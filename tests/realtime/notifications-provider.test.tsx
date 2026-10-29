import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const row = (id: string, o: Record<string, unknown> = {}) => ({
  id,
  user_id: "me",
  type: "task_assigned",
  title: `Title ${id}`,
  body: "b",
  task_id: null,
  read_at: null,
  created_at: new Date().toISOString(),
  ...o,
});

// ---- mocks ---------------------------------------------------------------
let serverRows: ReturnType<typeof row>[] = [];
const updates: Array<{ patch: unknown; col: string; val: unknown }> = [];
const fetchCount = { n: 0 };
const selectedColumns: Array<string | undefined> = [];
const idFetches: string[][] = [];
let gate: Promise<void> | null = null; // lets a test hold a REST fetch in flight

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: (cols?: string) => {
        selectedColumns.push(cols);
        return {
        // full rows for ids the light refetch found it does not hold yet
        in: async (_col: string, ids: string[]) => {
          idFetches.push(ids);
          return { data: serverRows.filter((r) => ids.includes(r.id)), error: null };
        },
        eq: () => ({
          order: () => ({
            limit: async () => {
              fetchCount.n += 1;
              const snapshot = [...serverRows]; // the DB snapshot is taken when the query runs
              if (gate) await gate;
              return { data: snapshot, error: null };
            },
          }),
        }),
        };
      },
      update: (patch: unknown) => {
        const rec = { patch, col: "", val: undefined as unknown };
        const chain: any = {
          eq: (col: string, val: unknown) => {
            rec.col = col;
            rec.val = val;
            updates.push({ ...rec });
            return Object.assign(Promise.resolve({ error: null }), { is: async () => ({ error: null }) });
          },
        };
        return chain;
      },
    }),
  },
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "me" } }) }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));

const toastFn = vi.fn();
vi.mock("sonner", () => ({ toast: (...a: unknown[]) => toastFn(...a) }));
const desktop = vi.fn();
vi.mock("@/hooks/use-browser-notifications", () => ({
  showDesktopNotification: (...a: unknown[]) => desktop(...a),
}));

const ev = new Map<string, (p: unknown) => void>();
type ResyncInfo = { full: boolean; tables: string[]; reason: string };
let resyncCb: ((info: ResyncInfo) => void) | null = null;
let safetyCb: (() => void) | null = null;
/** What socket.ts reports after a reconnect: which tables changed (or that it cannot tell). */
const resync = (tables: string[], full = false) => resyncCb?.({ full, tables, reason: "connect" });
const startRealtime = vi.fn();
const stopRealtime = vi.fn();
vi.mock("@/integrations/realtime/socket", () => ({
  startRealtime: () => startRealtime(),
  stopRealtime: () => stopRealtime(),
  onRealtime: (name: string, h: (p: unknown) => void) => {
    ev.set(name, h);
    return () => ev.delete(name);
  },
  onRealtimeResync: (h: (info: ResyncInfo) => void) => {
    resyncCb = h;
    return () => (resyncCb = null);
  },
  onRealtimeSafetyRefresh: (h: () => void) => {
    safetyCb = h;
    return () => (safetyCb = null);
  },
}));

import { NotificationsProvider, useNotifications } from "@/hooks/use-notifications";

const wrapper = ({ children }: { children: ReactNode }) => <NotificationsProvider>{children}</NotificationsProvider>;

beforeEach(() => {
  serverRows = [row("old1"), row("old2", { read_at: "2026-01-01T00:00:00Z" })];
  updates.length = 0;
  fetchCount.n = 0;
  selectedColumns.length = 0;
  idFetches.length = 0;
  toastFn.mockClear();
  desktop.mockClear();
  startRealtime.mockClear();
  stopRealtime.mockClear();
  ev.clear();
  resyncCb = null;
  safetyCb = null;
});

async function ready() {
  const hook = renderHook(() => useNotifications(), { wrapper });
  await waitFor(() => expect(hook.result.current.items.length).toBe(2));
  return hook;
}

