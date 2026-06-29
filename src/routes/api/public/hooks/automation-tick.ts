import { createFileRoute } from "@tanstack/react-router";
import { requireCronAuth } from "@/lib/cron-auth.server";
import { recordFailure } from "@/lib/ops-failures.server";
import { runAutomationTick } from "@/lib/automation/worker.server";

/**
 * Automation worker tick. Cron: every 30 seconds.
 * Drains the approval outbox, then drains automation_events.
 */
export const Route = createFileRoute("/api/public/hooks/automation-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await requireCronAuth(request, "automation-tick");
        if (denied) return denied;
        try {
          const result = await runAutomationTick();
          return Response.json({ ok: true, ...result });
        } catch (err) {
          const e = err as Error;
          await recordFailure({
            source: "cron.automation_tick",
            errorMessage: e.message,
          });
          return Response.json({ ok: false, error: e.message }, { status: 500 });
        }
      },
    },
  },
});
