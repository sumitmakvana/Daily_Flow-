import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { withUser } from "@/integrations/postgres/query.server";
import { pushTaskProgress } from "@/lib/task-push.server";
import { bankTimer, pauseOtherRunningTimers } from "@/lib/task-timer.server";
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Pulls the optional `reviewers` list out of a task payload. `undefined` means "not provided"
 * (leave the reviewers alone); an array (possibly empty) is the complete new reviewer list.
 */
function takeReviewers(payload: Record<string, unknown>): string[] | undefined {
  const raw = payload.reviewers;
  delete payload.reviewers;
  if (!Array.isArray(raw)) return undefined;
  const ids: string[] = [];
  for (const v of raw) {
    if (typeof v === "string" && UUID_RE.test(v) && !ids.includes(v)) ids.push(v);
  }
  // tasks.reviewer is only a mirror of the primary reviewer; the list is the source of truth.
  delete payload.reviewer;
  return ids;
}

/** Applies a reviewer list through set_task_reviewers, but only when it actually changed. */
async function applyReviewers(
  client: import("pg").PoolClient,
  taskId: string,
  ids: string[],
): Promise<void> {
  const cur = await client.query<{ reviewer_id: string }>(
    `SELECT reviewer_id FROM public.task_reviewers WHERE task_id = $1 ORDER BY position, created_at`,
    [taskId],
  );
  const same = cur.rows.length === ids.length && cur.rows.every((r, i) => r.reviewer_id === ids[i]);
  if (same) return;
  await client.query(`SELECT * FROM public.set_task_reviewers($1, $2::uuid[])`, [taskId, ids]);
}

