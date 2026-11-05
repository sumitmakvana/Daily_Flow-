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
const headCount = { n: 0 };
const windowFilters: Array<{ col: string; val: string }> = [];
const selectedColumns: Array<string | undefined> = [];
const idFetches: string[][] = [];
let gate: Promise<void> | null = null; // lets a test hold a REST fetch in flight

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: (cols?: string, opts?: { head?: boolean }) => {
        const head = Boolean(opts?.head);
        if (head) headCount.n += 1;
        else selectedColumns.push(cols);
        const q: any = {
          // full rows for ids the light refetch found it does not hold yet
          in: async (_col: string, ids: string[]) => {
            idFetches.push(ids);
            return { data: serverRows.filter((r) => ids.includes(r.id)), error: null };
          },
          eq: () => q,
          is: () => q,
          gte: (col: string, val: string) => {
            windowFilters.push({ col, val });
            return q;
          },
          lt: () => q,
          order: () => q,
          limit: async () => {
            fetchCount.n += 1;
            const snapshot = [...serverRows]; // the DB snapshot is taken when the query runs
            if (gate) await gate;
            return { data: snapshot, error: null };
          },
          // head-only unread count (awaited directly)
          then: (res: (v: unknown) => unknown) =>
            Promise.resolve({ count: serverRows.filter((r) => !r.read_at).length, error: null }).then(res),
        };
        return q;
      },
      update: (patch: unknown) => {
        const rec = { patch, col: "", val: undefined as unknown };
        const chain: any = {
          eq: (col: string, val: unknown) => {
            rec.col = col;
            rec.val = val;
            updates.push({ ...rec });
            const done = Object.assign(Promise.resolve({ error: null }), { gte: async () => ({ error: null }) });
            return Object.assign(Promise.resolve({ error: null }), { is: () => done });
          },
        };
        return chain;
      },
    }),
  },
}));
// Marking read goes through the server (which announces `notification:read`), not a browser table update.
const serverReads: Array<{ kind: "one" | "all"; data: any }> = [];
let serverReadFails = false;
vi.mock("@/services/notifications.functions", () => ({
  markNotificationReadFn: async (a: { data: { id: string } }) => {
    serverReads.push({ kind: "one", data: a.data });
    if (serverReadFails) throw new Error("server down");
    return { ids: [a.data.id] };
  },
  markAllNotificationsReadFn: async (a: { data: unknown }) => {
    serverReads.push({ kind: "all", data: a.data });
    if (serverReadFails) throw new Error("server down");
    return { count: 1 };
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
const resyncVisibility = (tables: string[]) => resyncCb?.({ full: false, tables, reason: "visibility" });
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
  serverReads.length = 0;
  serverReadFails = false;
  fetchCount.n = 0;
  headCount.n = 0;
  windowFilters.length = 0;
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

/** Mounts the provider and opens the list, as clicking the bell does. */
async function ready() {
  const hook = renderHook(() => useNotifications(), { wrapper });
  await act(async () => hook.result.current.ensureLoaded());
  await waitFor(() => expect(hook.result.current.items.length).toBe(2));
  return hook;
}

const setVisibility = (v: "visible" | "hidden") => {
  Object.defineProperty(document, "visibilityState", { value: v, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
};

describe("NotificationsProvider on-demand loading and 24 h window", () => {
  it("on sign-in fetches only an unread head-count; no rows until the bell is opened", async () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });
    await waitFor(() => expect(result.current.unreadCount).toBe(1));
    expect(headCount.n).toBe(1);
    expect(fetchCount.n).toBe(0);
    expect(result.current.items).toHaveLength(0);
    await act(async () => result.current.ensureLoaded());
    expect(fetchCount.n).toBe(1);
  });

  it("re-opening a fresh list does not refetch", async () => {
    const { result } = await ready();
    await act(async () => result.current.ensureLoaded());
    expect(fetchCount.n).toBe(1);
  });

  it("a reconnect before the list was ever opened refreshes only the badge count", async () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });
    await waitFor(() => expect(headCount.n).toBe(1));
    serverRows = [row("missed"), ...serverRows];
    await act(async () => resync(["notifications"]));
    await waitFor(() => expect(result.current.unreadCount).toBe(2));
    expect(fetchCount.n).toBe(0);
  });

  it("every query is bounded to the last 24 hours", async () => {
    await ready();
    expect(windowFilters.length).toBeGreaterThan(0);
    for (const f of windowFilters) {
      expect(f.col).toBe("created_at");
      const age = Date.now() - Date.parse(f.val);
      expect(age).toBeGreaterThan(24 * 3600_000 - 60_000);
      expect(age).toBeLessThan(24 * 3600_000 + 60_000);
    }
  });

  it("rows older than 24 h are not shown", async () => {
    serverRows = [row("fresh"), row("stale", { created_at: new Date(Date.now() - 25 * 3600_000).toISOString() })];
    const { result } = renderHook(() => useNotifications(), { wrapper });
    await act(async () => result.current.ensureLoaded());
    await waitFor(() => expect(result.current.items.map((n) => n.id)).toEqual(["fresh"]));
  });
});

