/**
 * Server-side change detector for entity events, used when the database cannot
 * push them itself (no notify_entity_changed() triggers installed). It needs NO
 * database change: it only runs small read-only SELECTs.
 *
 * How it works
 *  - Every few seconds it asks Postgres for a tiny "fingerprint" per table (row
 *    count, newest timestamps, version sums). A fingerprint that differs from the
 *    previous one means something changed; the diff says which owner/assignee
 *    group changed, and that group's sockets get an `entity:changed` event.
 *  - poke() runs a check right away. The HTTP layer pokes after any write request
 *    the server handles, and browsers poke (over the socket) after writing through
 *    PostgREST, so changes made through the app appear almost instantly. The
 *    periodic check still catches writers the server never sees (cron, another
 *    app instance, direct SQL).
 *  - Per table, it stands down by itself when that table's push trigger exists in
 *    the database (the DB then delivers exact events and this would only repeat them).
 *
 * This IS polling, but it is one cheap server-side query set for the whole
 * deployment instead of one poll per browser tab. It is event-driven for every
 * change made through the app, and bounded-latency (OPERON_CHANGE_WATCH_MS, default
 * 3000) for everything else. Exact instant delivery for ALL writers needs the
 * DB trigger.
 */
import { ALL_USERS_ROOM, type ChangeEvent } from "@/lib/entity-events.server";

export type WatchSpec = {
  table: string;
  /** Constant read-only SELECT returning rows { k: text|null, fp: text }. */
  sql: string;
  /** Rooms to notify for a changed key. */
  rooms: (key: string | null) => string[];
  /** Routing columns to expose for a changed key (never row content). */
  row: (key: string | null) => Record<string, unknown>;
  /** If this DB trigger exists, the DB pushes events itself and we stand down. */
  standDownTrigger?: string;
  /** Socket event name; defaults to `entity:changed`. */
  event?: string;
};

const fp = (...cols: string[]) => `concat_ws('|', count(*), ${cols.join(", ")})`;
const mx = (c: string) => `coalesce(max(${c})::text, '-')`;

export const DEFAULT_SPECS: WatchSpec[] = [
  {
    table: "tasks",
    sql: `SELECT assigned_to::text AS k, ${fp(mx("updated_at"), "coalesce(sum(version), 0)")} AS fp
          FROM public.tasks GROUP BY assigned_to`,
    rooms: () => [ALL_USERS_ROOM],
    row: (k) => ({ assigned_to: k }),
    standDownTrigger: "trg_realtime_tasks",
  },
  {
    table: "nudges",
    sql: `SELECT user_id::text AS k, ${fp(mx("created_at"), mx("read_at"), mx("dismissed_at"), "count(read_at)", "count(dismissed_at)")} AS fp
          FROM public.nudges GROUP BY user_id`,
    rooms: (k) => (k ? [`user:${k}`] : []),
    row: (k) => ({ user_id: k }),
    standDownTrigger: "trg_realtime_nudges",
  },
  {
    table: "risk_events",
    sql: `SELECT NULL::text AS k, ${fp(mx("detected_at"), mx("resolved_at"), "count(resolved_at)")} AS fp FROM public.risk_events`,
    rooms: () => ["role:manager"],
    row: () => ({}),
    standDownTrigger: "trg_realtime_risk_events",
  },
  {
    table: "planning_suggestions",
    sql: `SELECT NULL::text AS k, ${fp(mx("created_at"), mx("resolved_at"), "count(resolved_at)", "count(*) FILTER (WHERE status = 'open')")} AS fp
          FROM public.planning_suggestions`,
    rooms: () => ["role:manager"],
    row: () => ({}),
    standDownTrigger: "trg_realtime_planning_suggestions",
  },
  {
    // Not covered by the proposed triggers: My Day and Manager show pending approvals.
    table: "approval_requests",
    sql: `SELECT NULL::text AS k, ${fp(mx("updated_at"), mx("completed_at"), "count(*) FILTER (WHERE status = 'pending')")} AS fp
          FROM public.approval_requests`,
    rooms: () => [ALL_USERS_ROOM],
    row: () => ({}),
  },
  {
    // A reviewer's partial approval changes only this table, not the task row, so the
    // tasks fingerprint would miss it. Rows are readable by every signed-in user
    // (task_review_decisions_read USING true), like tasks, so everyone is told.
    table: "task_review_decisions",
    sql: `SELECT NULL::text AS k, ${fp(mx("created_at"), mx("decided_at"), "count(decided_at)", "count(*) FILTER (WHERE decision = 'pending')")} AS fp
          FROM public.task_review_decisions`,
    rooms: () => [ALL_USERS_ROOM],
    row: () => ({}),
  },
  {
    // Automation health panel (admins): queue depth, 24h run counts, rule counts.
    // The payload carries no data; the panel refetches over HTTP, which enforces auth.
    table: "automation_health",
    event: "automation:health",
    sql: `SELECT NULL::text AS k, concat_ws('|',
            (SELECT concat_ws('|', pending_count, updated_at) FROM public.automation_queue_stats LIMIT 1),
            (SELECT concat_ws('|', count(*), count(*) FILTER (WHERE status = 'failed'), count(*) FILTER (WHERE status = 'dead'))
               FROM public.automation_runs WHERE started_at >= now() - INTERVAL '24 hours'),
            (SELECT concat_ws('|', count(*) FILTER (WHERE is_active AND auto_disabled_at IS NULL), count(*) FILTER (WHERE auto_disabled_at IS NOT NULL))
               FROM public.automation_rules)
          ) AS fp`,
    rooms: () => ["role:admin"],
    row: () => ({}),
  },
];

