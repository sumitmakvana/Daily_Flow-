import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Run `onChange` when the server reports a change to any of `tables`
 * (Socket.IO events; no polling). Use it for screens whose data comes from a
 * server function or a query rather than a plain table read, e.g. to refetch a
 * React Query when tasks, risks or approvals change.
 *
 * - Events are coalesced by the channel layer (a burst causes a few refetches).
 * - The latest `onChange` is always used without re-subscribing.
 * - On reconnect and when a hidden tab returns, `onChange` runs once so nothing
 *   missed in the meantime stays stale.
 */
export function useRealtimeRefresh(tables: string[], onChange: () => void, channelName: string) {
  const saved = useRef(onChange);
  useEffect(() => {
    saved.current = onChange;
  }, [onChange]);

  const key = tables.join(",");
  useEffect(() => {
    let ch = supabase.channel(channelName);
    for (const table of key.split(",").filter(Boolean)) {
      ch = ch.on("postgres_changes", { event: "*", schema: "public", table }, () => saved.current());
    }
    ch.subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [channelName, key]);
}
