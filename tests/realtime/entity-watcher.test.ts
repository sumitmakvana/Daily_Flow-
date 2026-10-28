// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ALL_USERS_ROOM } from "@/lib/entity-events.server";
import { DEFAULT_SPECS, EntityChangeWatcher, type WatchSpec } from "@/lib/entity-watcher.server";

type Rows = Array<{ k: string | null; fp: string }>;

/** A fake database: per-table fingerprint rows that a test can change, plus which triggers "exist". */
function fakeDb() {
  const tables: Record<string, Rows> = { tasks: [], nudges: [], risk_events: [], planning_suggestions: [], approval_requests: [], task_review_decisions: [], automation_queue_stats: [] };
  const triggers = new Set<string>();
  const sqlSeen: string[] = [];
  let failTable: string | null = null;
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    sqlSeen.push(sql);
    if (/FROM pg_trigger/.test(sql)) {
      const wanted = (params?.[0] as string[]) ?? [];
      return { rows: wanted.filter((n) => triggers.has(n)).map((tgname) => ({ tgname })) };
    }
    const table = Object.keys(tables).find((t) => new RegExp(`FROM public\\.${t}\\b`).test(sql));
    if (!table) throw new Error("unexpected sql");
    if (failTable === table) throw new Error(`relation "${table}" does not exist`);
    return { rows: tables[table] };
  });
  return { tables, triggers, query, sqlSeen, failOn: (t: string | null) => (failTable = t) };
}

const setup = (o: Partial<ConstructorParameters<typeof EntityChangeWatcher>[0]> = {}) => {
  const db = fakeDb();
  const emit = vi.fn();
  const log = vi.fn();
  const w = new EntityChangeWatcher({ query: db.query, emit, log, intervalMs: 0, ...o });
  return { db, emit, log, w };
};
const events = (emit: ReturnType<typeof vi.fn>) => emit.mock.calls.map(([rooms, ev, p]) => ({ rooms, ev, ...p }));

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("fingerprint diffing", () => {
  it("the first look is only a baseline: nothing is emitted", async () => {
    const { db, emit, w } = setup();
    db.tables.tasks = [{ k: "a", fp: "1|t1|1" }];
    await w.tick();
    expect(emit).not.toHaveBeenCalled();
  });

  it("no change between checks → no events", async () => {
    const { db, emit, w } = setup();
    db.tables.tasks = [{ k: "a", fp: "1|t1|1" }];
    await w.tick();
    await w.tick();
    await w.tick();
    expect(emit).not.toHaveBeenCalled();
  });

  it("an update in one assignee's group → ONE event for that assignee, to everyone's room, ids-free", async () => {
    const { db, emit, w } = setup();
    db.tables.tasks = [{ k: "alice", fp: "3|t1|3" }, { k: "bob", fp: "2|t1|2" }];
    await w.tick();
    db.tables.tasks = [{ k: "alice", fp: "3|t2|4" }, { k: "bob", fp: "2|t1|2" }];
    await w.tick();
    expect(events(emit)).toEqual([
      { rooms: [ALL_USERS_ROOM], ev: "entity:changed", schema: "public", table: "tasks", eventType: "UPDATE", new: { assigned_to: "alice" }, old: {} },
    ]);
  });

  it("a reassignment changes two groups → both assignees are named (so each user's filter matches)", async () => {
    const { db, emit, w } = setup();
    db.tables.tasks = [{ k: "alice", fp: "3|t1|3" }, { k: "bob", fp: "2|t1|2" }];
    await w.tick();
    db.tables.tasks = [{ k: "alice", fp: "2|t2|4" }, { k: "bob", fp: "3|t2|3" }];
    await w.tick();
    expect(events(emit).map((e) => e.new.assigned_to).sort()).toEqual(["alice", "bob"]);
  });

  it("a new group (first task for a user), a vanished group, and unassigned (null) are all detected", async () => {
    const { db, emit, w } = setup();
    db.tables.tasks = [{ k: "alice", fp: "1|t1|1" }, { k: "gone", fp: "1|t1|1" }];
    await w.tick();
    db.tables.tasks = [{ k: "alice", fp: "1|t1|1" }, { k: "new", fp: "1|t3|1" }, { k: null, fp: "1|t3|1" }];
    await w.tick();
    const names = events(emit).map((e) => e.new.assigned_to);
    expect(names.sort((a, b) => String(a).localeCompare(String(b)))).toEqual(["gone", "new", null].sort((a, b) => String(a).localeCompare(String(b))));
  });

  it("each table routes like the DB-trigger path: nudges → owner only, risks/suggestions → managers, approvals → everyone", async () => {
    const { db, emit, w } = setup();
    db.tables.nudges = [{ k: "u1", fp: "1" }];
    db.tables.risk_events = [{ k: null, fp: "1" }];
    db.tables.planning_suggestions = [{ k: null, fp: "1" }];
    db.tables.approval_requests = [{ k: null, fp: "1" }];
    await w.tick();
    db.tables.nudges = [{ k: "u1", fp: "2" }];
    db.tables.risk_events = [{ k: null, fp: "2" }];
    db.tables.planning_suggestions = [{ k: null, fp: "2" }];
    db.tables.approval_requests = [{ k: null, fp: "2" }];
    await w.tick();
    const byTable = Object.fromEntries(events(emit).map((e) => [e.table, e]));
    expect(byTable.nudges.rooms).toEqual(["user:u1"]);
    expect(byTable.nudges.new).toEqual({ user_id: "u1" });
    expect(byTable.risk_events.rooms).toEqual(["role:manager"]);
    expect(byTable.planning_suggestions.rooms).toEqual(["role:manager"]);
    expect(byTable.approval_requests.rooms).toEqual([ALL_USERS_ROOM]);
  });

  it("a reviewer's decision change (task row untouched) is announced to everyone", async () => {
    const { db, emit, w } = setup();
    db.tables.task_review_decisions = [{ k: null, fp: "2|c|-|0|2" }];
    await w.tick();
    db.tables.task_review_decisions = [{ k: null, fp: "2|c|d|1|1" }];
    await w.tick();
    const e = events(emit).filter((x) => x.table === "task_review_decisions");
    expect(e).toHaveLength(1);
    expect(e[0].rooms).toEqual([ALL_USERS_ROOM]);
  });

  it("a flood of changed groups collapses to ONE bulk 'refetch' signal per table", async () => {
    const { db, emit, w } = setup({ bulkThreshold: 5 });
    db.tables.tasks = Array.from({ length: 20 }, (_, i) => ({ k: `u${i}`, fp: "1" }));
    await w.tick();
    db.tables.tasks = Array.from({ length: 20 }, (_, i) => ({ k: `u${i}`, fp: "2" }));
    await w.tick();
    expect(emit).toHaveBeenCalledTimes(1);
    expect(events(emit)[0]).toMatchObject({ table: "tasks", bulk: true, new: {}, old: {}, rooms: [ALL_USERS_ROOM] });
  });

  it("an emit failure is logged and never breaks the watcher", async () => {
    const emit = vi.fn(() => {
      throw new Error("socket gone");
    });
    const { db, w, log } = setup({ emit });
    db.tables.tasks = [{ k: "a", fp: "1" }];
    await w.tick();
    db.tables.tasks = [{ k: "a", fp: "2" }];
    await expect(w.tick()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("emit failed"));
  });
});