export type WatcherOptions = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
  emit: (rooms: string[], event: string, payload: ChangeEvent) => void;
  specs?: WatchSpec[];
  /** Periodic check interval. 0 disables the timer (pokes still work). */
  intervalMs?: number;
  /** Minimum gap between checks started by pokes. */
  minGapMs?: number;
  /** More changed groups than this in one check collapse into one refetch signal per table. */
  bulkThreshold?: number;
  /** How often to re-check whether push triggers exist. */
  standDownCheckMs?: number;
  log?: (msg: string) => void;
};

type TableState = { last: Map<string, string> | null; failures: number; disabledUntil: number };

export class EntityChangeWatcher {
  private readonly specs: WatchSpec[];
  private readonly state = new Map<string, TableState>();
  private readonly pushed = new Set<string>(); // tables whose DB trigger exists
  private timer: ReturnType<typeof setInterval> | null = null;
  private pokeTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private rerun = false;
  private lastStart = 0;
  private lastStandDownCheck = 0;
  private readonly intervalMs: number;
  private readonly minGapMs: number;
  private readonly bulkThreshold: number;
  private readonly standDownCheckMs: number;

  constructor(private readonly o: WatcherOptions) {
    this.specs = o.specs ?? DEFAULT_SPECS;
    for (const s of this.specs) {
      // Guard: this component may only ever send read-only statements.
      if (!/^\s*SELECT\b/i.test(s.sql) || /\b(INSERT|UPDATE\s+\w|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT)\b/i.test(s.sql)) {
        throw new Error(`entity watcher refuses non-SELECT spec for ${s.table}`);
      }
      this.state.set(s.table, { last: null, failures: 0, disabledUntil: 0 });
    }
    this.intervalMs = o.intervalMs ?? 3000;
    this.minGapMs = o.minGapMs ?? 150;
    this.bulkThreshold = o.bulkThreshold ?? 50;
    this.standDownCheckMs = o.standDownCheckMs ?? 60_000;
  }

