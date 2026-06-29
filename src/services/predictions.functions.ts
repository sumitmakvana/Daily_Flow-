import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { selectAsUser } from "@/integrations/postgres/query.server";
import type { PredictedRisk } from "@/lib/types";

export const fetchTomorrowRisks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    return selectAsUser<PredictedRisk>(
      context.userId,
      `SELECT task_id, risk_score, reasons
         FROM public.predict_tomorrow_risks()`,
    );
  });
