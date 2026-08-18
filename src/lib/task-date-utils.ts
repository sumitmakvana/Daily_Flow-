/**
 * Utility functions for consistent date comparisons and task categorization
 * across Dashboard UI and EOD Email Dispatchers.
 */

/**
 * Returns today's date in YYYY-MM-DD format for a given IANA timezone.
 * Defaults to "Asia/Kolkata" (IST) as used in work settings.
 */
export function getTodayDateStr(timeZone: string = "Asia/Kolkata"): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(new Date()); // Outputs YYYY-MM-DD
}

/**
 * Formats an ISO date/timestamp string to YYYY-MM-DD in the specified timezone.
 */
export function formatToDateStr(
  isoStr?: string | null,
  timeZone: string = "Asia/Kolkata",
): string | null {
  if (!isoStr) return null;
  const raw = isoStr.trim();
  if (!raw) return null;

  // If it's a simple YYYY-MM-DD string without time component
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }

  try {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return raw.slice(0, 10);
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return formatter.format(d);
  } catch {
    return raw.slice(0, 10);
  }
}

export interface TaskLike {
  status: string;
  due_date?: string | null;
  completed_at?: string | null;
  updated_at?: string | null;
  assigned_to?: string | null;
}

/**
 * Determines whether a completed task was completed TODAY (or on targetDateStr).
 * Supports fallbacks to updated_at and due_date if completed_at is null.
 */
export function isTaskCompletedToday(task: TaskLike, targetDateStr?: string): boolean {
  if (task.status !== "Completed") return false;

  const today = targetDateStr || getTodayDateStr();
  const utcToday = new Date().toISOString().slice(0, 10);

  let compDate: string | null = null;
  if (task.completed_at) {
    compDate = formatToDateStr(task.completed_at) || task.completed_at.slice(0, 10);
  }

  // If no completed_at date recorded, do not assume it was completed today
  if (!compDate) return false;

  return compDate === today || compDate === utcToday;
}

/**
 * Determines whether an active (non-completed) task is due today or past-due (on user's plate for today).
 */
export function isTaskDueOrActiveToday(task: TaskLike, targetDateStr?: string): boolean {
  if (task.status === "Completed") return false;
  if (!task.due_date) return true; // No due date = always on plate

  const today = targetDateStr || getTodayDateStr();
  const dueDateStr = formatToDateStr(task.due_date) || task.due_date.slice(0, 10);

  return dueDateStr <= today;
}

/**
 * Categorizes a task for today's digest / dashboard.
 */
export type TaskCategory = "completed" | "in_progress" | "blocked" | "pending" | "none";

export function categorizeTaskForToday(task: TaskLike, targetDateStr?: string): TaskCategory {
  const today = targetDateStr || getTodayDateStr();

  if (task.status === "Completed") {
    return isTaskCompletedToday(task, today) ? "completed" : "none";
  }

  if (!isTaskDueOrActiveToday(task, today)) {
    return "none";
  }

  switch (task.status) {
    case "In Progress":
    case "In Review":
      return "in_progress";
    case "Blocked":
    case "On Hold":
      return "blocked";
    case "To Do":
    default:
      return "pending";
  }
}
