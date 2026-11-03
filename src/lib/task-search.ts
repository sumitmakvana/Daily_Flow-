/**
 * Server-side reads for the global search (Ctrl K / search button).
 *
 * The modal used to read `tasks?select=*&order=updated_at.desc&limit=100` (~110 kB, every column and
 * the full remarks text) every time it opened, then filtered, counted and paged those 100 rows in the
 * browser. Now the database does the work and the browser receives only what is on screen:
 *
 *  - `searchTaskPage`   ONE page (the 6 rows shown) with the short columns the list renders, plus the
 *                       exact total for the pager (same request, `count=exact`);
 *  - `searchTaskCounts` the tab counters from one status-only read (exact `count` for the total;
 *                       per-status head counts only when more than STATUS_SAMPLE rows match);
 *  - full rows (remarks, custom fields, worklogs) load only for the task the user opens.
 *
 * Search semantics are unchanged: the first word must appear in the code, name, project, client or
 * remarks; every further word must appear in those or in the status / priority. A member only sees
 * their own tasks (`scopeUserId`), exactly like before; RLS applies as always.
 *
 * Identical requests that are in flight, or finished a moment ago, are shared (opening the modal twice
 * in a row, React strict mode, or a tab / page change that lands on the same request costs nothing).
 */
import { supabase } from "@/integrations/supabase/client";
import { TASK_PRIORITIES, TASK_STATUSES, type Profile, type Task } from "@/lib/types";

export type SearchTab = "all" | "in_progress" | "pending" | "completed" | "in_review";

/** What the list and its Prefill AI prompt read (6 rows per request). The detail view loads the full row on demand. */
export const TASK_SEARCH_COLS = "id,task_code,task_name,project_name,client,remarks,status,priority,assigned_to";

/** Rows of the status-only read behind the tab counters. */
export const STATUS_SAMPLE = 1000;

/** A finished identical request is reused this long. */
export const SEARCH_REUSE_MS = 5_000;

export type SearchScope = { userId: string; canSeeAll: boolean };

export type TaskSearchRow = Pick<Task, "id" | "task_code" | "task_name" | "project_name" | "client" | "remarks" | "status" | "priority" | "assigned_to">;

export type TabCounts = { all: number; in_progress: number; pending: number; completed: number; in_review: number };

const TEXT_FIELDS = ["task_code", "task_name", "project_name", "client", "remarks"] as const;

