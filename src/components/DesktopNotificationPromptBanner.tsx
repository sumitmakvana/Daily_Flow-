import { useState, useEffect } from "react";
import { BellRing, X, Clock, Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBrowserNotifications, playNotificationChime } from "@/hooks/use-browser-notifications";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";

const DISMISS_KEY = "operon_notif_banner_dismissed_until";

export function DesktopNotificationPromptBanner() {
  const { user } = useAuth();
  const { permission, isSupported, requestPermission, triggerDesktopNotification } = useBrowserNotifications(user?.id);
  const [isVisible, setIsVisible] = useState(false);
  const [isActivating, setIsActivating] = useState(false);

  useEffect(() => {
    if (!user || !isSupported) {
      setIsVisible(false);
      return;
    }

    // Only show if permission is 'default' (not granted, not explicitly denied)
    if (permission !== "default") {
      setIsVisible(false);
      return;
    }

    const dismissedUntil = localStorage.getItem(DISMISS_KEY);
    if (dismissedUntil && Number(dismissedUntil) > Date.now()) {
      setIsVisible(false);
      return;
    }

    // Small delay after page mount for smooth appearance
    const timer = setTimeout(() => {
      setIsVisible(true);
    }, 1000);

    return () => clearTimeout(timer);
  }, [user, isSupported, permission]);

  if (!isVisible) return null;

  const handleEnable = async () => {
    setIsActivating(true);
    try {
      const granted = await requestPermission();
      if (granted) {
        playNotificationChime();
        triggerDesktopNotification({
          title: "Real-time Notifications Active",
          body: "You're all set! Operon will send you desktop alerts for task updates, assignments & mentions.",
        });
        toast.success("Real-time notifications enabled!", {
          description: "You'll now receive instant alerts for task updates and mentions.",
        });
        setIsVisible(false);
      } else {
        toast.info("Browser notifications were not enabled. You can enable them anytime from Settings.");
        setIsVisible(false);
      }
    } catch {
      setIsVisible(false);
    } finally {
      setIsActivating(false);
    }
  };

  const handleSnooze = (days = 3) => {
    const snoozeUntil = Date.now() + days * 24 * 60 * 60 * 1000;
    localStorage.setItem(DISMISS_KEY, String(snoozeUntil));
    setIsVisible(false);
    toast.info(`Notification banner snoozed for ${days} days.`);
  };

  const handleDismiss = () => {
    handleSnooze(7);
  };

  return (
    <div className="relative z-40 w-full border-b border-[#5C8EFA]/30 bg-gradient-to-r from-[#0B1426] via-[#101D38] to-[#0B1426] px-3 sm:px-4 py-2 text-slate-100 shadow-md animate-in fade-in slide-in-from-top-2 duration-300">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 flex-wrap sm:flex-nowrap">
        {/* Left Side: Bell Icon & Message */}
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#5C8EFA]/20 text-[#5C8EFA] border border-[#5C8EFA]/40 shadow-xs ring-1 ring-[#5C8EFA]/20">
            <BellRing className="h-3.5 w-3.5 animate-pulse text-[#5C8EFA]" />
          </div>
          <div className="text-xs">
            <div className="font-semibold text-white flex items-center gap-2 flex-wrap">
              <span>Don't let important updates slip by. Enable real-time notifications.</span>
              <span className="hidden md:inline-flex items-center gap-1 rounded bg-[#5C8EFA]/20 px-1.5 py-0.5 text-[10px] font-semibold text-[#5C8EFA] border border-[#5C8EFA]/30">
                <Sparkles className="h-2.5 w-2.5 text-[#5C8EFA]" /> Real-time
              </span>
            </div>
          </div>
        </div>

        {/* Right Side: Action Buttons (Enable, Snooze, Close) */}
        <div className="flex items-center gap-2 shrink-0 ml-auto sm:ml-0">
          <Button
            size="sm"
            onClick={handleEnable}
            disabled={isActivating}
            className="h-7 px-3.5 text-xs font-bold bg-[#5C8EFA] hover:bg-[#4B7DE7] text-[#0A0F1D] shadow-xs gap-1.5 cursor-pointer border-0 transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            <Check className="h-3 w-3 text-[#0A0F1D]" />
            <span>{isActivating ? "Enabling…" : "Enable"}</span>
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleSnooze(3)}
            className="h-7 px-2.5 text-xs text-slate-300 hover:text-white bg-slate-800/60 hover:bg-slate-800 border border-slate-700/80 cursor-pointer flex items-center gap-1 transition-colors"
          >
            <Clock className="h-3 w-3 text-slate-400" />
            <span>Snooze</span>
          </Button>

          <button
            type="button"
            onClick={handleDismiss}
            className="text-slate-400 hover:text-white hover:bg-slate-800/60 p-1 rounded-md transition-colors cursor-pointer"
            title="Close Banner"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

