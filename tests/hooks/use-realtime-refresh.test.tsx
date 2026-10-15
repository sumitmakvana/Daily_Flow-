import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const handlers = new Map<string, Set<(p: unknown) => void>>();
const connectHandlers = new Set<(isReconnect: boolean) => void>();

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
  isRealtimeConnected: () => true,
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

beforeEach(() => {
  vi.useFakeTimers();
  handlers.clear();
  connectHandlers.clear();
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

  it("refetches once on a socket reconnect (catches what was missed) but not on the first connect", () => {
    const cb = vi.fn();
    renderHook(() => useRealtimeRefresh(["tasks"], cb, "page"));
    connectHandlers.forEach((h) => h(false));
    expect(cb).not.toHaveBeenCalled();
    connectHandlers.forEach((h) => h(true));
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
    expect(connectHandlers.size).toBe(0);
    emit("tasks");
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
