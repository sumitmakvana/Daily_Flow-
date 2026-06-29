import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { withUser } from "@/integrations/postgres/query.server";
import type { WorkItemType } from "@/lib/types";

const InputSchema = z.object({
  key: z.string().min(1).max(64),
  name: z.string().min(1).max(128),
  description: z.string().nullish(),
  icon: z.string().nullish(),
  color: z.string().nullish(),
  sort_order: z.number().int().optional(),
  id_prefix: z.string().nullish(),
});

const PatchSchema = InputSchema.partial().extend({
  active: z.boolean().optional(),
});

const SELECT_COLS = `id, key, name, description, icon, color, sort_order,
                     id_prefix, active, created_at, updated_at`;

export const listWorkItemTypesFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { includeInactive?: boolean }) =>
    z.object({ includeInactive: z.boolean().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const rows = await withUser(context.userId, async (client) => {
      const res = await client.query<WorkItemType>(
        data.includeInactive
          ? `SELECT ${SELECT_COLS} FROM public.work_item_types ORDER BY sort_order`
          : `SELECT ${SELECT_COLS} FROM public.work_item_types WHERE active = true ORDER BY sort_order`,
      );
      return res.rows;
    });
    return rows;
  });

export const createWorkItemTypeFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.infer<typeof InputSchema>) => InputSchema.parse(d))
  .handler(async ({ data, context }) => {
    const row = await withUser(context.userId, async (client) => {
      const res = await client.query<WorkItemType>(
        `INSERT INTO public.work_item_types
           (key, name, description, icon, color, sort_order, id_prefix)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING ${SELECT_COLS}`,
        [
          data.key,
          data.name,
          data.description ?? null,
          data.icon ?? null,
          data.color ?? null,
          data.sort_order ?? 100,
          data.id_prefix ?? null,
        ],
      );
      return res.rows[0];
    });
    return row;
  });

export const updateWorkItemTypeFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; patch: z.infer<typeof PatchSchema> }) =>
    z.object({ id: z.string().uuid(), patch: PatchSchema }).parse(d),
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
    if (sets.length === 0) {
      const row = await withUser(context.userId, async (client) => {
        const res = await client.query<WorkItemType>(
          `SELECT ${SELECT_COLS} FROM public.work_item_types WHERE id = $1`,
          [data.id],
        );
        return res.rows[0];
      });
      return row;
    }
    params.push(data.id);
    const row = await withUser(context.userId, async (client) => {
      const res = await client.query<WorkItemType>(
        `UPDATE public.work_item_types SET ${sets.join(", ")}
         WHERE id = $${i} RETURNING ${SELECT_COLS}`,
        params,
      );
      return res.rows[0];
    });
    return row;
  });

export const setWorkItemTypeActiveFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; active: boolean }) =>
    z.object({ id: z.string().uuid(), active: z.boolean() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await withUser(context.userId, async (client) => {
      await client.query(
        `UPDATE public.work_item_types SET active = $1 WHERE id = $2`,
        [data.active, data.id],
      );
    });
    return { ok: true };
  });
