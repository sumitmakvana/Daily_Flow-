import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { generateEodHtmlReport } from "@/services/pdf-report.generator";
import { sendEodEmail } from "@/services/email-dispatcher";
import {
  getTodayDateStr,
  isTaskCompletedToday,
  isTaskDueOrActiveToday,
} from "@/lib/task-date-utils";

let isTickerRunning = false;
let lastFiredKey = "";

export function startBackgroundCronTicker() {
  if (isTickerRunning) return;
  isTickerRunning = true;
  console.log("[CronTicker] Starting automated background EOD cron ticker (60s loop)...");

  setInterval(async () => {
    try {
      const todayStr = getTodayDateStr("Asia/Kolkata");
      const currentLocalTime = new Date().toLocaleTimeString("en-US", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });

      // 1. Fetch configured digest time from work_settings
      const { data: settings } = await supabaseAdmin
        .from("work_settings")
        .select("evening_digest_time")
        .eq("id", 1)
        .maybeSingle();

      const eveningTime = settings?.evening_digest_time ?? "18:00";
      const fireKey = `${todayStr}_${currentLocalTime}`;

      // 2. Check if current IST time matches configured evening digest time
      if (currentLocalTime === eveningTime && lastFiredKey !== fireKey) {
        lastFiredKey = fireKey;
        console.log(
          `[CronTicker] Time matched (${currentLocalTime} === ${eveningTime})! Triggering automated EOD Email dispatch...`,
        );

        const [{ data: profiles }, { data: tasks }, { data: prefs }] = await Promise.all([
          supabaseAdmin
            .from("profiles")
            .select("id, display_name, email, manager_id, is_active")
            .eq("is_active", true),
          supabaseAdmin
            .from("tasks")
            .select(
              "id, task_code, task_name, assigned_to, status, priority, due_date, completed_at, updated_at, blocker_reason, remarks",
            ),
          supabaseAdmin.from("notification_prefs").select("*"),
        ]);

        const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
        const plateByUser = new Map<string, typeof tasks>();

        for (const t of tasks ?? []) {
          if (!t.assigned_to) continue;
          const arr = plateByUser.get(t.assigned_to) ?? [];
          const isCompToday = isTaskCompletedToday(t, todayStr);
          const isDueTodayOrPast = isTaskDueOrActiveToday(t, todayStr);
          if (isCompToday || (t.status !== "Completed" && isDueTodayOrPast)) {
            arr.push(t);
          }
          plateByUser.set(t.assigned_to, arr);
        }

        let completedCount = 0;
        let inProgressCount = 0;
        let inReviewCount = 0;
        let todoCount = 0;
        let blockedCount = 0;
        let pendingCount = 0;

        const memberSummaries = (profiles ?? []).map((p) => {
          const mine = plateByUser.get(p.id) ?? [];
          const completed = mine.filter((t) => t.status === "Completed");
          const inProgress = mine.filter((t) => t.status === "In Progress");
          const inReview = mine.filter((t) => t.status === "In Review");
          const todo = mine.filter((t) => t.status === "To Do");
          const blocked = mine.filter((t) => t.status === "Blocked" || t.status === "On Hold");
          const pending = mine.filter((t) => t.status !== "Completed" && t.status !== "In Progress" && t.status !== "In Review" && t.status !== "Blocked" && t.status !== "On Hold");

          const overdueTasks = mine.filter((t) => t.status !== "Completed" && t.due_date && t.due_date.slice(0, 10) < todayStr);
          const overdueDates = Array.from(new Set(overdueTasks.map((t) => t.due_date?.slice(5, 10)).filter(Boolean))).join(", ");

          completedCount += completed.length;
          inProgressCount += inProgress.length;
          inReviewCount += inReview.length;
          todoCount += todo.length;
          blockedCount += blocked.length;
          pendingCount += pending.length;

          return {
            name: p.display_name || "Team Member",
            completedCount: completed.length,
            inProgressCount: inProgress.length,
            inReviewCount: inReview.length,
            todoCount: todo.length,
            blockedCount: blocked.length,
            pendingCount: pending.length + todo.length,
            overdueCount: overdueTasks.length,
            overdueDates: overdueDates || undefined,
            totalCount: mine.length,
            tasks: [],
          };
        });

        const totalCount = completedCount + inProgressCount + inReviewCount + todoCount + blockedCount + pendingCount;
        const completionRate = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

        const blockedAlerts: Array<{
          code: string;
          name: string;
          memberName: string;
          reason: string;
        }> = [];

        for (const t of tasks ?? []) {
          if (t.status === "Blocked" || t.status === "On Hold") {
            const isDueTodayOrPast = !t.due_date || t.due_date.slice(0, 10) <= todayStr;
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
          dateStr: todayStr,
          totalTasks: totalCount,
          completedTasks: completedCount,
          inProgressTasks: inProgressCount,
          inReviewTasks: inReviewCount,
          todoTasks: todoCount,
          blockedTasks: blockedCount,
          pendingTasks: pendingCount,
          completionRate,
          memberSummaries,
          blockedAlerts,
        });

        // Check if EOD email dispatch has already been executed today to prevent duplicate runs
        const dispatchDedupeKey = `EOD_EMAIL_DISPATCH_${todayStr}`;
        const { data: existingDispatch } = await supabaseAdmin
          .from("notifications")
          .select("id")
          .eq("dedupe_key", dispatchDedupeKey)
          .maybeSingle();

        if (existingDispatch) {
          console.log(
            `[CronTicker] EOD email dispatch for ${todayStr} already completed today. Skipping duplicate dispatch.`,
          );
          return;
        }

        // Collect recipient emails from notification_prefs (deduplicated & normalized to lowercase)
        const recipientEmails = new Set<string>();

        for (const pref of (prefs as any[]) ?? []) {
          if (pref.digest_enabled === false) continue;

          // 1. Custom Target Email(s)
          if (pref.eod_send_to_custom && pref.custom_target_email) {
            pref.custom_target_email
              .split(",")
              .map((e: string) => e.trim().toLowerCase())
              .filter(Boolean)
              .forEach((e: string) => recipientEmails.add(e));
          }

          // 2. Direct Managers (get manager email for users managed)
          if (pref.eod_send_to_managers) {
            const userProfile = profileById.get(pref.user_id);
            if (userProfile?.manager_id) {
              const mgr = profileById.get(userProfile.manager_id);
              if (mgr && mgr.email) recipientEmails.add(mgr.email.trim().toLowerCase());
            } else if (userProfile?.email) {
              // If the profile itself is a manager, add manager's own email
              const isAManager = (profiles ?? []).some((p) => p.manager_id === pref.user_id);
              if (isAManager) recipientEmails.add(userProfile.email.trim().toLowerCase());
            }
          }

          // 3. Admins
          if (pref.eod_send_to_admins) {
            for (const p of profiles ?? []) {
              if (p.email) recipientEmails.add(p.email.trim().toLowerCase());
            }
          }
        }

        const toList = Array.from(recipientEmails);
        if (toList.length > 0) {
          const res = await sendEodEmail({
            to: toList,
            subject: `📊 [EOD Team Digest] Today's Team Status Report - ${todayStr} | Daily Flow`,
            html: reportHtml,
          });
          console.log(
            `[CronTicker] Automated EOD Email dispatched to recipients: ${toList.join(", ")}`,
            res,
          );

          // Save dispatch idempotency marker & notification records to public.notifications
          if (profiles && profiles.length > 0) {
            await supabaseAdmin.from("notifications").insert({
              user_id: profiles[0].id,
              type: "eod_team_digest",
              title: `EOD Email Dispatched - ${todayStr}`,
              body: `Automated EOD team performance digest sent to ${toList.join(", ")}.`,
              dedupe_key: dispatchDedupeKey,
            });
          }

          for (const p of profiles ?? []) {
            const mine = plateByUser.get(p.id) ?? [];
            const completed = mine.filter((t) => t.status === "Completed").length;
            const inProgress = mine.filter(
              (t) => t.status === "In Progress" || t.status === "In Review",
            ).length;
            const blocked = mine.filter(
              (t) => t.status === "Blocked" || t.status === "On Hold",
            ).length;
            const pending = mine.filter((t) => t.status === "To Do").length;

            const dedupeKey = `EOD_${todayStr}_${p.id}`;
            await supabaseAdmin.from("notifications").insert({
              user_id: p.id,
              type: "eod_digest",
              title: `EOD: ${completed} done · ${inProgress} in progress · ${blocked} blocked · ${pending} pending`,
              body: `Automated EOD team performance digest sent to ${toList.join(", ")}.`,
              dedupe_key: dedupeKey,
            });
          }
        } else {
          console.log(`[CronTicker] No active recipient emails configured for EOD dispatch.`);
        }
      }
    } catch (err) {
      console.error("[CronTicker] Error in background EOD cron loop:", err);
    }
  }, 60000); // Check every 60 seconds
}
