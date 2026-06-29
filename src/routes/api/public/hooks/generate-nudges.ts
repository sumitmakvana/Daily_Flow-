import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireCronAuth } from "@/lib/cron-auth.server";
import { recordFailure } from "@/lib/ops-failures.server";

export const Route = createFileRoute("/api/public/hooks/generate-nudges")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await requireCronAuth(request, "generate-nudges");
        if (denied) return denied;
        const { data, error } = await supabaseAdmin.rpc("generate_nudges" as never);
        if (error) {
          await recordFailure({
            source: "cron.generate_nudges",
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