describe("NotificationsProvider request volume", () => {
  it("selects only the columns the UI uses, never select(*)", async () => {
    await ready();
    expect(selectedColumns).toHaveLength(1);
    expect(selectedColumns[0]).not.toBe("*");
    expect(selectedColumns[0]).toBe("id,user_id,type,title,body,task_id,read_at,created_at");
  });

  it("returning to the tab never refetches by itself, however long it was away", async () => {
    await ready();
    const lists = fetchCount.n;
    const heads = headCount.n;
    const realNow = Date.now();
    const now = vi.spyOn(Date, "now").mockReturnValue(realNow);
    for (const awayMs of [5_000, 31_000, 10 * 60_000]) {
      setVisibility("hidden");
      now.mockReturnValue(realNow + awayMs);
      await act(async () => setVisibility("visible"));
      await act(async () => {});
    }
    expect(fetchCount.n).toBe(lists);
    expect(headCount.n).toBe(heads);
    now.mockRestore();
  });

  it("registers no visibilitychange listener of its own", async () => {
    const add = vi.spyOn(document, "addEventListener");
    await ready();
    expect(add.mock.calls.filter((c) => c[0] === "visibilitychange")).toHaveLength(0);
    add.mockRestore();
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

  it("a reconnect that missed nothing syncs the badge count ONCE and does not reload the list", async () => {
    await ready();
    expect(fetchCount.n).toBe(1);
    const heads = headCount.n;
    await act(async () => resync(["tasks", "nudges"])); // reconnected; other tables changed, not notifications
    expect(fetchCount.n).toBe(1);
    expect(headCount.n).toBe(heads + 1);
  });

  it("a catch-up after a tab return (not a reconnect) that missed nothing makes no request at all", async () => {
    await ready();
    const heads = headCount.n;
    await act(async () => resyncVisibility([]));
    await act(async () => resyncVisibility(["tasks"]));
    expect(fetchCount.n).toBe(1);
    expect(headCount.n).toBe(heads);
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
    expect(serverReads).toHaveLength(1);
    expect(serverReads[0]).toMatchObject({ kind: "one", data: { id: "old1" } });
    expect(typeof serverReads[0].data.readAt).toBe("string");
    expect(updates).toHaveLength(0); // no direct table update from the browser any more
  });

  it("markRead on a row that is already read sends nothing", async () => {
    const { result } = await ready();
    await act(async () => result.current.markRead("old2")); // old2 is read already
    expect(serverReads).toHaveLength(0);
  });

  it("a failed markRead rolls back to the server's state and can be retried", async () => {
    const { result } = await ready();
    serverReadFails = true;
    await act(async () => result.current.markRead("old1"));
    await waitFor(() => expect(result.current.unreadCount).toBe(1)); // reloaded: still unread
    expect(fetchCount.n).toBe(2);
    serverReadFails = false;
    await act(async () => result.current.markRead("old1"));
    expect(result.current.unreadCount).toBe(0);
  });

  it("markAllRead clears the badge", async () => {
    const { result } = await ready();
    act(() => ev.get("notification:new")!(row("n1")));
    await act(async () => result.current.markAllRead());
    expect(result.current.unreadCount).toBe(0);
    expect(serverReads).toHaveLength(1);
    expect(serverReads[0].kind).toBe("all");
    expect(typeof serverReads[0].data.since).toBe("string");
  });

  it("notification:read from another tab/device updates a held row and the badge instantly", async () => {
    const { result } = await ready();
    expect(result.current.unreadCount).toBe(1);
    act(() => ev.get("notification:read")!({ ids: ["old1"], read_at: "2026-11-02T10:00:00Z" }));
    expect(result.current.unreadCount).toBe(0);
    expect(result.current.items.find((n) => n.id === "old1")?.read_at).toBe("2026-11-02T10:00:00Z");
    expect(fetchCount.n).toBe(1); // no request: the event carried everything needed
  });

  it("notification:read before the list was ever opened lowers the badge count, once per id", async () => {
    serverRows = [row("a"), row("b"), row("c", { read_at: "2026-01-01T00:00:00Z" })];
    const { result } = renderHook(() => useNotifications(), { wrapper });
    await waitFor(() => expect(result.current.unreadCount).toBe(2));
    const headsAfterLoad = headCount.n;
    act(() => ev.get("notification:read")!({ ids: ["a"], read_at: "2026-11-02T10:00:00Z" }));
    expect(result.current.unreadCount).toBe(1);
    act(() => ev.get("notification:read")!({ ids: ["a"], read_at: "2026-11-02T10:00:00Z" })); // duplicate delivery
    expect(result.current.unreadCount).toBe(1);
    expect(headCount.n).toBe(headsAfterLoad); // and no request
    expect(fetchCount.n).toBe(0);
  });

  it("this tab's own read is not applied twice when the server echoes it", async () => {
    serverRows = [row("a"), row("b")];
    const { result } = renderHook(() => useNotifications(), { wrapper });
    await act(async () => result.current.ensureLoaded());
    await waitFor(() => expect(result.current.unreadCount).toBe(2));
    await act(async () => result.current.markRead("a"));
    expect(result.current.unreadCount).toBe(1);
    act(() => ev.get("notification:read")!({ ids: ["a"], read_at: "2026-11-02T10:00:00Z" })); // the echo
    expect(result.current.unreadCount).toBe(1);
  });

  it("notification:read with all:true clears the badge and every held row", async () => {
    const { result } = await ready();
    act(() => ev.get("notification:new")!(row("n1")));
    expect(result.current.unreadCount).toBe(2);
    act(() => ev.get("notification:read")!({ all: true, count: 2, read_at: "2026-11-02T10:00:00Z" }));
    expect(result.current.unreadCount).toBe(0);
    expect(result.current.items.every((n) => n.read_at)).toBe(true);
  });

  it("a pushed notification:new is counted once, also after a reconnect syncs the count", async () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });
    await waitFor(() => expect(result.current.unreadCount).toBe(1));
    serverRows = [row("n1"), ...serverRows]; // the DB now has it...
    act(() => ev.get("notification:new")!(row("n1"))); // ...and the push arrives
    expect(result.current.unreadCount).toBe(2);
    await act(async () => resync([])); // a reconnect syncs the count: still 2, not 3
    await waitFor(() => expect(headCount.n).toBeGreaterThan(1));
    expect(result.current.unreadCount).toBe(2);
  });

  it("notification:unread sets the badge from the server total with no request (list opened)", async () => {
    const { result } = await ready();
    const heads = headCount.n;
    act(() => ev.get("notification:unread")!({ count: 6 })); // 1 held unread + 5 older ones
    expect(result.current.unreadCount).toBe(6);
    act(() => ev.get("notification:unread")!({ count: 1 })); // the older ones were read elsewhere
    expect(result.current.unreadCount).toBe(1);
    expect(headCount.n).toBe(heads);
    expect(fetchCount.n).toBe(1);
  });

  it("notification:unread before the list was ever opened updates the badge with no request", async () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });
    await waitFor(() => expect(result.current.unreadCount).toBe(1));
    act(() => ev.get("notification:unread")!({ count: 4 }));
    expect(result.current.unreadCount).toBe(4);
    expect(headCount.n).toBe(1);
    expect(fetchCount.n).toBe(0);
  });

  it("notification:new immediately followed by notification:unread (same tick) counts the row once", async () => {
    const { result } = await ready();
    act(() => {
      ev.get("notification:new")!(row("n1"));
      ev.get("notification:unread")!({ count: 2 }); // the server total already includes n1
    });
    expect(result.current.unreadCount).toBe(2);
  });

  it("notification:read followed by notification:unread in the same tick does not double count", async () => {
    const { result } = await ready();
    act(() => {
      ev.get("notification:read")!({ ids: ["old1"], read_at: "2026-11-02T10:00:00Z" });
      ev.get("notification:unread")!({ count: 0 });
    });
    expect(result.current.unreadCount).toBe(0);
  });

  it("ignores a malformed notification:unread payload", async () => {
    const { result } = await ready();
    for (const bad of [undefined, null, {}, { count: "3" }, { count: -1 }, { count: NaN }]) {
      act(() => ev.get("notification:unread")!(bad as never));
    }
    expect(result.current.unreadCount).toBe(1);
  });

  it("notification:deleted drops a held unread row and lowers the badge, then the server total confirms it", async () => {
    const { result } = await ready();
    act(() => ev.get("notification:deleted")!({ id: "old1" }));
    expect(result.current.items.map((n) => n.id)).toEqual(["old2"]);
    expect(result.current.unreadCount).toBe(0);
    act(() => ev.get("notification:unread")!({ count: 0 }));
    expect(result.current.unreadCount).toBe(0);
    expect(fetchCount.n).toBe(1);
  });

  it("a deleted row that was never loaded is corrected by the pushed count alone", async () => {
    const { result } = await ready();
    act(() => ev.get("notification:deleted")!({ id: "not-held" }));
    expect(result.current.items).toHaveLength(2);
    act(() => ev.get("notification:unread")!({ count: 1 }));
    expect(result.current.unreadCount).toBe(1);
  });

  it("a deleted row can be re-delivered later (its id is forgotten, not blocked)", async () => {
    const { result } = await ready();
    act(() => ev.get("notification:deleted")!({ id: "old1" }));
    act(() => ev.get("notification:new")!(row("old1")));
    expect(result.current.items.map((n) => n.id)).toContain("old1");
  });

  it("reconnect: one head-count resyncs the badge, then pushes keep it exact with no further requests", async () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });
    await waitFor(() => expect(result.current.unreadCount).toBe(1)); // initial count: 1 request
    serverRows = [row("n1"), row("n2"), ...serverRows]; // missed while disconnected
    await act(async () => resync(["tasks"])); // reconnect: one count request
    await waitFor(() => expect(result.current.unreadCount).toBe(3));
    expect(headCount.n).toBe(2);
    act(() => ev.get("notification:unread")!({ count: 5 }));
    act(() => ev.get("notification:unread")!({ count: 4 }));
    act(() => ev.get("notification:read")!({ ids: ["n1"], read_at: "2026-11-02T10:00:00Z" }));
    expect(result.current.unreadCount).toBe(3);
    expect(headCount.n).toBe(2);
    expect(fetchCount.n).toBe(0);
  });

  it("unsubscribes the unread and deleted listeners on unmount", async () => {
    const { unmount } = await ready();
    expect(ev.has("notification:unread")).toBe(true);
    expect(ev.has("notification:deleted")).toBe(true);
    unmount();
    expect(ev.has("notification:unread")).toBe(false);
    expect(ev.has("notification:deleted")).toBe(false);
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
