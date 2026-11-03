/**
 * Dropdown data for the task form (projects, clients, each person's last client / project, work item
 * types, holidays, leaves), shared by every dialog instance.
 *
 * The form used to read the whole `tasks` table twice every time it opened (once for each person's
 * last client / project, once for the distinct project and client names), and every task card mounts
 * its own form. Now:
 *  - ONE request feeds both lists. The database reduces the newest TASK_HINT_ROWS tasks to one row per
 *    assignee and one row per distinct project / client pair (about 3 kB instead of ~100 kB of rows; see
 *    task-form-hints.functions.ts). If that server function is unavailable, the previous bounded REST read
 *    of the same rows is used instead, so the form never loses its suggestions;
 *  - results are cached per TTL and concurrent opens join the in-flight request;
 *  - failures are not cached, so the next open retries.
 *
 * Reads still go through the normal client, so RLS applies exactly as before.
 */
import { supabase } from "@/integrations/supabase/client";
import { workItemTypesService } from "@/services/work-item-types";
import { holidaysService } from "@/services/operations";
import { leavesService } from "@/services/leaves";
import { auth } from "@/integrations/backend/auth";
import { fetchTaskNameHintsFn } from "@/services/task-form-hints.functions";
import type { HolidayCalendar, Leave, WorkItemType } from "@/lib/types";

/** Newest tasks inspected for "last client / project" hints and project names typed on tasks. */
export const TASK_HINT_ROWS = 1000;
/** Master data (projects, types, holidays) changes rarely. */
export const OPTIONS_TTL_MS = 5 * 60_000;
/** Leaves change when requests are approved, so they are reused for a shorter time. */
export const LEAVES_TTL_MS = 60_000;

type Slot<T> = { at: number; promise: Promise<T> };
const slots = new Map<string, Slot<unknown>>();

// What the form may list depends on who is signed in (RLS): sign-out or another user drops everything.
let authHooked = false;
let knownUserId: string | null | undefined;
function hookAuth() {
  if (authHooked || typeof window === "undefined") return;
  authHooked = true;
  try {
    auth.onAuthStateChange((event, s) => {
      const id = s?.user?.id ?? null;
      if (event === "SIGNED_OUT" || id === null || (knownUserId !== undefined && knownUserId !== id)) slots.clear();
      knownUserId = id;
    });
  } catch {
    /* no auth available (e.g. a test); the TTL still bounds staleness */
  }
}

function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  hookAuth();
  const hit = slots.get(key) as Slot<T> | undefined;
  if (hit && Date.now() - hit.at < ttl) return hit.promise;
  const slot: Slot<T> = { at: Date.now(), promise: load() };
  slots.set(key, slot);
  // A failure is never remembered: the next caller retries.
  slot.promise.catch(() => {
    if (slots.get(key) === slot) slots.delete(key);
  });
  return slot.promise;
}

export type MasterProject = { id: string; name: string; client: string | null };
export type LastTaskInfo = { client: string; project_name: string };
export type TaskNameHints = {
  /** Client / project of each person's newest task. */
  lastByAssignee: Record<string, LastTaskInfo>;
  /** Distinct (project_name, client) pairs found on tasks, newest first. */
  pairs: Array<{ project_name: string; client: string | null }>;
};

export function loadMasterProjects(): Promise<MasterProject[]> {
  return cached("projects", OPTIONS_TTL_MS, async () => {
    const { data, error } = await supabase
      .from("projects")
      .select("id, name, client")
      .order("name", { ascending: true })
      .limit(1000);
    if (error) throw error;
    return (data ?? []) as MasterProject[];
  });
}

export function loadTaskNameHints(): Promise<TaskNameHints> {
  return cached("task-hints", OPTIONS_TTL_MS, async () => {
    // Preferred: already reduced in the database (same window, order and rules as the fallback below).
    try {
      const r = await fetchTaskNameHintsFn({ data: { limit: TASK_HINT_ROWS } });
      if (r && typeof r === "object" && r.lastByAssignee && Array.isArray(r.pairs)) return r as TaskNameHints;
    } catch {
      /* fall through to the REST read */
    }
    const { data, error } = await supabase
      .from("tasks")
      .select("assigned_to, client, project_name")
      .order("created_at", { ascending: false })
      .limit(TASK_HINT_ROWS);
    if (error) throw error;

    const lastByAssignee: Record<string, LastTaskInfo> = {};
    const seen = new Set<string>();
    const pairs: TaskNameHints["pairs"] = [];
    for (const t of (data ?? []) as Array<{ assigned_to: string | null; client: string | null; project_name: string | null }>) {
      if (t.assigned_to && !lastByAssignee[t.assigned_to]) {
        lastByAssignee[t.assigned_to] = { client: t.client || "", project_name: t.project_name || "" };
      }
      if (t.project_name?.trim()) {
        const k = `${t.project_name}\u0000${t.client ?? ""}`;
        if (!seen.has(k)) {
          seen.add(k);
          pairs.push({ project_name: t.project_name, client: t.client });
        }
      }
    }
    return { lastByAssignee, pairs };
  });
}

export const loadWorkItemTypes = (): Promise<WorkItemType[]> =>
  cached("types", OPTIONS_TTL_MS, () => workItemTypesService.list());

export const loadHolidayCalendars = (): Promise<HolidayCalendar[]> =>
  cached("holidays", OPTIONS_TTL_MS, () => holidaysService.list());

export const loadActiveLeaves = (): Promise<Leave[]> =>
  cached("leaves", LEAVES_TTL_MS, async () => (await leavesService.getLeaves()) ?? []);

/** Forget the project / name lists (a project was created or tasks changed which client / project they use). */
export function invalidateTaskFormOptions() {
  slots.delete("projects");
  slots.delete("task-hints");
}

/** Forget everything (tests, sign-out). */
export function resetTaskFormOptions() {
  slots.clear();
}
