import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { withUser } from "@/integrations/postgres/query.server";

const COLS = `id, current_step, industry, completed_at, data`;

export const getOnboardingFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const row = await withUser(context.userId, async (client) => {
      const res = await client.query(
        `SELECT ${COLS} FROM public.tenant_onboarding WHERE id = 1`,
      );
      return res.rows[0] ?? null;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return row as any;
  });

export const setOnboardingStepFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      step: number;
      completed: boolean;
      industry?: string | null;
      data?: Record<string, unknown>;
    }) =>
      z
        .object({
          step: z.number().int(),
          completed: z.boolean(),
          industry: z.string().nullish(),
          data: z.record(z.string(), z.unknown()).optional(),
        })
        .parse(d),
  )
  .handler(async ({ data, context }) => {
    const sets = [`current_step = $1`];
    const params: unknown[] = [data.step];
    let i = 2;
    if (data.industry !== undefined) {
      sets.push(`industry = $${i++}`);
      params.push(data.industry);
    }
    if (data.data !== undefined) {
      sets.push(`data = $${i++}`);
      params.push(data.data);
    }
    if (data.completed) sets.push(`completed_at = now()`);
    await withUser(context.userId, async (client) => {
      await client.query(
        `UPDATE public.tenant_onboarding SET ${sets.join(", ")} WHERE id = 1`,
        params,
      );
    });
    return { ok: true };
  });

export const resetOnboardingFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await withUser(context.userId, async (client) => {
      await client.query(
        `UPDATE public.tenant_onboarding
           SET current_step = 0, completed_at = NULL, industry = NULL, data = '{}'::jsonb
           WHERE id = 1`,
      );
    });
    return { ok: true };
  });