describe("it only ever reads", () => {
  it("every statement it sends is a SELECT (fingerprints + trigger lookup)", async () => {
    const { db, w } = setup();
    for (const t of Object.keys(db.tables)) db.tables[t] = [{ k: null, fp: "1" }];
    await w.tick();
    await w.tick();
    expect(db.sqlSeen.length).toBeGreaterThan(5);
    for (const sql of db.sqlSeen) {
      expect(sql.trim()).toMatch(/^SELECT\b/i);
      expect(sql).not.toMatch(/\b(INSERT|UPDATE\s+\w|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT)\b/i);
    }
  });

  it("an automation health change emits automation:health to admins only", async () => {
    const { db, emit, w } = setup();
    db.tables.automation_queue_stats = [{ k: null, fp: "0|a" }];
    await w.tick();
    db.tables.automation_queue_stats = [{ k: null, fp: "7|b" }];
    await w.tick();
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0]).toEqual(["role:admin"]);
    expect(emit.mock.calls[0][1]).toBe("automation:health");
  });

  it("the shipped specs are all read-only SELECTs", () => {
    for (const s of DEFAULT_SPECS) expect(s.sql.trim()).toMatch(/^SELECT\b/i);
  });

  it("refuses to be constructed with a non-SELECT spec", () => {
    const bad: WatchSpec = { table: "tasks", sql: "DELETE FROM public.tasks", rooms: () => [], row: () => ({}) };
    expect(() => setup({ specs: [bad] })).toThrow(/non-SELECT/);
    const sneaky: WatchSpec = { table: "tasks", sql: "SELECT 1; DROP TABLE public.tasks", rooms: () => [], row: () => ({}) };
    expect(() => setup({ specs: [sneaky] })).toThrow(/non-SELECT/);
  });
});

