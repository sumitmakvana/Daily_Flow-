import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { withUser } from "@/integrations/postgres/query.server";

const CHAIN_COLS = `id, type_id, name, description, is_active, version`;
const STEP_COLS = `id, chain_id, step_order, name, approver_mode,
                   approver_role, approver_role_key, approver_user_id,
                   required_count, allow_self`;
const REQUEST_COLS = `id, work_item_id, chain_id, current_step, status,
                      requested_by, requested_at, completed_at`;
const DECISION_COLS = `id, request_id, step_order, approver_id, decision,
                       comment, decided_at`;

export const listChainsForTypeFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { typeId: string }) =>
    z.object({ typeId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const rows = await withUser(context.userId, async (client) => {
      const res = await client.query(
        `SELECT ${CHAIN_COLS} FROM public.approval_chains
           WHERE type_id = $1 AND is_active = true
           ORDER BY name`,
        [data.typeId],
      );
      return res.rows;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return rows as any;
  });

export const listApprovalStepsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { chainId: string }) =>
    z.object({ chainId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const rows = await withUser(context.userId, async (client) => {
      const res = await client.query(
        `SELECT ${STEP_COLS} FROM public.approval_steps
           WHERE chain_id = $1 ORDER BY step_order`,
        [data.chainId],
      );
      return res.rows;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return rows as any;
  });

export const startApprovalRequestFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { workItemId: string; chainId: string }) =>
    z
      .object({
        workItemId: z.string().uuid(),
        chainId: z.string().uuid(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const row = await withUser(context.userId, async (client) => {
      const res = await client.query(
        `INSERT INTO public.approval_requests
           (work_item_id, chain_id, requested_by)
         VALUES ($1, $2, $3)
         RETURNING ${REQUEST_COLS}`,
        [data.workItemId, data.chainId, context.userId],
      );
      return res.rows[0];
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return row as any;
  });

export const decideApprovalFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      requestId: string;
      stepOrder: number;
      decision: "approve" | "reject" | "delegate";
      comment?: string;
    }) =>
      z
        .object({
          requestId: z.string().uuid(),
          stepOrder: z.number().int(),
          decision: z.enum(["approve", "reject", "delegate"]),
          comment: z.string().optional(),
        })
        .parse(d),
  )
  .handler(async ({ data, context }) => {
    const row = await withUser(context.userId, async (client) => {
      const res = await client.query(
        `INSERT INTO public.approval_decisions
           (request_id, step_order, approver_id, decision, comment)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING ${DECISION_COLS}`,
        [
          data.requestId,
          data.stepOrder,
          context.userId,
          data.decision,
          data.comment ?? null,
        ],
      );
      return res.rows[0];
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return row as any;
  });

export const listApprovalsForWorkItemFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { workItemId: string }) =>
    z.object({ workItemId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const rows = await withUser(context.userId, async (client) => {
      const res = await client.query(
        `SELECT ${REQUEST_COLS} FROM public.approval_requests
           WHERE work_item_id = $1
           ORDER BY requested_at DESC`,
        [data.workItemId],
      );
      return res.rows;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return rows as any;
  });
