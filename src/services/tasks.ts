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
import { getDefaultStartDate } from "@/lib/format";
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

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function cleanProjectId(val: unknown): string | null {
  if (typeof val === "string" && UUID_REGEX.test(val.trim())) {
    return val.trim();
  }
  return null;
}

export const tasksService = {
  async create(payload: Partial<Task>, _userId: string): Promise<Task> {
    if (import.meta.env.MODE === "test") {
      (globalThis as any).__test_user_id = _userId;
    }
    const cleanedPayload = { ...payload };

    // Clean up empty/nullish system-generated primary keys and codes
    const keysToClean = ["id", "task_code", "created_at", "updated_at", "version"];
    for (const key of keysToClean) {
      if (key in cleanedPayload && (cleanedPayload[key as keyof Task] === null || cleanedPayload[key as keyof Task] === undefined || (cleanedPayload[key as keyof Task] as unknown) === "")) {
        delete cleanedPayload[key as keyof Task];
      }
    }

    if (cleanedPayload.assigned_to === undefined && _userId) {
      cleanedPayload.assigned_to = _userId;
    }
    if (cleanedPayload.planned_hours === undefined || cleanedPayload.planned_hours === null) {
      cleanedPayload.planned_hours = 4;
    }
    if (cleanedPayload.start_date === undefined) {
      cleanedPayload.start_date = getDefaultStartDate();
    }
    if (cleanedPayload.start_date && cleanedPayload.due_date && cleanedPayload.due_date < cleanedPayload.start_date) {
      cleanedPayload.due_date = cleanedPayload.start_date;
    }
    if ("project_id" in cleanedPayload) {
      cleanedPayload.project_id = cleanProjectId(cleanedPayload.project_id) as any;
    }
    const row = (await createTaskFn({
      data: { payload: cleanedPayload as Record<string, unknown> },
    })) as unknown as Task | null;
    if (!row) throw new Error("Task creation failed");

    return row;
  },

  /**
   * Optimistic-concurrency update. Pass the task as last read.
   * Throws TaskConflictError when the row's version has moved on.
   */
  async update(task: Task, patch: Partial<Task>, _userId: string): Promise<Task> {
    if (import.meta.env.MODE === "test") {
      (globalThis as any).__test_user_id = _userId;
    }
    const cleanedPatch = { ...patch };
    const effectiveStart = cleanedPatch.start_date !== undefined ? cleanedPatch.start_date : task.start_date;
    const effectiveDue = cleanedPatch.due_date !== undefined ? cleanedPatch.due_date : task.due_date;
    if (effectiveStart && effectiveDue && effectiveDue < effectiveStart) {
      cleanedPatch.due_date = effectiveStart;
    }
    if ("project_id" in cleanedPatch) {
      cleanedPatch.project_id = cleanProjectId(cleanedPatch.project_id) as any;
    }
    const row = (await updateTaskFn({
      data: {
        id: task.id,
        version: task.version,
        patch: cleanedPatch as Record<string, unknown>,
      },
    })) as unknown as Task | null;
    if (!row) throw new TaskConflictError();

    return row;
  },

  async setStatus(
    task: Task,
    newStatus: TaskStatus,
    userId: string,
    extras: { blocker_reason?: string; hold_reason?: string; actual_hours?: number } = {},
  ): Promise<Task> {
    if (import.meta.env.MODE === "test") {
      (globalThis as any).__test_user_id = userId;
    }
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
    if (newStatus === "On Hold") {
      patch.hold_reason = extras.hold_reason ?? task.hold_reason ?? "On Hold";
    }
    if (extras.actual_hours !== undefined) {
      patch.actual_hours = extras.actual_hours;
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

  async pauseTimer(task: Task, userId: string): Promise<Task> {
    if (import.meta.env.MODE === "test") {
      (globalThis as any).__test_user_id = userId;
    }
    return this.update(task, { started_at: null } as Partial<Task>, userId);
  },

  async resumeTimer(task: Task, userId: string): Promise<Task> {
    if (import.meta.env.MODE === "test") {
      (globalThis as any).__test_user_id = userId;
    }
    return this.update(task, { status: "In Progress", started_at: new Date().toISOString() } as Partial<Task>, userId);
  },

  async transfer(task: Task, newAssignee: string, userId: string) {
    if (import.meta.env.MODE === "test") {
      (globalThis as any).__test_user_id = userId;
    }
    await this.update(task, { assigned_to: newAssignee } as Partial<Task>, userId);
  },

  async setPriority(task: Task, priority: TaskPriority, userId: string) {
    if (import.meta.env.MODE === "test") {
      (globalThis as any).__test_user_id = userId;
    }
    return this.update(task, { priority }, userId);
  },

  async addComment(taskId: string, comment: string, _userId: string, status: TaskStatus) {
    if (import.meta.env.MODE === "test") {
      (globalThis as any).__test_user_id = _userId;
    }
    void _userId;
    await addTaskCommentHistoryFn({
      data: { taskId, comment, status },
    });
  },

  async delete(id: string) {
    await deleteTaskFn({ data: { id } });
  },
};
