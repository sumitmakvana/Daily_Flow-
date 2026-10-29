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

// Only the worklog columns the UI reads (day, hours, ids) plus updated_at for delta refreshes: the full
// row also carried created_at/started_at/ended_at, about 45% of the worklog bytes.
const WORKLOG_COLS = "id,task_id,user_id,work_date,system_hours,logged_hours,updated_at";
const WITH_WORKLOGS = `*, worklogs:task_worklogs(${WORKLOG_COLS})`;
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

/**
 * Several readers take an optional `cols` list: with it they return those columns only (no worklogs, no
 * `today_system_hours`); without it they return full rows with their worklogs embedded, as before.
 */
const selectFor = (cols?: string) => cols ?? WITH_WORKLOGS;
const orderFor = (q: any, cols?: string) => {
  const ordered = q.order("created_at", { ascending: false });
  return cols ? ordered : ordered.order("work_date", WORKLOG_ORDER);
};
const shapeRows = (data: unknown[] | null, todayStr: string, cols?: string): TaskWithWorklogs[] =>
  cols ? ((data ?? []) as TaskWithWorklogs[]) : withTodayHours(data ?? [], todayStr);

export async function fetchRecentTasks(cutoff: string, todayStr: string, cols?: string): Promise<TaskWithWorklogs[]> {
  const { data, error } = await orderFor((tasksTable() as any).select(selectFor(cols)).or(recentFilter(cutoff)), cols);
  if (error) throw error;
  return shapeRows(data, todayStr, cols);
}

