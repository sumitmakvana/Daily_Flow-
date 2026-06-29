import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireCronAuth } from "@/lib/cron-auth.server";
import { recordFailure } from "@/lib/ops-failures.server";

/**
 * Nightly workload snapshot. Aggregates tasks for ACTIVE users only.
 * Idempotent per (user, date) via daily_workload_snapshot_user_date_uniq.
 */
export const Route = createFileRoute("/api/public/hooks/workload-snapshot")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await requireCronAuth(request, "workload-snapshot");
        if (denied) return denied;

        const today = new Date().toISOString().slice(0, 10);
        const [{ data: tasks, error }, { data: profiles }] = await Promise.all([
          supabaseAdmin.from("tasks").select("*"),
          supabaseAdmin.from("profiles").select("id, is_active").eq("is_active", true),
        ]);
        if (error) {
          await recordFailure({
            source: "cron.workload_snapshot",
            errorCode: error.code ?? null,
            errorMessage: error.message,
          });
          return Response.json({ ok: false, error: error.message }, { status: 500 });
        }
        const activeIds = new Set((profiles ?? []).map((p) => p.id));

        type Row = {
          user_id: string;
          snapshot_date: string;
          planned_hours: number;
          actual_hours: number;
          active_count: number;
          delayed_count: number;
          blocked_count: number;
          completed_count: number;
        };
        const m = new Map<string, Row>();
        const todayDate = new Date(today).getTime();

        for (const t of tasks ?? []) {
          if (!t.assigned_to || !activeIds.has(t.assigned_to)) continue;
          const row =
            m.get(t.assigned_to) ?? {
              user_id: t.assigned_to,
              snapshot_date: today,
              planned_hours: 0,
              actual_hours: 0,
              active_count: 0,
              delayed_count: 0,
              blocked_count: 0,
              completed_count: 0,
            };
          row.actual_hours += Number(t.actual_hours ?? 0);
          if (t.status === "Completed") {
            row.completed_count += 1;
          } else {
            row.active_count += 1;
            row.planned_hours += Number(t.planned_hours ?? 0);
            if (t.status === "Blocked") row.blocked_count += 1;
            if (t.due_date && new Date(t.due_date).getTime() < todayDate) row.delayed_count += 1;
          }
          m.set(t.assigned_to, row);
        }

        const rows = Array.from(m.values());
        if (rows.length > 0) {
          const { error: upErr } = await supabaseAdmin
            .from("daily_workload_snapshot")
            .upsert(rows, { onConflict: "user_id,snapshot_date" });
          if (upErr) {
            await recordFailure({
              source: "cron.workload_snapshot",
              errorCode: upErr.code ?? null,
              errorMessage: upErr.message,
            });
            return Response.json({ ok: false, error: upErr.message }, { status: 500 });
          }
        }
        return Response.json({ ok: true, count: rows.length });
      },
    },
  },
});
