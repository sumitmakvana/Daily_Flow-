// @vitest-environment node
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { io as connect, type Socket } from "socket.io-client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ALL_USERS_ROOM, EntityEventBatcher, routeEntityMessage } from "@/lib/entity-events.server";

describe("routeEntityMessage", () => {
  it("tasks → every signed-in user (single all-users room); INSERT has empty old", () => {
    const d = routeEntityMessage({ table: "tasks", op: "INSERT", id: "t1", assigned_to: "a", reviewer: "r" })!;
    expect(d.rooms).toEqual([ALL_USERS_ROOM]);
    expect(d.event).toMatchObject({
      schema: "public",
      table: "tasks",
      eventType: "INSERT",
      new: { id: "t1", assigned_to: "a", reviewer: "r" },
      old: {},
    });
  });
  it("tasks UPDATE exposes the PREVIOUS assignee/reviewer as `old` (so client filters can match a lost task)", () => {
    const d = routeEntityMessage({
      table: "tasks", op: "UPDATE", id: "t1",
      assigned_to: "b", reviewer: "r", old_assigned_to: "a", old_reviewer: "r0",
    })!;
    expect(d.rooms).toEqual([ALL_USERS_ROOM]);
    expect(d.event.old).toMatchObject({ assigned_to: "a", reviewer: "r0" });
    expect(d.event.new).toMatchObject({ assigned_to: "b" });
  });
  it("tasks DELETE carries the row in `old` and nothing in `new`", () => {
    const d = routeEntityMessage({ table: "tasks", op: "DELETE", id: "t1", assigned_to: "a", reviewer: null })!;
    expect(d.event.new).toEqual({});
    expect(d.event.old).toMatchObject({ id: "t1", assigned_to: "a" });
    expect(d.rooms).toEqual([ALL_USERS_ROOM]);
  });
  it("task routing does not depend on assignment: unassigned, self-reviewed and reassigned tasks all go to the one room", () => {
    const d = routeEntityMessage({
      table: "tasks", op: "UPDATE", id: "t",
      assigned_to: null, reviewer: null, old_assigned_to: null, old_reviewer: null,
    })!;
    expect(d.rooms).toEqual([ALL_USERS_ROOM]);
    const same = routeEntityMessage({
      table: "tasks", op: "UPDATE", id: "t",
      assigned_to: "a", reviewer: "a", old_assigned_to: "a", old_reviewer: "a",
    })!;
    expect(same.rooms).toEqual([ALL_USERS_ROOM]);
  });
  it("only tasks are broadcast: nudges, risk events and suggestions never use the all-users room", () => {
    const rooms = [
      routeEntityMessage({ table: "nudges", op: "INSERT", id: "n", user_id: "u" })!.rooms,
      routeEntityMessage({ table: "risk_events", op: "INSERT", id: "r", entity_type: "task", entity_id: "t" })!.rooms,
      routeEntityMessage({ table: "planning_suggestions", op: "INSERT", id: "p", task_id: "t" })!.rooms,
    ].flat();
    expect(rooms).not.toContain(ALL_USERS_ROOM);
  });
  it("nudges → owner only (not managers)", () => {
    const d = routeEntityMessage({ table: "nudges", op: "INSERT", id: "n1", user_id: "u" })!;
    expect(d.rooms).toEqual(["user:u"]);
    expect(d.event.new).toMatchObject({ id: "n1", user_id: "u" });
  });
  it("risk_events and planning_suggestions → managers only", () => {
    const r = routeEntityMessage({ table: "risk_events", op: "INSERT", id: "r", entity_type: "task", entity_id: "t" })!;
    expect(r.rooms).toEqual(["role:manager"]);
    expect(r.event.new).toMatchObject({ entity_type: "task", entity_id: "t" });
    const p = routeEntityMessage({
      table: "planning_suggestions", op: "UPDATE", id: "p",
      task_id: "t", from_user_id: "f", to_user_id: "x",
    })!;
    expect(p.rooms).toEqual(["role:manager"]);
    expect(p.event.new).toMatchObject({ task_id: "t", from_user_id: "f", to_user_id: "x" });
  });
  it("rejects unknown tables, bad ops, missing ids and ownerless nudges", () => {
    expect(routeEntityMessage({ table: "profiles", op: "UPDATE", id: "1" })).toBeNull();
    expect(routeEntityMessage({ table: "tasks", op: "TRUNCATE", id: "1" })).toBeNull();
    expect(routeEntityMessage({ table: "tasks", op: "UPDATE" })).toBeNull();
    expect(routeEntityMessage({ table: "tasks", op: "UPDATE", id: 5 as never })).toBeNull();
    expect(routeEntityMessage({ table: "nudges", op: "INSERT", id: "n", user_id: null })).toBeNull();
    expect(routeEntityMessage({} as never)).toBeNull();
  });
  it("never forwards anything but ids/routing columns", () => {
    const d = routeEntityMessage({
      table: "tasks", op: "UPDATE", id: "t", assigned_to: "a", reviewer: null,
      task_name: "SECRET", remarks: "SECRET", old_assigned_to: "a", old_reviewer: null,
    })!;
    expect(JSON.stringify(d)).not.toContain("SECRET");
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
    expect(rooms).toEqual([ALL_USERS_ROOM]);
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
  it("a flood collapses to ONE bulk signal per table (tasks: all-users room)", () => {
    const { b, emit } = mk({ bulkThreshold: 100 });
    for (let i = 0; i < 1000; i++) b.push(task(String(i), { assigned_to: `u${i % 7}` }));
    b.push({ table: "nudges", op: "INSERT", id: "n", user_id: "u" });
    vi.advanceTimersByTime(100);
    expect(emit).toHaveBeenCalledTimes(2); // 1 bulk for tasks + 1 normal nudge
    const bulk = emit.mock.calls.find((c) => c[2].table === "tasks")!;
    expect(bulk[2]).toMatchObject({ table: "tasks", bulk: true, new: {}, old: {} });
    expect(bulk[0]).toEqual([ALL_USERS_ROOM]);
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

  it("a task change reaches EVERY signed-in user (assignee, reviewer, unrelated member, manager, admin), once each", async () => {
    const people = await Promise.all(["alice", "bob", "rita", "mgr", "boss", "zed"].map(client));
    await settle(150);
    const batcher = new EntityEventBatcher({ emit: emitToRooms, windowMs: 20 });
    batcher.push({ table: "tasks", op: "UPDATE", id: "tall", assigned_to: "alice", reviewer: "rita", old_assigned_to: "alice", old_reviewer: "rita" });
    await settle();
    for (const p of people) {
      expect(p.got.filter((g) => g.table === "tasks" && (g.new as { id?: string }).id === "tall")).toHaveLength(1);
    }
  });

  it("the task event reveals ids only — no task name/remarks/status ever reaches an unrelated user", async () => {
    const bob = await client("bob");
    const batcher = new EntityEventBatcher({ emit: emitToRooms, windowMs: 20 });
    batcher.push({
      table: "tasks", op: "UPDATE", id: "tsecret", assigned_to: "alice", reviewer: null,
      old_assigned_to: "alice", old_reviewer: null,
      task_name: "TOP SECRET NAME", remarks: "TOP SECRET REMARK", status: "Blocked", blocker_reason: "TOP SECRET",
    });
    await settle();
    const seen = JSON.stringify(bob.got.filter((g) => (g.new as { id?: string }).id === "tsecret"));
    expect(seen).toContain("tsecret");
    expect(seen).not.toMatch(/SECRET|Blocked/);
    const keys = Object.keys(bob.got.find((g) => (g.new as { id?: string }).id === "tsecret")!.new).sort();
    expect(keys).toEqual(["assigned_to", "id", "reviewer"]);
  });

  it("delivers each change to exactly the right people, and once per socket", async () => {
    const alice = await client("alice"); // assignee
    const bob = await client("bob"); // unrelated member
    const rita = await client("rita"); // reviewer
    const mgr = await client("mgr"); // manager
    const boss = await client("boss"); // admin (gets the manager room too)
    await settle(150); // async role lookup

    const batcher = new EntityEventBatcher({ emit: emitToRooms, windowMs: 20 });
    batcher.push({ table: "tasks", op: "UPDATE", id: "t1", assigned_to: "alice", reviewer: "rita", old_assigned_to: "alice", old_reviewer: "rita" });
    batcher.push({ table: "nudges", op: "INSERT", id: "n1", user_id: "bob" });
    batcher.push({ table: "risk_events", op: "INSERT", id: "r1", entity_type: "task", entity_id: "t1" });
    batcher.push({ table: "planning_suggestions", op: "INSERT", id: "p1", task_id: "t1", from_user_id: "alice", to_user_id: "bob" });
    await settle();

    const tables = (c: typeof alice) => c.got.map((g) => g.table).sort();
    expect(tables(alice)).toEqual(["tasks"]);
    expect(tables(rita)).toEqual(["tasks"]);
    // bob: the task (everyone gets task events) + his own nudge; NOT the risk or suggestion.
    expect(tables(bob)).toEqual(["nudges", "tasks"]);
    expect(tables(mgr)).toEqual(["planning_suggestions", "risk_events", "tasks"]);
    expect(tables(boss)).toEqual(["planning_suggestions", "risk_events", "tasks"]);
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
