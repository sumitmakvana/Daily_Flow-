/**
 * Pure rules + formatting for the In Review workflow. The database functions
 * (submit_task_for_review / decide_task_review) are the source of truth; these helpers
 * only decide what the UI should offer and mirror the same checks.
 */
import type { ReviewerDecision, Task } from "@/lib/types";

export interface ReviewActor {
  userId: string;
  isManager: boolean;
}

type ReviewTask = Pick<Task, "status" | "assigned_to" | "reviewer">;

/** Why a task cannot be sent for review right now, or null when it can. */
export function submitBlocker(task: ReviewTask, actor: ReviewActor): string | null {
  if (task.assigned_to !== actor.userId && !actor.isManager) {
    return "Only the assignee or a manager can send this task for review";
  }
  if (task.status !== "In Progress") return "Only In Progress tasks can be sent for review";
  if (!task.assigned_to) return "Assign this task to someone before sending it for review";
  if (!task.reviewer) return "Assign a reviewer before sending this task for review";
  if (task.reviewer === task.assigned_to) return "The reviewer cannot be the assignee";
  return null;
}

export function canSubmitForReview(task: ReviewTask, actor: ReviewActor): boolean {
  return submitBlocker(task, actor) === null;
}

/**
 * Can this person record a review decision right now? Never the assignee or whoever submitted
 * the work (self-approval). With the cycle's per-reviewer `decisions`:
 *   - an assigned reviewer can decide while THEIR OWN status is still pending;
 *   - a manager/admin who is not one of the reviewers can decide on behalf of a reviewer who is
 *     still pending.
 * Without `decisions` (not loaded yet) it falls back to the primary reviewer or a manager.
 */
export function canDecideReview(
  task: ReviewTask,
  actor: ReviewActor,
  submittedBy?: string | null,
  decisions?: ReviewerDecision[] | null,
): boolean {
  if (task.status !== "In Review") return false;
  if (actor.userId === task.assigned_to) return false;
  if (submittedBy && actor.userId === submittedBy) return false;
  if (!decisions) return task.reviewer === actor.userId || actor.isManager;
  const mine = myDecision(decisions, actor.userId);
  if (mine) return mine.decision === "pending";
  return actor.isManager && decisions.some((d) => d.decision === "pending");
}

/** The caller's own (non-withdrawn) status in the cycle, if they are one of its reviewers. */
export function myDecision(
  decisions: ReviewerDecision[] | null | undefined,
  userId: string,
): ReviewerDecision | undefined {
  if (!decisions || !userId) return undefined;
  return decisions.find((d) => d.reviewer_id === userId && d.decision !== "withdrawn");
}

/** Reviewers a manager (who is not a reviewer themselves) could decide for: those still pending. */
export function pendingReviewerIds(decisions: ReviewerDecision[] | null | undefined): string[] {
  return (decisions ?? [])
    .filter((d) => d.decision === "pending" && d.reviewer_id)
    .map((d) => d.reviewer_id as string);
}

export interface ReviewerSummary {
  /** Reviewers counted for this cycle (withdrawn ones are ignored). */
  total: number;
  approved: number;
  changesRequested: number;
  pending: number;
  /** Every counted reviewer approved: the only state in which the task is complete. */
  fullyApproved: boolean;
}

/** Roll the per-reviewer statuses up for display. Each reviewer's own row stays the truth. */
export function summarizeReviewers(
  decisions: ReviewerDecision[] | null | undefined,
): ReviewerSummary {
  const active = (decisions ?? []).filter((d) => d.decision !== "withdrawn");
  const approved = active.filter((d) => d.decision === "approved").length;
  const changesRequested = active.filter((d) => d.decision === "changes_requested").length;
  const pending = active.filter((d) => d.decision === "pending").length;
  return {
    total: active.length,
    approved,
    changesRequested,
    pending,
    fullyApproved: active.length > 0 && approved === active.length,
  };
}

/** True when the viewer is the task's reviewer (the "My Reviews" queue). */
export function isMyReview(task: Pick<Task, "status" | "reviewer">, userId: string): boolean {
  return task.status === "In Review" && !!userId && task.reviewer === userId;
}

/** Submission time of the current review; legacy In Review tasks fall back to last update. */
export function reviewSubmittedAt(
  task: Pick<Task, "review_submitted_at" | "updated_at">,
): string | null {
  return task.review_submitted_at ?? task.updated_at ?? null;
}

/** Compact elapsed duration: "<1m", "42m", "3h 20m", "2d 4h". */
export function formatElapsed(
  fromIso: string | null | undefined,
  now: number = Date.now(),
): string {
  if (!fromIso) return "—";
  const ms = now - new Date(fromIso).getTime();
  if (!Number.isFinite(ms)) return "—";
  const mins = Math.floor(Math.max(0, ms) / 60000);
  if (mins < 1) return "<1m";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

/** Elapsed time between two timestamps (used for completed review cycles). */
export function formatBetween(fromIso: string, toIso: string): string {
  return formatElapsed(fromIso, new Date(toIso).getTime());
}

export const REVIEW_AGING_HOURS = 24;

/** A review waiting longer than a day is flagged as aging. */
export function isReviewAging(
  fromIso: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!fromIso) return false;
  return now - new Date(fromIso).getTime() > REVIEW_AGING_HOURS * 3600000;
}