/** Full rows (with worklogs) of completed tasks older than the window; optionally one assignee. */
export async function fetchOlderCompleted(
  cutoff: string,
  todayStr: string,
  assignedTo?: string,
  /** Only rows updated at/after this timestamp (delta refresh of an already-loaded set). */
  since?: string,
  cols?: string,
): Promise<TaskWithWorklogs[]> {
  let q = (tasksTable() as any)
    .select(selectFor(cols))
    .eq("status", "Completed")
    .or(olderCompletedFilter(cutoff));
  if (assignedTo) q = q.eq("assigned_to", assignedTo);
  if (since) q = q.gte("updated_at", since);
  const { data, error } = await orderFor(q, cols);
  if (error) throw error;
  return shapeRows(data, todayStr, cols);
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

/**
 * How many older completed tasks there are, in total and per priority, for everyone and for `userId`.
 * Head-only counts (no rows): replaces downloading an id/assignee/priority stub per older task.
 */
export type OlderCompletedCounts = {
  /** The user the "mine" figures are for ("" when the user was not known yet: then they are 0). */
  forUser: string;
  total: number;
  mine: number;
  byPriority: Record<string, number>;
  mineByPriority: Record<string, number>;
};
export async function fetchOlderCompletedCounts(
  cutoff: string,
  userId: string,
  priorities: readonly string[],
): Promise<OlderCompletedCounts> {
  const count = async (apply?: (q: any) => any) => {
    let q = (tasksTable() as any)
      .select("id", { count: "exact", head: true })
      .eq("status", "Completed")
      .or(olderCompletedFilter(cutoff));
    if (apply) q = apply(q);
    const { count: n, error } = await q;
    if (error) throw error;
    return n ?? 0;
  };
  const none = () => Promise.resolve(0);
  const [total, mine, byP, mineByP] = await Promise.all([
    count(),
    userId ? count((q) => q.eq("assigned_to", userId)) : none(),
    Promise.all(priorities.map((p) => count((q) => q.eq("priority", p)))),
    Promise.all(priorities.map((p) => (userId ? count((q) => q.eq("assigned_to", userId).eq("priority", p)) : none()))),
  ]);
  return {
    forUser: userId,
    total,
    mine,
    byPriority: Object.fromEntries(priorities.map((p, k) => [p, byP[k]])),
    mineByPriority: Object.fromEntries(priorities.map((p, k) => [p, mineByP[k]])),
  };
}

/** Ids of every older completed task (used only while that set is loaded, to prune and to find aged-out rows). */
export async function fetchOlderCompletedIds(cutoff: string): Promise<string[]> {
  const { data, error } = await (tasksTable() as any)
    .select("id")
    .eq("status", "Completed")
    .or(olderCompletedFilter(cutoff));
  if (error) throw error;
  return ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
}

/** Ids of every task in the window (~40 bytes each): detects deletions during a delta refresh. */
export async function fetchRecentTaskIds(cutoff: string): Promise<string[]> {
  const { data, error } = await (tasksTable() as any).select("id").or(recentFilter(cutoff));
  if (error) throw error;
  return ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
}

/** Exact size of the window (head-only request, no rows). */
export async function countRecentTasks(cutoff: string): Promise<number> {
  const { count, error } = await (tasksTable() as any)
    .select("id", { count: "exact", head: true })
    .or(recentFilter(cutoff));
  if (error) throw error;
  return count ?? 0;
}

/**
 * The window after a delta: rows held plus rows changed, checked against the window's exact size. Only when
 * the two disagree (a task was deleted or aged out of the window) are the window's ids read, to prune
 * what left and to read the rows that are in the window but not held.
 */
export async function reconcileRecent<T extends { id: string }>(
  held: T[],
  changed: T[],
  count: number,
  cutoff: string,
  todayStr: string,
  cols?: string,
): Promise<T[]> {
  let next = mergeById<T>(held, changed);
  if (next.length === count) return next;
  const ids = await fetchRecentTaskIds(cutoff);
  const live = new Set(ids);
  next = next.filter((t) => live.has(t.id));
  const have = new Set(next.map((t) => t.id));
  const missing = ids.filter((id) => !have.has(id));
  if (missing.length > 0) next = mergeById<T>(next, (await fetchTasksByIds(missing, todayStr, cols)) as unknown as T[]);
  return next;
}

/** Window rows (with worklogs) updated at/after `since`: the delta of an already-loaded window. */
export async function fetchRecentTasksSince(
  cutoff: string,
  todayStr: string,
  since: string,
  cols?: string,
): Promise<TaskWithWorklogs[]> {
  const { data, error } = await orderFor(
    (tasksTable() as any).select(selectFor(cols)).or(recentFilter(cutoff)).gte("updated_at", since),
    cols,
  );
  if (error) throw error;
  return shapeRows(data, todayStr, cols);
}

/**
 * One tiny request that changes whenever the older-completed set changes: its exact size plus the
 * newest `updated_at` in it (a reassignment or priority edit bumps `updated_at`).
 */
export type OlderCompletedProbe = { count: number; latest: string | null };
export async function probeOlderCompleted(cutoff: string): Promise<OlderCompletedProbe> {
  const { data, count, error } = await (tasksTable() as any)
    .select("updated_at", { count: "exact" })
    .eq("status", "Completed")
    .or(olderCompletedFilter(cutoff))
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  return { count: count ?? 0, latest: (data?.[0]?.updated_at as string | undefined) ?? null };
}

/** `since` for a delta refresh: newest `updated_at` held, minus a small overlap for late commits. */
export function deltaSince(rows: Array<{ updated_at?: string | null }>, overlapMs = 60_000): string | null {
  let max = 0;
  for (const r of rows) {
    const t = r.updated_at ? Date.parse(r.updated_at) : NaN;
    if (!Number.isNaN(t) && t > max) max = t;
  }
  return max ? new Date(max - overlapMs).toISOString() : null;
}

/** Worklogs written at/after `since` (small rows): the delta of worklogs already held. */
export async function fetchWorklogsSince(since: string): Promise<TaskWorklog[]> {
  const { data, error } = await (supabase.from("task_worklogs" as never) as any).select(WORKLOG_COLS).gte("updated_at", since);
  if (error) throw error;
  return (data ?? []) as TaskWorklog[];
}

/**
 * Refresh an already-loaded recent window without re-downloading it: the window's ids (to drop removed
 * tasks), the rows updated since, and the worklogs written since (a worklog change need not touch its task).
 * Falls back to the full load when there is nothing to anchor the delta on.
 */
export async function refreshRecentTasks(
  prev: TaskWithWorklogs[] | undefined,
  cutoff: string,
  todayStr: string,
): Promise<TaskWithWorklogs[]> {
  if (!prev || prev.length === 0) return fetchRecentTasks(cutoff, todayStr);
  const taskSince = deltaSince(prev);
  const logSince = deltaSince(prev.flatMap((t) => t.worklogs ?? []));
  if (!taskSince) return fetchRecentTasks(cutoff, todayStr);
  const sinceLogs = logSince && logSince < taskSince ? logSince : taskSince;

  const [count, changed, logs] = await Promise.all([
    countRecentTasks(cutoff),
    fetchRecentTasksSince(cutoff, todayStr, taskSince),
    fetchWorklogsSince(sinceLogs),
  ]);
  let next = await reconcileRecent<TaskWithWorklogs>(prev, changed, count, cutoff, todayStr);

  // Fold new/updated worklogs into the tasks that hold them.
  if (logs.length > 0) {
    const byTask = new Map<string, TaskWorklog[]>();
    for (const w of logs) byTask.set(w.task_id, [...(byTask.get(w.task_id) ?? []), w]);
    next = next.map((t) => {
      const fresh = byTask.get(t.id);
      if (!fresh) return t;
      const merged = mergeById<TaskWorklog>(t.worklogs ?? [], fresh).sort((a, b) => b.work_date.localeCompare(a.work_date));
      return withTodayHours([{ ...t, worklogs: merged }], todayStr)[0];
    });
  }

  return next;
}

/**
 * Every task row, light columns, for pages whose numbers need all of them (Workload, Command, EOD, Dashboard).
 * The first call, a stale one (FULL_RELOAD_MS) or any doubt reads everything; otherwise only rows updated since
 * the newest one held are read, plus a head-only count that proves nothing was deleted. `cols` must include
 * `id` and `updated_at`. `lastFullAt` is the caller's ref holding when the last full read happened.
 * `apply` narrows every request the same way (a date range, an assignee), so the delta and the count see the same rows.
 */
export const ALL_TASKS_FULL_RELOAD_MS = 5 * 60_000;
export async function loadAllTasksSlim<T extends { id: string; updated_at?: string | null }>(
  cols: string,
  prev: T[] | undefined,
  lastFullAt: { current: number },
  apply: (q: any) => any = (q) => q,
): Promise<T[]> {
  const full = async () => {
    const { data, error } = await apply((tasksTable() as any).select(cols));
    if (error) throw error;
    lastFullAt.current = Date.now();
    return (data ?? []) as T[];
  };
  const since = prev && prev.length > 0 ? deltaSince(prev) : null;
  if (!since || Date.now() - lastFullAt.current > ALL_TASKS_FULL_RELOAD_MS) return full();
  try {
    const [changed, head] = await Promise.all([
      apply((tasksTable() as any).select(cols)).gte("updated_at", since),
      apply((tasksTable() as any).select("id", { count: "exact", head: true })),
    ]);
    if (changed.error || head.error || head.count == null) return full();
    const merged = mergeById<T>(prev!, (changed.data ?? []) as T[]);
    return merged.length === head.count ? merged : full(); // a mismatch means a deletion: read everything
  } catch {
    return full();
  }
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
 * The tasks assigned to `userId` that My Day shows: every open one plus those completed since `cutoff`
 * (the same window as the other pages), with only THOSE tasks' worklogs embedded. Without a cutoff it
 * returns every task of the user. Older completed tasks are only ever counted (`countMyCompleted`).
 */
export async function fetchMyTasksWithWorklogs(
  userId: string,
  todayStr: string,
  cutoff?: string,
): Promise<TaskWithWorklogs[]> {
  let q = (tasksTable() as any).select(WITH_WORKLOGS).eq("assigned_to", userId);
  if (cutoff) q = q.or(recentFilter(cutoff));
  const { data, error } = await q
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("work_date", WORKLOG_ORDER);
  if (error) throw error;
  return withTodayHours(data ?? [], todayStr);
}

/** How many tasks `userId` has completed, ever (head-only request, no rows). */
export async function countMyCompleted(userId: string): Promise<number> {
  const { count, error } = await (tasksTable() as any)
    .select("id", { count: "exact", head: true })
    .eq("assigned_to", userId)
    .eq("status", "Completed");
  if (error) throw error;
  return count ?? 0;
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
export async function fetchTasksByIds(ids: string[], todayStr: string, cols?: string): Promise<TaskWithWorklogs[]> {
  const out: TaskWithWorklogs[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const q = (tasksTable() as any).select(selectFor(cols)).in("id", ids.slice(i, i + 100));
    const { data, error } = await (cols ? q : q.order("work_date", WORKLOG_ORDER));
    if (error) throw error;
    out.push(...shapeRows(data, todayStr, cols));
  }
  return out;
}

/** Merge task lists by id; later lists win (fresher data). */
export function mergeById<T extends { id: string }>(...lists: T[][]): T[] {
  const map = new Map<string, T>();
  for (const list of lists) for (const t of list) map.set(t.id, t);
  return [...map.values()];
}

/**
 * The EOD board window: every open task plus the tasks completed on/after `dayIso` (YYYY-MM-DD). The board's
 * numbers (pending, blockers, hours, "completed today") only ever read those; older completed tasks matter
 * only as a per-member total (see fetchCompletedOutsideWindow).
 */
export const eodWindowFilter = (dayIso: string) => `status.neq.Completed,completed_at.gte.${dayIso}`;

/** Completed tasks per assignee that fall OUTSIDE the EOD window (one tiny `assigned_to` object each, paged). */
export async function fetchCompletedOutsideWindow(dayIso: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const CHUNK = 1000;
  for (let from = 0; ; from += CHUNK) {
    const { data, error } = await (tasksTable() as any)
      .select("assigned_to")
      .eq("status", "Completed")
      .or(`completed_at.lt.${dayIso},completed_at.is.null`)
      .order("id", { ascending: true })
      .range(from, from + CHUNK - 1);
    if (error) throw error;
    const rows = (data ?? []) as Array<{ assigned_to: string | null }>;
    for (const r of rows) if (r.assigned_to) out[r.assigned_to] = (out[r.assigned_to] ?? 0) + 1;
    if (rows.length < CHUNK) return out;
  }
}

// ---- Executive Command Center window -------------------------------------------------------------------
// The page's dashboard only ever shows: open tasks (not Completed / On Hold) and tasks created, due or
// completed inside the selected range, for the selected scope. The server applies the same rules, so the
// page downloads that set instead of every task ever created. The page still re-applies its own filters, so
// these queries only need to return a SUPERSET of what it shows (never fewer rows).

export type ExecScope = { kind: "org" } | { kind: "team"; id: string } | { kind: "manager"; id: string };
export type ExecProfile = { id: string; team_id?: string | null; manager_id?: string | null };

/** The range rule as a PostgREST `or` list. Day-aligned (UTC), so it stays stable all day and never excludes a row the page keeps. */
export function execRangeFilter(range: string, now: Date = new Date()): string {
  const today = now.toISOString().slice(0, 10);
  const open = 'status.not.in.(Completed,"On Hold")';
  if (range === "1") return `${open},completed_at.gte.${today},created_at.gte.${today},due_date.eq.${today}`;
  const days = Number(range) || 7;
  const cutoff = new Date(Date.parse(`${today}T00:00:00Z`) - days * 86400000).toISOString();
  return `${open},created_at.gte.${cutoff},completed_at.gte.${cutoff}`;
}

/** Everyone under `rootId` in the manager tree (including the manager). */
export function managerTreeIds(rootId: string, profiles: ExecProfile[]): string[] {
  const ids = new Set<string>([rootId]);
  let added = true;
  while (added) {
    added = false;
    for (const p of profiles) {
      if (p.manager_id && ids.has(p.manager_id) && !ids.has(p.id)) {
        ids.add(p.id);
        added = true;
      }
    }
  }
  return [...ids];
}

/**
 * Same member/scope rule as the page: an explicit member selection wins over the scope; a team scope keeps the
 * team's members' tasks plus tasks tagged with the team; a manager scope keeps the manager tree's tasks.
 * Returns the narrowing function and a stable key for caching.
 */
export function execScopeQuery(
  scope: ExecScope | null,
  selectedMembers: string[],
  profiles: ExecProfile[],
): { key: string; apply: (q: any) => any } {
  if (selectedMembers.length > 0) {
    const ids = [...selectedMembers].sort();
    return { key: `members:${ids.join(",")}`, apply: (q) => q.in("assigned_to", ids) };
  }
  if (scope?.kind === "team") {
    const ids = profiles.filter((p) => p.team_id === scope.id).map((p) => p.id).sort();
    return {
      key: `team:${scope.id}:${ids.join(",")}`,
      apply: (q) => (ids.length ? q.or(`assigned_to.in.(${ids.join(",")}),team_id.eq.${scope.id}`) : q.eq("team_id", scope.id)),
    };
  }
  if (scope?.kind === "manager") {
    const ids = managerTreeIds(scope.id, profiles).sort();
    return { key: `manager:${scope.id}:${ids.join(",")}`, apply: (q) => q.in("assigned_to", ids) };
  }
  return { key: "org", apply: (q) => q };
}