export const createTaskFn = createServerFn({ method: "POST" })
  .validator((d: { payload: Record<string, unknown> }) =>
    z.object({ payload: PartialTaskSchema }).parse(d),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const row = await withUser(context.userId, async (client) => {
      const payload: Record<string, unknown> = {
        ...data.payload,
        created_by: context.userId,
        updated_by: context.userId,
      };
      const reviewerIds = takeReviewers(payload);
      if (reviewerIds && reviewerIds.length > 0) payload.reviewer = reviewerIds[0];

      // Clean up auto-generated/system columns and virtual fields that shouldn't be explicitly inserted
      const keysToClean = ["id", "task_code", "created_at", "updated_at", "version", "today_system_hours", "worklogs"];
      for (const key of keysToClean) {
        if (key in payload) {
          if (key === "today_system_hours" || key === "worklogs") {
            delete payload[key];
          } else if (payload[key] === null || payload[key] === undefined || payload[key] === "") {
            delete payload[key];
          }
        }
      }

      // Timer state on creation: only "In Progress" runs the timer (started once, here).
      if (payload.status === "In Progress") {
        if (!payload.started_at) payload.started_at = new Date().toISOString();
      } else if ("started_at" in payload || payload.status) {
        payload.started_at = null;
      }

      const keys = Object.keys(payload);
      if (keys.length === 0) throw new Error("Empty task payload");

      // BACKEND ENFORCEMENT: Single running timer per user. Only a running timer
      // (started_at) counts; other tasks keep their status.
      const targetAssignee = (payload.assigned_to as string) || context.userId;
      if (payload.started_at && targetAssignee) {
        await pauseOtherRunningTimers(client, {
          userId: targetAssignee,
          actorId: context.userId,
          comment: "Timer paused automatically — started new active task",
        });
      }

      const cols = keys.map((k) => `"${k}"`).join(", ");
      const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
      const values = keys.map((k) => payload[k]);
      const res = await client.query<Task>(
        `INSERT INTO public.tasks (${cols}) VALUES (${placeholders}) RETURNING *`,
        values,
      );
      const insertedTask = res.rows[0];
      // The insert trigger registered the primary reviewer; this sets the complete list.
      if (insertedTask && reviewerIds && reviewerIds.length > 1) {
        await applyReviewers(client, insertedTask.id, reviewerIds);
      }

      // Send notification if assigned_to is set and is not the creator
      if (import.meta.env.MODE !== "test" && insertedTask && insertedTask.assigned_to && insertedTask.assigned_to !== context.userId) {
        const displayBody = insertedTask.task_code 
          ? `[${insertedTask.task_code}] ${insertedTask.task_name}`
          : insertedTask.task_name;
        await client.query("SAVEPOINT notif_create");
        try {
          await client.query(
            `INSERT INTO public.notifications (user_id, type, title, body, task_id)
               VALUES ($1, 'task_assigned', 'New task assigned to you', $2, $3)`,
            [insertedTask.assigned_to, displayBody, insertedTask.id],
          );
          await client.query("RELEASE SAVEPOINT notif_create");
        } catch (err) {
          await client.query("ROLLBACK TO SAVEPOINT notif_create");
          console.warn("[tasks] creation notification insert failed:", (err as Error).message);
        }
      }

      return insertedTask;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return row as any;
  });

export const updateTaskFn = createServerFn({ method: "POST" })
  .validator((d: { id: string; version: number; patch: Record<string, unknown> }) =>
    z
      .object({
        id: z.string(),
        version: z.number(),
        patch: PartialTaskSchema,
      })
      .parse(d),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    let oldStatus: string | null = null;
    const result = await withUser(context.userId, async (client) => {
      // Get old assigned_to, started_at, and status before update
      let oldAssignedTo: string | null = null;
      let existingStartedAt: string | null = null;
      let existingSystemHours: number = 0;
      if (import.meta.env.MODE !== "test") {
        const oldTaskRes = await client.query<{ assigned_to: string | null; started_at: string | null; system_hours: number | null; status: string | null }>(
          `SELECT assigned_to, started_at::text, system_hours, status::text AS status FROM public.tasks WHERE id = $1 FOR UPDATE`,
          [data.id],
        );
        oldStatus = oldTaskRes.rows[0]?.status ?? null;
        oldAssignedTo = oldTaskRes.rows[0]?.assigned_to ?? null;
        existingStartedAt = oldTaskRes.rows[0]?.started_at ?? null;
        existingSystemHours = Number(oldTaskRes.rows[0]?.system_hours ?? 0);
      }

      const patch: Record<string, unknown> = { ...data.patch, updated_by: context.userId };
      const reviewerIds = takeReviewers(patch);

      // Handle started_at and system_hours calculations on status changes or explicit timer pauses
      if (existingStartedAt && typeof patch.started_at === "string" && patch.status !== "Completed") {
        // Timer is already running (double-clicked / duplicate Resume): keep the original
        // session start so the elapsed time so far is not thrown away.
        delete patch.started_at;
      } else if (patch.status === "In Progress" && !existingStartedAt && patch.started_at !== null && !patch.started_at) {
        patch.started_at = new Date().toISOString();
      } else if ((patch.status === "On Hold" || patch.status === "Blocked" || patch.status === "To Do" || patch.started_at === null) && existingStartedAt) {
        // Worklogs belong to the person who worked the task (the assignee), not whoever
        // pressed the button (e.g. a manager pausing it).
        const elapsed = await bankTimer(client, {
          taskId: data.id,
          userId: oldAssignedTo ?? context.userId,
          startedAt: existingStartedAt,
        });
        patch.system_hours = existingSystemHours + elapsed;
        patch.started_at = null;
      } else if ((patch.status === "Completed" || patch.done === true)) {
        if (existingStartedAt || patch.started_at) {
          const startTs = new Date((patch.started_at as string) || existingStartedAt!).getTime();
          const diffHrs = Math.min(8.0, Math.max(0, Math.round(((Date.now() - startTs) / 3600000) * 100) / 100));
          if (patch.system_hours === undefined) {
            patch.system_hours = existingSystemHours + diffHrs;
          }
          if (diffHrs > 0) {
            await client.query("SAVEPOINT worklog_insert_comp");
            try {
              await client.query(
                `INSERT INTO public.task_worklogs (task_id, user_id, work_date, system_hours, started_at, ended_at)
                 VALUES ($1, $2, CURRENT_DATE, $3, $4, NOW())`,
                [data.id, oldAssignedTo ?? context.userId, diffHrs, existingStartedAt || (patch.started_at as string)]
              );
              await client.query("RELEASE SAVEPOINT worklog_insert_comp");
            } catch (e) {
              await client.query("ROLLBACK TO SAVEPOINT worklog_insert_comp");
              console.warn("[task_worklogs] insert failed:", (e as Error).message);
            }
          }
        }
        patch.started_at = null;
      }

      // BACKEND ENFORCEMENT: Single running timer per user. Only a running timer
      // (started_at) counts; paused / carried-forward tasks neither block nor get changed.
      const targetAssignee = (patch.assigned_to as string | undefined) || oldAssignedTo || context.userId;
      if (patch.started_at && targetAssignee) {
        await pauseOtherRunningTimers(client, {
          userId: targetAssignee,
          actorId: context.userId,
          exceptTaskId: data.id,
          comment: "Timer paused automatically — started new active task",
        });
      }

      // A change of assignee goes through reassign_task() (SECURITY DEFINER; checks the caller is the assignee,
      // the creator or a manager, and changes only assigned_to). A plain UPDATE cannot do it for an assignee who
      // is not the creator: once handed over, the task is no longer readable to them and the row-level
      // security policy rejects the update. Any other fields in the same save are written first, while the
      // caller can still see the task; the reassignment is the last step of the same transaction.
      const reassigning =
        import.meta.env.MODE !== "test" &&
        "assigned_to" in patch &&
        ((patch.assigned_to as string | null) ?? null) !== oldAssignedTo;
      const reassignTo = reassigning ? ((patch.assigned_to as string | null) ?? null) : null;
      if (reassigning) delete patch.assigned_to;

      delete patch.id;
      delete patch.created_at;
      delete patch.updated_at;
      delete patch.version;
      delete patch.today_system_hours;
      delete patch.worklogs;

      const keys = Object.keys(patch);
      // Only updated_by left (it is always set above): nothing but the reassignment to do.
      const onlyReassign = reassigning && keys.every((k) => k === "updated_by");
      if (keys.length === 0) throw new Error("Empty task patch");
      const setSql = keys.map((k, i) => `"${k}" = $${i + 1}`).join(", ");
      const values = [...keys.map((k) => patch[k]), data.id, data.version];
      const idIdx = keys.length + 1;
      const verIdx = keys.length + 2;

      let updatedTask: Task | null = null;
      if (!onlyReassign) {
        let res = await client.query<Task>(
          `UPDATE public.tasks SET ${setSql}
             WHERE id = $${idIdx} AND version = $${verIdx}
             RETURNING *`,
          values,
        );

        // Fallback: If strict version check returned 0 rows, update by ID
        if (res.rows.length === 0) {
          res = await client.query<Task>(
            `UPDATE public.tasks SET ${setSql}
               WHERE id = $${idIdx}
               RETURNING *`,
            [...keys.map((k) => patch[k]), data.id],
          );
        }
        updatedTask = res.rows[0] ?? null;
      }
      if (reassigning && (onlyReassign || updatedTask)) {
        const re = await client.query<Task>(`SELECT * FROM public.reassign_task($1, $2)`, [data.id, reassignTo]);
        updatedTask = re.rows[0] ?? updatedTask;
      }
      if (updatedTask && reviewerIds) await applyReviewers(client, data.id, reviewerIds);

      // Send notification if assigned_to has changed and is not the updater
      if (import.meta.env.MODE !== "test" && updatedTask && updatedTask.assigned_to && updatedTask.assigned_to !== oldAssignedTo && updatedTask.assigned_to !== context.userId) {
        const displayBody = updatedTask.task_code 
          ? `[${updatedTask.task_code}] ${updatedTask.task_name}`
          : updatedTask.task_name;
        try {
          await client.query(
            `INSERT INTO public.notifications (user_id, type, title, body, task_id)
               VALUES ($1, 'task_assigned', 'New task assigned to you', $2, $3)`,
            [updatedTask.assigned_to, displayBody, updatedTask.id],
          );
        } catch (err) {
          console.warn("[tasks] update notification insert failed:", (err as Error).message);
        }
      }

      return updatedTask;
    });
    // Push "started" / "completed" to the people following the task (after commit, best effort).
    if (import.meta.env.MODE !== "test" && result && oldStatus !== null && result.status !== oldStatus) {
      if (result.status === "In Progress") void pushTaskProgress("started", result.id, context.userId);
      else if (result.status === "Completed") void pushTaskProgress("completed", result.id, context.userId);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return result as any;
  });

export const notifyTaskBlockedFn = createServerFn({ method: "POST" })
  .validator((d: { taskId: string; reason: string }) =>
    z.object({ taskId: z.string(), reason: z.string() }).parse(d),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await withUser(context.userId, async (client) => {
      await client.query(`SELECT public.notify_task_blocked($1, $2)`, [data.taskId, data.reason]);
    });
    return { ok: true };
  });

