/**
 * Shared notifications store. Mount ONCE (see routes/_authenticated.tsx).
 *
 * - Only the last 24 h are ever fetched or shown. On sign-in only an unread head-count
 *   (no rows) is fetched for the badge, ONCE; the list loads when the bell/inbox is opened
 *   (ensureLoaded) and again only when the server says notifications changed while we were away.
 * - Applies `notification:new` socket events live: updates the list and unread
 *   badge, then raises the toast and desktop alert.
 * - Applies `notification:read` socket events live (a notification read in another tab or on another
 *   device): the badge and any held row update instantly. Marking read goes through the server so it can
 *   announce it (see services/notifications.functions.ts). There is no time-based refetch on tab return.
 * - After a socket reconnect the badge count is synced once; the list is reloaded only if the server
 *   reports that notifications changed (missed rows are alerted, read state is refreshed).
 * - Deduplicates by notification id, so an event and a refetch can never alert
 *   twice for the same row.
 *
 * Replaces the per-component fetching and the 4s/6s timers that used to live in
 * use-browser-notifications and NotificationsModal.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { showDesktopNotification } from "@/hooks/use-browser-notifications";
import {
  onRealtime,
  onRealtimeResync,
  onRealtimeSafetyRefresh,
  startRealtime,
  stopRealtime,
} from "@/integrations/realtime/socket";
import { markAllNotificationsReadFn, markNotificationReadFn } from "@/services/notifications.functions";
import type { AppNotification } from "@/lib/types";

// One page of the list; older pages load on demand (loadMore) instead of a 100-row fetch up front.
const LIST_LIMIT = 50;
// Only what AppNotification and the UI use (skips dedupe_key).
const NOTIFICATION_COLUMNS = "id,user_id,type,title,body,task_id,read_at,created_at";
// Notifications older than this are never fetched or shown.
const WINDOW_MS = 24 * 60 * 60 * 1000;
const windowStart = () => new Date(Date.now() - WINDOW_MS).toISOString();
// Re-opening the panel refetches (light index) only if the list is older than this.
const OPEN_REFETCH_AFTER_MS = 30_000;
// If the client was offline long enough to miss many, don't flood the screen.
const MAX_ALERTS_PER_SYNC = 5;

type NotificationsValue = {
  items: AppNotification[];
  unreadCount: number;
  refresh: () => Promise<void>;
  /** Load the list on demand (first open of the panel/inbox); a no-op while it is fresh. */
  ensureLoaded: () => Promise<void>;
  /** There are older notifications than the ones loaded. */
  hasMore: boolean;
  loadMore: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
};

const NotificationsContext = createContext<NotificationsValue | null>(null);

