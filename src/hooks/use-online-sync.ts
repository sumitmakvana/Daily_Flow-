/**
 * Watches navigator online/offline events and drains the offline queue
 * whenever connectivity is restored or the tab regains focus.
 * Returns a reactive snapshot for UI badges.
 */
import { useEffect, useState, useCallback } from "react";
import { offlineQueue, type QueueOp } from "@/lib/offline-queue";

export function useOnlineSync() {
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [ops, setOps] = useState<QueueOp[]>([]);
  const [lastSync, setLastSync] = useState<number | null>(offlineQueue.lastSyncAt());
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async () => {
    setOps(await offlineQueue.list());
    setLastSync(offlineQueue.lastSyncAt());
  }, []);

  const sync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      await offlineQueue.drain();
    } finally {
      setSyncing(false);
      await refresh();
    }
  }, [syncing, refresh]);

  useEffect(() => {
    refresh();
    const onOnline = () => { setOnline(true); void sync(); };
    const onOffline = () => setOnline(false);
    const onFocus = () => { if (navigator.onLine) void sync(); };
    const onQueue = () => { void refresh(); };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("focus", onFocus);
    window.addEventListener(offlineQueue.EVENT, onQueue);
    // initial drain on mount if online
    if (navigator.onLine) void sync();
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(offlineQueue.EVENT, onQueue);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    online,
    syncing,
    ops,
    pending: ops.filter((o) => o.status !== "failed").length,
    failed: ops.filter((o) => o.status === "failed").length,
    lastSync,
    sync,
    refresh,
  };
}
