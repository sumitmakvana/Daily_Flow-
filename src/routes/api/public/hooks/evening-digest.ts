import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireCronAuth } from "@/lib/cron-auth.server";
import { recordFailure } from "@/lib/ops-failures.server";

/**
 * End-of-day digest cron (e.g., 18:30 local).
 * Active users only; idempotent via notifications.dedupe_key.
 */
export const Route = createFileRoute("/api/public/hooks/evening-digest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await requireCronAuth(request, "evening-digest");
        if (denied) return denied;

        const today = new Date().toISOString().slice(0, 10);
        const todayMs = new Date(today).getTime();

        // Get current time in Indian Standard Time (IST) formatted as HH:MM
        const currentLocalTime = new Date().toLocaleTimeString("en-US", {
          timeZone: "Asia/Kolkata",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        });

        const [{ data: profiles }, { data: tasks }, { data: prefs }, { data: settings }] = await Promise.all([
          supabaseAdmin
            .from("profiles")
            .select("id, display_name, manager_id, is_active")
            .eq("is_active", true),
          supabaseAdmin
            .from("tasks")
            .select("id, task_code, task_name, assigned_to, status, priority, due_date, completed_at"),
          supabaseAdmin.from("notification_prefs").select("user_id, digest_enabled"),
          supabaseAdmin.from("work_settings").select("evening_digest_time").eq("id", 1).maybeSingle(),
        ]);

        const eveningTime = settings?.evening_digest_time ?? "18:00";
        if (currentLocalTime !== eveningTime) {
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
          const dueMs = t.due_date ? new Date(t.due_date).getTime() : null;
          const completedToday =
            t.completed_at && t.completed_at.slice(0, 10) === today;
          const onPlate =
            (dueMs !== null && dueMs <= todayMs) || dueMs === null || completedToday;
          if (!onPlate) continue;
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
          if (mine.length === 0) continue;
          const s = summarize(mine);

          const body = [
            fmt("✅ Completed", s.completed),
            fmt("🔄 In progress", s.inProgress),
            fmt("⛔ Blocked", s.blocked),
            fmt("📋 Still pending", s.pending),
          ]
            .filter(Boolean)
            .join("\n\n");

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
          if (!error) sentManagers += 1;
          else if (error.code !== "23505") {
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

        return Response.json({ ok: true, sentUsers, sentManagers, failed });
      },
    },
  },
});
