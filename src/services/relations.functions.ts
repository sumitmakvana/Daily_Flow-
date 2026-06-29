import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { withUser } from "@/integrations/postgres/query.server";

export type RelationKind =
  | "blocks"
  | "blocked_by"
  | "duplicates"
  | "parent"
  | "child"
  | "relates_to";

export type WorkItemRelation = {
  id: string;
  from_work_item_id: string;
  to_work_item_id: string;
  relation_kind: RelationKind;
  created_by: string | null;
  created_at: string;
};

const RELATION_KINDS = [
  "blocks",
  "blocked_by",
  "duplicates",
  "parent",
  "child",
  "relates_to",
] as const;

export const listRelationsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { workItemId: string }) =>
    z.object({ workItemId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const rows = await withUser(context.userId, async (client) => {
      const res = await client.query<WorkItemRelation>(
        `SELECT id, from_work_item_id, to_work_item_id, relation_kind,
                created_by, created_at
           FROM public.work_item_relations
           WHERE from_work_item_id = $1 OR to_work_item_id = $1
           ORDER BY created_at DESC`,
        [data.workItemId],
      );
      return res.rows;
    });
    return rows;
  });

export const linkRelationFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { fromId: string; toId: string; kind: RelationKind }) =>
    z
      .object({
        fromId: z.string().uuid(),
        toId: z.string().uuid(),
        kind: z.enum(RELATION_KINDS),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const row = await withUser(context.userId, async (client) => {
      const res = await client.query<WorkItemRelation>(
        `INSERT INTO public.work_item_relations
           (from_work_item_id, to_work_item_id, relation_kind, created_by)
         VALUES ($1, $2, $3, $4)
         RETURNING id, from_work_item_id, to_work_item_id, relation_kind,
                   created_by, created_at`,
        [data.fromId, data.toId, data.kind, context.userId],
      );
      return res.rows[0];
    });
    return row;
  });

export const unlinkRelationFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) =>
    z.object({ id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await withUser(context.userId, async (client) => {
      await client.query(`DELETE FROM public.work_item_relations WHERE id = $1`, [
        data.id,
      ]);
    });
    return { ok: true };
  });
