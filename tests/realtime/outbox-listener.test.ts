// @vitest-environment node
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OUTBOX_CHANNEL,
  OutboxListener,
  REQUIRED_TRIGGERS,
  emitResyncAll,
  type ListenClient,
  type OutboxMessage,
} from "@/lib/outbox-listener.server";

type Row = { id: number; table_name: string; op: string; row_id: string | null; payload: Record<string, unknown> };

/** A scripted stand-in for a pg.Client plus the outbox table behind it. */
class FakeDb {
  rows: Row[] = [];
  seqLast = 0;
  triggers: string[] = [...REQUIRED_TRIGGERS];
  clients: FakeClient[] = [];
  connectError: Error | null = null;
  queryError: ((text: string) => Error | null) | null = null;
  heartbeat: "ok" | "fail" | "hang" = "ok";
  commit(table: string, op = "UPDATE", keys: Record<string, unknown> = {}, rowId: string | null = "r") {
    const id = ++this.seqLast;
    this.rows.push({ id, table_name: table, op, row_id: rowId, payload: keys });
    return id;
  }
  /** What Postgres does at COMMIT: tell every connected listener. */
  notify(row: Row, idOnly = false) {
    const body = idOnly
      ? { id: row.id }
      : { id: row.id, table: row.table_name, op: row.op, row_id: row.row_id, keys: row.payload };
    for (const c of this.clients) if (c.connected) c.emit("notification", { channel: OUTBOX_CHANNEL, payload: JSON.stringify(body) });
  }
  newClient() {
    const c = new FakeClient(this);
    this.clients.push(c);
    return c;
  }
}

class FakeClient extends EventEmitter implements ListenClient {
  connected = false;
  ended = false;
  queries: string[] = [];
  constructor(private db: FakeDb) {
    super();
  }
  async connect() {
    if (this.db.connectError) throw this.db.connectError;
    this.connected = true;
  }
  async query(text: string, values?: unknown[]) {
    this.queries.push(text);
    const forced = this.db.queryError?.(text);
    if (forced) throw forced;
    if (text === "SELECT 1") {
      if (this.db.heartbeat === "fail") throw new Error("terminating connection");
      if (this.db.heartbeat === "hang") return new Promise<never>(() => {});
      return { rows: [{ "?column?": 1 }] };
    }
    if (text.startsWith("LISTEN")) return { rows: [] };
    if (text.includes("COALESCE(max(id), 0) AS max")) return { rows: [{ max: Math.max(0, ...this.db.rows.map((r) => r.id)) }] };
    if (text.startsWith("DELETE FROM realtime.outbox")) return { rows: [] };
    if (text.includes("WHERE id > $1")) return { rows: this.db.rows.filter((r) => r.id > Number(values![0])).sort((a, b) => a.id - b.id) };
    if (text.includes("last_value")) {
      const ids = this.db.rows.map((r) => r.id);
      return { rows: [{ min: ids.length ? Math.min(...ids) : null, last: this.db.seqLast }] };
    }
    if (text.includes("WHERE id = $1")) return { rows: this.db.rows.filter((r) => r.id === Number(values![0])) };
    if (text.includes("pg_trigger")) return { rows: this.db.triggers.map((tgname) => ({ tgname, tgenabled: "O" })) };
    throw new Error(`unscripted query: ${text}`);
  }
  async end() {
    this.ended = true;
    this.connected = false;
  }
  /** Simulate the server dropping the connection. */
  drop(err = new Error("Connection terminated unexpectedly")) {
    this.connected = false;
    this.emit("error", err);
    this.emit("end");
  }
}

let db: FakeDb;
let delivered: OutboxMessage[];
let gaps: string[];
let logs: string[];
let errors: string[];
const make = (extra: Partial<ConstructorParameters<typeof OutboxListener>[0]> = {}) =>
  new OutboxListener({
    createClient: () => db.newClient(),
    deliver: (m) => delivered.push(m),
    onGap: (r) => gaps.push(r),
    log: (m) => logs.push(m),
    error: (m, e) => errors.push(e ? `${m} ${String(e)}` : m),
    ...extra,
  });
