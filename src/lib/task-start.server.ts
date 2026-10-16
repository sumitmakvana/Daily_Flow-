/**
 * Start a task on behalf of its assignee from a trusted server context (notification action).
 * Mirrors the single-active-task rules of updateTaskFn / the email "start" link, inside one
 * transaction holding a row lock so concurrent taps cannot start the task twice.
 */
import { getPool } from "@/integrations/postgres/client.server";

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

export async function startTaskForUser(userId: string, taskId: string): Promise<StartTaskOutcome> {
  const done = (result: StartTaskResult): StartTaskOutcome => ({
    result,
    message: MESSAGES[result],
    taskId,
  });

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");

    const taskRes = await client.query<{ assigned_to: string | null; status: string }>(
      "SELECT assigned_to, status FROM public.tasks WHERE id = $1 FOR UPDATE",
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
    if (task.status === "In Progress") {
      await client.query("ROLLBACK");
      return done("already_in_progress");
    }
    if (task.status !== "To Do") {
      await client.query("ROLLBACK");
      return done("not_eligible");
    }

    // Single active task per user: pause anything else that is running.
    const others = await client.query<{
      id: string;
      started_at: string | null;
      system_hours: number | null;
      status: string;
    }>(
      `SELECT id, started_at::text, system_hours, status FROM public.tasks
        WHERE assigned_to = $1
          AND (status = 'In Progress' OR started_at IS NOT NULL)
          AND status != 'Completed'
          AND id != $2`,
      [userId, taskId],
    );
    for (const other of others.rows) {
      let sysHours = Number(other.system_hours ?? 0);
      if (other.started_at) {
        const startTs = new Date(other.started_at).getTime();
        const elapsed = Math.min(
          8.0,
          Math.max(0, Math.round(((Date.now() - startTs) / 3600000) * 100) / 100),
        );
        sysHours += elapsed;
        if (elapsed > 0) {
          await client.query("SAVEPOINT worklog");
          try {
            await client.query(
              `INSERT INTO public.task_worklogs (task_id, user_id, work_date, system_hours, started_at, ended_at)
               VALUES ($1, $2, CURRENT_DATE, $3, $4, NOW())`,
              [other.id, userId, elapsed, other.started_at],
            );
            await client.query("RELEASE SAVEPOINT worklog");
          } catch (e) {
            await client.query("ROLLBACK TO SAVEPOINT worklog");
            console.warn("[push-start] worklog insert failed:", (e as Error).message);
          }
        }
      }
      await client.query(
        `UPDATE public.tasks
            SET status = 'To Do', started_at = NULL, system_hours = $1,
                version = version + 1, updated_at = NOW(), updated_by = $2
          WHERE id = $3`,
        [sysHours, userId, other.id],
      );
    }

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
         VALUES ($1, 'To Do', 'In Progress', $2, 'Started from push notification')`,
        [taskId, userId],
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