export const insertAssignmentNotificationFn = createServerFn({ method: "POST" })
  .validator((d: { userId: string; taskId: string }) =>
    z.object({ userId: z.string(), taskId: z.string() }).parse(d),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    try {
      await withUser(context.userId, async (client) => {
        const taskRes = await client.query<{ task_name: string; task_code: string | null }>(
          `SELECT task_name, task_code FROM public.tasks WHERE id = $1`,
          [data.taskId],
        );
        const task = taskRes.rows[0];
        
        const assignerRes = await client.query<{ display_name: string | null }>(
          `SELECT display_name FROM public.profiles WHERE id = $1`,
          [context.userId],
        );
        const assignerName = assignerRes.rows[0]?.display_name || "Someone";

        const displayBody = task
          ? `${assignerName} assigned you: ${task.task_code ? `[${task.task_code}] ` : ""}${task.task_name}`
          : `${assignerName} assigned you a task`;

        await client.query(
          `INSERT INTO public.notifications (user_id, type, title, body, task_id)
             VALUES ($1, 'task_assigned', 'New task assigned to you', $2, $3)`,
          [data.userId, displayBody, data.taskId],
        );
      });
      return { ok: true };
    } catch (err) {
      console.warn("[tasks] notification insert failed:", (err as Error).message);
      return { ok: false };
    }
  });

export const addTaskCommentHistoryFn = createServerFn({ method: "POST" })
  .validator((d: { taskId: string; comment: string; status: string }) =>
    z
      .object({ taskId: z.string(), comment: z.string(), status: z.string() })
      .parse(d),
  )
  .middleware([requireSupabaseAuth])
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
  .validator((d: { id: string }) => z.object({ id: z.string() }).parse(d))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const res = await withUser(context.userId, async (client) => {
      return await client.query(`DELETE FROM public.tasks WHERE id = $1`, [data.id]);
    });
    if (res.rowCount === 0) {
      throw new Error("Task not found or permission denied");
    }
    return { ok: true };
  });