/** PostgREST `or(...)` breaks on these characters inside a value. */
const cleanToken = (t: string) => t.replace(/[,()"\\*]/g, "").trim();

function tokensOf(query: string): string[] {
  return query.toLowerCase().split(/\s+/).map(cleanToken).filter(Boolean);
}

function textOr(token: string): string {
  return TEXT_FIELDS.map((f) => `${f}.ilike.%${token}%`).join(",");
}

/** First word: the text columns only (as before). Further words: text columns, or a status / priority containing it. */
function wordOr(token: string): string {
  const parts = [textOr(token)];
  const statuses = TASK_STATUSES.filter((s) => s.toLowerCase().includes(token));
  if (statuses.length) parts.push(`status.in.(${statuses.map((s) => `"${s}"`).join(",")})`);
  const priorities = TASK_PRIORITIES.filter((p) => p.toLowerCase().includes(token));
  if (priorities.length) parts.push(`priority.in.(${priorities.map((p) => `"${p}"`).join(",")})`);
  return parts.join(",");
}

/** Applies scope + search words to a tasks query. */
function applyMatch(q: any, scope: SearchScope, query: string) {
  if (!scope.canSeeAll) q = q.eq("assigned_to", scope.userId || "00000000-0000-0000-0000-000000000000"); // fail closed
  const tokens = tokensOf(query);
  tokens.forEach((t, i) => {
    q = q.or(i === 0 ? textOr(t) : wordOr(t));
  });
  return q;
}

function applyTab(q: any, tab: SearchTab) {
  if (tab === "in_progress") return q.eq("status", "In Progress");
  // The old UI also accepted a "Pending" status, which does not exist: "To Do" is the pending state.
  if (tab === "pending") return q.eq("status", "To Do");
  if (tab === "completed") return q.eq("status", "Completed");
  if (tab === "in_review") return q.eq("status", "In Review");
  return q;
}

type Slot<T> = { at: number; promise: Promise<T> };
const slots = new Map<string, Slot<unknown>>();

function shared<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = slots.get(key) as Slot<T> | undefined;
  if (hit && Date.now() - hit.at < SEARCH_REUSE_MS) return hit.promise;
  const slot: Slot<T> = { at: Date.now(), promise: load() };
  slots.set(key, slot);
  slot.promise.catch(() => {
    if (slots.get(key) === slot) slots.delete(key);
  });
  // Keep the map small.
  if (slots.size > 40) slots.delete(slots.keys().next().value as string);
  return slot.promise;
}

/** Forget shared results (after a task changed through the modal, sign-out, tests). */
export function resetTaskSearch() {
  slots.clear();
}

const scopeKey = (s: SearchScope) => `${s.userId}:${s.canSeeAll ? "all" : "own"}`;

export async function searchTaskPage(args: {
  scope: SearchScope;
  query: string;
  tab: SearchTab;
  page: number;
  pageSize: number;
}): Promise<{ rows: TaskSearchRow[]; total: number }> {
  const { scope, query, tab, page, pageSize } = args;
  const key = `page|${scopeKey(scope)}|${tokensOf(query).join(" ")}|${tab}|${page}|${pageSize}`;
  return shared(key, async () => {
    const from = (page - 1) * pageSize;
    let q = supabase.from("tasks").select(TASK_SEARCH_COLS, { count: "exact" });
    q = applyTab(applyMatch(q, scope, query), tab);
    const { data, error, count } = await (q as any)
      // id breaks ties so a page never repeats or skips a row when several tasks share a timestamp
      .order("updated_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    return { rows: (data ?? []) as TaskSearchRow[], total: count ?? (data ?? []).length };
  });
}

export async function searchTaskCounts(scope: SearchScope, query: string): Promise<TabCounts> {
  const key = `counts|${scopeKey(scope)}|${tokensOf(query).join(" ")}`;
  return shared(key, async () => {
    const q = applyMatch(supabase.from("tasks").select("status", { count: "exact" }), scope, query);
    const { data, error, count } = await (q as any).limit(STATUS_SAMPLE);
    if (error) throw error;
    const rows = (data ?? []) as Array<{ status: string }>;
    const total = count ?? rows.length;

    if (total <= rows.length) {
      const n = (s: string) => rows.filter((r) => r.status === s).length;
      return { all: total, in_progress: n("In Progress"), pending: n("To Do"), completed: n("Completed"), in_review: n("In Review") };
    }
    // More matches than the sample: exact head counts instead of an undercount.
    const head = async (tab: SearchTab) => {
      const r = await (applyTab(applyMatch(supabase.from("tasks").select("id", { count: "exact", head: true }), scope, query), tab) as any);
      if (r.error) throw r.error;
      return (r.count ?? 0) as number;
    };
    const [in_progress, pending, completed, in_review] = await Promise.all([
      head("in_progress"),
      head("pending"),
      head("completed"),
      head("in_review"),
    ]);
    return { all: total, in_progress, pending, completed, in_review };
  });
}

/** Full row of one task (every column), read only when the user opens it or asks for the AI prompt. */
export async function fetchFullTask(id: string): Promise<Task | null> {
  const { data, error } = await supabase.from("tasks").select("*").eq("id", id).maybeSingle();
  if (error || !data) return null;
  return data as Task;
}

/** People matching the typed words (name / email), at most 20, filtered by every word like the task search. */
export async function searchMembers(query: string): Promise<Profile[]> {
  const tokens = tokensOf(query);
  const primary = tokens[0];
  if (!primary) return [];
  const key = `members|${tokens.join(" ")}`;
  return shared(key, async () => {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, display_name, email, avatar_url, team_id, manager_id")
      .or(`display_name.ilike.%${primary}%,email.ilike.%${primary}%`)
      .limit(20);
    if (error) throw error;
    return ((data ?? []) as Profile[]).filter((m) => {
      const combined = `${m.display_name || ""} ${m.email || ""}`.toLowerCase();
      return tokens.every((t) => combined.includes(t));
    });
  });
}
