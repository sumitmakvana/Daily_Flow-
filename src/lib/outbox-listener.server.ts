/**
 * Delivers committed database changes to Socket.IO, with no polling of the data.
 *
 *   trigger (same transaction as the write) -> realtime.outbox row + NOTIFY realtime_outbox
 *   this listener (own connection, LISTEN)  -> EntityEventBatcher -> audience router -> sockets
 *
 * The outbox is what makes this lossless. NOTIFY alone is at-most-once: it is only delivered to
 * connected listeners. So after ANY reconnect the listener re-reads the outbox from its cursor and
 * delivers whatever it missed. The cursor is the highest id delivered, minus a safety margin,
 * because ids are allocated at INSERT but become visible at COMMIT, so two concurrent writers can
 * commit out of order. Rows inside the margin are replayed and removed again by id de-duplication,
 * so every event is delivered exactly once.
 *
 * Restarts: the cursor lives in memory. A new process baselines at the newest id and gets a fresh
 * boot id, so every browser answers "full" on its next resync (realtime.server.ts) and refetches
 * what it shows. A change made while the app was down is therefore picked up through the browser's
 * resync, not by replaying old outbox rows.
 *
 * Reliability, all reported with a "[Realtime]" console line (never silent):
 *  - the connection uses TCP keepalive (no application-level heartbeat query): the kernel probes an
 *    idle connection and surfaces a dead peer as a socket 'error'/'end', which replaces it;
 *  - reconnects back off 1s, 2s, ... up to 30s and the attempt number is logged;
 *  - if the outbox cannot prove nothing was lost (pruned past the cursor) `onGap` makes every
 *    connected browser refetch;
 *  - a missing outbox table or missing/disabled triggers are logged as errors at startup.
 * No statement is ever run on a healthy idle connection; the data is never polled.
 */
import { Client } from "pg";
import { READ_ONLY_PG_OPTIONS, isReadOnlyMode } from "@/lib/read-only-mode.server";
import { ALL_USERS_ROOM, EntityEventBatcher, type EntityMessage } from "@/lib/entity-events.server";
import { emitToRooms } from "@/lib/realtime.server";

export const OUTBOX_CHANNEL = "realtime_outbox";

export type OutboxMessage = {
  id: number;
  table: string;
  op: string;
  row_id: string | null;
  keys: Record<string, unknown>;
};

export interface ListenClient {
  connect(): Promise<unknown>;
  query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  on(event: string, fn: (...args: any[]) => void): unknown;
  removeAllListeners(event?: string): unknown;
  end(): Promise<unknown>;
}

/** Every trigger the migration installs; the listener verifies they exist and are enabled. */
const ROW_TABLES = [
  "tasks", "nudges", "risk_events", "planning_suggestions", "approval_requests",
  "task_review_decisions", "task_worklogs", "leaves", "eod_checkins",
];
export const REQUIRED_TRIGGERS: string[] = ROW_TABLES.flatMap((t) => [
  `trg_realtime_${t}`,
  `trg_realtime_${t}_truncate`,
]);

export type OutboxListenerOptions = {
  createClient: () => ListenClient;
  deliver: (m: OutboxMessage) => void;
  /** Nothing can prove no event was missed: make every connected browser refetch. */
  onGap: (reason: string) => void;
  readOnly?: boolean;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  /** Ids replayed below the cursor to cover out-of-order commits. */
  margin?: number;
  /** De-duplication memory (ids). Must be larger than `margin`. */
  seenMax?: number;
  requiredTriggers?: string[];
  log?: (msg: string) => void;
  error?: (msg: string, err?: unknown) => void;
};

export type OutboxStatus = {
  connected: boolean;
  /** "outbox-missing" when the migration is not applied. */
  degraded: string | null;
  cursor: number | null;
  delivered: number;
  duplicates: number;
  replayed: number;
  reconnects: number;
  gaps: number;
  deliverErrors: number;
  missingTriggers: string[];
  lastError: string | null;
};

const COLS = `id, table_name, op, row_id, payload`;
const MISSING_RELATION = new Set(["42P01", "3F000"]); // undefined_table, invalid_schema_name

const asMessage = (r: Record<string, unknown>): OutboxMessage => ({
  id: Number(r.id),
  table: String(r.table_name),
  op: String(r.op),
  row_id: r.row_id == null ? null : String(r.row_id),
  keys: (r.payload && typeof r.payload === "object" ? r.payload : {}) as Record<string, unknown>,
});

export class OutboxListener {
  private client: ListenClient | null = null;
  private stopped = false;
  private connecting = false;
  private cursor: number | null = null;
  private readonly seen = new Set<number>();
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly s: OutboxStatus = {
    connected: false, degraded: null, cursor: null, delivered: 0, duplicates: 0, replayed: 0,
    reconnects: 0, gaps: 0, deliverErrors: 0, missingTriggers: [], lastError: null,
  };
  private readonly o: Required<Omit<OutboxListenerOptions, "log" | "error">> &
    Pick<OutboxListenerOptions, "log" | "error">;

