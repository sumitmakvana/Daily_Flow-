import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { withUser } from "@/integrations/postgres/query.server";
import type {
  Task,
  RiskEvent,
  WorkloadSnapshot,
  AdoptionDaily,
  EodCheckin,
} from "@/lib/types";

export interface IntelligenceBundle {
  tasks: Task[];
  risks: RiskEvent[];
  snapshots: WorkloadSnapshot[];
  adoption: AdoptionDaily[];
  eods: EodCheckin[];
}

export const fetchIntelligenceBundle = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { sinceISO: string }) =>
    z.object({ sinceISO: z.string() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const bundle = await withUser(context.userId, async (client) => {
      const [tasks, risks, snapshots, adoption, eods] = await Promise.all([
        client.query<Task>(`SELECT * FROM public.tasks`),
        client.query<RiskEvent>(
          `SELECT * FROM public.risk_events WHERE resolved_at IS NULL`,
        ),
        client.query<WorkloadSnapshot>(
          `SELECT * FROM public.daily_workload_snapshot WHERE snapshot_date >= $1`,
          [data.sinceISO],
        ),
        client.query<AdoptionDaily>(
          `SELECT * FROM public.adoption_daily WHERE rollup_date >= $1`,
          [data.sinceISO],
        ),
        client.query<EodCheckin>(
          `SELECT * FROM public.eod_checkins WHERE checkin_date >= $1`,
          [data.sinceISO],
        ),
      ]);
      return {
        tasks: tasks.rows,
        risks: risks.rows,
        snapshots: snapshots.rows,
        adoption: adoption.rows,
        eods: eods.rows,
      } satisfies IntelligenceBundle;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return bundle as any;
  });
