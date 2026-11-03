// @vitest-environment node
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { io as connect, type Socket } from "socket.io-client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADMINS_ROOM,
  ALL_USERS_ROOM,
  EntityEventBatcher,
  MANAGERS_ROOM,
  routeEntityMessage,
} from "@/lib/entity-events.server";

const rooms = (m: Record<string, unknown>) => [...routeEntityMessage(m)!.rooms].sort();

describe("routeEntityMessage: who is told (audience rules)", () => {
  it("tasks → assignee, previous assignee, reviewer(s), creator and managers; NEVER the all-users room", () => {
    const d = routeEntityMessage({
      table: "tasks", op: "UPDATE", id: "t1", assigned_to: "b", old_assigned_to: "a", reviewer: "r", old_reviewer: "r0",
      created_by: "c", reviewers: ["r", "r2"],
    })!;
    expect([...d.rooms].sort()).toEqual(
      [MANAGERS_ROOM, "user:a", "user:b", "user:c", "user:r", "user:r0", "user:r2"].sort(),
    );
    expect(d.rooms).not.toContain(ALL_USERS_ROOM);
  });
  it("an unrelated member is in no task audience", () => {
    expect(rooms({ table: "tasks", op: "UPDATE", id: "t", assigned_to: "alice", reviewer: null })).not.toContain("user:bob");
  });
  it("unassigned task with no reviewer still reaches managers (and nobody else)", () => {
    expect(rooms({ table: "tasks", op: "INSERT", id: "t", assigned_to: null, reviewer: null })).toEqual([MANAGERS_ROOM]);
  });
  it("tasks keep the postgres_changes shape: INSERT has empty old; UPDATE exposes the previous assignee/reviewer", () => {
    const i = routeEntityMessage({ table: "tasks", op: "INSERT", id: "t1", assigned_to: "a", reviewer: "r" })!;
    expect(i.event).toMatchObject({ schema: "public", table: "tasks", eventType: "INSERT", new: { id: "t1", assigned_to: "a", reviewer: "r" }, old: {} });
    const u = routeEntityMessage({ table: "tasks", op: "UPDATE", id: "t1", assigned_to: "b", reviewer: "r", old_assigned_to: "a", old_reviewer: "r0" })!;
    expect(u.event.old).toMatchObject({ assigned_to: "a", reviewer: "r0" });
    expect(u.event.new).toMatchObject({ assigned_to: "b" });
    expect(u.eventName).toBe("entity:changed");
  });
  it("tasks DELETE carries the row in old and nothing in new", () => {
    const d = routeEntityMessage({ table: "tasks", op: "DELETE", id: "t1", assigned_to: "a", reviewer: null })!;
    expect(d.event.new).toEqual({});
    expect(d.event.old).toMatchObject({ id: "t1", assigned_to: "a" });
  });
  it("leaves → owner, the person asked to approve, the reviewer, managers", () => {
    expect(rooms({ table: "leaves", op: "INSERT", id: "l", user_id: "u", request_to: "m1", reviewed_by: "m2" })).toEqual(
      [MANAGERS_ROOM, "user:m1", "user:m2", "user:u"].sort(),
    );
    expect(rooms({ table: "leaves", op: "UPDATE", id: "l", user_id: "u" })).toEqual([MANAGERS_ROOM, "user:u"].sort());
  });
  it("task_worklogs → the logger, the task's assignee, managers", () => {
    expect(rooms({ table: "task_worklogs", op: "UPDATE", id: "w", user_id: "u", task_id: "t", assigned_to: "a" })).toEqual(
      [MANAGERS_ROOM, "user:a", "user:u"].sort(),
    );
  });
  it("eod_checkins → owner + managers; nudges → owner only", () => {
    expect(rooms({ table: "eod_checkins", op: "INSERT", id: "e", user_id: "u" })).toEqual([MANAGERS_ROOM, "user:u"].sort());
    expect(rooms({ table: "nudges", op: "INSERT", id: "n", user_id: "u" })).toEqual(["user:u"]);
    expect(routeEntityMessage({ table: "nudges", op: "INSERT", id: "n", user_id: null })).toBeNull();
  });
  it("risk_events and planning_suggestions → managers only", () => {
    expect(rooms({ table: "risk_events", op: "INSERT", id: "r", entity_type: "task", entity_id: "t" })).toEqual([MANAGERS_ROOM]);
    expect(rooms({ table: "planning_suggestions", op: "UPDATE", id: "p", task_id: "t", from_user_id: "f", to_user_id: "x" })).toEqual([MANAGERS_ROOM]);
  });
  it("approval_requests → requester, the chain's approvers, admins (NOT every manager)", () => {
    const r = rooms({ table: "approval_requests", op: "UPDATE", id: "a", requested_by: "u", approvers: ["ap1", "ap2"] });
    expect(r).toEqual([ADMINS_ROOM, "user:ap1", "user:ap2", "user:u"].sort());
    expect(r).not.toContain(MANAGERS_ROOM);
  });
  it("task_review_decisions → that reviewer, who decided, the other reviewers, the assignee, managers", () => {
    const r = rooms({ table: "task_review_decisions", op: "UPDATE", id: "d", task_id: "t", reviewer_id: "r1", decided_by: "m", assigned_to: "a", reviewers: ["r1", "r2"] });
    expect(r).toEqual([MANAGERS_ROOM, "user:a", "user:m", "user:r1", "user:r2"].sort());
  });
  it("automation_health → admins only, on its own event name", () => {
    const d = routeEntityMessage({ table: "automation_health", op: "UPDATE", id: null })!;
    expect(d.rooms).toEqual([ADMINS_ROOM]);
    expect(d.eventName).toBe("automation:health");
  });
  it("TRUNCATE has no owner: it goes to the table's whole audience class as one bulk refetch signal", () => {
    expect(routeEntityMessage({ table: "tasks", op: "TRUNCATE", id: null })).toMatchObject({ rooms: [ALL_USERS_ROOM], event: { bulk: true, new: {}, old: {} } });
    expect(routeEntityMessage({ table: "risk_events", op: "TRUNCATE" })!.rooms).toEqual([MANAGERS_ROOM]);
    expect(routeEntityMessage({ table: "automation_health", op: "TRUNCATE" })!.rooms).toEqual([ADMINS_ROOM]);
    expect(routeEntityMessage({ table: "profiles", op: "TRUNCATE" })).toBeNull();
  });
  it("rejects unknown tables, bad ops and missing ids", () => {
    expect(routeEntityMessage({ table: "profiles", op: "UPDATE", id: "1" })).toBeNull();
    expect(routeEntityMessage({ table: "tasks", op: "UPSERT", id: "1" })).toBeNull();
    expect(routeEntityMessage({ table: "tasks", op: "UPDATE" })).toBeNull();
    expect(routeEntityMessage({ table: "tasks", op: "UPDATE", id: 5 as never })).toBeNull();
    expect(routeEntityMessage({} as never)).toBeNull();
  });
  it("never forwards anything but ids/routing columns, for any table", () => {
    for (const table of ["tasks", "leaves", "task_worklogs", "eod_checkins", "nudges", "risk_events", "planning_suggestions", "approval_requests", "task_review_decisions"]) {
      const d = routeEntityMessage({
        table, op: "UPDATE", id: "x", user_id: "u", assigned_to: "a", reviewer: "r", requested_by: "u", reviewer_id: "r",
        task_name: "SECRET", remarks: "SECRET", reason: "SECRET", feedback: "SECRET", status: "Blocked", detail: "SECRET",
      })!;
      expect(JSON.stringify(d), table).not.toMatch(/SECRET|Blocked/);
    }
  });
});