  constructor(opts: OutboxListenerOptions) {
    this.o = {
      readOnly: false,
      backoffBaseMs: 1_000,
      backoffMaxMs: 30_000,
      margin: 1_000,
      seenMax: 10_000,
      requiredTriggers: REQUIRED_TRIGGERS,
      ...opts,
    };
  }

  status(): OutboxStatus {
    return { ...this.s, cursor: this.cursor, missingTriggers: [...this.s.missingTriggers] };
  }

  start(): void {
    this.stopped = false;
    void this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const c = this.client;
    this.client = null;
    this.s.connected = false;
    if (c) {
      c.removeAllListeners();
      c.on("error", () => {});
      await c.end().catch(() => {});
    }
  }

  private log(m: string) {
    (this.o.log ?? console.log)(`[Realtime] ${m}`);
  }
  private err(m: string, e?: unknown) {
    this.s.lastError = e instanceof Error ? e.message : e ? String(e) : m;
    (this.o.error ?? console.error)(`[Realtime] ${m}`, ...(e ? [e instanceof Error ? e.message : e] : []));
  }

  // ---------- connection lifecycle ----------

  private async connect(): Promise<void> {
    if (this.stopped || this.connecting || this.client) return;
    this.connecting = true;
    const client = this.o.createClient();
    this.client = client;
    // Handlers first: an error while connecting must be handled, not crash the process.
    client.on("error", (e: Error) => this.lost(client, e));
    client.on("end", () => this.lost(client, new Error("connection ended")));
    client.on("notification", (n: { channel?: string; payload?: string }) => {
      if (this.client === client && n.channel === OUTBOX_CHANNEL) void this.onNotify(client, n.payload);
    });
    try {
      await client.connect();
      // LISTEN first, then read the outbox: anything committed in between is both announced and
      // read, and the id de-duplication keeps it to one delivery.
      await client.query(`LISTEN ${OUTBOX_CHANNEL}`);
      await this.catchUp(client);
      await this.verifyTriggers(client);
      if (this.client !== client || this.stopped) return;
      this.attempt = 0;
      this.s.connected = true;
      this.log(`listening on "${OUTBOX_CHANNEL}"${this.s.degraded ? ` (DEGRADED: ${this.s.degraded})` : ""}`);
    } catch (e) {
      this.lost(client, e);
    } finally {
      this.connecting = false;
    }
  }

  private lost(client: ListenClient, e: unknown): void {
    if (this.client !== client) return; // a connection we already replaced
    this.client = null;
    this.s.connected = false;
    client.removeAllListeners();
    client.on("error", () => {}); // late errors from a dead socket must not crash the process
    void client.end().catch(() => {});
    if (this.stopped) return;
    this.s.reconnects += 1;
    this.attempt += 1;
    const delay = Math.min(this.o.backoffBaseMs * 2 ** (this.attempt - 1), this.o.backoffMaxMs);
    this.err(`listener connection lost (${e instanceof Error ? e.message : String(e)}); reconnect #${this.attempt} in ${delay}ms`, undefined);
    this.s.lastError = e instanceof Error ? e.message : String(e);
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  // ---------- recovery ----------

  private async catchUp(client: ListenClient): Promise<void> {
    try {
      if (this.cursor === null) {
        // First connection of this process: baseline. Browsers resync in full (new boot id).
        const { rows } = await client.query("SELECT COALESCE(max(id), 0) AS max FROM realtime.outbox");
        this.cursor = Number(rows[0]?.max ?? 0);
        if (!this.o.readOnly) {
          await client
            .query("DELETE FROM realtime.outbox WHERE created_at < now() - interval '24 hours'")
            .catch((e) => this.err("outbox prune failed", e));
        }
        this.s.degraded = null;
        return;
      }
      const from = Math.max(0, this.cursor - this.o.margin);
      const { rows } = await client.query(`SELECT ${COLS} FROM realtime.outbox WHERE id > $1 ORDER BY id`, [from]);
      const { rows: info } = await client.query(
        "SELECT (SELECT min(id) FROM realtime.outbox) AS min, (SELECT last_value FROM realtime.outbox_id_seq) AS last",
      );
      this.s.degraded = null;
      const min = info[0]?.min == null ? null : Number(info[0].min);
      const last = Number(info[0]?.last ?? 0);
      // Outbox rows that should still be there but are not (pruned past the cursor): we cannot prove
      // nothing was missed, so everyone refetches. Holes up to `margin` are rolled-back writes.
      const pruned = min !== null ? min > this.cursor + 1 + this.o.margin : last > this.cursor;
      let replayed = 0;
      for (const r of rows) if (this.process(asMessage(r))) replayed += 1;
      this.s.replayed += replayed;
      if (replayed > 0) this.log(`reconnected: replayed ${replayed} missed event(s) from the outbox`);
      if (pruned) {
        this.s.gaps += 1;
        this.err("outbox no longer covers the disconnected period; asking every browser to refetch");
        this.o.onGap("outbox-pruned");
      }
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code && MISSING_RELATION.has(code)) {
        this.s.degraded = "outbox-missing";
        this.err(
          "realtime.outbox does not exist: apply supabase/migrations/20261031000000_realtime_outbox.sql. " +
            "Live updates are DISABLED until it is applied (pages still load over REST).",
        );
        return; // stay connected: once the migration is applied, notifications flow without a restart
      }
      throw e;
    }
  }

