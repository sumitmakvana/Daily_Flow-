/**
 * Shared notifications store. Mount ONCE (see routes/_authenticated.tsx).
 *
 * - Fetches the user's notifications over REST once, and again on socket
 *   reconnect / tab refocus to catch anything missed.
 * - Applies `notification:new` socket events live: updates the list and unread
 *   badge, then raises the toast and desktop alert.
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
import type { AppNotification } from "@/lib/types";

// One page of the list; older pages load on demand (loadMore) instead of a 100-row fetch up front.
const LIST_LIMIT = 50;
// Only what AppNotification and the UI use (skips dedupe_key).
const NOTIFICATION_COLUMNS = "id,user_id,type,title,body,task_id,read_at,created_at";
// A tab hidden for less than this does not refetch when it becomes visible again
// (new notifications arrive over the socket; this only resyncs read state from other devices).
const REFOCUS_REFETCH_AFTER_MS = 30_000;
// If the client was offline long enough to miss many, don't flood the screen.
const MAX_ALERTS_PER_SYNC = 5;

type NotificationsValue = {
  items: AppNotification[];
  unreadCount: number;
  refresh: () => Promise<void>;
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

  const knownIds = useRef<Set<string>>(new Set());
  // Rows delivered by socket events. A REST fetch that was already in flight when
  // an event arrived can return a snapshot without that row; it is merged back in
  // so a live notification is never erased by a slightly older refetch.
  const pushedRows = useRef<Map<string, AppNotification>>(new Map());
  const baselineReady = useRef(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

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
    async (before: string) => {
      if (!userId) return;
      const { count, error } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .is("read_at", null)
        .lt("created_at", before);
      if (!error) setOlderUnread(count ?? 0);
    },
    [userId],
  );

  /** Fetch the list. `alertNew` raises alerts for unseen unread rows (catch-up). */
  const load = useCallback(
    async (alertNew: boolean) => {
      if (!userId) return;
      const held = itemsRef.current;
      let rows: AppNotification[];
      if (baselineReady.current && held.length > 0) {
        // Refetch of a list we already hold: read a light index (id + read state, ~75 bytes/row) of the
        // same newest-LIST_LIMIT page and download full rows (title/body) only for ids we do not have.
        const { data: idx, error: idxErr } = await supabase
          .from("notifications")
          .select("id,read_at")
          .eq("user_id", userId)
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
    },
    [userId, announce, countOlderUnread],
  );

  /** The next page of older notifications (cursor on created_at; rows already held are skipped). */
  const loadMore = useCallback(async () => {
    const held = itemsRef.current;
    if (!userId || held.length === 0) return;
    const cursor = held[held.length - 1].created_at;
    const { data, error } = await supabase
      .from("notifications")
      .select(NOTIFICATION_COLUMNS)
      .eq("user_id", userId)
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
  }, [userId, countOlderUnread]);

  // Connection lifecycle + initial load, per signed-in user.
  useEffect(() => {
    knownIds.current = new Set();
    pushedRows.current = new Map();
    baselineReady.current = false;
    setItems([]);
    setHasMore(false);
    setOlderUnread(0);
    if (!userId) return;

    startRealtime();
    void load(false);

    const offEvent = onRealtime<AppNotification>("notification:new", (row) => {
      if (!row?.id || row.user_id !== userId) return;
      if (knownIds.current.has(row.id)) return; // duplicate event or already fetched
      knownIds.current.add(row.id);
      pushedRows.current.set(row.id, row);
      setItems((prev) => [row, ...prev.filter((p) => p.id !== row.id)]);
      announce(row);
    });

    // After a reconnect the server tells us whether notifications changed while we were away
    // (or that it cannot tell): refetch only then. A clean first connect does not trigger this,
    // because the initial load above already covers it.
    const offResync = onRealtimeResync((info) => {
      if (info.full || info.tables.includes("notifications")) void load(true);
    });

    // Socket stayed down: the one shared, backed-off safety refresh (see socket.ts).
    const offSafety = onRealtimeSafetyRefresh(() => void load(true));

    // Read state changes made in another tab/device have no push event, so
    // resync when this tab becomes visible again.
    let hiddenAt = 0;
    const onVisible = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      const away = hiddenAt ? Date.now() - hiddenAt : Infinity;
      hiddenAt = 0;
      if (away >= REFOCUS_REFETCH_AFTER_MS) void load(true);
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      offEvent();
      offResync();
      offSafety();
      document.removeEventListener("visibilitychange", onVisible);
      stopRealtime();
    };
  }, [userId, load, announce]);

  const refresh = useCallback(() => load(false), [load]);

  const markRead = useCallback(
    async (id: string) => {
      const readAt = new Date().toISOString();
      const pushed = pushedRows.current.get(id);
      if (pushed) pushedRows.current.set(id, { ...pushed, read_at: pushed.read_at ?? readAt });
      setItems((prev) => prev.map((n) => (n.id === id && !n.read_at ? { ...n, read_at: readAt } : n)));
      const { error } = await supabase
        .from("notifications")
        .update({ read_at: readAt } as never)
        .eq("id", id);
      if (error) await load(false); // roll back to server truth
    },
    [load],
  );

  const markAllRead = useCallback(async () => {
    if (!userId) return;
    const readAt = new Date().toISOString();
    pushedRows.current.forEach((p, id) => pushedRows.current.set(id, { ...p, read_at: p.read_at ?? readAt }));
    setItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: readAt })));
    setOlderUnread(0);
    const { error } = await supabase
      .from("notifications")
      .update({ read_at: readAt } as never)
      .eq("user_id", userId)
      .is("read_at", null);
    if (error) await load(false);
  }, [userId, load]);

  const value = useMemo<NotificationsValue>(
    () => ({
      items,
      unreadCount: items.filter((n) => !n.read_at).length + olderUnread,
      refresh,
      hasMore,
      loadMore,
      markRead,
      markAllRead,
    }),
    [items, olderUnread, refresh, hasMore, loadMore, markRead, markAllRead],
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}
