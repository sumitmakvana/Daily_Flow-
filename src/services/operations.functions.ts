import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { withUser } from "@/integrations/postgres/query.server";

// ----- work_settings --------------------------------------------------------

export const getWorkSettingsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const row = await withUser(context.userId, async (client) => {
      const res = await client.query(
        `SELECT id, workdays, daily_capacity_hours, sla_default_days
           FROM public.work_settings WHERE id = 1`,
      );
      return res.rows[0] ?? null;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return row as any;
  });

export const updateWorkSettingsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { patch: Record<string, unknown> }) =>
    z.object({ patch: z.record(z.string(), z.unknown()) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    for (const [k, v] of Object.entries(data.patch)) {
      if (v === undefined) continue;
      sets.push(`${k} = $${i++}`);
      params.push(v);
    }
    if (!sets.length) return { ok: true };
    await withUser(context.userId, async (client) => {
      await client.query(
        `UPDATE public.work_settings SET ${sets.join(", ")} WHERE id = 1`,
        params,
      );
    });
    return { ok: true };
  });

// ----- user_streaks ---------------------------------------------------------

const STREAK_COLS = `user_id, current_streak, longest_streak, last_update_date::text AS last_update_date, updated_at::text AS updated_at`;

export const getStreakForUserFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string }) =>
    z.object({ userId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const row = await withUser(context.userId, async (client) => {
      const res = await client.query(
        `SELECT ${STREAK_COLS} FROM public.user_streaks WHERE user_id = $1`,
        [data.userId],
      );
      return res.rows[0] ?? null;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return row as any;
  });

export const listAllStreaksFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const rows = await withUser(context.userId, async (client) => {
      const res = await client.query(
        `SELECT ${STREAK_COLS} FROM public.user_streaks`,
      );
      return res.rows;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return rows as any;
  });

// ----- teams ----------------------------------------------------------------

const TEAM_COLS = `id, name, description, manager_id, created_at`;

export const listTeamsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const rows = await withUser(context.userId, async (client) => {
      const res = await client.query(
        `SELECT ${TEAM_COLS} FROM public.teams ORDER BY name`,
      );
      return res.rows;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return rows as any;
  });

export const createTeamFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { team: Record<string, unknown> }) =>
    z.object({ team: z.record(z.string(), z.unknown()) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const cols = Object.keys(data.team);
    const params = Object.values(data.team);
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
    await withUser(context.userId, async (client) => {
      await client.query(
        `INSERT INTO public.teams (${cols.join(", ")}) VALUES (${placeholders})`,
        params,
      );
    });
    return { ok: true };
  });

export const deleteTeamFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) =>
    z.object({ id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await withUser(context.userId, async (client) => {
      await client.query(`DELETE FROM public.teams WHERE id = $1`, [data.id]);
    });
    return { ok: true };
  });

// ----- projects -------------------------------------------------------------

const PROJECT_COLS = `id, name, description, team_id, owner_id, status, created_at`;

export const listProjectsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const rows = await withUser(context.userId, async (client) => {
      const res = await client.query(
        `SELECT ${PROJECT_COLS} FROM public.projects ORDER BY name`,
      );
      return res.rows;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return rows as any;
  });

export const createProjectFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { project: Record<string, unknown> }) =>
    z.object({ project: z.record(z.string(), z.unknown()) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const cols = Object.keys(data.project);
    const params = Object.values(data.project);
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
    await withUser(context.userId, async (client) => {
      await client.query(
        `INSERT INTO public.projects (${cols.join(", ")}) VALUES (${placeholders})`,
        params,
      );
    });
    return { ok: true };
  });

// ----- holidays -------------------------------------------------------------

export const listHolidaysFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const rows = await withUser(context.userId, async (client) => {
      const res = await client.query(
        `SELECT id, calendar_date, label FROM public.holiday_calendar
           ORDER BY calendar_date`,
      );
      return res.rows;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return rows as any;
  });

export const addHolidayFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { calendar_date: string; label: string }) =>
    z
      .object({ calendar_date: z.string(), label: z.string() })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await withUser(context.userId, async (client) => {
      await client.query(
        `INSERT INTO public.holiday_calendar (calendar_date, label) VALUES ($1, $2)`,
        [data.calendar_date, data.label],
      );
    });
    return { ok: true };
  });

export const removeHolidayFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) =>
    z.object({ id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await withUser(context.userId, async (client) => {
      await client.query(
        `DELETE FROM public.holiday_calendar WHERE id = $1`,
        [data.id],
      );
    });
    return { ok: true };
  });