/** Why a task in review can't be approved yet, or null when it can. */
export function approvalBlocker(task: Pick<Task, "actual_hours">): string | null {
  return Number(task.actual_hours ?? 0) > 0
    ? null
    : "Waiting for the assignee to enter their logged hours";
}

/** The assignee may enter/correct today's logged hours while their task is in review. */
export function canLogReviewHours(task: ReviewTask, actor: ReviewActor): boolean {
  return task.status === "In Review" && !!actor.userId && task.assigned_to === actor.userId;
}

export const MAX_TIMER_SESSION_HOURS = 8;

/** Hours a running timer has accrued, capped like the server's single-session cap. */
export function runningTimerHours(
  startedAt: string | null | undefined,
  now: number = Date.now(),
): number {
  if (!startedAt) return 0;
  const ms = now - new Date(startedAt).getTime();
  if (!Number.isFinite(ms)) return 0;
  return Math.min(MAX_TIMER_SESSION_HOURS, Math.max(0, Math.round((ms / 3600000) * 100) / 100));
}

export interface SuggestedHoursInput {
  /** Hours already submitted today for this task (null when there is no submission yet). */
  todaySubmission: number | null;
  /** Timer hours already banked today (worklogs). */
  todaySystemHours: number;
  /** Hours the currently running timer has accrued (not yet banked). */
  runningHours: number;
  /** Total logged hours on the task. */
  totalLogged: number;
  planned: number;
}

/**
 * What to pre-fill in the "hours worked today" box: an existing submission for today wins
 * (so re-opening never invents a new number), then today's tracked time, then the plan for a
 * task with nothing logged yet.
 */
export function suggestLoggedHours(i: SuggestedHoursInput): number {
  if (i.todaySubmission !== null && i.todaySubmission > 0) return i.todaySubmission;
  const tracked = Math.round((i.todaySystemHours + i.runningHours) * 100) / 100;
  if (tracked > 0) return tracked;
  if (i.totalLogged === 0 && i.planned > 0) return i.planned;
  return 0;
}

/** Logged hours from earlier days (everything except today's submission). */
export function previouslyLogged(total: number, todaySubmission: number | null): number {
  return Math.max(0, Math.round((total - (todaySubmission ?? 0)) * 100) / 100);
}

export const MAX_REVIEWERS = 10;

/** Drop duplicates, empty ids and the assignee (who can never review their own task); keep the order. */
export function cleanReviewerList(ids: readonly string[], assigneeId?: string | null): string[] {
  const out: string[] = [];
  for (const id of ids) {
    if (id && id !== assigneeId && !out.includes(id)) out.push(id);
  }
  return out.slice(0, MAX_REVIEWERS);
}

/** "26 Oct, 14:20" */
export function formatReviewTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export interface TimerGap {
  /** timer-tracked minus logged, in hours (positive: the timer ran longer than was logged). */
  hours: number;
  direction: "match" | "timer_ahead" | "logged_ahead" | "unknown";
  /** A gap worth flagging (1.5h or more, the same threshold the hours badge uses). */
  significant: boolean;
  /** Compact signed text: "In line", "+55m", "−1h 10m", or "—" when there is nothing to compare. */
  label: string;
  /** One-sentence explanation for a tooltip. */
  title: string;
}

const hm = (hours: number) => {
  const mins = Math.round(Math.abs(hours) * 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
};

/**
 * How far the automatic timer and the hours the assignee logged are apart. Within 15 minutes is
 * "in line". Both numbers are needed to compare, so a task with nothing logged yet is "unknown".
 */
export function timerGap(
  logged: number | null | undefined,
  tracked: number | null | undefined,
): TimerGap {
  const l = Number(logged ?? 0);
  const t = Number(tracked ?? 0);
  if (!(l > 0) || !(t > 0)) {
    return {
      hours: 0,
      direction: "unknown",
      significant: false,
      label: "—",
      title: l > 0 ? "No timer time was tracked" : "Compared once hours are logged",
    };
  }
  const gap = Math.round((t - l) * 100) / 100;
  if (Math.abs(gap) < 0.25) {
    return {
      hours: gap,
      direction: "match",
      significant: false,
      label: "In line",
      title: "Timer and logged hours agree",
    };
  }
  const significant = Math.abs(gap) >= 1.5;
  return gap > 0
    ? {
        hours: gap,
        direction: "timer_ahead",
        significant,
        label: `+${hm(gap)}`,
        title: `The timer tracked ${hm(gap)} more than was logged`,
      }
    : {
        hours: gap,
        direction: "logged_ahead",
        significant,
        label: `\u2212${hm(gap)}`,
        title: `${hm(gap)} more was logged than the timer tracked`,
      };
}

/** Oldest submission first, so the reviews that have waited longest come first. Does not mutate. */
export function sortByWaiting<T extends Pick<Task, "review_submitted_at" | "updated_at">>(
  tasks: readonly T[],
): T[] {
  const at = (t: T) => new Date(reviewSubmittedAt(t) ?? 0).getTime();
  return [...tasks].sort((a, b) => at(a) - at(b));
}
