import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireCronAuth } from "@/lib/cron-auth.server";
import { recordFailure } from "@/lib/ops-failures.server";

export const Route = createFileRoute("/api/public/hooks/planning-suggestions")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await requireCronAuth(request, "planning-suggestions");
        if (denied) return denied;
        const { data, error } = await supabaseAdmin.rpc(
          "generate_planning_suggestions" as never,
        );
        if (error) {
          await recordFailure({
            source: "cron.planning_suggestions",
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
