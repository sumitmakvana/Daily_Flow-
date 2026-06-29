/**
 * Data layer abstraction.
 * Service surface preserved exactly; implementation now goes through
 * TanStack server functions hitting Postgres directly via the pg pool.
 *
 * Notes on integrity:
 * - History is written by the Postgres AFTER trigger `log_task_change`
 *   on `tasks` — never insert status-change rows from the client.
 * - Updates use optimistic concurrency via the `version` column. The
 *   server fn enforces `WHERE id = $1 AND version = $2`; if no row is
 *   updated, a `TaskConflictError` is thrown so callers can re-fetch.
 */
import type { Task, TaskStatus, TaskPriority } from "@/lib/types";
import {
  createTaskFn,
  updateTaskFn,
  deleteTaskFn,
  notifyTaskBlockedFn,
  insertAssignmentNotificationFn,
  addTaskCommentHistoryFn,
} from "./tasks.functions";

export class TaskConflictError extends Error {
  constructor() {
    super("This task was updated by someone else. Reloading latest version.");
    this.name = "TaskConflictError";
  }
}

export const tasksService = {
  async create(payload: Partial<Task>, _userId: string): Promise<Task> {
    void _userId;
    const row = (await createTaskFn({
      data: { payload: payload as Record<string, unknown> },
    })) as unknown as Task | null;
    if (!row) throw new Error("Task creation failed");
    return row;
  },

  /**
   * Optimistic-concurrency update. Pass the task as last read.
   * Throws TaskConflictError when the row's version has moved on.
   */
  async update(task: Task, patch: Partial<Task>, _userId: string): Promise<Task> {
    void _userId;
    const row = (await updateTaskFn({
      data: {
        id: task.id,
        version: task.version,
        patch: patch as Record<string, unknown>,
      },
    })) as unknown as Task | null;
    if (!row) throw new TaskConflictError();
    return row;
  },

  async setStatus(
    task: Task,
    newStatus: TaskStatus,
    userId: string,
    extras: { blocker_reason?: string } = {},
  ): Promise<Task> {
    const patch: Partial<Task> = { status: newStatus };
    if (newStatus === "Completed") {
      patch.done = true;
      patch.completed_at = new Date().toISOString();
    } else {
      patch.done = false;
      patch.completed_at = null;
    }
    if (newStatus === "Blocked") {
      patch.blocker_reason = extras.blocker_reason ?? task.blocker_reason ?? "Blocked";
      patch.blocked_at = new Date().toISOString();
    } else if (task.status === "Blocked") {
      patch.blocked_at = null;
    }
    const updated = await this.update(task, patch, userId);
    if (newStatus === "Blocked" && task.reviewer) {
      await notifyTaskBlockedFn({
        data: {
          taskId: task.id,
          reason: extras.blocker_reason ?? "Task marked as blocked",
        },
      });
    }
    return updated;
  },

  async transfer(task: Task, newAssignee: string, userId: string) {
    await this.update(task, { assigned_to: newAssignee } as Partial<Task>, userId);
    // Best-effort notification — failures logged server-side, don't roll back.
    await insertAssignmentNotificationFn({
      data: { userId: newAssignee, taskId: task.id },
    });
  },

  async setPriority(task: Task, priority: TaskPriority, userId: string) {
    return this.update(task, { priority }, userId);
  },

  async addComment(taskId: string, comment: string, _userId: string, status: TaskStatus) {
    void _userId;
    await addTaskCommentHistoryFn({
      data: { taskId, comment, status },
    });
  },

  async delete(id: string) {
    await deleteTaskFn({ data: { id } });
  },
};
