import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { withUser } from "@/integrations/postgres/query.server";

/**
 * Mark notifications read, and tell the user's other tabs/devices over Socket.IO.
 *
 * Marking read used to be a plain table update from the browser, which nothing on the server could see, so other
 * tabs only learned about it by refetching (a time-based refetch on every tab return). Doing the update here lets
 * the server announce exactly the rows it changed: `notification:read` goes to every socket of the user
 * (including the tab that did it, which ignores the echo), after the update has committed.
 *
 * The UPDATE runs as the signed-in user (SET LOCAL role authenticated + their claims), so row-level security applies
 * exactly as it did for the browser update; `user_id = caller` and `read_at IS NULL` mean only rows that really
 * changed are returned and announced. No schema change.
 */
const ReadAt = z.string().min(10).max(40);

async function announce(userId: string, payload: Record<string, unknown>) {
  // Imported on use so this server-only module never reaches the client bundle.
  const { emitToUser } = await import("@/lib/realtime.server");
  emitToUser(userId, "notification:read", payload);
  // Also push the authoritative unread count, so the badge is exact even if a tab missed or mis-applied the delta.
  const { scheduleUnreadPush } = await import("@/lib/notification-unread.server");
  scheduleUnreadPush(userId);
}

export const markNotificationReadFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { id: string; readAt: string }) => z.object({ id: z.string().uuid(), readAt: ReadAt }).parse(d))
  .handler(async ({ data, context }) => {
    const ids = await withUser(context.userId, async (client) => {
      const r = await client.query<{ id: string }>(
        `UPDATE public.notifications SET read_at = $1
          WHERE id = $2 AND user_id = $3 AND read_at IS NULL
          RETURNING id`,
        [data.readAt, data.id, context.userId],
      );
      return r.rows.map((x) => x.id);
    });
    if (ids.length > 0) await announce(context.userId, { ids, read_at: data.readAt });
    return { ids };
  });

export const markAllNotificationsReadFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { readAt: string; since: string }) => z.object({ readAt: ReadAt, since: ReadAt }).parse(d))
  .handler(async ({ data, context }) => {
    const count = await withUser(context.userId, async (client) => {
      const r = await client.query(
        `UPDATE public.notifications SET read_at = $1
          WHERE user_id = $2 AND read_at IS NULL AND created_at >= $3`,
        [data.readAt, context.userId, data.since],
      );
      return r.rowCount ?? 0;
    });
    // One event for the whole batch (not one id per row): receivers clear their unread state.
    if (count > 0) await announce(context.userId, { all: true, count, read_at: data.readAt });
    return { count };
  });
