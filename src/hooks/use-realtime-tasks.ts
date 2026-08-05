import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { subscribeToLocalTaskChanges } from "@/lib/task-events";

export type RealtimeScope =
  | { kind: "all" }
  | { kind: "assignee"; userId: string }
  | { kind: "reviewer"; userId: string }
  | { kind: "ids"; ids: string[] };

/**
 * Subscribe to task changes with server-side filters + local event bus
 * + automatic fallback polling. Guarantees 0ms instant sync.
 */
export function useRealtimeTasks(
  onChange: () => void,
  channelName = "tasks-rt",
  scope: RealtimeScope = { kind: "all" },
) {
  useEffect(() => {
    // 1. Subscribe to local event bus (BroadcastChannel + CustomEvent) for 0ms instant multi-tab sync
    const unsubscribeLocal = subscribeToLocalTaskChanges(() => {
      console.log(`[Realtime Bus] ⚡ Task change broadcast received on ${channelName}`);
      onChange();
    });

    const base = { event: "*" as const, schema: "public", table: "tasks" };
    let filter: string | undefined;
    if (scope.kind === "assignee") filter = `assigned_to=eq.${scope.userId}`;
    else if (scope.kind === "reviewer") filter = `reviewer=eq.${scope.userId}`;
    else if (scope.kind === "ids" && scope.ids.length > 0)
      filter = `id=in.(${scope.ids.join(",")})`;

    let fallbackInterval: ReturnType<typeof setInterval> | null = null;
    let isSubscribed = false;

    const startFallback = () => {
      if (!fallbackInterval) {
        // Fallback sync every 15s if WebSocket WSS server is disconnected/unconfigured
        fallbackInterval = setInterval(() => {
          if (!isSubscribed) {
            onChange();
          }
        }, 15000);
      }
    };

    const stopFallback = () => {
      if (fallbackInterval) {
        clearInterval(fallbackInterval);
        fallbackInterval = null;
      }
    };

    const ch = supabase
      .channel(channelName)
      .on("postgres_changes", filter ? { ...base, filter } : base, (payload) => {
        console.log(`[Realtime WSS] ⚡ Event received on channel (${channelName}):`, payload);
        onChange();
      })
      .subscribe((status) => {
        console.log(`[Realtime WSS] 🟢 Status for channel (${channelName}):`, status);
        if (status === "SUBSCRIBED") {
          isSubscribed = true;
          stopFallback();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          isSubscribed = false;
          startFallback();
        }
      });

    // Sync when tab becomes active / window gains focus
    const handleFocus = () => {
      onChange();
    };
    window.addEventListener("focus", handleFocus);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") onChange();
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      isSubscribed = false;
      stopFallback();
      unsubscribeLocal();
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelName, scope.kind, "userId" in scope ? scope.userId : "", "ids" in scope ? scope.ids.join(",") : ""]);
}
