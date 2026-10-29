/**
 * Server-side task list: tab scope, filters, text search, sorting, pagination and counts are all applied by
 * the API query (PostgREST), so a page of tasks costs one request of 25–50 rows instead of the whole table.
 *
 * Scope: a user who cannot see everyone's tasks (`canSeeAll` false, i.e. a member) is ALWAYS restricted to
 * `assigned_to = userId`, whatever tab or assignee filter was asked for. NOTE: this is enforced in the query
 * here; the database policy `tasks_read_all` still allows any signed-in user to read every task through the
 * API directly. Enforcing it in the database needs a policy change that has not been applied.
 */
import { supabase } from "@/integrations/supabase/client";
import { TASK_PRIORITIES, TASK_STATUSES, type Task } from "@/lib/types";
import { TASK_LIST_COLS } from "@/lib/task-columns";
import { withTodayHours, type TaskWithWorklogs } from "@/lib/task-window";

export type TaskTab = "my_tasks" | "team_tasks" | "all_tasks";
export type ListScope = { userId: string; canSeeAll: boolean };
export type Person = { id: string; name: string; email: string };
export type ListFilters = {
  statuses: string[];
  priorities: string[];
  /** "__all" or a profile id */
  assignee: string;
  q: string;
  dateFilter: string;
};
export type TaskListParams = {
  scope: ListScope;
  tab: TaskTab;
  filters: ListFilters;
  sortBy: string;
  page: number;
  pageSize: number;
  people: Person[];
};

export const ALL_ASSIGNEES = "__all";
export const MAX_PAGE_SIZE = 50;

/** Full rows of a page; worklogs are embedded for exactly these rows (never for the whole table). */
export const PAGE_SELECT = "*, worklogs:task_worklogs(id,task_id,user_id,work_date,system_hours,logged_hours)";
const WORKLOG_ORDER = { ascending: false, referencedTable: "worklogs" } as const;

const tasksTable = () => supabase.from("tasks") as unknown as { select: (...a: unknown[]) => any };

// ---- pure builders (unit-tested) -----------------------------------------------------------------

