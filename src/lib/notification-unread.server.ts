/**
 * Server-authoritative unread badge count, pushed over Socket.IO.
 *
 * Whenever a user's notifications are created, read or deleted, `scheduleUnreadPush(userId)` is called. After a
 * short debounce the user's unread count is read ONCE from the database and sent to all of their sockets as
 * `notification:unread` `{ count }`. The browser applies it as the badge value, so it needs no request to stay
 * correct between page load and reconnect.
 *
 * - Coalesced per user: a burst of inserts/reads/deletes costs one count query, not one per row.
 * - Serialised per user: a trigger that lands while a count is running marks it dirty and the count is
 *   recomputed afterwards, so the last event the client receives always reflects the latest state.
 * - Skipped when the user has no connected socket (nobody would receive it); a client that connects later
 *   fetches the count itself.
 * - The count uses the same 24 h window as the client list (the badge never counts older rows).
 */
import { getPool } from "@/integrations/postgres/client.server";
import { emitToUser, hasUserSockets } from "@/lib/realtime.server";

export const UNREAD_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Quiet period before counting, so a burst of changes collapses into one query. */
export const UNREAD_DEBOUNCE_MS = 150;

type Slot = { timer: ReturnType<typeof setTimeout> | null; running: boolean; dirty: boolean };
const g = globalThis as unknown as { __operonUnreadSlots?: Map<string, Slot> };
const slots = () => (g.__operonUnreadSlots ??= new Map<string, Slot>());

/** Unread notifications of one user inside the 24 h window. */
export async function countUnread(userId: string): Promise<number> {
  const since = new Date(Date.now() - UNREAD_WINDOW_MS).toISOString();
  const { rows } = await getPool().query<{ n: number }>(
    "SELECT count(*)::int AS n FROM public.notifications WHERE user_id = $1 AND read_at IS NULL AND created_at >= $2",
    [userId, since],
  );
  return rows[0]?.n ?? 0;
}

async function run(userId: string, slot: Slot) {
  slot.running = true;
  slot.dirty = false;
  try {
    if (hasUserSockets(userId)) emitToUser(userId, "notification:unread", { count: await countUnread(userId) });
  } catch (err) {
    // The client keeps its own count and re-syncs on reconnect; a failed push must never affect the writer.
    console.warn("[NotificationUnread] push failed:", (err as Error).message);
  } finally {
    slot.running = false;
    if (slot.dirty) arm(userId, slot);
    else slots().delete(userId);
  }
}

function arm(userId: string, slot: Slot) {
  if (slot.timer) clearTimeout(slot.timer);
  slot.timer = setTimeout(() => {
    slot.timer = null;
    void run(userId, slot);
  }, UNREAD_DEBOUNCE_MS);
  slot.timer.unref?.();
}

/** Something changed in this user's notifications: push their fresh unread count (debounced, never throws). */
export function scheduleUnreadPush(userId: string): void {
  if (!userId) return;
  let slot = slots().get(userId);
  if (!slot) {
    slot = { timer: null, running: false, dirty: false };
    slots().set(userId, slot);
  }
  if (slot.running) {
    slot.dirty = true;
    return;
  }
  arm(userId, slot);
}

/** Test hook: drop pending timers and state. */
export function __resetUnreadForTests() {
  for (const s of slots().values()) if (s.timer) clearTimeout(s.timer);
  g.__operonUnreadSlots = undefined;
}
