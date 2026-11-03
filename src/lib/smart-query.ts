/**
 * Smart caching + realtime refresh for the pages that are kept fresh by Socket.IO (Team Capacity, Executive).
 *
 * Opt-in per query: nothing here changes the app-wide QueryClient defaults, so every other page keeps its
 * current behaviour (My Day, for one, still refetches on focus on purpose).
 *
 * Why these pages need it: React Query refetches every stale query when the tab becomes visible. Both pages
 * already receive task / leave / worklog changes over the socket, and the channel layer re-runs their
 * subscribers after a reconnect or a tab absence (use-realtime-refresh), so a focus refetch only re-downloads
 * data that is unchanged, and when something DID change it races the realtime refetch (invalidateQueries
 * cancels the one in flight and starts another, so the server answers both).
 *
 *  - `realtimeCovered`  data pushed by realtime events: no refetch on focus/reconnect. `staleTime` stays short
 *                       so a remount after a long time away (the page was unsubscribed meanwhile) still reloads.
 *  - `slowChanging`     people, roles, teams, projects: long `staleTime`, no focus/reconnect refetch.
 *  - `useRefreshScheduler`  realtime callbacks call `schedule(key, delay)`: a burst of events, or a local
 *                       action plus its realtime echo, becomes ONE refetch, run after the last of them (so the
 *                       newest change is always included).
 */
import { useEffect, useMemo, useRef } from "react";
import type { QueryClient, QueryKey } from "@tanstack/react-query";

/** How long people / roles / teams / projects are reused (same order as the shared people cache). */
export const SLOW_DATA_STALE_MS = 5 * 60_000;
/** A remount inside this window reuses realtime-covered data; later it reloads (it may have missed events). */
export const REALTIME_STALE_MS = 30_000;

export const realtimeCovered = (staleTime: number = REALTIME_STALE_MS) =>
  ({ staleTime, refetchOnWindowFocus: false, refetchOnReconnect: false }) as const;

export const slowChanging = (staleTime: number = SLOW_DATA_STALE_MS) =>
  ({ staleTime, refetchOnWindowFocus: false, refetchOnReconnect: false }) as const;

export type RefreshScheduler = {
  /** Refetch the ACTIVE queries under `key` once, `delayMs` after the last call for that key. */
  schedule: (key: QueryKey, delayMs?: number) => void;
  /** Drop everything pending (unmount). */
  cancel: () => void;
};

export function createRefreshScheduler(queryClient: QueryClient, defaultDelayMs = 300): RefreshScheduler {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  return {
    schedule(key, delayMs = defaultDelayMs) {
      const id = JSON.stringify(key);
      const t = timers.get(id);
      if (t) clearTimeout(t);
      timers.set(
        id,
        setTimeout(() => {
          timers.delete(id);
          // Inactive queries (e.g. a closed drawer) are only marked stale; they load when opened.
          void queryClient.invalidateQueries({ queryKey: key });
        }, delayMs),
      );
    },
    cancel() {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    },
  };
}

/** One scheduler per page instance, cancelled on unmount. */
export function useRefreshScheduler(queryClient: QueryClient, defaultDelayMs = 300): RefreshScheduler {
  const scheduler = useMemo(() => createRefreshScheduler(queryClient, defaultDelayMs), [queryClient, defaultDelayMs]);
  const ref = useRef(scheduler);
  ref.current = scheduler;
  useEffect(() => () => ref.current.cancel(), [scheduler]);
  return scheduler;
}