/** Characters that would change the meaning of a PostgREST filter or a LIKE pattern are dropped from search terms. */
export function searchTokens(q: string): string[] {
  return q
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[%_,()*"\\]/g, ""))
    .filter(Boolean);
}

const quote = (v: string) => `"${v}"`;

/** One search term: matches the same fields the old in-browser search did, expressed as a PostgREST `or` list. */
export function tokenClause(token: string, people: Person[]): string {
  const parts = ["task_code", "task_name", "client", "project_name", "remarks"].map((c) => `${c}.ilike.*${token}*`);
  const statuses = TASK_STATUSES.filter((s) => s.toLowerCase().includes(token));
  if (statuses.length) parts.push(`status.in.(${statuses.map(quote).join(",")})`);
  const priorities = TASK_PRIORITIES.filter((p) => p.toLowerCase().includes(token));
  if (priorities.length) parts.push(`priority.in.(${priorities.map(quote).join(",")})`);
  const assignees = people.filter((p) => `${p.name} ${p.email}`.toLowerCase().includes(token)).map((p) => p.id);
  if (assignees.length) parts.push(`assigned_to.in.(${assignees.join(",")})`);
  const reviewers = people.filter((p) => p.name.toLowerCase().includes(token)).map((p) => p.id);
  if (reviewers.length) parts.push(`reviewer.in.(${reviewers.join(",")})`);
  return parts.join(",");
}

export type DateWindow = { today: string; tomorrow: string; weekStart: string; weekEnd: string };
export function dateWindow(now: Date = new Date()): DateWindow {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const start = new Date(now);
  start.setDate(now.getDate() - now.getDay() + (now.getDay() === 0 ? -6 : 1));
  const end = new Date(now);
  end.setDate(start.getDate() + 6);
  return { today: iso(now), tomorrow: iso(tomorrow), weekStart: iso(start), weekEnd: iso(end) };
}

/** Restrict to the tab, and for a member always to their own tasks. */
export function applyTab(q: any, tab: TaskTab, scope: ListScope): any {
  if (!scope.canSeeAll) return q.eq("assigned_to", scope.userId);
  if (tab === "my_tasks") return q.eq("assigned_to", scope.userId);
  if (tab === "team_tasks") return q.or(`assigned_to.is.null,assigned_to.neq.${scope.userId}`);
  return q;
}

export function applyFilters(q: any, f: ListFilters, people: Person[], scope: ListScope, win: DateWindow = dateWindow()): any {
  if (f.statuses.length > 0) q = q.in("status", f.statuses);
  if (f.priorities.length > 0) q = q.in("priority", f.priorities);
  if (scope.canSeeAll && f.assignee !== ALL_ASSIGNEES) q = q.eq("assigned_to", f.assignee);
  for (const token of searchTokens(f.q)) q = q.or(tokenClause(token, people));
  const day = (d: string) => `due_date.eq.${d},and(due_date.is.null,start_date.eq.${d})`;
  switch (f.dateFilter) {
    case "today":
      q = q.or(day(win.today));
      break;
    case "tomorrow":
      q = q.or(day(win.tomorrow));
      break;
    case "this_week":
      q = q.or(
        `and(due_date.gte.${win.weekStart},due_date.lte.${win.weekEnd}),and(due_date.is.null,start_date.gte.${win.weekStart},start_date.lte.${win.weekEnd})`,
      );
      break;
    case "overdue":
      q = q.neq("status", "Completed").or(`due_date.lt.${win.today},and(due_date.is.null,start_date.lt.${win.today})`);
      break;
    case "no_due_date":
      q = q.is("due_date", null).is("start_date", null);
      break;
  }
  return q;
}

/** Ordering, with `id` as the final tie-break so pages never overlap or skip rows. */
export function applySort(q: any, sortBy: string): any {
  switch (sortBy) {
    case "oldest":
      q = q.order("created_at", { ascending: true });
      break;
    case "due_soon":
      q = q
        .order("due_date", { ascending: true, nullsFirst: false })
        .order("start_date", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false });
      break;
    case "due_late":
      q = q
        .order("due_date", { ascending: false, nullsFirst: false })
        .order("start_date", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false });
      break;
    default:
      q = q.order("created_at", { ascending: false });
  }
  return q.order("id", { ascending: true });
}

export const pageRange = (page: number, pageSize: number): [number, number] => {
  const size = Math.min(Math.max(1, pageSize), MAX_PAGE_SIZE);
  const from = (Math.max(1, page) - 1) * size;
  return [from, from + size - 1];
};

/** The query of one page, ready to await (exposed so tests and callers can inspect or reuse it). */
export function buildPageQuery(p: TaskListParams, select: string, win?: DateWindow): any {
  let q = tasksTable().select(select, { count: "exact" });
  q = applyTab(q, p.tab, p.scope);
  q = applyFilters(q, p.filters, p.people, p.scope, win);
  q = applySort(q, p.sortBy);
  if (select === PAGE_SELECT) q = q.order("work_date", WORKLOG_ORDER);
  const [from, to] = pageRange(p.page, p.pageSize);
  return q.range(from, to);
}

// ---- requests --------------------------------------------------------------------------------------

export type PageResult = { rows: TaskWithWorklogs[]; total: number };

/** One page of full rows (with their worklogs) and the exact number of matching tasks. */
export async function fetchTaskListPage(p: TaskListParams, todayStr: string): Promise<PageResult> {
  const { data, count, error } = await buildPageQuery(p, PAGE_SELECT);
  if (error) throw error;
  return { rows: withTodayHours(data ?? [], todayStr), total: count ?? 0 };
}

export type PageSignature = { ids: string[]; updatedAt: Record<string, string>; total: number };

