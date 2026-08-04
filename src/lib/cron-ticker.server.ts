import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { generateEodHtmlReport } from "@/services/pdf-report.generator";
import { sendEodEmail } from "@/services/email-dispatcher";

let isTickerRunning = false;
let lastFiredKey = "";

export function startBackgroundCronTicker() {
  if (isTickerRunning) return;
  isTickerRunning = true;
  console.log("[CronTicker] Starting automated background EOD cron ticker (60s loop)...");

  setInterval(async () => {
    try {
      const todayStr = new Date().toISOString().slice(0, 10);
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
              "id, task_code, task_name, assigned_to, status, priority, due_date, completed_at, blocker_reason, remarks",
            ),
          supabaseAdmin.from("notification_prefs").select("*"),
        ]);

        const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
        const plateByUser = new Map<string, typeof tasks>();

        for (const t of tasks ?? []) {
          if (!t.assigned_to) continue;
          const arr = plateByUser.get(t.assigned_to) ?? [];
          const isCompletedToday = t.completed_at && t.completed_at.slice(0, 10) === todayStr;
          const isDueTodayOrPast = !t.due_date || t.due_date.slice(0, 10) <= todayStr;
          if (isCompletedToday || (t.status !== "Completed" && isDueTodayOrPast)) {
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
          const inProgress = mine.filter(
            (t) => t.status === "In Progress" || t.status === "In Review",
          );
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
          blockedTasks: blockedCount,
          pendingTasks: pendingCount,
          completionRate,
          memberSummaries,
          blockedAlerts,
        });

        // Collect recipient emails from notification_prefs
        const recipientEmails = new Set<string>();

        for (const pref of (prefs as any[]) ?? []) {
          if (pref.digest_enabled === false) continue;

          // 1. Custom Target Email(s)
          if (pref.eod_send_to_custom && pref.custom_target_email) {
            pref.custom_target_email
              .split(",")
              .map((e: string) => e.trim())
              .filter(Boolean)
              .forEach((e: string) => recipientEmails.add(e));
          }

          // 2. Direct Managers
          if (pref.eod_send_to_managers) {
            for (const p of profiles ?? []) {
              if (p.manager_id) {
                const mgr = profileById.get(p.manager_id);
                if (mgr && mgr.email) recipientEmails.add(mgr.email);
              }
            }
          }

          // 3. Admins
          if (pref.eod_send_to_admins) {
            for (const p of profiles ?? []) {
              if (p.email) recipientEmails.add(p.email);
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

          // Save notification records to public.notifications for auditing
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
