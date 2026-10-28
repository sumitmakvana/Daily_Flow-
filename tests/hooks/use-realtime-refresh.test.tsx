import { renderHook } from "@testing-library/react";
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
vi.mock("@/integrations/supabase/client", async () => {
  const { createRealtimeChannel } = await import("@/integrations/realtime/channel");
  return {
    supabase: {
      channel: (n: string) => createRealtimeChannel(n),
      removeChannel: (c: { unsubscribe: () => void }) => c.unsubscribe(),
    },
  };
});

import { useRealtimeRefresh } from "@/hooks/use-realtime-refresh";

const emit = (table: string) =>
  handlers.get("entity:changed")?.forEach((h) => h({ schema: "public", table, eventType: "UPDATE", new: {}, old: {} }));
const live = () => handlers.get("entity:changed")?.size ?? 0;
const resync = (tables: string[], full = false) => resyncHandlers.forEach((h) => h({ full, tables, reason: "connect" }));

beforeEach(() => {
  vi.useFakeTimers();
  handlers.clear();
  resyncHandlers.clear();
  safetyHandlers.clear();
});
afterEach(() => vi.useRealTimers());

describe("useRealtimeRefresh", () => {
  it("runs the callback when ANY listed table changes, and not for other tables", () => {
    const cb = vi.fn();
    renderHook(() => useRealtimeRefresh(["tasks", "risk_events", "approval_requests"], cb, "page"));
    emit("tasks");
    expect(cb).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(300);
    emit("approval_requests");
    expect(cb).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(300);
    emit("nudges");
    emit("profiles");
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("uses the LATEST callback without re-subscribing", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useRealtimeRefresh(["tasks"], cb, "page"), { initialProps: { cb: first } });
    const subsBefore = live();
    rerender({ cb: second });
    expect(live()).toBe(subsBefore);
    emit("tasks");
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("a burst of events causes a refetch or two, not hundreds", () => {
    const cb = vi.fn();
    renderHook(() => useRealtimeRefresh(["tasks"], cb, "page"));
    for (let i = 0; i < 300; i++) emit("tasks");
    vi.advanceTimersByTime(1000);
    expect(cb.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("after a reconnect, refetches only if one of ITS tables changed while away (targeted)", () => {
    const cb = vi.fn();
    renderHook(() => useRealtimeRefresh(["tasks", "risk_events"], cb, "page"));
    resync([]); // reconnected, nothing missed
    resync(["nudges"]); // an unrelated table changed
    expect(cb).not.toHaveBeenCalled();
    resync(["risk_events"]);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("a full resync (server restarted / cannot tell) refetches", () => {
    const cb = vi.fn();
    renderHook(() => useRealtimeRefresh(["tasks"], cb, "page"));
    resync([], true);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("the shared safety refresh (socket down) refetches too", () => {
    const cb = vi.fn();
    renderHook(() => useRealtimeRefresh(["tasks"], cb, "page"));
    safetyHandlers.forEach((h) => h());
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("has NO timer-driven polling: minutes of quiet = zero calls", () => {
    const cb = vi.fn();
    renderHook(() => useRealtimeRefresh(["tasks", "risk_events"], cb, "page"));
    vi.advanceTimersByTime(10 * 60_000);
    expect(cb).not.toHaveBeenCalled();
  });

  it("re-subscribes when the table list changes, and cleans up fully on unmount", () => {
    const cb = vi.fn();
    const { rerender, unmount } = renderHook(({ t }) => useRealtimeRefresh(t, cb, "page"), { initialProps: { t: ["tasks"] } });
    emit("risk_events");
    expect(cb).not.toHaveBeenCalled();
    rerender({ t: ["tasks", "risk_events"] });
    emit("risk_events");
    expect(cb).toHaveBeenCalledTimes(1);
    unmount();
    expect(live()).toBe(0);
    expect(resyncHandlers.size).toBe(0);
    expect(safetyHandlers.size).toBe(0);
    emit("tasks");
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
