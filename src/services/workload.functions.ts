import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { withUser } from "@/integrations/postgres/query.server";
import type { WorkloadSnapshot } from "@/lib/types";

const SnapshotRowSchema = z.object({
  user_id: z.string().uuid(),
  snapshot_date: z.string(),
  planned_hours: z.number(),
  actual_hours: z.number(),
  active_count: z.number().int(),
  delayed_count: z.number().int(),
  blocked_count: z.number().int(),
  completed_count: z.number().int(),
});

export type WorkloadSnapshotInput = z.infer<typeof SnapshotRowSchema>;

export const upsertWorkloadSnapshotsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { rows: WorkloadSnapshotInput[] }) =>
    z.object({ rows: z.array(SnapshotRowSchema) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    if (data.rows.length === 0) return { inserted: 0 };
    await withUser(context.userId, async (client) => {
      for (const r of data.rows) {
        await client.query(
          `INSERT INTO public.daily_workload_snapshot
             (user_id, snapshot_date, planned_hours, actual_hours,
              active_count, delayed_count, blocked_count, completed_count)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (user_id, snapshot_date) DO UPDATE SET
             planned_hours = EXCLUDED.planned_hours,
             actual_hours = EXCLUDED.actual_hours,
             active_count = EXCLUDED.active_count,
             delayed_count = EXCLUDED.delayed_count,
             blocked_count = EXCLUDED.blocked_count,
             completed_count = EXCLUDED.completed_count`,
          [
            r.user_id,
            r.snapshot_date,
            r.planned_hours,
            r.actual_hours,
            r.active_count,
            r.delayed_count,
            r.blocked_count,
            r.completed_count,
          ],
        );
      }
    });
    return { inserted: data.rows.length };
  });

export const last7DaysWorkloadFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const rows = await withUser(context.userId, async (client) => {
      const res = await client.query<WorkloadSnapshot>(
        `SELECT id, user_id, snapshot_date, planned_hours, actual_hours,
                active_count, delayed_count, blocked_count, completed_count, captured_at
           FROM public.daily_workload_snapshot
           WHERE snapshot_date >= (CURRENT_DATE - INTERVAL '7 days')
           ORDER BY snapshot_date ASC`,
      );
      return res.rows;
    });
    return rows;
  });