/** Ids + updated_at of the same page (~70 bytes a row): tells a realtime refresh which rows actually changed. */
export async function fetchTaskListSignature(p: TaskListParams): Promise<PageSignature> {
  const { data, count, error } = await buildPageQuery(p, "id,updated_at");
  if (error) throw error;
  const rows = (data ?? []) as Array<{ id: string; updated_at: string }>;
  return { ids: rows.map((r) => r.id), updatedAt: Object.fromEntries(rows.map((r) => [r.id, r.updated_at])), total: count ?? 0 };
}

/** Every matching row (light columns) in chunks, for the CSV export. */
export async function fetchAllTaskRows(p: TaskListParams, chunk = 500): Promise<Task[]> {
  const out: Task[] = [];
  for (let page = 1; ; page++) {
    let q = tasksTable().select(TASK_LIST_COLS);
    q = applySort(applyFilters(applyTab(q, p.tab, p.scope), p.filters, p.people, p.scope), p.sortBy);
    const from = (page - 1) * chunk;
    const { data, error } = await q.range(from, from + chunk - 1);
    if (error) throw error;
    out.push(...((data ?? []) as Task[]));
    if (!data || data.length < chunk) return out;
  }
}

// Identical count requests asked for at the same moment (the KPI strip and the tab labels share several) are sent once.
const inflight = new Map<string, Promise<number>>();
const head = (build: (q: any) => any): Promise<number> => {
  const q = build(tasksTable().select("id", { count: "exact", head: true }));
  const key = typeof q?.url?.href === "string" ? (q.url.href as string) : "";
  const hit = key ? inflight.get(key) : undefined;
  if (hit) return hit;
  const p = (async () => {
    const { count, error } = await q;
    if (error) throw error;
    return (count ?? 0) as number;
  })();
  if (key) {
    inflight.set(key, p);
    const clear = () => inflight.delete(key);
    p.then(clear, clear);
  }
  return p;
};

export type SidebarCounts = { status: Record<string, number>; priority: Record<string, number> };
/** Status and priority counters of the active tab (not narrowed by the other filters), as head-only counts. */
export async function fetchSidebarCounts(tab: TaskTab, scope: ListScope): Promise<SidebarCounts> {
  const [statuses, priorities] = await Promise.all([
    Promise.all(TASK_STATUSES.map((s) => head((q) => applyTab(q, tab, scope).eq("status", s)))),
    Promise.all(TASK_PRIORITIES.map((pr) => head((q) => applyTab(q, tab, scope).eq("priority", pr)))),
  ]);
  return {
    status: Object.fromEntries(TASK_STATUSES.map((s, i) => [s, statuses[i]])),
    priority: Object.fromEntries(TASK_PRIORITIES.map((pr, i) => [pr, priorities[i]])),
  };
}

export type TabCounts = { my: number; team: number; all: number };
/** How many tasks match the current filters in each tab (a member only has "my"). */
export async function fetchTabCounts(p: TaskListParams): Promise<TabCounts> {
  const win = dateWindow();
  const count = (tab: TaskTab) => head((q) => applyFilters(applyTab(q, tab, p.scope), p.filters, p.people, p.scope, win));
  if (!p.scope.canSeeAll) {
    const my = await count("my_tasks");
    return { my, team: 0, all: my };
  }
  const [my, team, all] = await Promise.all([count("my_tasks"), count("team_tasks"), count("all_tasks")]);
  return { my, team, all };
}

export type HeaderCounts = { total: number; mine: number; overdue: number };
/** The KPI strip: every task the viewer may see, the viewer's own, and overdue ones. */
export async function fetchHeaderCounts(scope: ListScope): Promise<HeaderCounts> {
  const { today } = dateWindow();
  const [total, mine, overdue] = await Promise.all([
    head((q) => applyTab(q, "all_tasks", scope)),
    head((q) => applyTab(q, "my_tasks", scope)),
    head((q) =>
      applyTab(q, "all_tasks", scope)
        .neq("status", "Completed")
        .or(`due_date.lt.${today},and(due_date.is.null,start_date.lt.${today})`),
    ),
  ]);
  return { total, mine, overdue };
}
