/**
 * Freshness rules for My Day's two data sources, so the page asks the server only when it must.
 *
 *   ["my-day"]                  the ranked priorities / risks / approvals (server function)
 *   ["my-day-tasks", user, day] my tasks with their worklogs + the all-time completed count
 *
 * Both are cached by React Query. Coming back to My Day reuses them while they are fresh, so a plain
 * navigation costs no request. They are refetched only when
 *   1. a relevant realtime event arrived (while the page is open its own handlers refetch; while it is NOT
 *      open, `useMyDayFreshness` below still hears the event and marks the cache stale WITHOUT fetching,
 *      so the next visit refreshes exactly once), or
 *   2. the data is older than MY_DAY_STALE_MS (safety net if an event was missed), or
 *   3. the user edits something on the page.
 *
 * `useMyDayFreshness` never makes a request: it only flips a flag. The socket already delivers these
 * events to the browser; this just stops ignoring them when My Day is not on screen.
 */
import { useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const MY_DAY_KEY = ["my-day"] as const;
export const MY_DAY_TASKS_KEY = ["my-day-tasks"] as const;

/** Cached My Day data is reused this long without any event. Realtime marks it stale sooner when needed. */
export const MY_DAY_STALE_MS = 2 * 60_000;

/** Mark My Day's cache stale. Inactive queries are not fetched; an open page refetches through its own handlers. */
export function markMyDayStale(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: MY_DAY_KEY, refetchType: "none" });
  void queryClient.invalidateQueries({ queryKey: MY_DAY_TASKS_KEY, refetchType: "none" });
}

/**
 * Hear the changes that can alter My Day for this user, anywhere in the app, and mark the cache stale.
 *  - tasks / worklogs / review decisions: members only receive the ones that concern them (the server routes
 *    by assignee, reviewers and creator), so any event counts. Managers also receive everyone else's, so
 *    their events are narrowed to rows naming them.
 *  - approval requests: routed to requester / approvers / admins, so any event counts.
 *  - risk events: only managers receive them.
 * A catch-up after a reconnect or a long tab absence arrives without a row and also marks the cache stale.
 */
export function useMyDayFreshness(userId: string | undefined, isManager: boolean) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!userId) return;
    const mark = () => markMyDayStale(queryClient);
    let ch = supabase.channel(`my-day-freshness-${userId}`);
    const on = (table: string, filter?: string) => {
      ch = ch.on("postgres_changes", { event: "*", schema: "public", table, ...(filter ? { filter } : {}) }, mark);
    };
    if (isManager) {
      on("tasks", `assigned_to=eq.${userId}`);
      on("tasks", `reviewer=eq.${userId}`);
      on("task_worklogs", `user_id=eq.${userId}`);
      on("task_review_decisions", `reviewer_id=eq.${userId}`);
      on("risk_events");
    } else {
      on("tasks");
      on("task_worklogs");
      on("task_review_decisions");
    }
    on("approval_requests");
    ch.subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [queryClient, userId, isManager]);
}
