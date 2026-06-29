import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { withUser } from "@/integrations/postgres/query.server";
import type { NotificationPrefs } from "@/lib/types";

const PrefsSchema = z.object({
  user_id: z.string().uuid(),
  digest_enabled: z.boolean(),
  eod_reminder_hour: z.number().int().min(0).max(23),
  notify_assignment: z.boolean(),
  notify_priority_change: z.boolean(),
  notify_blocker_resolved: z.boolean(),
  notify_manager_overload: z.boolean(),
  notify_manager_delays: z.boolean(),
});

export const getNotifPrefsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string }) =>
    z.object({ userId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const row = await withUser(context.userId, async (client) => {
      const res = await client.query<NotificationPrefs>(
        `SELECT user_id, digest_enabled, eod_reminder_hour,
                notify_assignment, notify_priority_change, notify_blocker_resolved,
                notify_manager_overload, notify_manager_delays
           FROM public.notification_prefs
           WHERE user_id = $1`,
        [data.userId],
      );
      return res.rows[0] ?? null;
    });
    return row;
  });

export const saveNotifPrefsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: NotificationPrefs) => PrefsSchema.parse(d))
  .handler(async ({ data, context }) => {
    const row = await withUser(context.userId, async (client) => {
      const res = await client.query<NotificationPrefs>(
        `INSERT INTO public.notification_prefs
           (user_id, digest_enabled, eod_reminder_hour,
            notify_assignment, notify_priority_change, notify_blocker_resolved,
            notify_manager_overload, notify_manager_delays)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (user_id) DO UPDATE SET
           digest_enabled = EXCLUDED.digest_enabled,
           eod_reminder_hour = EXCLUDED.eod_reminder_hour,
           notify_assignment = EXCLUDED.notify_assignment,
           notify_priority_change = EXCLUDED.notify_priority_change,
           notify_blocker_resolved = EXCLUDED.notify_blocker_resolved,
           notify_manager_overload = EXCLUDED.notify_manager_overload,
           notify_manager_delays = EXCLUDED.notify_manager_delays
         RETURNING user_id, digest_enabled, eod_reminder_hour,
                   notify_assignment, notify_priority_change, notify_blocker_resolved,
                   notify_manager_overload, notify_manager_delays`,
        [
          data.user_id,
          data.digest_enabled,
          data.eod_reminder_hour,
          data.notify_assignment,
          data.notify_priority_change,
          data.notify_blocker_resolved,
          data.notify_manager_overload,
          data.notify_manager_delays,
        ],
      );
      return res.rows[0];
    });
    return row;
  });
