import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { withUser } from "@/integrations/postgres/query.server";
import type { Task } from "@/lib/types";

/**
 * Tasks CRUD as TanStack server functions over the pg pool.
 *
 * All writes run inside `withUser`, so the original RLS policies and the
 * `log_task_change` AFTER trigger on `tasks` continue to enforce ownership
 * and write history. Optimistic concurrency via `version` is preserved by
 * including `version = $N` in UPDATE WHERE clauses.
 */

const PartialTaskSchema = z.record(z.string(), z.unknown());

export const createTaskFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { payload: Record<string, unknown> }) =>
    z.object({ payload: PartialTaskSchema }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const row = await withUser(context.userId, async (client) => {
      const payload: Record<string, unknown> = {
        ...data.payload,
        created_by: context.userId,
        updated_by: context.userId,
      };
      const keys = Object.keys(payload);
      if (keys.length === 0) throw new Error("Empty task payload");
      const cols = keys.map((k) => `"${k}"`).join(", ");
      const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
      const values = keys.map((k) => payload[k]);
      const res = await client.query<Task>(
        `INSERT INTO public.tasks (${cols}) VALUES (${placeholders}) RETURNING *`,
        values,
      );
      return res.rows[0];
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return row as any;
  });

export const updateTaskFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; version: number; patch: Record<string, unknown> }) =>
    z
      .object({
        id: z.string(),
        version: z.number(),
        patch: PartialTaskSchema,
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const result = await withUser(context.userId, async (client) => {
      const patch: Record<string, unknown> = { ...data.patch, updated_by: context.userId };
      const keys = Object.keys(patch);
      if (keys.length === 0) throw new Error("Empty task patch");
      const setSql = keys.map((k, i) => `"${k}" = $${i + 1}`).join(", ");
      const values = [...keys.map((k) => patch[k]), data.id, data.version];
      const idIdx = keys.length + 1;
      const verIdx = keys.length + 2;
      const res = await client.query<Task>(
        `UPDATE public.tasks SET ${setSql}
           WHERE id = $${idIdx} AND version = $${verIdx}
           RETURNING *`,
        values,
      );
      return res.rows[0] ?? null;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return result as any;
  });

export const notifyTaskBlockedFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { taskId: string; reason: string }) =>
    z.object({ taskId: z.string(), reason: z.string() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await withUser(context.userId, async (client) => {
      await client.query(`SELECT public.notify_task_blocked($1, $2)`, [data.taskId, data.reason]);
    });
    return { ok: true };
  });

export const insertAssignmentNotificationFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; taskId: string }) =>
    z.object({ userId: z.string(), taskId: z.string() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    try {
      await withUser(context.userId, async (client) => {
        await client.query(
          `INSERT INTO public.notifications (user_id, type, title, task_id)
             VALUES ($1, 'task_assigned', 'New task assigned to you', $2)`,
          [data.userId, data.taskId],
        );
      });
      return { ok: true };
    } catch (err) {
      console.warn("[tasks] notification insert failed:", (err as Error).message);
      return { ok: false };
    }
  });

export const addTaskCommentHistoryFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { taskId: string; comment: string; status: string }) =>
    z
      .object({ taskId: z.string(), comment: z.string(), status: z.string() })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await withUser(context.userId, async (client) => {
      await client.query(
        `INSERT INTO public.task_history (task_id, old_status, new_status, updated_by, comment)
           VALUES ($1, $2, $2, $3, $4)`,
        [data.taskId, data.status, context.userId, data.comment],
      );
    });
    return { ok: true };
  });

export const deleteTaskFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    await withUser(context.userId, async (client) => {
      await client.query(`DELETE FROM public.tasks WHERE id = $1`, [data.id]);
    });
    return { ok: true };
  });