const setVisibility = (v: "visible" | "hidden") => {
  Object.defineProperty(document, "visibilityState", { value: v, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
};

describe("NotificationsProvider request volume", () => {
  it("selects only the columns the UI uses, never select(*)", async () => {
    await ready();
    expect(selectedColumns).toHaveLength(1);
    expect(selectedColumns[0]).not.toBe("*");
    expect(selectedColumns[0]).toBe("id,user_id,type,title,body,task_id,read_at,created_at");
  });

  it("a brief tab blur/focus does not refetch; coming back after a long absence does", async () => {
    await ready();
    expect(fetchCount.n).toBe(1);

    const realNow = Date.now();
    const now = vi.spyOn(Date, "now").mockReturnValue(realNow);
    setVisibility("hidden");
    now.mockReturnValue(realNow + 5_000);
    setVisibility("visible");
    await act(async () => {});
    expect(fetchCount.n).toBe(1); // 5 s away: no refetch

    setVisibility("hidden");
    now.mockReturnValue(realNow + 5_000 + 31_000);
    await act(async () => setVisibility("visible"));
    await waitFor(() => expect(fetchCount.n).toBe(2)); // 31 s away: resync once
    now.mockRestore();
  });
});

describe("NotificationsProvider", () => {
  it("loads once, sets the unread badge, and does NOT alert for existing rows", async () => {
    const { result } = await ready();
    expect(result.current.unreadCount).toBe(1);
    expect(fetchCount.n).toBe(1);
    expect(toastFn).not.toHaveBeenCalled();
    expect(desktop).not.toHaveBeenCalled();
    expect(startRealtime).toHaveBeenCalled();
  });

  it("notification:new updates list + badge and raises toast and desktop alert", async () => {
    const { result } = await ready();
    act(() => ev.get("notification:new")!(row("n1", { title: "Assigned" })));
    expect(result.current.items[0].id).toBe("n1");
    expect(result.current.unreadCount).toBe(2);
    expect(toastFn).toHaveBeenCalledTimes(1);
    expect(desktop).toHaveBeenCalledTimes(1);
    expect(desktop.mock.calls[0][0]).toMatchObject({ id: "n1", title: "Assigned" });
    expect(fetchCount.n).toBe(1); // no REST call needed for a pushed event
  });

  it("ignores duplicate events and rows already fetched", async () => {
    const { result } = await ready();
    act(() => ev.get("notification:new")!(row("n1")));
    act(() => ev.get("notification:new")!(row("n1")));
    act(() => ev.get("notification:new")!(row("old1"))); // already known from the fetch
    expect(result.current.items.filter((n) => n.id === "n1").length).toBe(1);
    expect(toastFn).toHaveBeenCalledTimes(1);
  });

  it("ignores events addressed to another user", async () => {
    const { result } = await ready();
    act(() => ev.get("notification:new")!(row("x", { user_id: "someone-else" })));
    expect(result.current.items.length).toBe(2);
    expect(toastFn).not.toHaveBeenCalled();
  });

  it("a reconnect that missed nothing for notifications does not refetch (targeted resync)", async () => {
    await ready();
    expect(fetchCount.n).toBe(1);
    act(() => resync([])); // reconnected, nothing changed
    act(() => resync(["tasks", "nudges"])); // other tables changed, not notifications
    expect(fetchCount.n).toBe(1);
  });

  it("when the server says notifications changed, it refetches and alerts only for missed rows", async () => {
    const { result } = await ready();
    serverRows = [row("missed"), ...serverRows];
    await act(async () => resync(["notifications"]));
    await waitFor(() => expect(result.current.items.length).toBe(3));
    expect(fetchCount.n).toBe(2);
    expect(toastFn).toHaveBeenCalledTimes(1);
    expect(desktop.mock.calls[0][0]).toMatchObject({ id: "missed" });

    // A second resync with nothing new must not re-alert.
    await act(async () => resync(["notifications"]));
    expect(toastFn).toHaveBeenCalledTimes(1);
  });

  it("a FULL resync (server restarted / cannot tell) refetches, so nothing is silently lost", async () => {
    const { result } = await ready();
    serverRows = [row("while-restarting"), ...serverRows];
    await act(async () => resync([], true));
    await waitFor(() => expect(result.current.items.length).toBe(3));
    expect(fetchCount.n).toBe(2);
  });

  it("the shared safety refresh (socket down) refetches and alerts for missed rows", async () => {
    const { result } = await ready();
    serverRows = [row("missed-while-down"), ...serverRows];
    await act(async () => safetyCb!());
    await waitFor(() => expect(result.current.items.length).toBe(3));
    expect(toastFn).toHaveBeenCalledTimes(1);
  });

  it("a refetch of a held list reads a light index and downloads full rows only for new ids", async () => {
    const { result } = await ready();
    serverRows = [row("brand-new"), ...serverRows];
    await act(async () => safetyCb!());
    await waitFor(() => expect(result.current.items.length).toBe(3));
    expect(selectedColumns).toEqual([
      "id,user_id,type,title,body,task_id,read_at,created_at", // the first, full load
      "id,read_at", // the light index
      "id,user_id,type,title,body,task_id,read_at,created_at", // full rows, for the new id only
    ]);
    expect(idFetches).toEqual([["brand-new"]]);
  });

  it("a refetch picks up read state changed elsewhere without downloading any full row", async () => {
    const { result } = await ready();
    serverRows = serverRows.map((r) => (r.id === "old1" ? { ...r, read_at: "2026-02-02T00:00:00Z" } : r));
    await act(async () => safetyCb!());
    await waitFor(() => expect(result.current.items.find((n) => n.id === "old1")?.read_at).toBe("2026-02-02T00:00:00Z"));
    expect(idFetches).toEqual([]);
  });

  it("starts no polling interval of its own", async () => {
    // (Testing Library's waitFor polls every 50ms; the provider must add nothing of 1s or more.)
    const spy = vi.spyOn(globalThis, "setInterval");
    const { unmount } = await ready();
    const slow = spy.mock.calls.filter(([, ms]) => Number(ms ?? 0) >= 1000);
    expect(slow).toHaveLength(0);
    unmount();
    spy.mockRestore();
  });

  it("an event followed by a refetch containing it does not alert twice", async () => {
    await ready();
    act(() => ev.get("notification:new")!(row("n1")));
    serverRows = [row("n1"), ...serverRows];
    await act(async () => resync(["notifications"]));
    expect(toastFn).toHaveBeenCalledTimes(1);
  });

  it("a live notification is NOT erased by a refetch that was already in flight", async () => {
    const { result } = await ready();
    let release!: () => void;
    gate = new Promise<void>((r) => (release = r));
    // Reconnect starts a refetch; its snapshot is taken BEFORE the new row exists.
    act(() => {
      resync(["notifications"]); // starts the refetch; it now waits on the gate
    });
    await waitFor(() => expect(fetchCount.n).toBe(2));
    act(() => ev.get("notification:new")!(row("live1", { title: "Live" }))); // arrives mid-flight
    expect(result.current.items.map((n) => n.id)).toContain("live1");
    gate = null;
    await act(async () => {
      release(); // the stale snapshot (without live1) now lands
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(result.current.items.map((n) => n.id)).toContain("live1"); // still there
    expect(result.current.unreadCount).toBe(2);
    expect(toastFn).toHaveBeenCalledTimes(1); // alerted once, not again
  });

  it("markRead is optimistic and writes read_at", async () => {
    const { result } = await ready();
    await act(async () => result.current.markRead("old1"));
    expect(result.current.unreadCount).toBe(0);
    expect(updates[0]).toMatchObject({ col: "id", val: "old1" });
  });

  it("markAllRead clears the badge", async () => {
    const { result } = await ready();
    act(() => ev.get("notification:new")!(row("n1")));
    await act(async () => result.current.markAllRead());
    expect(result.current.unreadCount).toBe(0);
  });

  it("cleans up listeners and disconnects on unmount", async () => {
    const { unmount } = await ready();
    unmount();
    expect(ev.size).toBe(0);
    expect(resyncCb).toBeNull();
    expect(safetyCb).toBeNull();
    expect(stopRealtime).toHaveBeenCalled();
  });
});
