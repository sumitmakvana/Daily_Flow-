import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { generateEodHtmlReport } from "@/services/pdf-report.generator";
import { sendEodEmail } from "@/services/email-dispatcher";
import {
  getTodayDateStr,
  isTaskCompletedToday,
  isTaskDueOrActiveToday,
} from "@/lib/task-date-utils";

let isTickerRunning = false;
let lastMorningFiredKey = "";
let lastMemberFiredKey = "";
let lastManagerFiredKey = "";

function addMinutesToTime(timeStr: string, minsToAdd: number): string {
  const [hStr, mStr] = timeStr.split(":");
  const hours = parseInt(hStr || "18", 10);
  const minutes = parseInt(mStr || "00", 10);
  const totalMins = (hours * 60 + minutes + minsToAdd) % 1440;
  const finalH = Math.floor(totalMins / 60).toString().padStart(2, "0");
  const finalM = (totalMins % 60).toString().padStart(2, "0");
  return `${finalH}:${finalM}`;
}

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

      // 1. Fetch configured digest times dynamically from work_settings (UI editable)
      const { data: settings } = await supabaseAdmin
        .from("work_settings")
        .select("morning_digest_time, evening_digest_time")
        .eq("id", 1)
        .maybeSingle();

      const morningTime = settings?.morning_digest_time ?? "10:00"; // Dynamic from UI
      const memberEodTime = settings?.evening_digest_time ?? "18:00"; // Dynamic from UI
      const managerReportTime = addMinutesToTime(memberEodTime, 15); // Auto 15 mins after EOD

      const morningFireKey = `${todayStr}_morning_${currentLocalTime}`;
      const memberFireKey = `${todayStr}_member_${currentLocalTime}`;
      const managerFireKey = `${todayStr}_manager_${currentLocalTime}`;

      // -------------------------------------------------------------
      // STEP A: At Configured Morning Time (UI Setting) -> Trigger Morning Digest
      // -------------------------------------------------------------
      if (currentLocalTime === morningTime && lastMorningFiredKey !== morningFireKey) {
        lastMorningFiredKey = morningFireKey;
        console.log(
          `[CronTicker] Time matched Morning Digest (${currentLocalTime} === ${morningTime})! Triggering Morning Digest...`,
        );

        try {
          const origin = process.env.APP_URL || "http://localhost:7050";
          await fetch(`${origin}/api/public/hooks/morning-digest?force=true`, {
            method: "POST",
            headers: { "x-cron-secret": process.env.CRON_SECRET || "" },
          });
        } catch (err) {
          console.error("[CronTicker] Error auto-triggering morning-digest:", err);
        }
      }

      // -------------------------------------------------------------
      // STEP B: At Configured Evening Time (UI Setting) -> Trigger Member EOD
      // -------------------------------------------------------------
      if (currentLocalTime === memberEodTime && lastMemberFiredKey !== memberFireKey) {
        lastMemberFiredKey = memberFireKey;
        console.log(
          `[CronTicker] Time matched Evening Digest (${currentLocalTime} === ${memberEodTime})! Triggering Member EOD...`,
        );

        const { data: profiles } = await supabaseAdmin
          .from("profiles")
          .select("id, display_name, email, is_active")
          .eq("is_active", true);

        for (const p of profiles ?? []) {
          const dedupeKey = `EOD_${todayStr}_${p.id}`;
          // Check idempotency marker before inserting notification
          const { data: existingNotif } = await supabaseAdmin
            .from("notifications")
            .select("id")
            .eq("dedupe_key", dedupeKey)
            .maybeSingle();

          if (!existingNotif) {
            await supabaseAdmin.from("notifications").insert({
              user_id: p.id,
              type: "eod_digest",
              title: `End of Day Check-in`,
              body: `Please review and update your uncompleted tasks for today.`,
              dedupe_key: dedupeKey,
            });
          }
        }
      }

      // -------------------------------------------------------------
      // STEP B: At 6:15 PM (18:15 IST) -> Dispatch Manager EOD Team Summary Report
      // -------------------------------------------------------------
      if (currentLocalTime === managerReportTime && lastManagerFiredKey !== managerFireKey) {
        lastManagerFiredKey = managerFireKey;
        console.log(
          `[CronTicker] Time matched 6:15 PM (${currentLocalTime} === ${managerReportTime})! Triggering Manager EOD Team Summary Report...`,
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
          const pending = mine.filter(
            (t) =>
              t.status !== "Completed" &&
              t.status !== "In Progress" &&
              t.status !== "In Review" &&
              t.status !== "Blocked" &&
              t.status !== "On Hold",
          );

          const overdueTasks = mine.filter(
            (t) => t.status !== "Completed" && t.due_date && t.due_date.slice(0, 10) < todayStr,
          );
          const overdueDates = Array.from(
            new Set(overdueTasks.map((t) => t.due_date?.slice(5, 10)).filter(Boolean)),
          ).join(", ");

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

        const totalCount =
          completedCount +
          inProgressCount +
          inReviewCount +
          todoCount +
          blockedCount +
          pendingCount;
        const completionRate =
          totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

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

        const dispatchDedupeKey = `EOD_TEAM_REPORT_${todayStr}`;
        const { data: existingDispatch } = await supabaseAdmin
          .from("notifications")
          .select("id")
          .eq("dedupe_key", dispatchDedupeKey)
          .maybeSingle();

        if (existingDispatch) {
          console.log(
            `[CronTicker] Manager EOD report dispatch for ${todayStr} already completed today. Skipping duplicate.`,
          );
          return;
        }

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

          // 2. Direct Managers
          if (pref.eod_send_to_managers) {
            const userProfile = profileById.get(pref.user_id);
            if (userProfile?.manager_id) {
              const mgr = profileById.get(userProfile.manager_id);
              if (mgr && mgr.email) recipientEmails.add(mgr.email.trim().toLowerCase());
            } else if (userProfile?.email) {
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
            subject: `📊 [EOD Team Digest] Today's Team Status Report - ${todayStr} | Operon`,
            html: reportHtml,
          });
          console.log(
            `[CronTicker] Automated Manager EOD Report dispatched to: ${toList.join(", ")}`,
            res,
          );

          if (profiles && profiles.length > 0) {
            await supabaseAdmin.from("notifications").insert({
              user_id: profiles[0].id,
              type: "eod_team_digest",
              title: `Manager EOD Report Dispatched - ${todayStr}`,
              body: `Automated EOD team performance report sent to ${toList.join(", ")}.`,
              dedupe_key: dispatchDedupeKey,
            });
          }
        }
      }
    } catch (err) {
      console.error("[CronTicker] Error in background EOD cron loop:", err);
    }
  }, 60000); // Check every 60 seconds
}
