import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { withUser } from "@/integrations/postgres/query.server";
import type { WorkItemFieldDef } from "./dynamic-fields";

export const listFieldDefsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { typeId: string }) =>
    z.object({ typeId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const rows = await withUser(context.userId, async (client) => {
      const res = await client.query(
        `SELECT id, type_id, key, label, data_type, required,
                required_for_completion, options, validation,
                sort_order, is_active
           FROM public.work_item_field_defs
           WHERE type_id = $1 AND is_active = true
           ORDER BY sort_order`,
        [data.typeId],
      );
      return res.rows;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return rows as any;
  });
