import { useState, useEffect } from "react";
import { BellRing, X, Sparkles, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBrowserNotifications, playNotificationChime } from "@/hooks/use-browser-notifications";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";

const DISMISS_KEY = "operon_notif_banner_dismissed_until";

export function DesktopNotificationPromptBanner() {
  const { user } = useAuth();
  const { permission, isSupported, requestPermission } = useBrowserNotifications(user?.id);
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
    }, 1200);

    return () => clearTimeout(timer);
  }, [user, isSupported, permission]);

  if (!isVisible) return null;

  const handleEnable = async () => {
    setIsActivating(true);
    try {
      const granted = await requestPermission();
      if (granted) {
        playNotificationChime();
        toast.success("Desktop notifications enabled for Operon!", {
          description: "You'll now receive real-time task alerts and updates on your desktop.",
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

  const handleDismiss = () => {
    // Dismiss for 7 days
    const nextWeek = Date.now() + 7 * 24 * 60 * 60 * 1000;
    localStorage.setItem(DISMISS_KEY, String(nextWeek));
    setIsVisible(false);
  };

  return (
    <div className="relative z-20 w-full border-b border-[#5C8EFA]/25 bg-gradient-to-r from-[#0B1426] via-[#101D38] to-[#0B1426] px-4 py-2.5 text-slate-200 shadow-md animate-in fade-in slide-in-from-top-2 duration-300">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 flex-wrap sm:flex-nowrap">
        
        {/* Left Side Info */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#5C8EFA]/20 text-[#5C8EFA] border border-[#5C8EFA]/40 ring-2 ring-[#5C8EFA]/10">
            <BellRing className="h-4 w-4 animate-bounce" />
          </div>
          <div className="text-xs">
            <div className="font-semibold text-white flex items-center gap-1.5">
              <span>Enable Operon Desktop Notifications</span>
              <span className="hidden sm:inline-flex items-center gap-1 rounded bg-[#5C8EFA]/15 px-1.5 py-0.2 text-[10px] font-medium text-[#5C8EFA] border border-[#5C8EFA]/30">
                <Sparkles className="h-2.5 w-2.5" /> Recommended
              </span>
            </div>
            <p className="text-slate-400 text-[11px] mt-0.5 leading-tight">
              Get instant Chrome popups and chimes when tasks are assigned, reviewed, or mentioned — even when you're on other tabs.
            </p>
          </div>
        </div>

        {/* Right Side Action Buttons */}
        <div className="flex items-center gap-2 shrink-0 ml-auto sm:ml-0">
          <Button
            size="sm"
            onClick={handleEnable}
            disabled={isActivating}
            className="h-7 px-3 text-xs font-semibold bg-[#5C8EFA] hover:bg-[#4b7ce6] text-white shadow-sm gap-1.5 cursor-pointer border-0"
          >
            <Check className="h-3 w-3" />
            <span>{isActivating ? "Enabling…" : "Enable Notifications"}</span>
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleDismiss}
            className="h-7 px-2.5 text-xs text-slate-400 hover:text-white hover:bg-slate-800/60 cursor-pointer"
          >
            Maybe Later
          </Button>

          <button
            type="button"
            onClick={handleDismiss}
            className="text-slate-400 hover:text-white p-1 rounded transition-colors cursor-pointer"
            title="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

      </div>
    </div>
  );
}
