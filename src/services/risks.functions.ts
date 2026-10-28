import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { withUser } from "@/integrations/postgres/query.server";

// Must match public.risk_events (and the RiskEvent type). The previous list named work_item_id /
// user_id / team_id / reason / evidence, which do not exist on this table, so the query failed
// with `column "work_item_id" does not exist` and the Command page showed no risks.
export const RISK_SELECT_COLS = `id, kind, severity, entity_type, entity_id, summary, payload,
                     detected_at, resolved_at, resolved_by, detection_date`;
const SELECT_COLS = RISK_SELECT_COLS;

export const listOpenRisksFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const rows = await withUser(context.userId, async (client) => {
      const res = await client.query(
        `SELECT ${SELECT_COLS}
           FROM public.risk_events
           WHERE resolved_at IS NULL
           ORDER BY detected_at DESC`,
      );
      return res.rows;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return rows as any;
  });

export const resolveRiskFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) =>
    z.object({ id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await withUser(context.userId, async (client) => {
      await client.query(
        `UPDATE public.risk_events
           SET resolved_at = now(), resolved_by = $1
           WHERE id = $2`,
        [context.userId, data.id],
      );
    });
    return { ok: true };
  });