  start(): void {
    if (this.timer || this.intervalMs <= 0) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref?.();
    void this.tick(); // baseline
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.pokeTimer) clearTimeout(this.pokeTimer);
    this.timer = this.pokeTimer = null;
  }

  /** Check soon (coalesced). Safe to call very often. */
  poke(): void {
    if (this.pokeTimer) return;
    const wait = Math.max(0, this.minGapMs - (Date.now() - this.lastStart));
    this.pokeTimer = setTimeout(() => {
      this.pokeTimer = null;
      void this.tick();
    }, wait);
    this.pokeTimer.unref?.();
  }

  /** Tables currently handled by the database's own triggers. */
  pushedTables(): string[] {
    return [...this.pushed];
  }

  private async refreshStandDown(): Promise<void> {
    const names = this.specs.map((s) => s.standDownTrigger).filter((x): x is string => !!x);
    if (names.length === 0) return;
    const { rows } = await this.o.query(
      "SELECT tgname FROM pg_trigger WHERE tgname = ANY($1) AND NOT tgisinternal",
      [names],
    );
    const found = new Set(rows.map((r) => String(r.tgname)));
    for (const s of this.specs) {
      if (!s.standDownTrigger) continue;
      const nowPushed = found.has(s.standDownTrigger);
      const was = this.pushed.has(s.table);
      if (nowPushed && !was) {
        this.pushed.add(s.table);
        this.o.log?.(`[EntityWatcher] DB trigger found for ${s.table}: standing down for that table`);
      } else if (!nowPushed && was) {
        this.pushed.delete(s.table);
        this.state.get(s.table)!.last = null; // rebuild a baseline, emit nothing for the gap
        this.o.log?.(`[EntityWatcher] DB trigger for ${s.table} is gone: resuming change detection`);
      }
    }
  }

  async tick(): Promise<void> {
    if (this.running) {
      this.rerun = true;
      return;
    }
    this.running = true;
    this.lastStart = Date.now();
    try {
      do {
        this.rerun = false;
        if (Date.now() - this.lastStandDownCheck >= this.standDownCheckMs || this.lastStandDownCheck === 0) {
          this.lastStandDownCheck = Date.now();
          try {
            await this.refreshStandDown();
          } catch (err) {
            this.o.log?.(`[EntityWatcher] trigger check failed: ${(err as Error).message}`);
          }
        }
        for (const spec of this.specs) {
          if (this.pushed.has(spec.table)) continue;
          await this.checkTable(spec);
        }
      } while (this.rerun);
    } finally {
      this.running = false;
    }
  }

  private async checkTable(spec: WatchSpec): Promise<void> {
    const st = this.state.get(spec.table)!;
    if (Date.now() < st.disabledUntil) return;
    let next: Map<string, string>;
    try {
      const { rows } = await this.o.query(spec.sql);
      next = new Map(rows.map((r) => [r.k == null ? "" : String(r.k), String(r.fp)]));
      st.failures = 0;
    } catch (err) {
      st.failures += 1;
      if (st.failures === 1) this.o.log?.(`[EntityWatcher] ${spec.table} check failed: ${(err as Error).message}`);
      if (st.failures >= 3) {
        st.disabledUntil = Date.now() + 5 * 60_000; // missing table/permissions: back off
        st.last = null;
        this.o.log?.(`[EntityWatcher] ${spec.table} disabled for 5 minutes after repeated errors`);
      }
      return;
    }

    const prev = st.last;
    st.last = next;
    if (!prev) return; // first look is the baseline: nothing to report

    const changed: string[] = [];
    for (const [k, v] of next) if (prev.get(k) !== v) changed.push(k);
    for (const k of prev.keys()) if (!next.has(k)) changed.push(k); // group disappeared
    if (changed.length === 0) return;

    try {
      if (changed.length > this.bulkThreshold) {
        const rooms = [...new Set(changed.flatMap((k) => spec.rooms(k === "" ? null : k)))];
        this.o.emit(rooms, spec.event ?? "entity:changed", { schema: "public", table: spec.table, eventType: "UPDATE", new: {}, old: {}, bulk: true });
        return;
      }
      for (const k of changed) {
        const key = k === "" ? null : k;
        const rooms = spec.rooms(key);
        if (rooms.length === 0) continue;
        this.o.emit(rooms, spec.event ?? "entity:changed", { schema: "public", table: spec.table, eventType: "UPDATE", new: spec.row(key), old: {} });
      }
    } catch (err) {
      this.o.log?.(`[EntityWatcher] emit failed: ${(err as Error).message}`);
    }
  }
}

// ---------- process-wide instance ----------
const g = globalThis as unknown as { __operonEntityWatcher?: EntityChangeWatcher };

export function pokeEntityWatcher(): void {
  g.__operonEntityWatcher?.poke();
}

export async function startEntityWatcher(): Promise<EntityChangeWatcher | null> {
  if (g.__operonEntityWatcher) return g.__operonEntityWatcher;
  const raw = process.env.OPERON_CHANGE_WATCH_MS;
  const intervalMs = raw === undefined || raw === "" ? 3000 : Number(raw);
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    console.log("[EntityWatcher] disabled (OPERON_CHANGE_WATCH_MS=0)");
    return null;
  }
  const [{ getPool }, { emitToRooms, setPokeHandler }] = await Promise.all([
    import("@/integrations/postgres/client.server"),
    import("@/lib/realtime.server"),
  ]);
  const pool = getPool();
  const w = new EntityChangeWatcher({
    intervalMs,
    query: (sql, params) =>
      pool.query({ text: sql, values: params, query_timeout: 5000 } as never) as never,
    emit: (rooms, event, payload) => emitToRooms(rooms, event, payload),
    log: (m) => console.log(m),
  });
  g.__operonEntityWatcher = w;
  setPokeHandler(() => w.poke());
  w.start();
  console.log(`[EntityWatcher] watching tasks, nudges, risk_events, planning_suggestions, approval_requests, task_review_decisions, automation_health every ${intervalMs}ms (read-only SELECTs)`);
  return w;
}
