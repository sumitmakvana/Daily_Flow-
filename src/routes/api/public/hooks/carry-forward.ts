import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireCronAuth } from "@/lib/cron-auth.server";
import { recordFailure } from "@/lib/ops-failures.server";

/**
 * Auto carry-forward cron (daily, e.g. 02:00).
 * Moves every non-completed overdue task to next working day via the
 * atomic carry_task_forward RPC. Honours the holiday calendar via
 * public.next_working_day().
 */
export const Route = createFileRoute("/api/public/hooks/carry-forward")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await requireCronAuth(request, "carry-forward");
        if (denied) return denied;

        const today = new Date();
        const todayISO = today.toISOString().slice(0, 10);

        const { data: nextRow, error: nwdErr } = await supabaseAdmin.rpc(
          "next_working_day" as never,
          { _from: todayISO } as never,
        );
        if (nwdErr) {
          await recordFailure({
            source: "cron.carry_forward",
            errorCode: nwdErr.code ?? null,
            errorMessage: `next_working_day failed: ${nwdErr.message}`,
          });
          return Response.json({ ok: false, error: nwdErr.message }, { status: 500 });
        }
        const nextISO = (nextRow as unknown as string) ?? todayISO;

        const { data: tasks, error } = await supabaseAdmin
          .from("tasks")
          .select("id, task_code, due_date, status, version")
          .lt("due_date", todayISO)
          .not("status", "in", '("Completed")');
        if (error) {
          await recordFailure({
            source: "cron.carry_forward",
            errorCode: error.code ?? null,
            errorMessage: `tasks read failed: ${error.message}`,
          });
          return Response.json({ ok: false, error: error.message }, { status: 500 });
        }

        let carried = 0;
        let failed = 0;
        for (const t of tasks ?? []) {
          const { error: rpcErr } = await supabaseAdmin.rpc(
            "carry_task_forward" as never,
            {
              _task_id: t.id,
              _to_date: nextISO,
              _reason: "auto",
              _expected_version: t.version,
            } as never,
          );
          if (rpcErr) {
            failed += 1;
            await recordFailure({
              source: "cron.carry_forward",
              entityType: "task",
              entityId: t.id,
              errorCode: rpcErr.code ?? null,
              errorMessage: rpcErr.message,
              context: { task_code: t.task_code, target: nextISO },
            });
          } else {
            carried += 1;
          }
        }

        return Response.json({ ok: true, carried, failed, to: nextISO });
      },
    },
  },
});
