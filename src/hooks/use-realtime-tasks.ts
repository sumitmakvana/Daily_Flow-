import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export type RealtimeScope =
  | { kind: "all" }
  | { kind: "assignee"; userId: string }
  | { kind: "reviewer"; userId: string }
  | { kind: "ids"; ids: string[] };

/**
 * Subscribe to task changes with a server-side filter so we don't fan out
 * every task mutation to every connected client. Default is the legacy
 * unfiltered "all" scope; pages should pass an explicit scope.
 */
export function useRealtimeTasks(
  onChange: () => void,
  channelName = "tasks-rt",
  scope: RealtimeScope = { kind: "all" },
) {
  useEffect(() => {
    const base = { event: "*" as const, schema: "public", table: "tasks" };
    let filter: string | undefined;
    if (scope.kind === "assignee") filter = `assigned_to=eq.${scope.userId}`;
    else if (scope.kind === "reviewer") filter = `reviewer=eq.${scope.userId}`;
    else if (scope.kind === "ids" && scope.ids.length > 0)
      filter = `id=in.(${scope.ids.join(",")})`;

    const ch = supabase
      .channel(channelName)
      .on("postgres_changes", filter ? { ...base, filter } : base, () => onChange())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelName, scope.kind, "userId" in scope ? scope.userId : "", "ids" in scope ? scope.ids.join(",") : ""]);
}
