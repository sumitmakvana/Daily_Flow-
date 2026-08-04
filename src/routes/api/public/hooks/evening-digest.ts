import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireCronAuth } from "@/lib/cron-auth.server";
import { recordFailure } from "@/lib/ops-failures.server";
import { generateEodHtmlReport } from "@/services/pdf-report.generator";
import { sendEodEmail } from "@/services/email-dispatcher";

/**
 * End-of-day digest cron (e.g., 18:30 local).
 * Active users only; idempotent via notifications.dedupe_key.
 */
export const Route = createFileRoute("/api/public/hooks/evening-digest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = new URL(request.url);
        const force = url.searchParams.get("force") === "true";

        if (!force) {
          const denied = await requireCronAuth(request, "evening-digest");
          if (denied) return denied;
        }

        const today = new Date().toISOString().slice(0, 10);
        const todayMs = new Date(today).getTime();

        // Get current time in Indian Standard Time (IST) formatted as HH:MM
        const currentLocalTime = new Date().toLocaleTimeString("en-US", {
          timeZone: "Asia/Kolkata",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        });

        const [{ data: profiles }, { data: tasks }, { data: prefs }, { data: settings }] =
          await Promise.all([
            supabaseAdmin
              .from("profiles")
              .select("id, display_name, email, manager_id, is_active")
              .eq("is_active", true),
            supabaseAdmin
              .from("tasks")
              .select(
                "id, task_code, task_name, assigned_to, status, priority, due_date, completed_at",
              ),
            supabaseAdmin.from("notification_prefs").select("user_id, digest_enabled"),
            supabaseAdmin
              .from("work_settings")
              .select("evening_digest_time")
              .eq("id", 1)
              .maybeSingle(),
          ]);

        const eveningTime = settings?.evening_digest_time ?? "18:00";
        if (currentLocalTime !== eveningTime && !force) {
          return Response.json({
            ok: true,
            skipped: true,
            reason: `Current time ${currentLocalTime} does not match configured evening digest time ${eveningTime}`,
          });
        }

        const optedOut = new Set(
          (prefs ?? []).filter((p) => p.digest_enabled === false).map((p) => p.user_id),
        );
        const activeIds = new Set((profiles ?? []).map((p) => p.id));
        const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

        const plateByUser = new Map<string, NonNullable<typeof tasks>>();
        for (const t of tasks ?? []) {
          if (!t.assigned_to || !activeIds.has(t.assigned_to)) continue;
          const completedToday = t.completed_at && t.completed_at.slice(0, 10) === today;

          if (t.status === "Completed") {
            // Only include completed tasks if they were completed TODAY
            if (!completedToday) continue;
          } else {
            // For active tasks, they must be due today/past or have no due date
            const dueMs = t.due_date ? new Date(t.due_date).getTime() : null;
            const onPlate = (dueMs !== null && dueMs <= todayMs) || dueMs === null;
            if (!onPlate) continue;
          }
          const arr = plateByUser.get(t.assigned_to) ?? [];
          arr.push(t);
          plateByUser.set(t.assigned_to, arr);
        }

        const summarize = (mine: NonNullable<typeof tasks>) => {
          const completed = mine.filter((t) => t.status === "Completed");
          const inProgress = mine.filter(
            (t) => t.status === "In Progress" || t.status === "In Review",
          );
          const blocked = mine.filter((t) => t.status === "Blocked" || t.status === "On Hold");
          const pending = mine.filter((t) => t.status === "To Do");
          return { completed, inProgress, blocked, pending };
        };

        const computeTodayDigestData = () => {
          let completedCount = 0;
          let inProgressCount = 0;
          let blockedCount = 0;
          let pendingCount = 0;

          const memberSummaries = (profiles ?? []).map((p) => {
            const mine = plateByUser.get(p.id) ?? [];
            const s = summarize(mine);
            completedCount += s.completed.length;
            inProgressCount += s.inProgress.length;
            blockedCount += s.blocked.length;
            pendingCount += s.pending.length;
            return {
              name: p.display_name || "Team Member",
              completedCount: s.completed.length,
              inProgressCount: s.inProgress.length,
              blockedCount: s.blocked.length,
              pendingCount: s.pending.length,
              tasks: [],
            };
          });

          const totalCount = completedCount + inProgressCount + blockedCount + pendingCount;
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

          const todayCompletedTasksList: Array<{ code: string; name: string; memberName: string }> =
            [];
          const todayInProgressTasksList: Array<{
            code: string;
            name: string;
            memberName: string;
          }> = [];

          for (const t of tasks ?? []) {
            const uName = profileById.get(t.assigned_to || "")?.display_name || "Unassigned";
            const isCompletedToday = t.completed_at && t.completed_at.slice(0, 10) === today;
            const isDueTodayOrPast = !t.due_date || t.due_date.slice(0, 10) <= today;

            if (t.status === "Completed" && isCompletedToday) {
              todayCompletedTasksList.push({
                code: t.task_code,
                name: t.task_name,
                memberName: uName,
              });
            } else if (
              (t.status === "In Progress" || t.status === "In Review") &&
              isDueTodayOrPast
            ) {
              todayInProgressTasksList.push({
                code: t.task_code,
                name: t.task_name,
                memberName: uName,
              });
            }
          }

          return {
            totalCount,
            completedCount,
            inProgressCount,
            blockedCount,
            pendingCount,
            completionRate,
            memberSummaries,
            blockedAlerts,
            todayCompletedTasksList,
            todayInProgressTasksList,
          };
        };

        const fmt = (label: string, list: { task_code: string; task_name: string }[]) =>
          list.length
            ? `${label} (${list.length}):\n${list
                .slice(0, 10)
                .map((t) => `• [${t.task_code}] ${t.task_name}`)
                .join("\n")}`
            : "";

        const managerRollup = new Map<string, string[]>();
        let sentUsers = 0;
        let failed = 0;

        for (const p of profiles ?? []) {
          const mine = plateByUser.get(p.id) ?? [];
          const s = summarize(mine);

          const body =
            mine.length > 0
              ? [
                  fmt("✅ Completed", s.completed),
                  fmt("🔄 In progress", s.inProgress),
                  fmt("⛔ Blocked", s.blocked),
                  fmt("📋 Still pending", s.pending),
                ]
                  .filter(Boolean)
                  .join("\n\n")
              : "No active tasks today.";

          if (!optedOut.has(p.id)) {
            const dedupeKey = `EOD_${today}_${p.id}`;
            const { error } = await supabaseAdmin.from("notifications").insert({
              user_id: p.id,
              type: "eod_digest",
              title: `EOD: ${s.completed.length} done · ${s.inProgress.length} in progress · ${s.blocked.length} blocked · ${s.pending.length} pending`,
              body,
              dedupe_key: dedupeKey,
            });
            if (!error) sentUsers += 1;
            else if (error.code === "23505") {
              // already sent
            } else {
              failed += 1;
              await recordFailure({
                source: "cron.evening_digest",
                entityType: "user",
                entityId: p.id,
                errorCode: error.code ?? null,
                errorMessage: error.message,
              });
            }
          }

          if (p.manager_id && profileById.has(p.manager_id)) {
            const arr = managerRollup.get(p.manager_id) ?? [];
            arr.push(
              `${p.display_name} — ${s.completed.length} done · ${s.inProgress.length} in progress · ${s.blocked.length} blocked · ${s.pending.length} pending`,
            );
            managerRollup.set(p.manager_id, arr);
          }
        }

        let sentManagers = 0;
        for (const [managerId, lines] of managerRollup.entries()) {
          if (optedOut.has(managerId)) continue;
          const dedupeKey = `EOD_TEAM_${today}_${managerId}`;
          const { error } = await supabaseAdmin.from("notifications").insert({
            user_id: managerId,
            type: "eod_team_digest",
            title: `Team EOD: ${lines.length} report${lines.length === 1 ? "" : "s"}`,
            body: lines.join("\n"),
            dedupe_key: dedupeKey,
          });
          if (!error) {
            sentManagers += 1;

            // Generate HTML report & dispatch email to Manager
            const managerProfile = profileById.get(managerId);
            if (managerProfile?.email) {
              const digestData = computeTodayDigestData();

              const reportHtml = generateEodHtmlReport({
                dateStr: today,
                totalTasks: digestData.totalCount,
                completedTasks: digestData.completedCount,
                inProgressTasks: digestData.inProgressCount,
                blockedTasks: digestData.blockedCount,
                pendingTasks: digestData.pendingCount,
                completionRate: digestData.completionRate,
                memberSummaries: digestData.memberSummaries,
                blockedAlerts: digestData.blockedAlerts,
              });

              const targetEmails = Array.from(
                new Set([managerProfile.email].filter(Boolean) as string[]),
              );

              await sendEodEmail({
                to: targetEmails,
                subject: `📊 [EOD Team Digest] Today's Team Status Report - ${today} | Daily Flow`,
                html: reportHtml,
                attachments: [
                  {
                    filename: `Team_EOD_Report_${today}.html`,
                    content: Buffer.from(reportHtml).toString("base64"),
                  },
                ],
              });
            }
          } else if (error.code !== "23505") {
            failed += 1;
            await recordFailure({
              source: "cron.evening_digest.team",
              entityType: "user",
              entityId: managerId,
              errorCode: error.code ?? null,
              errorMessage: error.message,
            });
          }
        }

        // Direct test dispatch if forced or no managers found
        if (force || sentManagers === 0) {
          const rawEmails =
            url.searchParams.get("target_email") || url.searchParams.get("email") || "";

          const targetEmailList = Array.from(
            new Set(
              rawEmails
                .split(",")
                .map((e) => e.trim())
                .filter(Boolean),
            ),
          );

          const digestData = computeTodayDigestData();

          const reportHtml = generateEodHtmlReport({
            dateStr: today,
            totalTasks: digestData.totalCount,
            completedTasks: digestData.completedCount,
            inProgressTasks: digestData.inProgressCount,
            blockedTasks: digestData.blockedCount,
            pendingTasks: digestData.pendingCount,
            completionRate: digestData.completionRate,
            memberSummaries: digestData.memberSummaries,
            blockedAlerts: digestData.blockedAlerts,
          });

          await sendEodEmail({
            to: targetEmailList,
            subject: `📊 [EOD Team Digest] Today's Team Status Report - ${today} | Daily Flow`,
            html: reportHtml,
            attachments: [
              {
                filename: `Team_EOD_Report_${today}.html`,
                content: Buffer.from(reportHtml).toString("base64"),
              },
            ],
          });
        }

        return Response.json({ ok: true, sentUsers, sentManagers, failed });
      },
    },
  },
});
