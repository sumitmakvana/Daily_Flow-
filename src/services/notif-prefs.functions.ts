import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { withUser } from "@/integrations/postgres/query.server";
import { getPool } from "@/integrations/postgres/client.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { generateEodHtmlReport } from "@/services/pdf-report.generator";
import { sendEodEmail } from "@/services/email-dispatcher";
import {
  getTodayDateStr,
  isTaskCompletedToday,
  isTaskDueOrActiveToday,
} from "@/lib/task-date-utils";
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
      ADD COLUMN IF NOT EXISTS custom_target_email text DEFAULT '';
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
                  COALESCE(custom_target_email, '') as custom_target_email
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
            custom_target_email: "",
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
            data.custom_target_email ?? "",
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
          custom_target_email: data.custom_target_email ?? "",
        };
      }
    });
    return row;
  });

export const dispatchEodTestEmailFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { targetEmail?: string }) =>
    z.object({ targetEmail: z.string().optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    const today = getTodayDateStr("Asia/Kolkata");
    const [{ data: profiles }, { data: tasks }] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("id, display_name, email, manager_id, is_active")
        .eq("is_active", true),
      supabaseAdmin
        .from("tasks")
        .select(
          "id, task_code, task_name, assigned_to, status, priority, due_date, completed_at, updated_at, blocker_reason, remarks",
        ),
    ]);

    const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
    const plateByUser = new Map<string, typeof tasks>();
    for (const t of tasks ?? []) {
      if (!t.assigned_to) continue;
      const arr = plateByUser.get(t.assigned_to) ?? [];
      const isCompToday = isTaskCompletedToday(t, today);
      const isDueTodayOrPast = isTaskDueOrActiveToday(t, today);
      if (isCompToday || (t.status !== "Completed" && isDueTodayOrPast)) {
        arr.push(t);
      }
      plateByUser.set(t.assigned_to, arr);
    }

    let completedCount = 0;
    let inProgressCount = 0;
    let blockedCount = 0;
    let pendingCount = 0;

    const memberSummaries = (profiles ?? []).map((p) => {
      const mine = plateByUser.get(p.id) ?? [];
      const completed = mine.filter((t) => t.status === "Completed");
      const inProgress = mine.filter((t) => t.status === "In Progress" || t.status === "In Review");
      const blocked = mine.filter((t) => t.status === "Blocked" || t.status === "On Hold");
      const pending = mine.filter((t) => t.status === "To Do");

      completedCount += completed.length;
      inProgressCount += inProgress.length;
      blockedCount += blocked.length;
      pendingCount += pending.length;

      return {
        name: p.display_name || "Team Member",
        completedCount: completed.length,
        inProgressCount: inProgress.length,
        blockedCount: blocked.length,
        pendingCount: pending.length,
        tasks: [],
      };
    });

    const totalCount = completedCount + inProgressCount + blockedCount + pendingCount;
    const completionRate = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

    const blockedAlerts: Array<{
      code: string;
      name: string;
      memberName: string;
      reason: string;
    }> = [];
    for (const t of tasks ?? []) {
      if (t.status === "Blocked" || t.status === "On Hold") {
        const isDueTodayOrPast = !t.due_date || t.due_date.slice(0, 10) <= today;
        if (isDueTodayOrPast) {
          blockedAlerts.push({
            code: t.task_code,
            name: t.task_name,
            memberName: profileById.get(t.assigned_to || "")?.display_name || "Unassigned",
            reason:
              (t as { blocker_reason?: string; remarks?: string }).blocker_reason ||
              (t as { blocker_reason?: string; remarks?: string }).remarks ||
              "No details provided",
          });
        }
      }
    }

    const reportHtml = generateEodHtmlReport({
      dateStr: today,
      totalTasks: totalCount,
      completedTasks: completedCount,
      inProgressTasks: inProgressCount,
      blockedTasks: blockedCount,
      pendingTasks: pendingCount,
      completionRate,
      memberSummaries,
      blockedAlerts,
    });

    const rawEmails = data.targetEmail || "";
    const targetEmailList = Array.from(
      new Set(
        rawEmails
          .split(",")
          .map((e) => e.trim())
          .filter(Boolean),
      ),
    );

    const result = await sendEodEmail({
      to: targetEmailList,
      subject: `📊 [EOD Team Digest] Today's Team Status Report - ${today} | Daily Flow`,
      html: reportHtml,
    });

    return { ok: result.success, sentTo: targetEmailList, result };
  });
