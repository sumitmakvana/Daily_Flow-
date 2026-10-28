import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const handlers = new Map<string, Set<(p: unknown) => void>>();
const connectHandlers = new Set<(isReconnect: boolean) => void>();
let connected = true;

vi.mock("@/integrations/realtime/socket", () => ({
  onRealtime: (ev: string, h: (p: unknown) => void) => {
    if (!handlers.has(ev)) handlers.set(ev, new Set());
    handlers.get(ev)!.add(h);
    return () => handlers.get(ev)!.delete(h);
  },
  onRealtimeConnect: (h: (r: boolean) => void) => {
    connectHandlers.add(h);
    return () => connectHandlers.delete(h);
  },
  isRealtimeConnected: () => connected,
}));

import { createRealtimeChannel, matchesFilter, POLL_DISABLED_TABLES, PUSH_TABLES } from "@/integrations/realtime/channel";

const emit = (ev: string, p: unknown) => handlers.get(ev)?.forEach((h) => h(p));
const live = (ev: string) => handlers.get(ev)?.size ?? 0;

beforeEach(() => {
  vi.useFakeTimers();
  handlers.clear();
  connectHandlers.clear();
  connected = true;
});
afterEach(() => vi.useRealTimers());

describe("matchesFilter", () => {
  const p = (n: object) => ({ schema: "public", table: "t", eventType: "INSERT" as const, new: n, old: {} });
  it("eq / in", () => {
    expect(matchesFilter("user_id=eq.a", p({ user_id: "a" }))).toBe(true);
    expect(matchesFilter("user_id=eq.a", p({ user_id: "b" }))).toBe(false);
    expect(matchesFilter("id=in.(1,2)", p({ id: 2 }))).toBe(true);
    expect(matchesFilter("id=in.(1,2)", p({ id: 3 }))).toBe(false);
  });
  it("lets the event through when the column is absent or filter is unknown", () => {
    expect(matchesFilter("user_id=eq.a", p({ other: 1 }))).toBe(true);
    expect(matchesFilter("weird", p({}))).toBe(true);
    expect(matchesFilter(undefined, p({}))).toBe(true);
  });
});