export function useNotifications(): NotificationsValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error("useNotifications must be used inside <NotificationsProvider>");
  return ctx;
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id;
  const navigate = useNavigate();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [hasMore, setHasMore] = useState(false);
  // Unread notifications older than the loaded page, so the badge stays right without loading every row.
  const [olderUnread, setOlderUnread] = useState(0);
  // Before the list is opened only this head-count is fetched (no rows) to drive the badge.
  const [baseUnread, setBaseUnread] = useState(0);
  const [listReady, setListReady] = useState(false);
  const listReadyRef = useRef(false);
  const loadedAt = useRef(0);

  const knownIds = useRef<Set<string>>(new Set());
  // Rows delivered by socket events. A REST fetch that was already in flight when
  // an event arrived can return a snapshot without that row; it is merged back in
  // so a live notification is never erased by a slightly older refetch.
  const pushedRows = useRef<Map<string, AppNotification>>(new Map());
  const baselineReady = useRef(false);
  // Ids known to be read (marked here, or announced by `notification:read`). The server echoes a read to every
  // tab of the user, including the one that did it, so this keeps one read from being applied twice.
  const readIds = useRef<Set<string>>(new Set());
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  // Request de-duplication: concurrent callers (panel open + resync + rollback) share one in-flight request.
  const inflight = useRef<Map<string, Promise<void>>>(new Map());
  const alertRequested = useRef(false);
  const coalesce = useCallback((key: string, run: () => Promise<void>): Promise<void> => {
    const existing = inflight.current.get(key);
    if (existing) return existing;
    const p = run().finally(() => {
      if (inflight.current.get(key) === p) inflight.current.delete(key);
    });
    inflight.current.set(key, p);
    return p;
  }, []);

  const announce = useCallback((n: AppNotification) => {
    void showDesktopNotification(
      { id: n.id, title: n.title || "New Notification", body: n.body || "", taskId: n.task_id },
      (to) => navigateRef.current(to as never),
    );
    toast(n.title || "Operon Notification", {
      description: n.body || undefined,
      action: {
        label: "View",
        onClick: () => {
          if (n.task_id) {
            navigateRef.current({
              to: "/tasks",
              search: { taskId: n.task_id, tab: "all_tasks" } as never,
            });
          } else {
            navigateRef.current({ to: "/notifications" });
          }
        },
      },
    });
  }, []);

  /** Head-only count of unread rows older than `before` (no rows downloaded). */
  const countOlderUnread = useCallback(
    (before: string) =>
      coalesce("older-unread", async () => {
        if (!userId) return;
        const { count, error } = await supabase
          .from("notifications")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .is("read_at", null)
          .gte("created_at", windowStart())
          .lt("created_at", before);
        if (!error) setOlderUnread(count ?? 0);
      }),
    [userId, coalesce],
  );

  /**
   * Badge only: head-count of unread rows in the last 24 h (no rows downloaded). The count already includes the
   * unread rows the list holds (e.g. ones pushed by `notification:new`), so those are subtracted: the badge is
   * then count = held + the rest.
   */
  const loadUnreadCount = useCallback(
    () =>
      coalesce("unread-count", async () => {
        if (!userId) return;
        const listWasReady = listReadyRef.current;
        const { count, error } = await supabase
          .from("notifications")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .is("read_at", null)
          .gte("created_at", windowStart());
        if (error) return;
        // The list finished loading while this count was in flight: the list computes its own totals, and the
        // rows it now holds are not yet reflected in what we would subtract. Drop this (older) answer.
        if (listReadyRef.current !== listWasReady) return;
        const cutoff = Date.now() - WINDOW_MS;
        const heldUnread = itemsRef.current.filter((n) => !n.read_at && Date.parse(n.created_at) >= cutoff).length;
        const rest = Math.max(0, (count ?? 0) - heldUnread);
        if (listReadyRef.current) setOlderUnread(rest);
        else setBaseUnread(rest);
      }),
    [userId, coalesce],
  );

  /** A notification was read (here, or announced from another tab/device). Idempotent. */
  const applyRead = useCallback((id: string, readAt: string) => {
    if (readIds.current.has(id)) return;
    readIds.current.add(id);
    if (readIds.current.size > 500) readIds.current.delete(readIds.current.values().next().value as string);
    const pushed = pushedRows.current.get(id);
    if (pushed) pushedRows.current.set(id, { ...pushed, read_at: pushed.read_at ?? readAt });
    const held = itemsRef.current.find((n) => n.id === id);
    if (held) {
      if (!held.read_at) setItems((prev) => prev.map((n) => (n.id === id && !n.read_at ? { ...n, read_at: readAt } : n)));
      return;
    }
    // Not held (list never opened, or older than the loaded page): it is part of the counted number.
    if (listReadyRef.current) setOlderUnread((n) => Math.max(0, n - 1));
    else setBaseUnread((n) => Math.max(0, n - 1));
  }, []);

  /** Everything unread became read. Idempotent. */
  const applyAllRead = useCallback((readAt: string) => {
    pushedRows.current.forEach((p, id) => pushedRows.current.set(id, { ...p, read_at: p.read_at ?? readAt }));
    setItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: readAt })));
    setOlderUnread(0);
    setBaseUnread(0);
  }, []);

  const runLoad = useCallback(
    async (alertNew: boolean) => {
      if (!userId) return;
      const held = itemsRef.current;
      const since = windowStart();
      let rows: AppNotification[];
      if (baselineReady.current && held.length > 0) {
        // Refetch of a list we already hold: read a light index (id + read state, ~75 bytes/row) of the
        // same newest-LIST_LIMIT page and download full rows (title/body) only for ids we do not have.
        const { data: idx, error: idxErr } = await supabase
          .from("notifications")
          .select("id,read_at")
          .eq("user_id", userId)
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(LIST_LIMIT);
        if (idxErr || !idx) return;
        const heldById = new Map(held.map((n) => [n.id, n]));
        const missing = (idx as Array<{ id: string }>).filter((r) => !heldById.has(r.id)).map((r) => r.id);
        const fetched = new Map<string, AppNotification>();
        if (missing.length > 0) {
          const { data: full, error: fullErr } = await supabase
            .from("notifications")
            .select(NOTIFICATION_COLUMNS)
            .in("id", missing);
          if (fullErr || !full) return;
          for (const r of full as AppNotification[]) fetched.set(r.id, r);
        }
        rows = (idx as Array<{ id: string; read_at: string | null }>).flatMap((r) => {
          const row = fetched.get(r.id) ?? heldById.get(r.id);
          return row ? [{ ...row, read_at: r.read_at }] : [];
        });
      } else {
        const { data, error } = await supabase
          .from("notifications")
          .select(NOTIFICATION_COLUMNS)
          .eq("user_id", userId)
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(LIST_LIMIT);
        if (error || !data) return;
        rows = data as AppNotification[];
      }

      const fresh = rows.filter((n) => !knownIds.current.has(n.id));
      rows.forEach((n) => knownIds.current.add(n.id));
      const have = new Set(rows.map((r) => r.id));
      const oldest = rows.length ? Date.parse(rows[rows.length - 1].created_at) : 0;
      const missed = [...pushedRows.current.values()].filter(
        (p) => !have.has(p.id) && (rows.length < LIST_LIMIT || Date.parse(p.created_at) >= oldest),
      );
      setItems(
        [...missed, ...rows]
          .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
          .slice(0, LIST_LIMIT),
      );

      const more = rows.length >= LIST_LIMIT;
      setHasMore(more);
      if (more && rows.length) void countOlderUnread(rows[rows.length - 1].created_at);
      else setOlderUnread(0);

      if (alertNew && baselineReady.current) {
        fresh
          .filter((n) => !n.read_at)
          .slice(0, MAX_ALERTS_PER_SYNC)
          .reverse()
          .forEach(announce);
      }
      baselineReady.current = true;
      loadedAt.current = Date.now();
      listReadyRef.current = true;
      setListReady(true);
    },
    [userId, announce, countOlderUnread],
  );

  /**
   * Fetch the list. `alertNew` raises alerts for unseen unread rows (catch-up).
   * Concurrent calls share one request; an alerting caller upgrades the shared one.
   */
  const load = useCallback(
    (alertNew: boolean) => {
      if (alertNew) alertRequested.current = true;
      return coalesce("list", async () => {
        const alertThisRun = alertRequested.current;
        alertRequested.current = false;
        try {
          await runLoad(alertThisRun);
        } finally {
          alertRequested.current = false; // a late upgrade must not leak into the next, unrelated load
        }
      });
    },
    [coalesce, runLoad],
  );

  /** Fetch the list the first time the panel/inbox is opened (or if stale); never in the background. */
  const ensureLoaded = useCallback(async () => {
    if (listReadyRef.current && Date.now() - loadedAt.current < OPEN_REFETCH_AFTER_MS) return;
    await load(false);
  }, [load]);

  /** Background resync: refetch the list only if it was ever opened, else just the badge count. */
  const resync = useCallback(
    (alertNew: boolean) => (listReadyRef.current ? load(alertNew) : loadUnreadCount()),
    [load, loadUnreadCount],
  );

  /** The next page of older notifications (cursor on created_at; rows already held are skipped). */
  const loadMore = useCallback(
    () =>
      coalesce("more", async () => {
        const held = itemsRef.current;
        if (!userId || held.length === 0) return;
        const cursor = held[held.length - 1].created_at;
        const { data, error } = await supabase
          .from("notifications")
          .select(NOTIFICATION_COLUMNS)
          .eq("user_id", userId)
          .gte("created_at", windowStart())
          .lt("created_at", cursor)
          .order("created_at", { ascending: false })
          .limit(LIST_LIMIT);
        if (error || !data) return;
        const page = data as AppNotification[];
        page.forEach((n) => knownIds.current.add(n.id));
        setItems((prev) => {
          const have = new Set(prev.map((x) => x.id));
          return [...prev, ...page.filter((n) => !have.has(n.id))];
        });
        setHasMore(page.length >= LIST_LIMIT);
        if (page.length >= LIST_LIMIT) void countOlderUnread(page[page.length - 1].created_at);
        else setOlderUnread(0);
      }),
    [userId, coalesce, countOlderUnread],
  );

  // Connection lifecycle + initial load, per signed-in user.
  useEffect(() => {
    knownIds.current = new Set();
    inflight.current = new Map();
    alertRequested.current = false;
    pushedRows.current = new Map();
    readIds.current = new Set();
    baselineReady.current = false;
    listReadyRef.current = false;
    loadedAt.current = 0;
    setListReady(false);
    setItems([]);
    setHasMore(false);
    setOlderUnread(0);
    setBaseUnread(0);
    if (!userId) return;

    startRealtime();
    void loadUnreadCount();

    const offEvent = onRealtime<AppNotification>("notification:new", (row) => {
      if (!row?.id || row.user_id !== userId) return;
      if (knownIds.current.has(row.id)) return; // duplicate event or already fetched
      knownIds.current.add(row.id);
      pushedRows.current.set(row.id, row);
      setItems((prev) => [row, ...prev.filter((p) => p.id !== row.id)]);
      announce(row);
    });

    // A notification was read in another tab or on another device (or in this tab: the echo is ignored).
    const offRead = onRealtime<{ ids?: string[]; all?: boolean; read_at?: string }>("notification:read", (p) => {
      const at = p?.read_at ?? new Date().toISOString();
      if (p?.all) applyAllRead(at);
      else for (const id of p?.ids ?? []) applyRead(id, at);
    });

    // After a reconnect the server tells us whether notifications changed while we were away
    // (or that it cannot tell). If they did, catch up (missed rows are alerted, read state refreshed);
    // either way a reconnect syncs the badge count once. A clean first connect does not trigger this,
    // because the initial load above already covers it.
    const offResync = onRealtimeResync((info) => {
      if (info.full || info.tables.includes("notifications")) void resync(true);
      else if (info.reason === "connect") void loadUnreadCount();
    });

    // Socket stayed down: the one shared, backed-off safety refresh (see socket.ts).
    const offSafety = onRealtimeSafetyRefresh(() => void resync(true));

    return () => {
      offEvent();
      offRead();
      offResync();
      offSafety();
      stopRealtime();
    };
  }, [userId, loadUnreadCount, resync, announce, applyRead, applyAllRead]);

  const refresh = useCallback(() => load(false), [load]);

  const markRead = useCallback(
    async (id: string) => {
      // Already read (e.g. announced from another tab): nothing to send.
      if (itemsRef.current.find((n) => n.id === id)?.read_at) return;
      const readAt = new Date().toISOString();
      applyRead(id, readAt);
      try {
        await markNotificationReadFn({ data: { id, readAt } });
      } catch {
        readIds.current.delete(id); // so a retry can apply again
        await load(false); // roll back to server truth
      }
    },
    [load, applyRead],
  );

  const markAllRead = useCallback(async () => {
    if (!userId) return;
    const readAt = new Date().toISOString();
    applyAllRead(readAt);
    try {
      await markAllNotificationsReadFn({ data: { readAt, since: windowStart() } });
    } catch {
      await load(false);
    }
  }, [userId, load, applyAllRead]);

  const value = useMemo<NotificationsValue>(() => {
    // Rows that aged past 24 h while the tab stayed open drop out without a refetch.
    const cutoff = Date.now() - WINDOW_MS;
    const visible = items.filter((n) => Date.parse(n.created_at) >= cutoff);
    const unreadHeld = visible.filter((n) => !n.read_at).length;
    return {
      items: visible,
      unreadCount: listReady ? unreadHeld + olderUnread : baseUnread + unreadHeld,
      refresh,
      ensureLoaded,
      hasMore,
      loadMore,
      markRead,
      markAllRead,
    };
  }, [items, listReady, olderUnread, baseUnread, refresh, ensureLoaded, hasMore, loadMore, markRead, markAllRead]);

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}
