import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const handlers = new Map<string, Set<(p: unknown) => void>>();
type ResyncInfo = { full: boolean; tables: string[]; reason: string };
const resyncHandlers = new Set<(info: ResyncInfo) => void>();

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
  onRealtimeSafetyRefresh: () => () => {},
}));

import { createRealtimeChannel } from "@/integrations/realtime/channel";

let visibility: "visible" | "hidden" = "visible";
const setVisibility = (v: "visible" | "hidden") => {
  visibility = v;
  document.dispatchEvent(new Event("visibilitychange"));
};
const emit = (ev: string, p: unknown) => handlers.get(ev)?.forEach((h) => h(p));
const task = (id: string) => ({ schema: "public", table: "tasks", eventType: "UPDATE", new: { id, assigned_to: "me" }, old: {} });
const resync = (tables: string[], reason: string, full = false) => resyncHandlers.forEach((h) => h({ full, tables, reason }));

beforeEach(() => {
  vi.useFakeTimers();
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  handlers.clear();
  resyncHandlers.clear();
});
const opened: Array<{ unsubscribe: () => void }> = [];
afterEach(() => {
  opened.splice(0).forEach((c) => c.unsubscribe()); // also proves the shared listener is released
  vi.useRealTimers();
});

const sub = (table = "tasks") => {
  const cb = vi.fn();
  const ch = createRealtimeChannel("t").on("postgres_changes", { event: "*", table }, cb).subscribe();
  opened.push(ch);
  return { cb, ch };
};

describe("hidden tabs do not refetch", () => {
  it("events while hidden cause NO callback; becoming visible runs the subscriber exactly once", () => {
    const { cb } = sub();
    setVisibility("hidden");
    for (let i = 0; i < 40; i++) emit("entity:changed", task(String(i)));
    vi.advanceTimersByTime(5000); // throttle windows pass: still nothing
    expect(cb).not.toHaveBeenCalled();
    setVisibility("visible");
    expect(cb).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("a tab that was hidden but saw no changes refetches nothing when it comes back", () => {
    const { cb } = sub();
    setVisibility("hidden");
    setVisibility("visible");
    expect(cb).not.toHaveBeenCalled();
  });

  it("only subscribers whose table changed are refreshed on return", () => {
    const tasks = sub("tasks");
    const leaves = sub("leaves");
    setVisibility("hidden");
    emit("entity:changed", task("1"));
    setVisibility("visible");
    expect(tasks.cb).toHaveBeenCalledTimes(1);
    expect(leaves.cb).not.toHaveBeenCalled();
  });

  it("a reconnect/resync while hidden is deferred too, and runs once on return", () => {
    const { cb } = sub();
    setVisibility("hidden");
    resync(["tasks"], "connect");
    resync([], "connect", true);
    expect(cb).not.toHaveBeenCalled();
    setVisibility("visible");
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("an unsubscribed page is not refetched on return", () => {
    const { cb, ch } = sub();
    setVisibility("hidden");
    emit("entity:changed", task("1"));
    ch.unsubscribe();
    setVisibility("visible");
    expect(cb).not.toHaveBeenCalled();
  });

  it("notifications still arrive in a hidden tab (each carries data the user needs)", () => {
    const cb = vi.fn();
    opened.push(createRealtimeChannel("n").on("postgres_changes", { event: "INSERT", table: "notifications" }, cb).subscribe());
    setVisibility("hidden");
    emit("notification:new", { id: "1", user_id: "me", type: "x" });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("the shared visibility listener is removed once the last channel unsubscribes", () => {
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");
    const a = sub();
    const b = sub();
    expect(add.mock.calls.filter((c) => c[0] === "visibilitychange")).toHaveLength(1); // ONE listener for both
    a.ch.unsubscribe();
    expect(remove.mock.calls.filter((c) => c[0] === "visibilitychange")).toHaveLength(0);
    b.ch.unsubscribe();
    expect(remove.mock.calls.filter((c) => c[0] === "visibilitychange")).toHaveLength(1);
    add.mockRestore();
    remove.mockRestore();
  });
});

describe("no duplicate refetch when a tab returns", () => {
  it("visibility flush then the visibility resync for the same table = ONE refetch", () => {
    const { cb } = sub();
    setVisibility("hidden");
    emit("entity:changed", task("1")); // received while hidden: dirty
    setVisibility("visible"); // flush: refetch #1
    resync(["tasks"], "visibility"); // server ack arrives a moment later (it reports the same table)
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("a visibility resync for something the socket genuinely missed still refetches", () => {
    const { cb } = sub();
    setVisibility("hidden");
    setVisibility("visible"); // nothing dirty
    resync(["tasks"], "visibility"); // the server says tasks changed while the socket was asleep
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("a visibility resync for a DIFFERENT table than the one just flushed still fires for that table", () => {
    const tasks = sub("tasks");
    const leaves = sub("leaves");
    setVisibility("hidden");
    emit("entity:changed", task("1"));
    setVisibility("visible");
    resync(["tasks", "leaves"], "visibility");
    expect(tasks.cb).toHaveBeenCalledTimes(1); // already refetched by the flush
    expect(leaves.cb).toHaveBeenCalledTimes(1); // genuinely missed
  });

  it("a connect resync is never suppressed (a real reconnect gap)", () => {
    const { cb } = sub();
    emit("entity:changed", task("1")); // fires now
    resync(["tasks"], "connect");
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("a visible-tab burst is coalesced to a leading and one trailing refetch", () => {
    const { cb } = sub();
    for (let i = 0; i < 50; i++) emit("entity:changed", task(String(i)));
    vi.advanceTimersByTime(1000);
    expect(cb).toHaveBeenCalledTimes(2);
  });
});
