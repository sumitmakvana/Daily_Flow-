import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { AppNotification } from "@/lib/types";

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

export function useBrowserNotifications(
  userId?: string | null,
  options?: {
    onUnreadChange?: (count: number) => void;
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

  const lastSeenTimeRef = useRef<number>(Date.now());
  const knownIdsRef = useRef<Set<string>>(new Set());
  const isInitializedRef = useRef<boolean>(false);
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
    async ({
      title,
      body,
      taskId,
      id,
    }: {
      title: string;
      body: string;
      taskId?: string | null;
      id?: string;
    }) => {
      if (soundEnabled) {
        playNotificationChime();
      }

      if (!desktopEnabled) return;
      if (typeof window === "undefined" || !("Notification" in window)) return;
      if (Notification.permission !== "granted") return;

      const formattedTitle = title.toLowerCase().includes("operon")
        ? title
        : `Operon • ${title}`;

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
            navigate({ to: "/tasks", search: { taskId, tab: "all_tasks" } as never });
          } else {
            navigate({ to: "/notifications" });
          }
        };
      } catch (err) {
        console.warn("Failed to display Operon desktop notification:", err);
      }
    },
    [desktopEnabled, soundEnabled, navigate],
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

  // Realtime & Polling synchronization for notifications table
  useEffect(() => {
    if (!userId) return;

    // 1. Initial snapshot load to track existing notifications so we don't alert on old ones
    const initializeKnownNotifications = async () => {
      try {
        const { data } = await supabase
          .from("notifications")
          .select("id, title, body, read_at, created_at, task_id")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(50);

        if (data) {
          const unreadCount = data.filter((n) => !n.read_at).length;
          options?.onUnreadChange?.(unreadCount);

          data.forEach((item) => {
            if (item.id) knownIdsRef.current.add(item.id);
          });
          if (data.length > 0 && data[0]?.created_at) {
            lastSeenTimeRef.current = new Date(data[0].created_at).getTime();
          }
        }
      } catch (err) {
        console.warn("Failed to initialize notification baseline:", err);
      } finally {
        isInitializedRef.current = true;
      }
    };

    initializeKnownNotifications();

    // 2. Poll / check for new notifications for this user
    const checkNewNotifications = async () => {
      if (!isInitializedRef.current) return;
      try {
        const { data } = await supabase
          .from("notifications")
          .select("*")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(20);

        if (!data || data.length === 0) return;

        const unreadCount = (data as AppNotification[]).filter((n) => !n.read_at).length;
        options?.onUnreadChange?.(unreadCount);

        const newItems: AppNotification[] = [];
        for (const item of data as AppNotification[]) {
          const itemTime = new Date(item.created_at).getTime();
          if (!knownIdsRef.current.has(item.id) && itemTime > lastSeenTimeRef.current - 1000) {
            knownIdsRef.current.add(item.id);
            newItems.push(item);
          }
        }

        if (newItems.length > 0) {
          // Update baseline timestamp
          const mostRecentTime = Math.max(
            ...newItems.map((n) => new Date(n.created_at).getTime()),
          );
          if (mostRecentTime > lastSeenTimeRef.current) {
            lastSeenTimeRef.current = mostRecentTime;
          }

          // Trigger desktop alert and in-app toast for each new notification
          for (const item of newItems) {
            triggerDesktopNotification({
              id: item.id,
              title: item.title || "New Notification",
              body: item.body || "",
              taskId: item.task_id,
            });

            toast(item.title || "Operon Notification", {
              description: item.body || undefined,
              action: {
                label: "View",
                onClick: () => {
                  if (item.task_id) {
                    navigate({ to: "/tasks", search: { taskId: item.task_id, tab: "all_tasks" } as never });
                  } else {
                    navigate({ to: "/notifications" });
                  }
                },
              },
            });
          }
        }
      } catch (err) {
        console.warn("Notification polling error:", err);
      }
    };

    // Use channel subscription (realtime or polling fallback)
    const channel = supabase
      .channel(`user-notifs-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          checkNewNotifications();
        },
      )
      .subscribe();

    // Periodic safety interval (every 6 seconds) to guarantee delivery even if tab is idle
    const interval = setInterval(checkNewNotifications, 6000);

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [userId, triggerDesktopNotification]);

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
