import { flushSync } from "react-dom";

/**
 * Cross-tab & local window event bus for instant real-time sync.
 * Works seamlessly in self-hosted mode (without external WSS server)
 * as well as cloud Supabase mode.
 */

const CHANNEL_NAME = "daily-flow-tasks-bus";
const STORAGE_KEY = "daily-flow-task-sync-v1";

let bc: BroadcastChannel | null = null;
if (typeof window !== "undefined" && "BroadcastChannel" in window) {
  try {
    bc = new BroadcastChannel(CHANNEL_NAME);
  } catch {
    bc = null;
  }
}

export function notifyTaskChanged() {
  if (typeof window === "undefined") return;

  console.log(
    "%c[WebSocket Realtime] ⚡ LIVE TASK EVENT BROADCASTED",
    "background: #3b82f6; color: white; padding: 3px 8px; border-radius: 4px; font-weight: bold;",
  );

  // 1. Dispatch custom event for current window
  try {
    window.dispatchEvent(new CustomEvent("daily-flow-task-changed"));
  } catch {}

  // 2. Post to BroadcastChannel for other tabs/windows on same browser
  try {
    bc?.postMessage({ type: "task-changed", timestamp: Date.now() });
  } catch {}

  // 3. Set localStorage to trigger native browser kernel storage event across windows
  try {
    window.localStorage.setItem(STORAGE_KEY, Date.now().toString());
  } catch {}
}

export function subscribeToLocalTaskChanges(onChanged: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  console.log(
    "%c[WebSocket Realtime] 🟢 SUBSCRIBED & LIVE SYNC READY",
    "background: #10b981; color: white; padding: 3px 8px; border-radius: 4px; font-weight: bold;",
  );

  const triggerUpdate = (source: string) => {
    console.log(
      `%c[WebSocket Realtime] ⚡ EVENT RECEIVED (${source})`,
      "background: #ec4899; color: white; padding: 3px 8px; border-radius: 4px; font-weight: bold;",
    );
    try {
      flushSync(() => {
        onChanged();
      });
    } catch {
      onChanged();
    }
  };

  const handleCustomEvent = () => triggerUpdate("Same Window");
  window.addEventListener("daily-flow-task-changed", handleCustomEvent);

  const handleStorageEvent = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      triggerUpdate("Storage Event - Cross Window");
    }
  };
  window.addEventListener("storage", handleStorageEvent);

  let localBc: BroadcastChannel | null = null;
  if ("BroadcastChannel" in window) {
    try {
      localBc = new BroadcastChannel(CHANNEL_NAME);
      localBc.onmessage = (e) => {
        if (e.data?.type === "task-changed") {
          triggerUpdate("BroadcastChannel - Cross Window");
        }
      };
    } catch {
      localBc = null;
    }
  }

  return () => {
    window.removeEventListener("daily-flow-task-changed", handleCustomEvent);
    window.removeEventListener("storage", handleStorageEvent);
    if (localBc) {
      try {
        localBc.close();
      } catch {}
    }
  };
}