describe("realtime channel — push tables (notifications)", () => {
  it("delivers notification:new as a postgres_changes payload, filtered", () => {
    const cb = vi.fn();
    createRealtimeChannel("x")
      .on("postgres_changes", { event: "INSERT", table: "notifications", filter: "user_id=eq.me" }, cb)
      .subscribe();
    emit("notification:new", { id: "1", user_id: "someone-else", type: "sod_digest" });
    expect(cb).not.toHaveBeenCalled();
    emit("notification:new", { id: "2", user_id: "me", type: "sod_digest" });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0]).toMatchObject({
      table: "notifications",
      eventType: "INSERT",
      new: { id: "2", type: "sod_digest" },
    });
  });

  it("does not poll while connected", () => {
    const cb = vi.fn();
    createRealtimeChannel("x").on("postgres_changes", { event: "INSERT", table: "notifications" }, cb).subscribe();
    vi.advanceTimersByTime(120_000);
    expect(cb).not.toHaveBeenCalled();
  });

  it("falls back to a slow poll only while disconnected", () => {
    const cb = vi.fn();
    createRealtimeChannel("x").on("postgres_changes", { event: "INSERT", table: "notifications" }, cb).subscribe();
    connected = false;
    vi.advanceTimersByTime(30_000);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("fires a catch-up callback on reconnect, not on first connect", () => {
    const cb = vi.fn();
    createRealtimeChannel("x").on("postgres_changes", { event: "INSERT", table: "notifications" }, cb).subscribe();
    connectHandlers.forEach((h) => h(false));
    expect(cb).not.toHaveBeenCalled();
    connectHandlers.forEach((h) => h(true));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("supports several .on() per channel (the old mock kept only the last)", () => {
    const a = vi.fn();
    const b = vi.fn();
    createRealtimeChannel("x")
      .on("postgres_changes", { event: "INSERT", table: "notifications" }, a)
      .on("postgres_changes", { event: "*", table: "notifications" }, b)
      .subscribe();
    emit("notification:new", { id: "1", user_id: "me" });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("unsubscribe removes listeners and timers", () => {
    const cb = vi.fn();
    const ch = createRealtimeChannel("x").on("postgres_changes", { event: "INSERT", table: "notifications" }, cb).subscribe();
    expect(live("notification:new")).toBe(1);
    ch.unsubscribe();
    expect(live("notification:new")).toBe(0);
    expect(connectHandlers.size).toBe(0);
    connected = false;
    vi.advanceTimersByTime(120_000);
    expect(cb).not.toHaveBeenCalled();
  });
});

const PUSHED_TABLES = ["tasks", "nudges", "risk_events", "planning_suggestions", "approval_requests", "task_review_decisions"];
const setVisibility = (v: "visible" | "hidden") => {
  Object.defineProperty(document, "visibilityState", { value: v, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
};
const evt = (table: string, o: Record<string, unknown> = {}, old: Record<string, unknown> = {}, eventType = "UPDATE") => ({
  schema: "public", table, eventType, new: o, old,
});

describe("realtime channel — task/nudge/risk/suggestion events", () => {
  it("every realtime table is a push table AND has its client poll removed", () => {
    for (const t of [...PUSHED_TABLES, "notifications"]) {
      expect(PUSH_TABLES.has(t)).toBe(true);
      expect(POLL_DISABLED_TABLES.has(t)).toBe(true);
    }
  });

  it.each(PUSHED_TABLES)("%s: receives socket events", (table) => {
    const cb = vi.fn();
    createRealtimeChannel("x").on("postgres_changes", { event: "*", table }, cb).subscribe();
    emit("entity:changed", evt(table, { id: "1" }));
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0]).toMatchObject({ table, eventType: "UPDATE", new: { id: "1" } });
  });

  it.each(PUSHED_TABLES)("%s: NO recurring poll while the socket is connected (2 minutes of silence = 0 refetches)", (table) => {
    const cb = vi.fn();
    createRealtimeChannel("x").on("postgres_changes", { event: "*", table }, cb).subscribe();
    vi.advanceTimersByTime(120_000);
    expect(cb).not.toHaveBeenCalled();
  });

  it("while the socket is DOWN and the tab is visible, a slow 30s fallback refetches", () => {
    const cb = vi.fn();
    createRealtimeChannel("x").on("postgres_changes", { event: "*", table: "tasks" }, cb).subscribe();
    connected = false;
    vi.advanceTimersByTime(30_000);
    expect(cb).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_000);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("the fallback does NOT run while the tab is hidden", () => {
    const cb = vi.fn();
    createRealtimeChannel("x").on("postgres_changes", { event: "*", table: "tasks" }, cb).subscribe();
    connected = false;
    setVisibility("hidden");
    vi.advanceTimersByTime(120_000);
    expect(cb).not.toHaveBeenCalled();
    setVisibility("visible");
  });

  it("tab visibility: returning after >=5s hidden refetches once; a quick tab flip does not", () => {
    const cb = vi.fn();
    createRealtimeChannel("x").on("postgres_changes", { event: "*", table: "tasks" }, cb).subscribe();
    setVisibility("hidden");
    vi.advanceTimersByTime(2000);
    setVisibility("visible");
    expect(cb).not.toHaveBeenCalled(); // flipped tabs briefly
    setVisibility("hidden");
    vi.advanceTimersByTime(6000);
    setVisibility("visible");
    expect(cb).toHaveBeenCalledTimes(1);
    setVisibility("visible"); // a second 'visible' without a hide in between
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("unsubscribe removes the visibility listener (no refetch after the page is gone)", () => {
    const cb = vi.fn();
    const ch = createRealtimeChannel("x").on("postgres_changes", { event: "*", table: "tasks" }, cb).subscribe();
    ch.unsubscribe();
    setVisibility("hidden");
    vi.advanceTimersByTime(10_000);
    setVisibility("visible");
    expect(cb).not.toHaveBeenCalled();
  });

  it("a duplicate event burst never produces more refetches than the throttle allows", () => {
    const cb = vi.fn();
    createRealtimeChannel("x").on("postgres_changes", { event: "*", table: "approval_requests" }, cb).subscribe();
    for (let i = 0; i < 200; i++) emit("entity:changed", evt("approval_requests", {}));
    vi.advanceTimersByTime(1000);
    expect(cb.mock.calls.length).toBeLessThanOrEqual(2); // leading + one trailing
  });

  it("a table-less or unsupported-table subscription never polls; it logs a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cb = vi.fn();
    createRealtimeChannel("x").on("postgres_changes", { event: "*" }, cb).subscribe();
    createRealtimeChannel("y").on("postgres_changes", { event: "*", table: "unknown_table" }, cb).subscribe();
    vi.advanceTimersByTime(60_000);
    expect(cb).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("a table-less subscription on a channel that also has a pushed table gets NO socket events", () => {
    const tableLess = vi.fn();
    const tasks = vi.fn();
    createRealtimeChannel("x")
      .on("postgres_changes", { event: "*" }, tableLess)
      .on("postgres_changes", { event: "*", table: "tasks" }, tasks)
      .subscribe();
    emit("entity:changed", evt("tasks", { id: "1" }));
    emit("notification:new", { id: "n", user_id: "me" });
    expect(tasks).toHaveBeenCalledTimes(1);
    expect(tableLess).not.toHaveBeenCalled();
  });

  it("only the subscribed table's events are delivered", () => {
    const cb = vi.fn();
    createRealtimeChannel("x").on("postgres_changes", { event: "*", table: "tasks" }, cb).subscribe();
    emit("entity:changed", evt("nudges", { id: "n" }));
    emit("entity:changed", evt("risk_events", { id: "r" }));
    expect(cb).not.toHaveBeenCalled();
  });

  it("respects the event type (INSERT-only subscribers ignore UPDATE/DELETE)", () => {
    const cb = vi.fn();
    createRealtimeChannel("x").on("postgres_changes", { event: "INSERT", table: "tasks" }, cb).subscribe();
    emit("entity:changed", evt("tasks", { id: "1" }, {}, "UPDATE"));
    emit("entity:changed", evt("tasks", {}, { id: "1" }, "DELETE"));
    expect(cb).not.toHaveBeenCalled();
    emit("entity:changed", evt("tasks", { id: "1" }, {}, "INSERT"));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("assignee filter: delivers my tasks, ignores others", () => {
    const cb = vi.fn();
    createRealtimeChannel("x").on("postgres_changes", { event: "*", table: "tasks", filter: "assigned_to=eq.me" }, cb).subscribe();
    emit("entity:changed", evt("tasks", { id: "1", assigned_to: "someone" }, { id: "1", assigned_to: "else" }));
    expect(cb).not.toHaveBeenCalled();
    emit("entity:changed", evt("tasks", { id: "2", assigned_to: "me" }));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("assignee filter: a user who just LOST the task is still told (matches the old row)", () => {
    const cb = vi.fn();
    createRealtimeChannel("x").on("postgres_changes", { event: "*", table: "tasks", filter: "assigned_to=eq.me" }, cb).subscribe();
    emit("entity:changed", evt("tasks", { id: "1", assigned_to: "bob" }, { id: "1", assigned_to: "me" }));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("an unfiltered task board (scope: all) receives OTHER people's task changes", () => {
    const cb = vi.fn();
    createRealtimeChannel("x").on("postgres_changes", { event: "*", table: "tasks" }, cb).subscribe();
    emit("entity:changed", evt("tasks", { id: "t9", assigned_to: "someone-else", reviewer: "another" }, { id: "t9", assigned_to: "someone-else", reviewer: "another" }));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("an ids-scoped subscription (id=in.(...)) only reacts to its own tasks", () => {
    const cb = vi.fn();
    createRealtimeChannel("x").on("postgres_changes", { event: "*", table: "tasks", filter: "id=in.(t1,t2)" }, cb).subscribe();
    emit("entity:changed", evt("tasks", { id: "t3", assigned_to: "a", reviewer: null }));
    expect(cb).not.toHaveBeenCalled();
    emit("entity:changed", evt("tasks", { id: "t2", assigned_to: "a", reviewer: null }));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("a reviewer-scoped subscription ignores tasks it neither reviews nor reviewed", () => {
    const cb = vi.fn();
    createRealtimeChannel("x").on("postgres_changes", { event: "*", table: "tasks", filter: "reviewer=eq.me" }, cb).subscribe();
    emit("entity:changed", evt("tasks", { id: "t1", assigned_to: "a", reviewer: "other" }, { id: "t1", assigned_to: "a", reviewer: "other2" }));
    expect(cb).not.toHaveBeenCalled();
    emit("entity:changed", evt("tasks", { id: "t1", assigned_to: "a", reviewer: "other" }, { id: "t1", assigned_to: "a", reviewer: "me" })); // I stopped being the reviewer
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("a bulk 'refetch' signal (empty new/old) passes every filter", () => {
    const cb = vi.fn();
    createRealtimeChannel("x").on("postgres_changes", { event: "*", table: "tasks", filter: "assigned_to=eq.me" }, cb).subscribe();
    emit("entity:changed", { ...evt("tasks"), bulk: true });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("bursts are coalesced: leading call + one trailing call with the LATEST payload", () => {
    const cb = vi.fn();
    createRealtimeChannel("x").on("postgres_changes", { event: "*", table: "tasks" }, cb).subscribe();
    for (let i = 1; i <= 50; i++) emit("entity:changed", evt("tasks", { id: String(i) }));
    expect(cb).toHaveBeenCalledTimes(1); // leading
    vi.advanceTimersByTime(250);
    expect(cb).toHaveBeenCalledTimes(2); // trailing
    expect(cb.mock.calls[1][0]).toMatchObject({ new: { id: "50" } });
    vi.advanceTimersByTime(250);
    expect(cb).toHaveBeenCalledTimes(2); // nothing further
    emit("entity:changed", evt("tasks", { id: "late" })); // new window starts cleanly
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it("each subscription is throttled independently", () => {
    const a = vi.fn();
    const b = vi.fn();
    createRealtimeChannel("x")
      .on("postgres_changes", { event: "*", table: "tasks" }, a)
      .on("postgres_changes", { event: "*", table: "nudges" }, b)
      .subscribe();
    emit("entity:changed", evt("tasks", { id: "1" }));
    emit("entity:changed", evt("nudges", { id: "1" }));
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("notifications are NOT throttled (every one carries data)", () => {
    const cb = vi.fn();
    createRealtimeChannel("x").on("postgres_changes", { event: "INSERT", table: "notifications" }, cb).subscribe();
    for (let i = 0; i < 5; i++) emit("notification:new", { id: String(i), user_id: "me" });
    expect(cb).toHaveBeenCalledTimes(5);
  });

  it("reconnect fires a catch-up refetch for every pushed table", () => {
    const cbs = PUSHED_TABLES.map(() => vi.fn());
    const ch = createRealtimeChannel("x");
    PUSHED_TABLES.forEach((t, i) => ch.on("postgres_changes", { event: "*", table: t }, cbs[i]));
    ch.subscribe();
    connectHandlers.forEach((h) => h(true));
    cbs.forEach((cb) => expect(cb).toHaveBeenCalledTimes(1));
  });

  it("unsubscribe stops socket listeners, the poll, and pending throttle timers", () => {
    const cb = vi.fn();
    const ch = createRealtimeChannel("x").on("postgres_changes", { event: "*", table: "tasks" }, cb).subscribe();
    emit("entity:changed", evt("tasks", { id: "1" })); // leading call, trailing now pending
    emit("entity:changed", evt("tasks", { id: "2" }));
    ch.unsubscribe();
    expect(live("entity:changed")).toBe(0);
    expect(connectHandlers.size).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(cb).toHaveBeenCalledTimes(1); // only the leading call; nothing after unsubscribe
  });
});
