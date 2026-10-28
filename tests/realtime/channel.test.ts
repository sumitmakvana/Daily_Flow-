import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const handlers = new Map<string, Set<(p: unknown) => void>>();
type ResyncInfo = { full: boolean; tables: string[]; reason: string };
const resyncHandlers = new Set<(info: ResyncInfo) => void>();
const safetyHandlers = new Set<() => void>();

vi.mock("@/integrations/realtime/socket", () => ({
  onRealtime: (ev: string, h: (p: unknown) => void) => {
    if (!handlers.has(ev)) handlers.set(ev, new Set());
    handlers.get(ev)!.add(h);
    return () => handlers.get(ev)!.delete(h);
  },
  onRealtimeResync: (h: (i: ResyncInfo) => void) => {
    resyncHandlers.add(h);
    return () => resyncHandlers.delete(h);
  },
  onRealtimeSafetyRefresh: (h: () => void) => {
    safetyHandlers.add(h);
    return () => safetyHandlers.delete(h);
  },
}));

import { createRealtimeChannel, matchesFilter, POLL_DISABLED_TABLES, PUSH_TABLES } from "@/integrations/realtime/channel";

const emit = (ev: string, p: unknown) => handlers.get(ev)?.forEach((h) => h(p));
const live = (ev: string) => handlers.get(ev)?.size ?? 0;
/** What socket.ts does after a reconnect: tell subscribers which tables changed (or that everything may have). */
const resync = (tables: string[], full = false) => resyncHandlers.forEach((h) => h({ full, tables, reason: "connect" }));
const safetyRefresh = () => safetyHandlers.forEach((h) => h());

beforeEach(() => {
  vi.useFakeTimers();
  handlers.clear();
  resyncHandlers.clear();
  safetyHandlers.clear();
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

  it("a channel starts no timers of its own, so nothing polls however long it sits", () => {
    const cb = vi.fn();
    createRealtimeChannel("x").on("postgres_changes", { event: "INSERT", table: "notifications" }, cb).subscribe();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10 * 60_000);
    expect(cb).not.toHaveBeenCalled();
  });

  it("after a reconnect, refetches only if the server says notifications changed (or cannot tell)", () => {
    const cb = vi.fn();
    createRealtimeChannel("x").on("postgres_changes", { event: "INSERT", table: "notifications" }, cb).subscribe();
    resync([]); // reconnected, nothing missed
    resync(["tasks"]); // something else changed
    expect(cb).not.toHaveBeenCalled();
    resync(["notifications"]);
    expect(cb).toHaveBeenCalledTimes(1);
    resync([], true); // server restarted / cannot tell: refetch everything
    expect(cb).toHaveBeenCalledTimes(2);
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
    expect(resyncHandlers.size).toBe(0);
    expect(safetyHandlers.size).toBe(0);
    resync([], true);
    safetyRefresh();
    vi.advanceTimersByTime(120_000);
    expect(cb).not.toHaveBeenCalled();
  });
});

const PUSHED_TABLES = ["tasks", "nudges", "risk_events", "planning_suggestions", "approval_requests", "task_review_decisions", "task_worklogs", "leaves", "eod_checkins"];
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

  it("NO per-channel timer exists at all: zero timers while the socket is up OR down", () => {
    createRealtimeChannel("x").on("postgres_changes", { event: "*", table: "tasks" }, vi.fn()).subscribe();
    createRealtimeChannel("y").on("postgres_changes", { event: "*", table: "approval_requests" }, vi.fn()).subscribe();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10 * 60_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("the shared safety refresh (socket down) refetches every subscriber of the channel, once per firing", () => {
    const cb = vi.fn();
    const other = vi.fn();
    createRealtimeChannel("x")
      .on("postgres_changes", { event: "*", table: "tasks" }, cb)
      .on("postgres_changes", { event: "*", table: "nudges" }, other)
      .subscribe();
    safetyRefresh();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(other).toHaveBeenCalledTimes(1);
    safetyRefresh();
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("targeted resync: only subscribers of the tables that changed refetch", () => {
    const tasks = vi.fn();
    const nudges = vi.fn();
    const approvals = vi.fn();
    createRealtimeChannel("x")
      .on("postgres_changes", { event: "*", table: "tasks" }, tasks)
      .on("postgres_changes", { event: "*", table: "nudges" }, nudges)
      .on("postgres_changes", { event: "*", table: "approval_requests" }, approvals)
      .subscribe();
    resync(["tasks", "approval_requests"]);
    expect(tasks).toHaveBeenCalledTimes(1);
    expect(approvals).toHaveBeenCalledTimes(1);
    expect(nudges).not.toHaveBeenCalled(); // nothing missed for nudges: no request
  });

  it("a resync with nothing changed refetches nothing (the old code refetched everything)", () => {
    const cbs = PUSHED_TABLES.map(() => vi.fn());
    const ch = createRealtimeChannel("x");
    PUSHED_TABLES.forEach((t, i) => ch.on("postgres_changes", { event: "*", table: t }, cbs[i]));
    ch.subscribe();
    resync([]);
    cbs.forEach((cb) => expect(cb).not.toHaveBeenCalled());
  });

  it("a review-decision change missed while disconnected is recovered by a targeted resync", () => {
    const cb = vi.fn();
    createRealtimeChannel("x").on("postgres_changes", { event: "*", table: "task_review_decisions" }, cb).subscribe();
    resync(["task_review_decisions"]);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("unsubscribe removes the resync and safety listeners (nothing fires after the page is gone)", () => {
    const cb = vi.fn();
    const ch = createRealtimeChannel("x").on("postgres_changes", { event: "*", table: "tasks" }, cb).subscribe();
    ch.unsubscribe();
    resync(["tasks"], true);
    safetyRefresh();
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

  it("a FULL resync (server restarted / cannot tell) refetches every pushed table", () => {
    const cbs = PUSHED_TABLES.map(() => vi.fn());
    const ch = createRealtimeChannel("x");
    PUSHED_TABLES.forEach((t, i) => ch.on("postgres_changes", { event: "*", table: t }, cbs[i]));
    ch.subscribe();
    resync([], true);
    cbs.forEach((cb) => expect(cb).toHaveBeenCalledTimes(1));
  });

  it("unsubscribe stops socket listeners and pending throttle timers", () => {
    const cb = vi.fn();
    const ch = createRealtimeChannel("x").on("postgres_changes", { event: "*", table: "tasks" }, cb).subscribe();
    emit("entity:changed", evt("tasks", { id: "1" })); // leading call, trailing now pending
    emit("entity:changed", evt("tasks", { id: "2" }));
    ch.unsubscribe();
    expect(live("entity:changed")).toBe(0);
    expect(resyncHandlers.size).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(cb).toHaveBeenCalledTimes(1); // only the leading call; nothing after unsubscribe
  });
});
