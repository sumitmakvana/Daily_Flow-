/**
 * Drop-in replacement for the old fake `supabase.channel()` (which fired every
 * subscriber every 4 seconds). Keeps the same chainable API:
 *
 *   supabase.channel(name).on("postgres_changes", { event, table, filter }, cb).subscribe()
 *   supabase.removeChannel(channel)
 *
 * Tables in PUSH_TABLES are delivered by real Socket.IO events, with a
 * `postgres_changes`-shaped payload ({ eventType, table, new, old }). On a
 * socket reconnect their callbacks fire once (no payload) so consumers refetch
 * what they missed.
 *
 * There is no recurring client poll for any push table. Recovery instead:
 *  - on a socket reconnect, every callback fires once (catch up on what was missed);
 *  - when a tab becomes visible again after being hidden, every callback fires once;
 *  - a slow fallback poll runs ONLY while the socket is down and the tab is visible.
 * Subscriptions to tables that are not push tables get a console warning and no poll.
 */
import { isRealtimeConnected, onRealtime, onRealtimeConnect } from "./socket";

/** Tables whose changes the server pushes over the socket. */
export const PUSH_TABLES = new Set<string>([
  "notifications",
  "tasks",
  "nudges",
  "risk_events",
  "planning_suggestions",
  "approval_requests",
  "task_review_decisions",
]);

/**
 * Tables whose client poll has been removed: all of them. Events come from the
 * server (DB triggers when installed, otherwise the server's read-only change
 * watcher plus write pokes), so no client needs to poll.
 */
export const POLL_DISABLED_TABLES = new Set<string>(PUSH_TABLES);

/** A tab hidden at least this long refetches when it becomes visible again. */
const VISIBILITY_REFETCH_AFTER_MS = 5000;

const DISCONNECTED_FALLBACK_MS = 30_000;
/**
 * Socket events for these tables are coalesced (leading + trailing) so a burst
 * of changes causes a handful of REST refetches, not hundreds. Notifications are
 * not throttled: each one carries data the consumer needs.
 */
const THROTTLE_MS = 250;
const NO_THROTTLE_TABLES = new Set<string>(["notifications"]);

export type ChangePayload = {
  schema: string;
  table: string;
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: Record<string, unknown>;
  old: Record<string, unknown>;
  bulk?: boolean;
};

type Sub = {
  event: string;
  table?: string;
  filter?: string;
  cb: (payload?: ChangePayload) => void;
  timer?: ReturnType<typeof setTimeout>;
  pending?: ChangePayload;
};

const isPush = (s: Sub) => !!s.table && PUSH_TABLES.has(s.table);
const isPollDisabled = (s: Sub) => !!s.table && POLL_DISABLED_TABLES.has(s.table);

/**
 * Evaluate a PostgREST-style filter (`col=eq.v`, `col=in.(a,b)`) against the
 * changed row. The new AND the old row are both considered, so a user who just
 * lost a task (assignee changed away from them) still gets the refresh. If a row
 * doesn't carry the column we can't tell, so we let it through (a spurious
 * refetch is safe; a missed one is not).
 */
export function matchesFilter(filter: string | undefined, payload: ChangePayload): boolean {
  if (!filter) return true;
  const m = /^([^=]+)=(eq|in)\.(.*)$/.exec(filter);
  if (!m) return true;
  const [, col, op, raw] = m;
  const rows = [payload.new, payload.old].filter((r) => r && Object.keys(r).length > 0);
  if (rows.length === 0) return true;
  const list = op === "in" ? raw.replace(/^\(|\)$/g, "").split(",") : [raw];
  return rows.some((row) => !(col in row) || list.includes(String(row[col])));
}

export function createRealtimeChannel(_name: string) {
  const subs: Sub[] = [];
  const teardown: Array<() => void> = [];
  let timers: Array<ReturnType<typeof setInterval>> = [];

  const deliver = (s: Sub, payload: ChangePayload) => {
    if (!s.table || NO_THROTTLE_TABLES.has(s.table)) {
      s.cb(payload);
      return;
    }
    if (s.timer) {
      s.pending = payload; // trailing call will use the latest
      return;
    }
    s.cb(payload); // leading call
    s.timer = setTimeout(() => {
      s.timer = undefined;
      const p = s.pending;
      s.pending = undefined;
      if (p) s.cb(p);
    }, THROTTLE_MS);
  };

  const dispatch = (payload: ChangePayload) => {
    for (const s of subs) {
      // Table-less subscriptions only ever use the legacy poll; they must not
      // receive every socket event.
      if (!s.table || s.table !== payload.table) continue;
      if (s.event !== "*" && s.event !== payload.eventType) continue;
      if (!matchesFilter(s.filter, payload)) continue;
      deliver(s, payload);
    }
  };

  const channel = {
    on(_type: string, opts: { event?: string; table?: string; filter?: string }, cb: Sub["cb"]) {
      subs.push({ event: opts?.event ?? "*", table: opts?.table, filter: opts?.filter, cb });
      return channel;
    },
    subscribe() {
      if (teardown.length || timers.length) return channel;
      const pushed = subs.filter(isPush);

      if (pushed.length) {
        teardown.push(
          onRealtime<ChangePayload>("entity:changed", (p) => dispatch(p)),
          // The notifications trigger already emits a dedicated event; map it
          // to the postgres_changes shape existing consumers expect.
          onRealtime<Record<string, unknown>>("notification:new", (row) =>
            dispatch({
              schema: "public",
              table: "notifications",
              eventType: "INSERT",
              new: row,
              old: {},
            }),
          ),
          // Catch up on anything missed while the socket was down.
          onRealtimeConnect((isReconnect) => {
            if (isReconnect) pushed.forEach((s) => s.cb());
          }),
        );

        // Tab visibility: browsers throttle hidden tabs, so recover on return.
        if (typeof document !== "undefined") {
          let hiddenAt = 0;
          const onVisibility = () => {
            if (document.visibilityState === "hidden") {
              hiddenAt = Date.now();
              return;
            }
            if (hiddenAt && Date.now() - hiddenAt >= VISIBILITY_REFETCH_AFTER_MS) {
              pushed.forEach((s) => s.cb());
            }
            hiddenAt = 0;
          };
          document.addEventListener("visibilitychange", onVisibility);
          teardown.push(() => document.removeEventListener("visibilitychange", onVisibility));
        }
      }

      // Slow safety net, only while the socket is down AND the tab is visible.
      const fallback = subs.filter((s) => isPush(s) && isPollDisabled(s));
      if (fallback.length) {
        timers.push(
          setInterval(() => {
            const visible = typeof document === "undefined" || document.visibilityState !== "hidden";
            if (!isRealtimeConnected() && visible) fallback.forEach((s) => s.cb());
          }, DISCONNECTED_FALLBACK_MS),
        );
      }

      // No automatic poll for unsupported tables: warn so the gap is visible.
      for (const s of subs.filter((x) => !isPollDisabled(x))) {
        console.warn(
          `[realtime] "${s.table ?? "(no table)"}" is not a push table, so this subscription will never fire. Add it to PUSH_TABLES and the server routing.`,
        );
      }
      return channel;
    },
    unsubscribe() {
      teardown.splice(0).forEach((fn) => fn());
      timers.forEach(clearInterval);
      timers = [];
      for (const s of subs) {
        if (s.timer) clearTimeout(s.timer);
        s.timer = undefined;
        s.pending = undefined;
      }
    },
    presenceState: () => ({}),
    send: async () => ({ status: "ok" }),
    track: async () => ({ status: "ok" }),
    untrack: async () => ({ status: "ok" }),
  };
  return channel;
}
