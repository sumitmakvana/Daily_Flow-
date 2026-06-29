import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { selectAsUser } from "@/integrations/postgres/query.server";
import type { AdoptionDaily } from "@/lib/types";

export const fetchAdoptionLast14 = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { sinceISO: string }) =>
    z.object({ sinceISO: z.string() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    return selectAsUser<AdoptionDaily>(
      context.userId,
      `SELECT user_id, rollup_date, status_updates_count, eod_submitted,
              blocker_usage, planning_views, notif_interactions
         FROM public.adoption_daily
         WHERE rollup_date >= $1
         ORDER BY rollup_date ASC`,
      [data.sinceISO],
    );
  });
