import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireCronAuth } from "@/lib/cron-auth.server";
import { recordFailure } from "@/lib/ops-failures.server";

/**
 * Cron-driven enqueue of due.reached + due.missed events.
 * Idempotent by the partial unique index on automation_events.
 *
 * Schedule:
 *  - every 15 min for due.reached
 *  - daily 02:00 UTC for due.missed (also safe to run more often)
 */
export const Route = createFileRoute("/api/public/hooks/automation-due-enqueue")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await requireCronAuth(request, "automation-due-enqueue");
        if (denied) return denied;

        try {
          const todayIso = new Date().toISOString().slice(0, 10);

          // due.reached — tasks due today, still open
          const { data: due } = await supabaseAdmin
            .from("tasks")
            .select("id, type_id, status, priority, due_date, assigned_to")
            .eq("due_date", todayIso)
            .not("status", "in", '("Completed")');
          for (const t of (due ?? []) as Array<{
            id: string; type_id: string | null; status: string;
            priority: string | null; due_date: string | null; assigned_to: string | null;
          }>) {
            await supabaseAdmin.rpc("enqueue_automation_event" as never, {
              _event_kind: "due.reached",
              _entity_type: "task",
              _entity_id: t.id,
              _payload: {
                type_id: t.type_id, status: t.status, priority: t.priority,
                due_date: t.due_date, assigned_to: t.assigned_to,
              },
              _actor_id: null, _depth: 0,
              _available_at: new Date().toISOString(),
            } as never);
          }

          // due.missed — tasks past due, still open
          const { data: missed } = await supabaseAdmin
            .from("tasks")
            .select("id, type_id, status, priority, due_date, assigned_to")
            .lt("due_date", todayIso)
            .not("status", "in", '("Completed")');
          for (const t of (missed ?? []) as Array<{
            id: string; type_id: string | null; status: string;
            priority: string | null; due_date: string | null; assigned_to: string | null;
          }>) {
            await supabaseAdmin.rpc("enqueue_automation_event" as never, {
              _event_kind: "due.missed",
              _entity_type: "task",
              _entity_id: t.id,
              _payload: {
                type_id: t.type_id, status: t.status, priority: t.priority,
                due_date: t.due_date, assigned_to: t.assigned_to,
              },
              _actor_id: null, _depth: 0,
              _available_at: new Date().toISOString(),
            } as never);
          }

          return Response.json({
            ok: true,
            due_reached: (due ?? []).length,
            due_missed: (missed ?? []).length,
          });
        } catch (err) {
          const e = err as Error;
          await recordFailure({
            source: "cron.automation_due_enqueue",
            errorMessage: e.message,
          });
          return Response.json({ ok: false, error: e.message }, { status: 500 });
        }
      },
    },
  },
});
