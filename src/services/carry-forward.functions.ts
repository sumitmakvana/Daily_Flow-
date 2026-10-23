import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { withUser } from "@/integrations/postgres/query.server";
import { bankTimer } from "@/lib/task-timer.server";


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

/**
 * "Carry Forward → Tomorrow": stop the running timer (banking today's hours), keep the task
 * In Progress and move it to `toDate`. Everything happens in one transaction under a row lock,
 * so a double click cannot bank the same elapsed time twice. Hours are banked into
 * tasks.system_hours + one task_worklogs row; resuming later (updateTaskFn / resumeTimer) only
 * adds new elapsed time on top of that total.
 */
export const carryForwardWithTimerFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { taskId: string; toDate: string; expectedVersion: number }) =>
    z
      .object({
        taskId: z.string().uuid(),
        toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        expectedVersion: z.number().int(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    return await withUser(context.userId, async (client) => {
      const cur = await client.query<{
        status: string;
        started_at: string | null;
        system_hours: number | null;
        due_date: string | null;
        version: number;
      }>(
        `SELECT status::text AS status, started_at::text, system_hours, due_date::text, version
           FROM public.tasks WHERE id = $1 FOR UPDATE`,
        [data.taskId],
      );
      const task = cur.rows[0];
      if (!task) throw new Error("Task not found");
      if (task.status !== "In Progress") {
        throw new Error("Only tasks that are In Progress can be carried forward with the timer");
      }
      if (task.version !== data.expectedVersion) {
        throw new Error("This task was updated by someone else. Reloading latest version.");
      }

      // Same row-locked "bank once" primitive that Pause uses.
      let sysHours = Number(task.system_hours ?? 0);
      if (task.started_at) {
        sysHours += await bankTimer(client, {
          taskId: data.taskId,
          userId: context.userId,
          startedAt: task.started_at,
        });
      }

      // Timer stopped, status untouched (stays In Progress), due date moved.
      const upd = await client.query(
        `UPDATE public.tasks
            SET started_at = NULL, system_hours = $1, due_date = $2,
                version = version + 1, updated_at = NOW(), updated_by = $3
          WHERE id = $4
          RETURNING *`,
        [sysHours, data.toDate, context.userId, data.taskId],
      );

      // The AFTER INSERT trigger bumps carry_forward_count / original_due_date and writes history.
      await client.query(
        `INSERT INTO public.carry_forward_events (task_id, from_date, to_date, reason, created_by)
         VALUES ($1, COALESCE($2::date, CURRENT_DATE), $3, 'manager', $4)`,
        [data.taskId, task.due_date, data.toDate, context.userId],
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return upd.rows[0] as any;
    });
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
