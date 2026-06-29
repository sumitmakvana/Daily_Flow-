import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireCronAuth } from "@/lib/cron-auth.server";
import { recordFailure } from "@/lib/ops-failures.server";

/**
 * Start-of-day digest cron (e.g., 08:30 local).
 * Sends each active user the day's plate; rolls up to their manager.
 * Idempotent via notifications.dedupe_key.
 */
export const Route = createFileRoute("/api/public/hooks/morning-digest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await requireCronAuth(request, "morning-digest");
        if (denied) return denied;

        const today = new Date().toISOString().slice(0, 10);
        const todayMs = new Date(today).getTime();

        const [{ data: profiles }, { data: tasks }, { data: prefs }] = await Promise.all([
          supabaseAdmin
            .from("profiles")
            .select("id, display_name, manager_id, is_active")
            .eq("is_active", true),
          supabaseAdmin
            .from("tasks")
            .select("id, task_code, task_name, assigned_to, status, priority, due_date"),
          supabaseAdmin.from("notification_prefs").select("user_id, digest_enabled"),
        ]);

        const optedOut = new Set(
          (prefs ?? []).filter((p) => p.digest_enabled === false).map((p) => p.user_id),
        );
        const activeIds = new Set((profiles ?? []).map((p) => p.id));
        const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

        const plateByUser = new Map<string, NonNullable<typeof tasks>>();
        for (const t of tasks ?? []) {
          if (!t.assigned_to || !activeIds.has(t.assigned_to)) continue;
          if (t.status === "Completed") continue;
          const dueMs = t.due_date ? new Date(t.due_date).getTime() : null;
          if (dueMs === null || dueMs <= todayMs) {
            const arr = plateByUser.get(t.assigned_to) ?? [];
            arr.push(t);
            plateByUser.set(t.assigned_to, arr);
          }
        }

        const fmtLine = (t: {
          task_code: string;
          task_name: string;
          priority: string;
          status: string;
        }) => `• [${t.task_code}] ${t.task_name} — ${t.priority}, ${t.status}`;

        const managerRollup = new Map<string, string[]>();
        let sentUsers = 0;
        let failed = 0;

        for (const p of profiles ?? []) {
          const mine = (plateByUser.get(p.id) ?? []).slice(0, 20);
          if (mine.length === 0) continue;

          const high = mine.filter((t) => t.priority === "High").length;
          const blocked = mine.filter((t) => t.status === "Blocked").length;
          const body = mine.map(fmtLine).join("\n");

          if (!optedOut.has(p.id)) {
            const dedupeKey = `SOD_${today}_${p.id}`;
            const { error } = await supabaseAdmin.from("notifications").insert({
              user_id: p.id,
              type: "sod_digest",
              title: `Today's plate: ${mine.length} task${mine.length === 1 ? "" : "s"}${high ? ` · ${high} high` : ""}${blocked ? ` · ${blocked} blocked` : ""}`,
              body,
              dedupe_key: dedupeKey,
            });
            if (!error) sentUsers += 1;
            else if (error.code === "23505") {
              // already sent today; idempotent skip
            } else {
              failed += 1;
              await recordFailure({
                source: "cron.morning_digest",
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
              `${p.display_name}: ${mine.length} task${mine.length === 1 ? "" : "s"}${high ? ` (${high} high)` : ""}${blocked ? ` (${blocked} blocked)` : ""}\n${mine.slice(0, 5).map(fmtLine).join("\n")}`,
            );
            managerRollup.set(p.manager_id, arr);
          }
        }

        let sentManagers = 0;
        for (const [managerId, sections] of managerRollup.entries()) {
          if (optedOut.has(managerId)) continue;
          const dedupeKey = `SOD_TEAM_${today}_${managerId}`;
          const { error } = await supabaseAdmin.from("notifications").insert({
            user_id: managerId,
            type: "sod_team_digest",
            title: `Team plate today: ${sections.length} report${sections.length === 1 ? "" : "s"}`,
            body: sections.join("\n\n"),
            dedupe_key: dedupeKey,
          });
          if (!error) sentManagers += 1;
          else if (error.code !== "23505") {
            failed += 1;
            await recordFailure({
              source: "cron.morning_digest.team",
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
