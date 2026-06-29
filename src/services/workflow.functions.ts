import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { withUser } from "@/integrations/postgres/query.server";

const STATUS_COLS = `id, type_id, key, label, category, color, sort_order, is_initial, is_terminal`;
const TRANSITION_COLS = `id, type_id, from_status_id, to_status_id, label,
                         required_role, required_role_key, guard_expr, sort_order`;

export const listStatusesFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { typeId: string }) =>
    z.object({ typeId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const rows = await withUser(context.userId, async (client) => {
      const res = await client.query(
        `SELECT ${STATUS_COLS} FROM public.work_item_statuses
           WHERE type_id = $1 ORDER BY sort_order`,
        [data.typeId],
      );
      return res.rows;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return rows as any;
  });

export const listTransitionsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { typeId: string }) =>
    z.object({ typeId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const rows = await withUser(context.userId, async (client) => {
      const res = await client.query(
        `SELECT ${TRANSITION_COLS} FROM public.work_item_transitions
           WHERE type_id = $1 ORDER BY sort_order`,
        [data.typeId],
      );
      return res.rows;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return rows as any;
  });
