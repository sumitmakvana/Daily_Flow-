/**
 * Start a task on behalf of its assignee from a trusted server context (notification action).
 * Mirrors the single-active-task rules of updateTaskFn / the email "start" link, inside one
 * transaction holding a row lock so concurrent taps cannot start the task twice.
 */
import { getPool } from "@/integrations/postgres/client.server";
import { pauseOtherRunningTimers } from "@/lib/task-timer.server";

export type StartTaskResult =
  | "started"
  | "already_in_progress"
  | "completed"
  | "not_eligible"
  | "forbidden"
  | "not_found";

export interface StartTaskOutcome {
  result: StartTaskResult;
  message: string;
  taskId: string;
}

const MESSAGES: Record<StartTaskResult, string> = {
  started: "Task started.",
  already_in_progress: "This task is already in progress.",
  completed: "This task is already completed.",
  not_eligible: "This task can't be started from here. Open Operon to update it.",
  forbidden: "This task is not assigned to you.",
  not_found: "This task no longer exists.",
};

export async function startTaskForUser(
  userId: string,
  taskId: string,
  opts: { source?: string; anyOpenStatus?: boolean } = {},
): Promise<StartTaskOutcome> {
  const done = (result: StartTaskResult): StartTaskOutcome => ({
    result,
    message: MESSAGES[result],
    taskId,
  });

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");

    const taskRes = await client.query<{
      assigned_to: string | null;
      status: string;
      started_at: string | null;
    }>(
      "SELECT assigned_to, status, started_at::text AS started_at FROM public.tasks WHERE id = $1 FOR UPDATE",
      [taskId],
    );
    const task = taskRes.rows[0];
    if (!task) {
      await client.query("ROLLBACK");
      return done("not_found");
    }

    const profileRes = await client.query<{ is_active: boolean | null }>(
      "SELECT is_active FROM public.profiles WHERE id = $1",
      [userId],
    );
    if (task.assigned_to !== userId || profileRes.rows[0]?.is_active === false) {
      await client.query("ROLLBACK");
      return done("forbidden");
    }
    if (task.status === "Completed") {
      await client.query("ROLLBACK");
      return done("completed");
    }
    // "Already running" means the timer is running. An In Progress task whose timer is
    // paused (or carried forward) is resumable.
    if (task.started_at) {
      await client.query("ROLLBACK");
      return done("already_in_progress");
    }
    if (!opts.anyOpenStatus && task.status !== "To Do" && task.status !== "In Progress") {
      await client.query("ROLLBACK");
      return done("not_eligible");
    }

    // Single running timer per user: stop any other running timer (status is kept).
    await pauseOtherRunningTimers(client, {
      userId,
      actorId: userId,
      exceptTaskId: taskId,
      comment: "Timer paused automatically — started new active task",
    });

    await client.query(
      `UPDATE public.tasks
          SET status = 'In Progress', started_at = NOW(),
              version = version + 1, updated_at = NOW(), updated_by = $2
        WHERE id = $1`,
      [taskId, userId],
    );
    await client.query("SAVEPOINT history");
    try {
      await client.query(
        `INSERT INTO public.task_history (task_id, old_status, new_status, updated_by, comment)
         VALUES ($1, $2, 'In Progress', $3, $4)`,
        [taskId, task.status, userId, opts.source ?? "Started from push notification"],
      );
      await client.query("RELEASE SAVEPOINT history");
    } catch (e) {
      await client.query("ROLLBACK TO SAVEPOINT history");
      console.warn("[push-start] history insert failed:", (e as Error).message);
    }

    await client.query("COMMIT");
    return done("started");
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* connection already broken */
    }
    throw e;
  } finally {
    client.release();
  }
}
