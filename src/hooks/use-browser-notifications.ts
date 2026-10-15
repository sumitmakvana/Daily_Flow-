import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";

const SOUND_PREF_KEY = "operon_notif_sound_enabled";
const DESKTOP_PREF_KEY = "operon_notif_desktop_enabled";

// Pleasant 2-tone chime using Web Audio API (no external asset download needed)
export function playNotificationChime() {
  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();

    const now = ctx.currentTime;

    // First tone (D5 - 587.33Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(587.33, now);
    gain1.gain.setValueAtTime(0, now);
    gain1.gain.linearRampToValueAtTime(0.18, now + 0.02);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.25);

    // Second harmonic tone (A5 - 880Hz)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(880, now + 0.09);
    gain2.gain.setValueAtTime(0, now + 0.09);
    gain2.gain.linearRampToValueAtTime(0.22, now + 0.11);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.09);
    osc2.stop(now + 0.5);
  } catch {
    // Ignore audio context autoplay limitations or browser restrictions
  }
}

/**
 * Show an in-browser/desktop alert. Reads the sound/desktop preferences from
 * localStorage at call time so a change on the settings page applies right away
 * to every caller (the shared NotificationsProvider included).
 */
export async function showDesktopNotification(
  {
    title,
    body,
    taskId,
    id,
  }: {
    title: string;
    body: string;
    taskId?: string | null;
    id?: string;
  },
  navigate: (to: { to: string; search?: unknown }) => void,
) {
  if (typeof window === "undefined") return;
  const soundEnabled = localStorage.getItem(SOUND_PREF_KEY) !== "false";
  const desktopEnabled = localStorage.getItem(DESKTOP_PREF_KEY) !== "false";

  if (soundEnabled) {
    playNotificationChime();
  }

  if (!desktopEnabled) return;
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  const formattedTitle = title.toLowerCase().includes("operon") ? title : `Operon • ${title}`;

  const options: NotificationOptions = {
    body: body || "You have a new update in Operon.",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: id ? `operon-notif-${id}` : undefined,
    data: {
      taskId,
      url: taskId ? `/tasks?taskId=${taskId}` : "/notifications",
    },
  };

  try {
    // Try ServiceWorker notification first for background durability
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.ready.catch(() => null);
      if (reg && "showNotification" in reg) {
        await reg.showNotification(formattedTitle, options);
        return;
      }
    }

    // Fallback to standard Window Notification
    const notif = new Notification(formattedTitle, options);
    notif.onclick = () => {
      window.focus();
      notif.close();
      if (taskId) {
        navigate({ to: "/tasks", search: { taskId, tab: "all_tasks" } });
      } else {
        navigate({ to: "/notifications" });
      }
    };
  } catch (err) {
    console.warn("Failed to display Operon desktop notification:", err);
  }
}

export function useBrowserNotifications(
  userId?: string | null,
  options?: {
    autoPrompt?: boolean;
  },
) {
  const navigate = useNavigate();
  const [permission, setPermission] = useState<NotificationPermission>(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      return Notification.permission;
    }
    return "default";
  });

  const [soundEnabled, setSoundEnabledState] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const saved = localStorage.getItem(SOUND_PREF_KEY);
    return saved !== null ? saved === "true" : true;
  });

  const [desktopEnabled, setDesktopEnabledState] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const saved = localStorage.getItem(DESKTOP_PREF_KEY);
    return saved !== null ? saved === "true" : true;
  });

  const hasAutoPromptedRef = useRef<boolean>(false);

  // Sync state with Notification.permission if changed
  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      setPermission(Notification.permission);
    }
  }, []);

  const setSoundEnabled = useCallback((enabled: boolean) => {
    setSoundEnabledState(enabled);
    if (typeof window !== "undefined") {
      localStorage.setItem(SOUND_PREF_KEY, String(enabled));
    }
  }, []);

  const setDesktopEnabled = useCallback((enabled: boolean) => {
    setDesktopEnabledState(enabled);
    if (typeof window !== "undefined") {
      localStorage.setItem(DESKTOP_PREF_KEY, String(enabled));
    }
  }, []);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      return false;
    }
    try {
      const res = await Notification.requestPermission();
      setPermission(res);
      return res === "granted";
    } catch {
      return false;
    }
  }, []);

  // Automatic direct browser permission prompt on initial app load
  useEffect(() => {
    if (!userId || hasAutoPromptedRef.current) return;
    if (typeof window === "undefined" || !("Notification" in window)) return;

    if (Notification.permission === "default" && options?.autoPrompt !== false) {
      hasAutoPromptedRef.current = true;
      const timer = setTimeout(() => {
        requestPermission();
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [userId, options?.autoPrompt, requestPermission]);

  const triggerDesktopNotification = useCallback(
    (args: { title: string; body: string; taskId?: string | null; id?: string }) =>
      showDesktopNotification(args, navigate as never),
    [navigate],
  );

  // Send a test notification for instant verification
  const sendTestNotification = useCallback(async () => {
    let perm = permission;
    if (perm !== "granted") {
      const granted = await requestPermission();
      if (!granted) return false;
      perm = "granted";
    }

    await triggerDesktopNotification({
      id: "test-" + Date.now(),
      title: "Task Assigned",
      body: "You have been assigned to 'Review Q3 Operations Roadmap' by Project Lead.",
    });
    return true;
  }, [permission, requestPermission, triggerDesktopNotification]);

  return {
    permission,
    isSupported: typeof window !== "undefined" && "Notification" in window,
    soundEnabled,
    desktopEnabled,
    setSoundEnabled,
    setDesktopEnabled,
    requestPermission,
    sendTestNotification,
    triggerDesktopNotification,
  };
}
