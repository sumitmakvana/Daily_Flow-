import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireCronAuth } from "@/lib/cron-auth.server";
import { recordFailure } from "@/lib/ops-failures.server";

/**
 * Risk detection cron (daily, e.g. 07:00). Idempotent.
 */
export const Route = createFileRoute("/api/public/hooks/detect-risks")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await requireCronAuth(request, "detect-risks");
        if (denied) return denied;
        const { data, error } = await supabaseAdmin.rpc("detect_risks" as never);
        if (error) {
          await recordFailure({
            source: "cron.detect_risks",
            errorCode: error.code ?? null,
            errorMessage: error.message,
          });
          return Response.json({ ok: false, error: error.message }, { status: 500 });
        }
        return Response.json({ ok: true, inserted: data ?? 0 });
      },
    },
  },
});