  private async verifyTriggers(client: ListenClient): Promise<void> {
    if (this.s.degraded) return;
    const { rows } = await client.query(
      "SELECT tgname, tgenabled FROM pg_trigger WHERE tgname LIKE 'trg\\_realtime\\_%' AND NOT tgisinternal",
    );
    const ok = new Set(rows.filter((r) => r.tgenabled !== "D").map((r) => String(r.tgname)));
    const missing = this.o.requiredTriggers.filter((t) => !ok.has(t));
    this.s.missingTriggers = missing;
    if (missing.length > 0) {
      this.err(
        `MISSING or disabled realtime triggers: ${missing.join(", ")}. Changes to those tables will NOT produce live updates. ` +
          "Re-apply supabase/migrations/20261031000000_realtime_outbox.sql.",
      );
    }
  }

  // ---------- delivery ----------

  private async onNotify(client: ListenClient, payload: string | undefined): Promise<void> {
    let p: Partial<OutboxMessage> & { id?: number };
    try {
      p = JSON.parse(payload ?? "");
    } catch {
      this.err(`unreadable NOTIFY payload ignored: ${String(payload).slice(0, 80)}`);
      return;
    }
    if (typeof p.id !== "number") {
      this.err("NOTIFY without an id ignored");
      return;
    }
    if (this.s.degraded) {
      this.s.degraded = null;
      this.log("outbox is now available");
    }
    if (p.table) {
      this.process({ id: p.id, table: p.table, op: String(p.op), row_id: p.row_id ?? null, keys: p.keys ?? {} });
      return;
    }
    // Oversized notification: only the id was sent. The row is committed, so it can be read back.
    try {
      const { rows } = await client.query(`SELECT ${COLS} FROM realtime.outbox WHERE id = $1`, [p.id]);
      if (rows[0]) this.process(asMessage(rows[0]));
      else this.err(`outbox row ${p.id} was announced but cannot be read`);
    } catch (e) {
      this.err(`could not read outbox row ${p.id}`, e);
    }
  }

  /** Deliver one event exactly once. Returns false for a duplicate. */
  private process(m: OutboxMessage): boolean {
    if (this.seen.has(m.id)) {
      this.s.duplicates += 1;
      return false;
    }
    this.seen.add(m.id);
    if (this.seen.size > this.o.seenMax) this.seen.delete(this.seen.values().next().value as number);
    if (this.cursor === null || m.id > this.cursor) this.cursor = m.id;
    try {
      this.o.deliver(m);
      this.s.delivered += 1;
    } catch (e) {
      this.s.deliverErrors += 1;
      this.err(`delivery of outbox event ${m.id} (${m.table} ${m.op}) failed`, e);
    }
    return true;
  }
}

// ---------- process-wide instance ----------
const g = globalThis as unknown as { __operonOutboxListener?: OutboxListener };

export function getOutboxStatus(): OutboxStatus | null {
  return g.__operonOutboxListener?.status() ?? null;
}

/** Everyone refetches what they show: used only when the outbox cannot prove nothing was missed. */
export function emitResyncAll(emit: typeof emitToRooms = emitToRooms): void {
  for (const table of ROW_TABLES) {
    const rooms = table === "risk_events" || table === "planning_suggestions" ? ["role:manager"] : [ALL_USERS_ROOM];
    emit(rooms, "entity:changed", { schema: "public", table, eventType: "UPDATE", new: {}, old: {}, bulk: true });
  }
}

export function startOutboxListener(): OutboxListener | null {
  if (g.__operonOutboxListener) return g.__operonOutboxListener;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("[Realtime] DATABASE_URL is not set: live updates are DISABLED");
    return null;
  }
  const readOnly = isReadOnlyMode();
  const batcher = new EntityEventBatcher({ emit: emitToRooms });
  const l = new OutboxListener({
    readOnly,
    createClient: () =>
      new Client({
        connectionString,
        keepAlive: true,
        keepAliveInitialDelayMillis: 10_000,
        application_name: readOnly ? "operon-realtime-readonly" : "operon-realtime",
        ssl: process.env.PG_SSL === "true" ? { rejectUnauthorized: false } : undefined,
        ...(readOnly ? { options: READ_ONLY_PG_OPTIONS } : {}),
      }) as unknown as ListenClient,
    deliver: (m) => batcher.push({ ...m.keys, table: m.table, op: m.op, id: m.row_id } as EntityMessage),
    onGap: () => emitResyncAll(),
  });
  g.__operonOutboxListener = l;
  l.start();
  return l;
}
