import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { selectAsUser, withUser } from "@/integrations/postgres/query.server";
import type { PlanningSuggestion } from "@/lib/types";

export const fetchOpenSuggestions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const rows = await selectAsUser<PlanningSuggestion>(
      context.userId,
      `SELECT id, kind, severity, target_date, task_id, from_user_id, to_user_id,
              reason, payload, status, created_at, resolved_at, resolved_by
         FROM public.planning_suggestions
         WHERE status = 'open'
         ORDER BY severity DESC, created_at DESC`,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return rows as any;
  });

export const resolveSuggestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; status: "accepted" | "dismissed" }) =>
    z
      .object({
        id: z.string(),
        status: z.enum(["accepted", "dismissed"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await withUser(context.userId, async (client) => {
      await client.query(
        `UPDATE public.planning_suggestions
            SET status = $2,
                resolved_at = now(),
                resolved_by = $3
          WHERE id = $1`,
        [data.id, data.status, context.userId],
      );
    });
    return { ok: true };
  });
