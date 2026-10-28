/**
 * Windowed task loading for pages that used to download the whole `tasks` and
 * `task_worklogs` tables on every refresh.
 *
 * Window = every task that is not Completed + Completed tasks finished within the
 * last RECENT_COMPLETED_DAYS. Older completed tasks are fetched separately, only
 * when a screen needs them (`fetchOlderCompleted`), and counted cheaply
 * (`fetchOlderCompletedSummary`) so counters stay exact without the full rows.
 *
 * Worklogs are embedded in the same request (`worklogs:task_worklogs(*)`), so only
 * the loaded tasks' worklogs travel. Everything is a plain PostgREST read, so RLS
 * applies exactly as it did for the old full-table selects.
 *
 * "Completed date" is `completed_at`, falling back to `updated_at` when it is null
 * (legacy rows), matching how the Team Capacity history groups completed tasks.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Task, TaskWorklog } from "@/lib/types";

export const RECENT_COMPLETED_DAYS = 14;

export type TaskWithWorklogs = Task & {
  worklogs: TaskWorklog[];
  today_system_hours: number;
};

export type OlderCompletedStub = { id: string; assigned_to: string | null; priority: string | null };

/** YYYY-MM-DD (UTC) of `days` ago; used as an inclusive window start. */
export function windowCutoff(days: number = RECENT_COMPLETED_DAYS, now: Date = new Date()): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

/** PostgREST `or` body: everything that is open or completed on/after the cutoff. */
export const recentFilter = (cutoff: string) =>
  `status.neq.Completed,completed_at.gte.${cutoff},and(completed_at.is.null,updated_at.gte.${cutoff})`;

/** Exact complement of `recentFilter` (to be combined with `status=eq.Completed`). */
export const olderCompletedFilter = (cutoff: string) =>
  `completed_at.lt.${cutoff},and(completed_at.is.null,updated_at.lt.${cutoff})`;

const WITH_WORKLOGS = "*, worklogs:task_worklogs(*)";
const WORKLOG_ORDER = { ascending: false, referencedTable: "worklogs" } as const;

/** Attach `today_system_hours` (from the embedded worklogs) like the old client-side join did. */
export function withTodayHours(rows: unknown[], todayStr: string): TaskWithWorklogs[] {
  return (rows as Array<Task & { worklogs?: TaskWorklog[] | null }>).map((t) => {
    const logs = t.worklogs ?? [];
    const todaySys = logs
      .filter((w) => w.work_date === todayStr)
      .reduce((sum, w) => sum + Number(w.system_hours || 0), 0);
    return { ...t, worklogs: logs, today_system_hours: todaySys };
  });
}

// The generated Database types do not model the embedded alias, hence the loose casts.
const tasksTable = () => supabase.from("tasks") as unknown as ReturnType<typeof supabase.from>;

export async function fetchRecentTasks(cutoff: string, todayStr: string): Promise<TaskWithWorklogs[]> {
  const { data, error } = await (tasksTable() as any)
    .select(WITH_WORKLOGS)
    .or(recentFilter(cutoff))
    .order("created_at", { ascending: false })
    .order("work_date", WORKLOG_ORDER);
  if (error) throw error;
  return withTodayHours(data ?? [], todayStr);
}

/** Full rows (with worklogs) of completed tasks older than the window; optionally one assignee. */
export async function fetchOlderCompleted(
  cutoff: string,
  todayStr: string,
  assignedTo?: string,
  /** Only rows updated at/after this timestamp (delta refresh of an already-loaded set). */
  since?: string,
): Promise<TaskWithWorklogs[]> {
  let q = (tasksTable() as any)
    .select(WITH_WORKLOGS)
    .eq("status", "Completed")
    .or(olderCompletedFilter(cutoff));
  if (assignedTo) q = q.eq("assigned_to", assignedTo);
  if (since) q = q.gte("updated_at", since);
  const { data, error } = await q
    .order("created_at", { ascending: false })
    .order("work_date", WORKLOG_ORDER);
  if (error) throw error;
  return withTodayHours(data ?? [], todayStr);
}

/** Tiny rows for older completed tasks: enough to keep every counter exact. */
export async function fetchOlderCompletedSummary(cutoff: string): Promise<OlderCompletedStub[]> {
  const { data, error } = await (tasksTable() as any)
    .select("id,assigned_to,priority")
    .eq("status", "Completed")
    .or(olderCompletedFilter(cutoff));
  if (error) throw error;
  return (data ?? []) as OlderCompletedStub[];
}

/** Exact number of older completed tasks (HEAD request, no body). */
export async function countOlderCompleted(cutoff: string): Promise<number> {
  const { count, error } = await (tasksTable() as any)
    .select("id", { count: "exact", head: true })
    .eq("status", "Completed")
    .or(olderCompletedFilter(cutoff));
  if (error) throw error;
  return count ?? 0;
}

/**
 * Every task assigned to `userId` (any status), with only THOSE tasks' worklogs embedded.
 * Replaces "all my tasks" + "the whole task_worklogs table" on My Day.
 */
export async function fetchMyTasksWithWorklogs(userId: string, todayStr: string): Promise<TaskWithWorklogs[]> {
  const { data, error } = await (tasksTable() as any)
    .select(WITH_WORKLOGS)
    .eq("assigned_to", userId)
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("work_date", WORKLOG_ORDER);
  if (error) throw error;
  return withTodayHours(data ?? [], todayStr);
}

export async function fetchTaskWithWorklogs(id: string, todayStr: string): Promise<TaskWithWorklogs | null> {
  const { data, error } = await (tasksTable() as any)
    .select(WITH_WORKLOGS)
    .eq("id", id)
    .order("work_date", WORKLOG_ORDER)
    .maybeSingle();
  if (error || !data) return null;
  return withTodayHours([data], todayStr)[0];
}

/** Full rows by id, in chunks so the URL stays short. */
export async function fetchTasksByIds(ids: string[], todayStr: string): Promise<TaskWithWorklogs[]> {
  const out: TaskWithWorklogs[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await (tasksTable() as any)
      .select(WITH_WORKLOGS)
      .in("id", ids.slice(i, i + 100))
      .order("work_date", WORKLOG_ORDER);
    if (error) throw error;
    out.push(...withTodayHours(data ?? [], todayStr));
  }
  return out;
}

/** Merge task lists by id; later lists win (fresher data). */
export function mergeById<T extends { id: string }>(...lists: T[][]): T[] {
  const map = new Map<string, T>();
  for (const list of lists) for (const t of list) map.set(t.id, t);
  return [...map.values()];
}