describe("poke()", () => {
  it("checks right away (not after the periodic interval) and coalesces a burst into one check", async () => {
    const { db, emit, w } = setup({ intervalMs: 0, minGapMs: 150 });
    db.tables.tasks = [{ k: "a", fp: "1" }];
    await w.tick(); // baseline
    db.query.mockClear();
    db.tables.tasks = [{ k: "a", fp: "2" }];
    for (let i = 0; i < 50; i++) w.poke();
    await vi.advanceTimersByTimeAsync(300);
    expect(emit).toHaveBeenCalledTimes(1);
    const fingerprintQueries = db.query.mock.calls.filter(([sql]) => /FROM public\.tasks/.test(sql as string)).length;
    expect(fingerprintQueries).toBe(1); // 50 pokes → 1 check
  });

  it("a poke during a running check schedules exactly one follow-up (no overlap, nothing lost)", async () => {
    const { db, emit, w } = setup();
    db.tables.tasks = [{ k: "a", fp: "1" }];
    await w.tick();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const orig = db.query.getMockImplementation()!;
    db.query.mockImplementationOnce(async (sql: string, p?: unknown[]) => {
      await gate;
      return orig(sql, p);
    });
    const running = w.tick();
    db.tables.tasks = [{ k: "a", fp: "2" }]; // changes while the check is in flight
    void w.tick(); // overlapping call is folded into a re-run
    release();
    await running;
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it("the periodic timer keeps checking on its own (catches writers the server never sees)", async () => {
    const { db, emit, w } = setup({ intervalMs: 3000 });
    db.tables.tasks = [{ k: "a", fp: "1" }];
    w.start();
    await vi.advanceTimersByTimeAsync(10);
    db.tables.tasks = [{ k: "a", fp: "2" }]; // e.g. cron, another app instance, direct SQL
    await vi.advanceTimersByTimeAsync(3100);
    expect(emit).toHaveBeenCalledTimes(1);
    w.stop();
  });

  it("intervalMs 0 disables the timer (pokes still work)", async () => {
    const { db, w } = setup({ intervalMs: 0 });
    w.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe("stand-down when the database pushes events itself", () => {
  it("skips a table once its push trigger exists, but keeps watching tables the triggers don't cover", async () => {
    const { db, emit, w, log } = setup();
    db.triggers.add("trg_realtime_tasks");
    db.tables.tasks = [{ k: "a", fp: "1" }];
    db.tables.approval_requests = [{ k: null, fp: "1" }];
    await w.tick();
    expect(w.pushedTables()).toEqual(["tasks"]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("standing down for that table"));
    db.query.mockClear();
    db.tables.tasks = [{ k: "a", fp: "2" }];
    db.tables.approval_requests = [{ k: null, fp: "2" }];
    await w.tick();
    expect(db.query.mock.calls.some(([s]) => /FROM public\.tasks\b/.test(s as string))).toBe(false); // not even queried
    expect(events(emit).map((e) => e.table)).toEqual(["approval_requests"]); // no duplicate of the DB's own tasks events
  });

  it("resumes (with a fresh baseline, no phantom event) if the trigger is later removed", async () => {
    const { db, emit, w } = setup({ standDownCheckMs: 1000 });
    db.triggers.add("trg_realtime_tasks");
    db.tables.tasks = [{ k: "a", fp: "1" }];
    await w.tick();
    db.triggers.delete("trg_realtime_tasks"); // e.g. the rollback SQL was run
    db.tables.tasks = [{ k: "a", fp: "5" }];
    vi.advanceTimersByTime(1500);
    await w.tick();
    expect(w.pushedTables()).toEqual([]);
    expect(emit).not.toHaveBeenCalled(); // first look after resuming is a baseline
    db.tables.tasks = [{ k: "a", fp: "6" }];
    await w.tick();
    expect(emit).toHaveBeenCalledTimes(1);
  });
});

describe("failure handling", () => {
  it("a missing table backs off after 3 errors without affecting other tables, then is retried later", async () => {
    const { db, emit, w, log } = setup();
    db.tables.tasks = [{ k: "a", fp: "1" }];
    db.tables.approval_requests = [{ k: null, fp: "1" }];
    await w.tick();
    db.failOn("approval_requests");
    await w.tick();
    await w.tick();
    await w.tick();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("approval_requests disabled for 5 minutes"));
    db.query.mockClear();
    db.tables.tasks = [{ k: "a", fp: "2" }];
    await w.tick();
    expect(events(emit).map((e) => e.table)).toEqual(["tasks"]); // other tables unaffected
    expect(db.query.mock.calls.some(([s]) => /FROM public\.approval_requests\b/.test(s as string))).toBe(false);
    db.failOn(null);
    vi.advanceTimersByTime(5 * 60_000 + 1000);
    await w.tick(); // retried (new baseline)
    expect(db.query.mock.calls.some(([s]) => /FROM public\.approval_requests\b/.test(s as string))).toBe(true);
  });

  it("an error is logged once, not on every tick", async () => {
    const { db, w, log } = setup();
    db.failOn("tasks");
    await w.tick();
    await w.tick();
    expect(log.mock.calls.filter(([m]) => /tasks check failed/.test(m as string))).toHaveLength(1);
  });
});
