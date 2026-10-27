import type { ReviewDecision, ReviewerDecision, Task, TaskReview, TaskReviewer } from "@/lib/types";
import {
  setTaskReviewersFn,
  listTaskReviewersFn,
  submitForReviewFn,
  logReviewHoursFn,
  decideReviewFn,
  listTaskReviewsFn,
  listReviewQueueFn,
} from "./reviews.functions";

export interface ReviewQueueItem {
  id: string;
  task_code: string;
  task_name: string;
  project_name: string | null;
  priority: string;
  due_date: string | null;
  assigned_to: string | null;
  reviewer: string | null;
  status: string;
  planned_hours: number | null;
  actual_hours: number | null;
  system_hours: number | null;
  review_id: string | null;
  cycle_no: number | null;
  submitted_by: string | null;
  logged_hours_confirmed_at: string | null;
  logged_hours_today: number | null;
  submitted_at: string;
  /** Each reviewer's own status in the open cycle. */
  reviewers: ReviewerDecision[];
  /** The caller's own status in the open cycle (null when they are not a reviewer of it). */
  my_decision: ReviewDecision | null;
}

export interface SubmitForReviewOptions {
  /** The assignee's manual EOD logged hours for today (enter or confirm). */
  loggedHours?: number;
  note?: string;
}

/** In Review workflow: send for review, log hours, approve, request changes, queues, history. */
export const reviewsService = {
  async submit(task: Pick<Task, "id">, opts: SubmitForReviewOptions = {}): Promise<TaskReview> {
    return (await submitForReviewFn({
      data: { taskId: task.id, loggedHours: opts.loggedHours, note: opts.note },
    })) as TaskReview;
  },

  /** Assignee enters/corrects today's logged hours while the task is in review. */
  async logHours(taskId: string, hours: number, note?: string): Promise<TaskReview> {
    return (await logReviewHoursFn({ data: { taskId, hours, note } })) as TaskReview;
  },

  /**
   * Record one reviewer's approval. A reviewer approves for themselves (leave `reviewerId` out);
   * a manager/admin can approve on behalf of a named reviewer. The task completes only when every
   * reviewer of the cycle has approved.
   */
  async approve(taskId: string, feedback?: string, reviewerId?: string): Promise<TaskReview> {
    return (await decideReviewFn({
      data: { taskId, decision: "approved", feedback: feedback?.trim() || undefined, reviewerId },
    })) as TaskReview;
  },

  /** Feedback is mandatory; the database enforces it too. Sends the task back to In Progress. */
  async requestChanges(taskId: string, feedback: string, reviewerId?: string): Promise<TaskReview> {
    const text = feedback.trim();
    if (!text) throw new Error("Feedback is required when requesting changes");
    return (await decideReviewFn({
      data: { taskId, decision: "changes_requested", feedback: text, reviewerId },
    })) as TaskReview;
  },

  /** The reviewers assigned to a task, in order. */
  async listReviewers(taskId: string): Promise<TaskReviewer[]> {
    return (await listTaskReviewersFn({ data: { taskId } })) as TaskReviewer[];
  },

  /** Replace the task's reviewer list (the only way to change it). */
  async setReviewers(taskId: string, reviewerIds: string[]): Promise<TaskReviewer[]> {
    return (await setTaskReviewersFn({ data: { taskId, reviewerIds } })) as TaskReviewer[];
  },

  async listForTask(taskId: string): Promise<TaskReview[]> {
    return (await listTaskReviewsFn({ data: { taskId } })) as TaskReview[];
  },

  async queue(scope: "mine" | "all"): Promise<ReviewQueueItem[]> {
    return (await listReviewQueueFn({ data: { scope } })) as ReviewQueueItem[];
  },
};