const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => {
  vi.useFakeTimers();
  db = new FakeDb();
  delivered = [];
  gaps = [];
  logs = [];
  errors = [];
});
afterEach(() => vi.useRealTimers());

describe("startup", () => {
  it("LISTENs, baselines at the newest outbox id (no replay of old rows) and reports healthy", async () => {
    db.commit("tasks");
    db.commit("tasks");
    const l = make();
    l.start();
    await tick();
    const s = l.status();
    expect(s.connected).toBe(true);
    expect(s.cursor).toBe(2);
    expect(delivered).toEqual([]);
    expect(s.missingTriggers).toEqual([]);
    expect(db.clients[0].queries[0]).toBe(`LISTEN ${OUTBOX_CHANNEL}`);
    await l.stop();
  });

  it("prunes old outbox rows at startup, but never in read-only mode", async () => {
    const a = make();
    a.start();
    await tick();
    expect(db.clients[0].queries.some((q) => q.startsWith("DELETE FROM realtime.outbox"))).toBe(true);
    await a.stop();
    db = new FakeDb();
    const b = make({ readOnly: true });
    b.start();
    await tick();
    expect(db.clients[0].queries.some((q) => q.startsWith("DELETE"))).toBe(false);
    await b.stop();
  });

  it("logs a clear error naming the missing triggers", async () => {
    db.triggers = REQUIRED_TRIGGERS.filter((t) => t !== "trg_realtime_leaves" && t !== "trg_realtime_tasks_truncate");
    const l = make();
    l.start();
    await tick();
    expect(l.status().missingTriggers).toEqual(["trg_realtime_tasks_truncate", "trg_realtime_leaves"].sort((a, b) => REQUIRED_TRIGGERS.indexOf(a) - REQUIRED_TRIGGERS.indexOf(b)));
    expect(errors.join("\n")).toMatch(/MISSING or disabled realtime triggers: .*trg_realtime_leaves/);
    await l.stop();
  });
});

describe("delivery and duplicates", () => {
  it("delivers each committed change exactly once and exposes the routing keys", async () => {
    const l = make();
    l.start();
    await tick();
    const id = db.commit("tasks", "UPDATE", { assigned_to: "alice" }, "t1");
    db.notify(db.rows[0]);
    await tick();
    expect(delivered).toEqual([{ id, table: "tasks", op: "UPDATE", row_id: "t1", keys: { assigned_to: "alice" } }]);
    await l.stop();
  });

  it("a duplicate NOTIFY (or the same event read again from the outbox) is dropped and counted", async () => {
    const l = make();
    l.start();
    await tick();
    db.commit("tasks");
    db.notify(db.rows[0]);
    db.notify(db.rows[0]);
    db.notify(db.rows[0], true);
    await tick();
    expect(delivered).toHaveLength(1);
    expect(l.status().duplicates).toBe(2);
    await l.stop();
  });

  it("an oversized event announced by id only is read back from the outbox", async () => {
    const l = make();
    l.start();
    await tick();
    db.commit("tasks", "UPDATE", { assigned_to: "a", reviewers: ["x", "y"] }, "big");
    db.notify(db.rows[0], true);
    await tick();
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({ table: "tasks", row_id: "big", keys: { reviewers: ["x", "y"] } });
    await l.stop();
  });

  it("garbage or id-less notifications are reported, never delivered, and do not break the stream", async () => {
    const l = make();
    l.start();
    await tick();
    db.clients[0].emit("notification", { channel: OUTBOX_CHANNEL, payload: "{not json" });
    db.clients[0].emit("notification", { channel: OUTBOX_CHANNEL, payload: JSON.stringify({ table: "tasks" }) });
    db.clients[0].emit("notification", { channel: "some_other_channel", payload: JSON.stringify({ id: 99, table: "tasks" }) });
    db.commit("tasks");
    db.notify(db.rows[0]);
    await tick();
    expect(delivered).toHaveLength(1);
    expect(errors.filter((e) => /unreadable|without an id/.test(e))).toHaveLength(2);
    await l.stop();
  });

  it("a delivery that throws is reported and counted; the cursor still advances and later events flow", async () => {
    let n = 0;
    const l = make({
      deliver: (m) => {
        if (n++ === 0) throw new Error("emit exploded");
        delivered.push(m);
      },
    });
    l.start();
    await tick();
    db.commit("tasks");
    db.commit("leaves");
    db.rows.forEach((r) => db.notify(r));
    await tick();
    expect(delivered.map((m) => m.table)).toEqual(["leaves"]);
    expect(l.status().deliverErrors).toBe(1);
    expect(errors.join("\n")).toMatch(/outbox event 1 \(tasks UPDATE\) failed/);
    await l.stop();
  });
});

