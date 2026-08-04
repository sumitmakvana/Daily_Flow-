import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { withUser } from "@/integrations/postgres/query.server";
import { getPool } from "@/integrations/postgres/client.server";
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
  eod_send_to_managers: z.boolean().optional(),
  eod_send_to_admins: z.boolean().optional(),
  eod_send_to_custom: z.boolean().optional(),
  eod_recipient_policy: z.string().optional().nullable(),
  custom_target_email: z.string().optional().nullable(),
});

let columnsEnsured = false;
async function ensureNotifColumnsAdmin() {
  if (columnsEnsured) return;
  try {
    const pool = getPool();
    await pool.query(`
      ALTER TABLE public.notification_prefs 
      ADD COLUMN IF NOT EXISTS eod_send_to_managers boolean DEFAULT true,
      ADD COLUMN IF NOT EXISTS eod_send_to_admins boolean DEFAULT false,
      ADD COLUMN IF NOT EXISTS eod_send_to_custom boolean DEFAULT true,
      ADD COLUMN IF NOT EXISTS eod_recipient_policy text DEFAULT 'single_email',
      ADD COLUMN IF NOT EXISTS custom_target_email text DEFAULT 'sumitmakvana535@gmail.com';
    `);
    columnsEnsured = true;
  } catch (err) {
    console.warn("Notice: Column check on notification_prefs:", (err as Error).message);
  }
}

export const getNotifPrefsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: { userId: string }) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await ensureNotifColumnsAdmin();

    const row = await withUser(context.userId, async (client) => {
      try {
        const res = await client.query<NotificationPrefs>(
          `SELECT user_id, digest_enabled, eod_reminder_hour,
                  notify_assignment, notify_priority_change, notify_blocker_resolved,
                  notify_manager_overload, notify_manager_delays,
                  COALESCE(eod_send_to_managers, true) as eod_send_to_managers,
                  COALESCE(eod_send_to_admins, false) as eod_send_to_admins,
                  COALESCE(eod_send_to_custom, true) as eod_send_to_custom,
                  COALESCE(eod_recipient_policy, 'single_email') as eod_recipient_policy,
                  COALESCE(custom_target_email, 'sumitmakvana535@gmail.com') as custom_target_email
             FROM public.notification_prefs
             WHERE user_id = $1`,
          [data.userId],
        );
        return res.rows[0] ?? null;
      } catch (err) {
        const res = await client.query<NotificationPrefs>(
          `SELECT user_id, digest_enabled, eod_reminder_hour,
                  notify_assignment, notify_priority_change, notify_blocker_resolved,
                  notify_manager_overload, notify_manager_delays
             FROM public.notification_prefs
             WHERE user_id = $1`,
          [data.userId],
        );
        if (res.rows[0]) {
          return {
            ...res.rows[0],
            eod_send_to_managers: true,
            eod_send_to_admins: false,
            eod_send_to_custom: true,
            eod_recipient_policy: "single_email",
            custom_target_email: "sumitmakvana535@gmail.com",
          };
        }
        return null;
      }
    });
    return row;
  });

export const saveNotifPrefsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: NotificationPrefs) => PrefsSchema.parse(d))
  .handler(async ({ data, context }) => {
    await ensureNotifColumnsAdmin();

    const row = await withUser(context.userId, async (client) => {
      try {
        const res = await client.query<NotificationPrefs>(
          `INSERT INTO public.notification_prefs
             (user_id, digest_enabled, eod_reminder_hour,
              notify_assignment, notify_priority_change, notify_blocker_resolved,
              notify_manager_overload, notify_manager_delays,
              eod_send_to_managers, eod_send_to_admins, eod_send_to_custom,
              eod_recipient_policy, custom_target_email)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           ON CONFLICT (user_id) DO UPDATE SET
             digest_enabled = EXCLUDED.digest_enabled,
             eod_reminder_hour = EXCLUDED.eod_reminder_hour,
             notify_assignment = EXCLUDED.notify_assignment,
             notify_priority_change = EXCLUDED.notify_priority_change,
             notify_blocker_resolved = EXCLUDED.notify_blocker_resolved,
             notify_manager_overload = EXCLUDED.notify_manager_overload,
             notify_manager_delays = EXCLUDED.notify_manager_delays,
             eod_send_to_managers = EXCLUDED.eod_send_to_managers,
             eod_send_to_admins = EXCLUDED.eod_send_to_admins,
             eod_send_to_custom = EXCLUDED.eod_send_to_custom,
             eod_recipient_policy = EXCLUDED.eod_recipient_policy,
             custom_target_email = EXCLUDED.custom_target_email
           RETURNING user_id, digest_enabled, eod_reminder_hour,
                     notify_assignment, notify_priority_change, notify_blocker_resolved,
                     notify_manager_overload, notify_manager_delays,
                     eod_send_to_managers, eod_send_to_admins, eod_send_to_custom,
                     eod_recipient_policy, custom_target_email`,
          [
            data.user_id,
            data.digest_enabled,
            data.eod_reminder_hour,
            data.notify_assignment,
            data.notify_priority_change,
            data.notify_blocker_resolved,
            data.notify_manager_overload,
            data.notify_manager_delays,
            data.eod_send_to_managers ?? true,
            data.eod_send_to_admins ?? false,
            data.eod_send_to_custom ?? true,
            data.eod_recipient_policy ?? "single_email",
            data.custom_target_email ?? "sumitmakvana535@gmail.com",
          ],
        );
        return res.rows[0];
      } catch (err) {
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
        return {
          ...res.rows[0],
          eod_send_to_managers: data.eod_send_to_managers ?? true,
          eod_send_to_admins: data.eod_send_to_admins ?? false,
          eod_send_to_custom: data.eod_send_to_custom ?? true,
          eod_recipient_policy: data.eod_recipient_policy ?? "single_email",
          custom_target_email: data.custom_target_email ?? "sumitmakvana535@gmail.com",
        };
      }
    });
    return row;
  });