describe("EntityEventBatcher", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const mk = (o: { bulkThreshold?: number } = {}) => {
    const emit = vi.fn();
    return { emit, b: new EntityEventBatcher({ emit, ...o }) };
  };
  const task = (id: string, extra: Record<string, unknown> = {}) => ({
    table: "tasks", op: "UPDATE", id, assigned_to: "a", reviewer: null, ...extra,
  });

  it("waits for the window, then emits once per change", () => {
    const { b, emit } = mk();
    b.push(task("1"));
    b.push(task("2"));
    expect(emit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls[0][1]).toBe("entity:changed");
  });
  it("coalesces repeated changes to the same row into one event", () => {
    const { b, emit } = mk();
    for (let i = 0; i < 20; i++) b.push(task("1"));
    vi.advanceTimersByTime(100);
    expect(emit).toHaveBeenCalledTimes(1);
  });
  it("reassign A→B→C within a window: delivered once, with A as `old` so A's filter still matches", () => {
    const { b, emit } = mk();
    b.push(task("1", { assigned_to: "B", old_assigned_to: "A" }));
    b.push(task("1", { assigned_to: "C", old_assigned_to: "B" }));
    vi.advanceTimersByTime(100);
    expect(emit).toHaveBeenCalledTimes(1);
    const [rooms, , payload] = emit.mock.calls[0];
    expect(rooms).toEqual(expect.arrayContaining(["user:B", "user:C", "user:A"]));
    expect(payload.new.assigned_to).toBe("C");
    expect(payload.old.assigned_to).toBe("A");
  });
  it("different ops on the same row are not merged (INSERT then DELETE both delivered)", () => {
    const { b, emit } = mk();
    b.push({ ...task("1"), op: "INSERT" });
    b.push({ ...task("1"), op: "DELETE" });
    vi.advanceTimersByTime(100);
    expect(emit).toHaveBeenCalledTimes(2);
  });
  it("a flood collapses to ONE bulk signal per table (audience = everyone involved)", () => {
    const { b, emit } = mk({ bulkThreshold: 100 });
    for (let i = 0; i < 1000; i++) b.push(task(String(i), { assigned_to: `u${i % 7}` }));
    b.push({ table: "nudges", op: "INSERT", id: "n", user_id: "u" });
    vi.advanceTimersByTime(100);
    expect(emit).toHaveBeenCalledTimes(2); // 1 bulk for tasks + 1 normal nudge
    const bulk = emit.mock.calls.find((c) => c[2].table === "tasks")!;
    expect(bulk[2]).toMatchObject({ table: "tasks", bulk: true, new: {}, old: {} });
    expect(bulk[0]).toEqual(expect.arrayContaining([MANAGERS_ROOM, "user:u0", "user:u6"]));
    expect(bulk[0]).not.toContain(ALL_USERS_ROOM);
  });
  it("at exactly the threshold it still emits individually", () => {
    const { b, emit } = mk({ bulkThreshold: 5 });
    for (let i = 0; i < 5; i++) b.push(task(String(i)));
    vi.advanceTimersByTime(100);
    expect(emit).toHaveBeenCalledTimes(5);
  });
  it("ignores invalid messages and starts a fresh window afterwards", () => {
    const { b, emit } = mk();
    b.push({ table: "nope", op: "INSERT", id: "1" });
    vi.advanceTimersByTime(100);
    expect(emit).not.toHaveBeenCalled();
    b.push(task("1"));
    vi.advanceTimersByTime(100);
    expect(emit).toHaveBeenCalledTimes(1);
  });
  it("an emit failure never throws out of the timer or blocks other tables", () => {
    const emit = vi.fn().mockImplementationOnce(() => {
      throw new Error("boom");
    });
    const b = new EntityEventBatcher({ emit });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    b.push(task("1"));
    b.push({ table: "nudges", op: "INSERT", id: "n", user_id: "u" });
    expect(() => vi.advanceTimersByTime(100)).not.toThrow();
    expect(emit).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});

// ---- real Socket.IO server + real clients, using the production emit path ----
vi.mock("@/integrations/backend/jwt.server", () => ({
  verifyBackendJwt: async (t: string) => {
    const [sub, exp] = t.split(":");
    if (!sub || !exp) throw new Error("invalid");
    return { sub, exp: Number(exp) };
  },
}));
vi.mock("@/integrations/postgres/client.server", () => ({
  getPool: () => ({
    query: async (_s: string, [u]: string[]) => ({
      rows: u === "mgr" ? [{ role: "manager" }] : u === "boss" ? [{ role: "admin" }] : [],
    }),
  }),
}));

describe("entity events over a real Socket.IO server", () => {
  let http: HttpServer;
  let url: string;
  let emitToRooms: (r: string[], e: string, p: unknown) => void;
  const open: Socket[] = [];
  const exp = () => Math.floor(Date.now() / 1000) + 300;

  beforeAll(async () => {
    const rt = await import("@/lib/realtime.server");
    emitToRooms = rt.emitToRooms;
    http = createServer();
    rt.attachRealtime(http);
    await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
    url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    open.forEach((s) => s.close());
    await new Promise((r) => http.close(r));
  });

  const client = async (sub: string) => {
    const s = connect(url, {
      path: "/socket.io",
      auth: { token: `${sub}:${exp()}` },
      transports: ["websocket"],
      reconnection: false,
    });
    open.push(s);
    const got: Array<{ table: string; new: Record<string, unknown> }> = [];
    s.on("entity:changed", (p) => got.push(p));
    await new Promise((r) => s.once("connect", r));
    return { s, got };
  };
  const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms));

  it("a task change reaches ONLY its assignee, reviewers, creator and managers; unrelated members get nothing; once each", async () => {
    const [alice, rita, rev2, cat, mgr, boss, bob, zed] = await Promise.all(
      ["alice", "rita", "rev2", "cat", "mgr", "boss", "bob", "zed"].map(client),
    );
    await settle(150);
    const batcher = new EntityEventBatcher({ emit: emitToRooms, windowMs: 20 });
    batcher.push({ table: "tasks", op: "UPDATE", id: "tall", assigned_to: "alice", old_assigned_to: "alice", reviewer: "rita", old_reviewer: "rita", created_by: "cat", reviewers: ["rita", "rev2"] });
    await settle();
    const hit = (c: typeof alice) => c.got.filter((g) => g.table === "tasks" && (g.new as { id?: string }).id === "tall");
    for (const c of [alice, rita, rev2, cat, mgr, boss]) expect(hit(c)).toHaveLength(1);
    for (const c of [bob, zed]) expect(hit(c)).toHaveLength(0);
  });

  it("the task event reveals ids only — no task name/remarks/status ever reaches anyone", async () => {
    const alice = await client("alice");
    const batcher = new EntityEventBatcher({ emit: emitToRooms, windowMs: 20 });
    batcher.push({
      table: "tasks", op: "UPDATE", id: "tsecret", assigned_to: "alice", reviewer: null,
      old_assigned_to: "alice", old_reviewer: null,
      task_name: "TOP SECRET NAME", remarks: "TOP SECRET REMARK", status: "Blocked", blocker_reason: "TOP SECRET",
    });
    await settle();
    const mine = alice.got.filter((g) => (g.new as { id?: string }).id === "tsecret");
    expect(JSON.stringify(mine)).toContain("tsecret");
    expect(JSON.stringify(mine)).not.toMatch(/SECRET|Blocked/);
    expect(Object.keys(mine[0].new).sort()).toEqual(["assigned_to", "id", "reviewer"]);
  });

  it("every watched entity reaches exactly its audience over real sockets (members, managers, admins)", async () => {
    const watch = async (sub: string) => {
      const c = await client(sub);
      const health: unknown[] = [];
      c.s.on("automation:health", (p) => health.push(p));
      return { ...c, health };
    };
    const alice = await watch("alice"); // assignee / leave owner / logger
    const bob = await watch("bob"); // unrelated member
    const rita = await watch("rita"); // reviewer / approver
    const mgr = await watch("mgr"); // manager
    const boss = await watch("boss"); // admin (also in the manager room)
    await settle(150);

    const batcher = new EntityEventBatcher({ emit: emitToRooms, windowMs: 20 });
    batcher.push({ table: "tasks", op: "UPDATE", id: "t1", assigned_to: "alice", reviewer: "rita", old_assigned_to: "alice", old_reviewer: "rita", reviewers: ["rita"] });
    batcher.push({ table: "leaves", op: "INSERT", id: "l1", user_id: "alice", request_to: "mgr" });
    batcher.push({ table: "task_worklogs", op: "UPDATE", id: "w1", user_id: "alice", task_id: "t1", assigned_to: "alice" });
    batcher.push({ table: "eod_checkins", op: "INSERT", id: "e1", user_id: "alice" });
    batcher.push({ table: "nudges", op: "INSERT", id: "n1", user_id: "bob" });
    batcher.push({ table: "risk_events", op: "INSERT", id: "r1", entity_type: "task", entity_id: "t1" });
    batcher.push({ table: "planning_suggestions", op: "INSERT", id: "p1", task_id: "t1", from_user_id: "alice", to_user_id: "bob" });
    batcher.push({ table: "approval_requests", op: "UPDATE", id: "a1", requested_by: "alice", approvers: ["rita"] });
    batcher.push({ table: "task_review_decisions", op: "UPDATE", id: "d1", task_id: "t1", reviewer_id: "rita", assigned_to: "alice", reviewers: ["rita"] });
    batcher.push({ table: "automation_health", op: "UPDATE", id: null });
    await settle();

    const tables = (c: typeof alice) => c.got.map((g) => g.table).sort();
    expect(tables(alice)).toEqual(["approval_requests", "eod_checkins", "leaves", "task_review_decisions", "task_worklogs", "tasks"]);
    expect(tables(bob)).toEqual(["nudges"]); // his own nudge, nothing about anyone else's work
    expect(tables(rita)).toEqual(["approval_requests", "task_review_decisions", "tasks"]);
    // manager: everything except nudges, and NOT approval requests (only requester, approvers, admins may read those)
    expect(tables(mgr)).toEqual(["eod_checkins", "leaves", "planning_suggestions", "risk_events", "task_review_decisions", "task_worklogs", "tasks"]);
    expect(tables(boss)).toEqual(["approval_requests", "eod_checkins", "leaves", "planning_suggestions", "risk_events", "task_review_decisions", "task_worklogs", "tasks"]);
    // automation health: admins only
    expect([alice, bob, rita, mgr].map((c) => c.health.length)).toEqual([0, 0, 0, 0]);
    expect(boss.health).toHaveLength(1);
  });

  it("an assignee who is also a manager gets ONE copy, not two", async () => {
    const mgr = await client("mgr");
    await settle(150);
    const batcher = new EntityEventBatcher({ emit: emitToRooms, windowMs: 20 });
    batcher.push({ table: "tasks", op: "UPDATE", id: "tm", assigned_to: "mgr", reviewer: null, old_assigned_to: "mgr", old_reviewer: null });
    await settle();
    expect(mgr.got.filter((g) => (g.new as { id?: string }).id === "tm")).toHaveLength(1);
  });

  it("a user who lost the task is notified (previous assignee room)", async () => {
    const olduser = await client("olduser");
    const newuser = await client("newuser");
    const batcher = new EntityEventBatcher({ emit: emitToRooms, windowMs: 20 });
    batcher.push({ table: "tasks", op: "UPDATE", id: "tr", assigned_to: "newuser", reviewer: null, old_assigned_to: "olduser", old_reviewer: null });
    await settle();
    expect(olduser.got).toHaveLength(1);
    expect(newuser.got).toHaveLength(1);
  });

  it("an unauthenticated socket receives nothing", async () => {
    const s = connect(url, { path: "/socket.io", auth: {}, transports: ["websocket"], reconnection: false });
    open.push(s);
    const got: unknown[] = [];
    s.on("entity:changed", (p) => got.push(p));
    await new Promise((r) => s.once("connect_error", r));
    const batcher = new EntityEventBatcher({ emit: emitToRooms, windowMs: 20 });
    batcher.push({ table: "risk_events", op: "INSERT", id: "rx", entity_type: "task", entity_id: "t" });
    await settle();
    expect(got).toHaveLength(0);
  });
});