describe("reconnect and outbox recovery (nothing committed is lost)", () => {
  it("reconnects with exponential backoff, logging every attempt", async () => {
    const l = make();
    l.start();
    await tick();
    db.connectError = new Error("ECONNREFUSED");
    db.clients[0].drop();
    await tick(999);
    expect(db.clients).toHaveLength(1); // first retry is at 1000ms
    await tick(1);
    expect(db.clients).toHaveLength(2);
    await tick(2000); // 2nd retry after 2s
    expect(db.clients).toHaveLength(3);
    await tick(4000);
    expect(db.clients).toHaveLength(4);
    expect(errors.filter((e) => /reconnect #\d+ in \d+ms/.test(e)).map((e) => e.match(/#(\d+) in (\d+)ms/)!.slice(1).join(":"))).toEqual(["1:1000", "2:2000", "3:4000", "4:8000"]);
    db.connectError = null;
    await tick(8000);
    expect(l.status().connected).toBe(true);
    await l.stop();
  });

  it("backoff is capped at 30s", async () => {
    const l = make({ backoffMaxMs: 30_000 });
    l.start();
    await tick();
    db.connectError = new Error("down");
    db.clients[0].drop();
    for (let i = 0; i < 9; i++) await tick(30_000);
    const delays = errors.map((e) => Number(e.match(/in (\d+)ms/)?.[1])).filter(Boolean);
    expect(Math.max(...delays)).toBe(30_000);
    await l.stop();
  });

  it("'error' and 'end' firing together cause ONE reconnect, never two competing clients", async () => {
    const l = make();
    l.start();
    await tick();
    db.clients[0].drop();
    await tick(1000);
    expect(db.clients).toHaveLength(2);
    expect(db.clients[0].ended).toBe(true);
    await l.stop();
  });

  it("events committed while the listener was down are replayed from the outbox exactly once", async () => {
    const l = make();
    l.start();
    await tick();
    db.commit("tasks", "UPDATE", { assigned_to: "a" }, "before");
    db.notify(db.rows[0]);
    await tick();
    expect(delivered).toHaveLength(1);

    db.clients[0].drop(); // connection lost
    db.commit("tasks", "UPDATE", { assigned_to: "a" }, "during-1"); // nobody hears these NOTIFYs
    db.commit("leaves", "INSERT", { user_id: "u" }, "during-2");
    await tick(1000); // reconnect + catch-up
    expect(delivered.map((m) => m.row_id)).toEqual(["before", "during-1", "during-2"]);
    expect(l.status().replayed).toBe(2);
    expect(logs.join("\n")).toMatch(/replayed 2 missed event/);
    expect(gaps).toEqual([]); // the outbox fully covers the outage: no "everyone refetch"
    await l.stop();
  });

  it("an out-of-order commit (lower id commits AFTER a higher one) is not lost across a reconnect", async () => {
    const l = make();
    l.start();
    await tick();
    const slow = db.commit("tasks", "UPDATE", {}, "slow"); // id 1, transaction still open
    const fast = db.commit("tasks", "UPDATE", {}, "fast"); // id 2 commits first
    const slowRow = db.rows.splice(0, 1)[0]; // not visible yet
    db.notify(db.rows[0]);
    await tick();
    expect(delivered.map((m) => m.row_id)).toEqual(["fast"]);
    db.clients[0].drop(); // the slow commit lands while we are disconnected
    db.rows.unshift(slowRow);
    expect(slow).toBeLessThan(fast);
    await tick(1000);
    expect(delivered.map((m) => m.row_id)).toEqual(["fast", "slow"]);
    await l.stop();
  });

  it("an event that arrives both as NOTIFY and in the catch-up read is delivered once", async () => {
    const l = make();
    l.start();
    await tick();
    db.clients[0].drop();
    db.commit("tasks", "UPDATE", {}, "x");
    const orig = db.newClient.bind(db);
    db.newClient = () => {
      const c = orig();
      const q = c.query.bind(c);
      c.query = async (text: string, v?: unknown[]) => {
        const r = await q(text, v);
        if (text.startsWith("LISTEN")) db.notify(db.rows[0]); // announced right after LISTEN...
        return r; // ...and also returned by the catch-up SELECT that follows
      };
      return c;
    };
    await tick(1000);
    expect(delivered.map((m) => m.row_id)).toEqual(["x"]);
    await l.stop();
  });

  it("if the outbox no longer covers the outage, everyone is told to refetch (and the error is logged)", async () => {
    const l = make({ margin: 10 });
    l.start();
    await tick();
    db.commit("tasks");
    db.notify(db.rows[0]);
    await tick();
    db.clients[0].drop();
    for (let i = 0; i < 50; i++) db.commit("tasks", "UPDATE", {}, `gone-${i}`);
    db.rows = db.rows.slice(40); // pruned: ids 1..40 are gone, 41..51 remain
    await tick(1000);
    expect(gaps).toEqual(["outbox-pruned"]);
    expect(l.status().gaps).toBe(1);
    expect(errors.join("\n")).toMatch(/no longer covers the disconnected period/);
    await l.stop();
  });

  it("an empty outbox whose sequence moved past the cursor is also a gap", async () => {
    const l = make();
    l.start();
    await tick();
    db.clients[0].drop();
    db.seqLast = 25; // 25 events happened and were pruned
    await tick(1000);
    expect(gaps).toEqual(["outbox-pruned"]);
    await l.stop();
  });

  it("rolled-back writes leave harmless id holes: no false 'gap'", async () => {
    const l = make();
    l.start();
    await tick();
    db.commit("tasks", "UPDATE", {}, "a");
    db.notify(db.rows[0]);
    await tick();
    db.clients[0].drop();
    db.seqLast += 30; // ids burned by rolled-back transactions
    db.commit("tasks", "UPDATE", {}, "b");
    await tick(1000);
    expect(gaps).toEqual([]);
    expect(delivered.map((m) => m.row_id)).toEqual(["a", "b"]);
    await l.stop();
  });

  it("a query failing during catch-up is retried with backoff, never swallowed", async () => {
    const l = make();
    l.start();
    await tick();
    db.clients[0].drop();
    let failOnce = true;
    db.queryError = (t) => (t.includes("WHERE id > $1") && failOnce ? ((failOnce = false), new Error("canceling statement due to statement timeout")) : null);
    await tick(1000);
    expect(l.status().connected).toBe(false);
    expect(errors.join("\n")).toMatch(/statement timeout/);
    await tick(2000);
    expect(l.status().connected).toBe(true);
    await l.stop();
  });
});

describe("heartbeat", () => {
  it("a healthy connection runs ONLY `SELECT 1` after startup: the data tables are never polled", async () => {
    const l = make({ heartbeatMs: 30_000 });
    l.start();
    await tick();
    const startupQueries = db.clients[0].queries.length;
    await tick(10 * 60_000);
    const later = db.clients[0].queries.slice(startupQueries);
    expect(later.length).toBe(20);
    expect(new Set(later)).toEqual(new Set(["SELECT 1"]));
    expect(l.status().lastHeartbeatAt).not.toBeNull();
    await l.stop();
  });

  it("a failing heartbeat replaces the connection", async () => {
    const l = make({ heartbeatMs: 30_000 });
    l.start();
    await tick();
    db.heartbeat = "fail";
    await tick(30_000);
    expect(l.status().connected).toBe(false);
    db.heartbeat = "ok";
    await tick(1000);
    expect(db.clients).toHaveLength(2);
    expect(l.status().connected).toBe(true);
    await l.stop();
  });

  it("a HUNG connection (no answer at all) is detected by the heartbeat timeout", async () => {
    const l = make({ heartbeatMs: 30_000, heartbeatTimeoutMs: 5_000 });
    l.start();
    await tick();
    db.heartbeat = "hang";
    await tick(30_000);
    expect(l.status().connected).toBe(true); // not yet: waiting for the answer
    await tick(5_000);
    expect(l.status().connected).toBe(false);
    expect(errors.join("\n")).toMatch(/heartbeat timed out/);
    db.heartbeat = "ok";
    await tick(1000);
    expect(l.status().connected).toBe(true);
    await l.stop();
  });
});

describe("clear error reporting", () => {
  it("a missing outbox table is reported with the fix, does not loop, and recovers when the migration is applied", async () => {
    db.queryError = (t) => (t.includes("COALESCE(max(id), 0)") ? Object.assign(new Error('relation "realtime.outbox" does not exist'), { code: "42P01" }) : null);
    const l = make();
    l.start();
    await tick();
    expect(l.status().degraded).toBe("outbox-missing");
    expect(l.status().connected).toBe(true); // still LISTENing
    expect(errors.filter((e) => /20261031000000_realtime_outbox\.sql/.test(e))).toHaveLength(1);
    await tick(5 * 60_000);
    expect(db.clients).toHaveLength(1); // no reconnect loop
    expect(errors.filter((e) => /outbox\.sql/.test(e))).toHaveLength(1); // not spammed

    db.queryError = null; // migration applied
    db.commit("tasks", "UPDATE", { assigned_to: "a" }, "now-works");
    db.notify(db.rows[0]);
    await tick();
    expect(l.status().degraded).toBeNull();
    expect(delivered.map((m) => m.row_id)).toEqual(["now-works"]);
    await l.stop();
  });

  it("stop() ends the connection and cancels pending reconnects", async () => {
    const l = make();
    l.start();
    await tick();
    db.clients[0].drop();
    await l.stop();
    await tick(60_000);
    expect(db.clients).toHaveLength(1);
    expect(db.clients[0].ended).toBe(true);
  });
});

describe("emitResyncAll (used only when the outbox cannot prove nothing was missed)", () => {
  it("asks each audience class to refetch each table once; admins get the health signal", () => {
    const emit = vi.fn();
    emitResyncAll(emit);
    const byTable = Object.fromEntries(emit.mock.calls.map((c) => [c[2].table, c[0]]));
    expect(byTable.tasks).toEqual(["authenticated"]);
    expect(byTable.leaves).toEqual(["authenticated"]);
    expect(byTable.task_worklogs).toEqual(["authenticated"]);
    expect(byTable.risk_events).toEqual(["role:manager"]);
    expect(byTable.planning_suggestions).toEqual(["role:manager"]);
    expect(byTable.automation_health).toEqual(["role:admin"]);
    expect(emit.mock.calls.every((c) => c[2].bulk === true)).toBe(true);
    expect(emit.mock.calls.find((c) => c[2].table === "automation_health")![1]).toBe("automation:health");
  });
});
