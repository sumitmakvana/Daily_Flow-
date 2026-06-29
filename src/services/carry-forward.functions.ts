import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { withUser } from "@/integrations/postgres/query.server";


export const carryTaskForwardFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      taskId: string;
      toDate: string;
      reason: "auto" | "eod" | "manager";
      expectedVersion: number;
    }) =>
      z
        .object({
          taskId: z.string().uuid(),
          toDate: z.string(),
          reason: z.enum(["auto", "eod", "manager"]),
          expectedVersion: z.number().int(),
        })
        .parse(d),
  )
  .handler(async ({ data, context }) => {
    await withUser(context.userId, async (client) => {
      await client.query(
        `SELECT public.carry_task_forward($1, $2, $3, $4)`,
        [data.taskId, data.toDate, data.reason, data.expectedVersion],
      );
    });
    return { ok: true };
  });

export const listOverdueForUserFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { ownerId: string; today: string }) =>
    z.object({ ownerId: z.string().uuid(), today: z.string() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const rows = await withUser(context.userId, async (client) => {
      const res = await client.query(
        `SELECT * FROM public.tasks
           WHERE assigned_to = $1
             AND status <> 'Completed'
             AND due_date < $2`,
        [data.ownerId, data.today],
      );
      return res.rows;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return rows as any;
  });

export const listCarryEventsForTaskFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { taskId: string }) =>
    z.object({ taskId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const rows = await withUser(context.userId, async (client) => {
      const res = await client.query(
        `SELECT id, task_id, from_date, to_date, reason, created_by, created_at
           FROM public.carry_forward_events
           WHERE task_id = $1
           ORDER BY created_at DESC`,
        [data.taskId],
      );
      return res.rows;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return rows as any;
  });
