import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireCronAuth } from "@/lib/cron-auth.server";
import { recordFailure } from "@/lib/ops-failures.server";

export const Route = createFileRoute("/api/public/hooks/adoption-rollup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await requireCronAuth(request, "adoption-rollup");
        if (denied) return denied;
        const d = new Date();
        d.setUTCDate(d.getUTCDate() - 1);
        const ymd = d.toISOString().slice(0, 10);
        const { data, error } = await supabaseAdmin.rpc(
          "adoption_rollup" as never,
          { _for_date: ymd } as never,
        );
        if (error) {
          await recordFailure({
            source: "cron.adoption_rollup",
            errorCode: error.code ?? null,
            errorMessage: error.message,
            context: { for_date: ymd },
          });
          return Response.json({ ok: false, error: error.message }, { status: 500 });
        }
        return Response.json({ ok: true, date: ymd, updated: data ?? 0 });
      },
    },
  },
});
