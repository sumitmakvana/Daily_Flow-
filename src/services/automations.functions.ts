import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { withUser } from "@/integrations/postgres/query.server";

const RULE_COLS = `id, name, description, description_internal, type_id,
                   trigger_kind, condition_expr, actions, is_active, run_mode,
                   dedupe_window_minutes, max_runs_per_entity, max_runs_per_minute,
                   allow_self_retrigger, sort_order, auto_disabled_at,
                   auto_disabled_reason, created_at, updated_at`;

const RUN_COLS = `id, rule_id, event_id, entity_type, entity_id, status,
                  attempts, actions_log, error, started_at, finished_at`;

export const listAutomationRulesFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const rows = await withUser(context.userId, async (client) => {
      const res = await client.query(
        `SELECT ${RULE_COLS} FROM public.automation_rules
           ORDER BY sort_order, created_at`,
      );
      return res.rows;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return rows as any;
  });

export const getAutomationRuleFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) =>
    z.object({ id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const row = await withUser(context.userId, async (client) => {
      const res = await client.query(
        `SELECT ${RULE_COLS} FROM public.automation_rules WHERE id = $1`,
        [data.id],
      );
      return res.rows[0] ?? null;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return row as any;
  });

export const createAutomationRuleFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { input: Record<string, unknown> }) =>
    z.object({ input: z.record(z.string(), z.unknown()) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const payload = {
      ...data.input,
      created_by: context.userId,
      updated_by: context.userId,
    };
    const cols = Object.keys(payload);
    const params = Object.values(payload);
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
    const row = await withUser(context.userId, async (client) => {
      const res = await client.query(
        `INSERT INTO public.automation_rules (${cols.join(", ")})
         VALUES (${placeholders})
         RETURNING ${RULE_COLS}`,
        params,
      );
      return res.rows[0];
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return row as any;
  });

export const updateAutomationRuleFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; patch: Record<string, unknown> }) =>
    z
      .object({
        id: z.string().uuid(),
        patch: z.record(z.string(), z.unknown()),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const patch = { ...data.patch, updated_by: context.userId };
    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      sets.push(`${k} = $${i++}`);
      params.push(v);
    }
    if (!sets.length) return { ok: true };
    params.push(data.id);
    await withUser(context.userId, async (client) => {
      await client.query(
        `UPDATE public.automation_rules SET ${sets.join(", ")} WHERE id = $${i}`,
        params,
      );
    });
    return { ok: true };
  });

export const deleteAutomationRuleFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) =>
    z.object({ id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await withUser(context.userId, async (client) => {
      await client.query(
        `DELETE FROM public.automation_rules WHERE id = $1`,
        [data.id],
      );
    });
    return { ok: true };
  });

export const listAutomationRunsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { ruleId?: string; status?: string; limit?: number }) =>
      z
        .object({
          ruleId: z.string().uuid().optional(),
          status: z.string().optional(),
          limit: z.number().int().min(1).max(1000).optional(),
        })
        .parse(d),
  )
  .handler(async ({ data, context }) => {
    const where: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (data.ruleId) {
      where.push(`rule_id = $${i++}`);
      params.push(data.ruleId);
    }
    if (data.status) {
      where.push(`status = $${i++}`);
      params.push(data.status);
    }
    const limit = data.limit ?? 100;
    const rows = await withUser(context.userId, async (client) => {
      const res = await client.query(
        `SELECT ${RUN_COLS} FROM public.automation_runs
           ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
           ORDER BY started_at DESC
           LIMIT ${limit}`,
        params,
      );
      return res.rows;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return rows as any;
  });

export const replayAutomationRunFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { runId: string }) =>
    z.object({ runId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await withUser(context.userId, async (client) => {
      await client.query(
        `SELECT public.automation_replay_dead_run($1)`,
        [data.runId],
      );
    });
    return { ok: true };
  });

export const automationHealthFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const result = await withUser(context.userId, async (client) => {
      const [stats, rules, runs24, failed24, dead24] = await Promise.all([
        client.query<{ pending_count: number; updated_at: string }>(
          `SELECT pending_count, updated_at FROM public.automation_queue_stats LIMIT 1`,
        ),
        client.query<{ is_active: boolean; auto_disabled_at: string | null }>(
          `SELECT is_active, auto_disabled_at FROM public.automation_rules`,
        ),
        client.query<{ c: string }>(
          `SELECT COUNT(*)::text AS c FROM public.automation_runs
             WHERE started_at >= now() - INTERVAL '24 hours'`,
        ),
        client.query<{ c: string }>(
          `SELECT COUNT(*)::text AS c FROM public.automation_runs
             WHERE started_at >= now() - INTERVAL '24 hours' AND status = 'failed'`,
        ),
        client.query<{ c: string }>(
          `SELECT COUNT(*)::text AS c FROM public.automation_runs
             WHERE started_at >= now() - INTERVAL '24 hours' AND status = 'dead'`,
        ),
      ]);
      const rs = rules.rows;
      return {
        pending_count: Number(stats.rows[0]?.pending_count ?? 0),
        pending_updated_at:
          stats.rows[0]?.updated_at ?? new Date().toISOString(),
        runs_24h: Number(runs24.rows[0]?.c ?? 0),
        failed_24h: Number(failed24.rows[0]?.c ?? 0),
        dead_24h: Number(dead24.rows[0]?.c ?? 0),
        active_rules: rs.filter((r) => r.is_active && !r.auto_disabled_at).length,
        auto_disabled_rules: rs.filter((r) => r.auto_disabled_at).length,
      };
    });
    return result;
  });
