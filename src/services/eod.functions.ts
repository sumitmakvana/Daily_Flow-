import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { withUser } from "@/integrations/postgres/query.server";
import type { EodCheckin } from "@/lib/types";

const SELECT_COLS = `id, user_id, checkin_date, pending_count, blocker_count,
                     completed_count, remaining_hours, tomorrow_priority_task_id,
                     note, submitted_at`;

export const getEodTodayFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; date: string }) =>
    z.object({ userId: z.string().uuid(), date: z.string() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const row = await withUser(context.userId, async (client) => {
      const res = await client.query<EodCheckin>(
        `SELECT ${SELECT_COLS}
           FROM public.eod_checkins
           WHERE user_id = $1 AND checkin_date = $2`,
        [data.userId, data.date],
      );
      return res.rows[0] ?? null;
    });
    return row;
  });

export const upsertEodFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      userId: string;
      checkinDate: string;
      patch: Partial<EodCheckin>;
    }) =>
      z
        .object({
          userId: z.string().uuid(),
          checkinDate: z.string(),
          patch: z.record(z.string(), z.unknown()),
        })
        .parse(d),
  )
  .handler(async ({ data, context }) => {
    const p = data.patch as Partial<EodCheckin>;
    const row = await withUser(context.userId, async (client) => {
      const res = await client.query<EodCheckin>(
        `INSERT INTO public.eod_checkins
           (user_id, checkin_date, submitted_at,
            pending_count, blocker_count, completed_count,
            remaining_hours, tomorrow_priority_task_id, note)
         VALUES ($1,$2, now(), $3,$4,$5,$6,$7,$8)
         ON CONFLICT (user_id, checkin_date) DO UPDATE SET
           submitted_at = now(),
           pending_count = COALESCE(EXCLUDED.pending_count, public.eod_checkins.pending_count),
           blocker_count = COALESCE(EXCLUDED.blocker_count, public.eod_checkins.blocker_count),
           completed_count = COALESCE(EXCLUDED.completed_count, public.eod_checkins.completed_count),
           remaining_hours = COALESCE(EXCLUDED.remaining_hours, public.eod_checkins.remaining_hours),
           tomorrow_priority_task_id = COALESCE(EXCLUDED.tomorrow_priority_task_id, public.eod_checkins.tomorrow_priority_task_id),
           note = COALESCE(EXCLUDED.note, public.eod_checkins.note)
         RETURNING ${SELECT_COLS}`,
        [
          data.userId,
          data.checkinDate,
          p.pending_count ?? null,
          p.blocker_count ?? null,
          p.completed_count ?? null,
          p.remaining_hours ?? null,
          p.tomorrow_priority_task_id ?? null,
          p.note ?? null,
        ],
      );
      return res.rows[0];
    });
    return row;
  });

export const listEodForDateFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { date: string }) =>
    z.object({ date: z.string() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const rows = await withUser(context.userId, async (client) => {
      const res = await client.query<EodCheckin>(
        `SELECT ${SELECT_COLS}
           FROM public.eod_checkins
           WHERE checkin_date = $1
           ORDER BY submitted_at DESC`,
        [data.date],
      );
      return res.rows;
    });
    return rows;
  });
