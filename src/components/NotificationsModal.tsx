import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import {
  Bell,
  CheckCheck,
  Maximize2,
  Minimize2,
  X,
  AlertOctagon,
  CheckSquare,
  Sparkles,
  Clock,
  ExternalLink,
  Sun,
  ShieldCheck,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { AppNotification } from "@/lib/types";
import { cn } from "@/lib/utils";

type TabFilter = "all" | "unread";

function formatNotifDateTime(iso: string): string {
  const d = new Date(iso);
  const dateStr = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const timeStr = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
  return `${dateStr} | ${timeStr}`;
}

function getNotifSection(iso: string): "Today" | "Yesterday" | "Earlier" {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return "Earlier";
}

function getNotifIconConfig(n: AppNotification) {
  const title = (n.title || "").toLowerCase();
  const type = (n.type || "").toLowerCase();

  if (type.includes("blocked") || title.includes("blocked")) {
    return {
      icon: AlertOctagon,
      bg: "bg-destructive/15 text-destructive border-destructive/20",
    };
  }
  if (type.includes("sod") || title.includes("morning")) {
    return {
      icon: Sun,
      bg: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/20",
    };
  }
  if (type.includes("eod") || title.includes("end of day") || title.includes("digest")) {
    return {
      icon: Sparkles,
      bg: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
    };
  }
  if (title.includes("assign") || title.includes("task")) {
    return {
      icon: CheckSquare,
      bg: "bg-primary/15 text-primary border-primary/20",
    };
  }
  if (title.includes("approval") || title.includes("request")) {
    return {
      icon: ShieldCheck,
      bg: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border-indigo-500/20",
    };
  }
  return {
    icon: Bell,
    bg: "bg-accent/60 text-foreground border-border/60",
  };
}

export function NotificationsModalContent({
  onClose,
  isEmbedded = false,
}: {
  onClose?: () => void;
  isEmbedded?: boolean;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [activeTab, setActiveTab] = useState<TabFilter>("all");
  const [isExpanded, setIsExpanded] = useState(false);

  const load = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(100);
    setItems((data ?? []) as AppNotification[]);
  };

  useEffect(() => {
    load();
  }, [user?.id]);

  const unreadCount = useMemo(() => items.filter((n) => !n.read_at).length, [items]);

  const filteredItems = useMemo(() => {
    if (activeTab === "unread") return items.filter((n) => !n.read_at);
    return items;
  }, [items, activeTab]);

  const groupedItems = useMemo(() => {
    const sections: { title: "Today" | "Yesterday" | "Earlier"; items: AppNotification[] }[] = [
      { title: "Today", items: [] },
      { title: "Yesterday", items: [] },
      { title: "Earlier", items: [] },
    ];

    for (const item of filteredItems) {
      const sectionName = getNotifSection(item.created_at);
      const section = sections.find((s) => s.title === sectionName);
      if (section) {
        section.items.push(item);
      }
    }

    return sections.filter((s) => s.items.length > 0);
  }, [filteredItems]);

  const markAll = async () => {
    if (!user) return;
    await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() } as never)
      .eq("user_id", user.id)
      .is("read_at", null);
    load();
  };

  const handleClick = async (n: AppNotification) => {
    if (!n.read_at) {
      await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() } as never)
        .eq("id", n.id);
      load();
    }

    onClose?.();

    if (n.task_id) {
      navigate({ to: "/my-day", search: { taskId: n.task_id } });
    } else if (["eod_digest", "sod_digest"].includes(n.type)) {
      if (n.type === "sod_digest" && (n.title.includes("0 tasks") || n.body?.includes("No tasks"))) {
        navigate({ to: "/tasks", search: { create: true } });
      } else {
        navigate({ to: "/my-day" });
      }
    } else if (["eod_team_digest", "sod_team_digest"].includes(n.type)) {
      navigate({ to: "/manager" });
    }
  };

  return (
    <div
      className={cn(
        "bg-card/95 backdrop-blur-md border border-border/80 rounded-2xl p-3.5 sm:p-4 shadow-2xl space-y-3.5 transition-all duration-300 text-left w-full",
        isEmbedded
          ? "max-w-xl mx-auto"
          : isExpanded
          ? "sm:w-[720px] max-w-[calc(100vw-16px)]"
          : "sm:w-[420px] max-w-[calc(100vw-16px)]"
      )}
    >
      {/* Header Title & Expand / Close Actions */}
      <div className="flex items-start justify-between gap-2 pb-2 border-b border-border/50">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-foreground flex items-center gap-2">
            Notifications
          </h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Stay Updated with Your Latest Notifications
          </p>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {/* Mark all as read button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={markAll}
            disabled={unreadCount === 0}
            className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 hover:bg-emerald-500/10 gap-1 h-7 px-2 rounded-md"
          >
            <CheckCheck className="h-3.5 w-3.5" />
            Mark read
          </Button>

          {/* Expand Button */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsExpanded(!isExpanded)}
            title={isExpanded ? "Collapse View" : "Expand View"}
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
          >
            {isExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </Button>

          {/* Close Button */}
          {onClose && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              title="Close Notifications"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Tab Filters (All vs Unread) */}
      <div className="flex items-center justify-between border-b border-border/50 pb-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setActiveTab("all")}
            className={cn(
              "px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all flex items-center gap-1",
              activeTab === "all"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            )}
          >
            All <span className="opacity-80">({items.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("unread")}
            className={cn(
              "px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all flex items-center gap-1",
              activeTab === "unread"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            )}
          >
            Unread
            {unreadCount > 0 && (
              <span className="inline-grid place-items-center min-w-4 h-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold">
                {unreadCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Notification Group Lists */}
      {groupedItems.length === 0 ? (
        <div className="py-8 text-center space-y-1.5">
          <div className="h-9 w-9 rounded-full bg-muted/60 grid place-items-center mx-auto text-muted-foreground">
            <Bell className="h-4 w-4 opacity-60" />
          </div>
          <p className="text-xs font-medium text-muted-foreground">
            {activeTab === "unread" ? "No unread notifications." : "No notifications yet."}
          </p>
        </div>
      ) : (
        <div className="space-y-3.5 max-h-[calc(80vh-140px)] overflow-y-auto pr-1">
          {groupedItems.map((group) => (
            <div key={group.title} className="space-y-1.5">
              {/* Date Section Subheader */}
              <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1">
                {group.title}
              </h3>

              <div className="space-y-1.5">
                {group.items.map((n) => {
                  const iconConfig = getNotifIconConfig(n);
                  const IconComp = iconConfig.icon;
                  const isClickable =
                    !!n.task_id ||
                    ["eod_digest", "sod_digest", "eod_team_digest", "sod_team_digest"].includes(
                      n.type
                    );
                  const isUnread = !n.read_at;

                  return (
                    <div
                      key={n.id}
                      onClick={() => isClickable && handleClick(n)}
                      className={cn(
                        "group relative flex items-start gap-2.5 p-2.5 rounded-xl border transition-all duration-200",
                        isUnread
                          ? "bg-card border-border/80 shadow-xs"
                          : "bg-muted/20 border-border/40 opacity-90",
                        isClickable
                          ? "cursor-pointer hover:bg-accent/40 hover:border-border hover:shadow-xs"
                          : ""
                      )}
                    >
                      {/* Left Avatar / Icon Badge */}
                      <div
                        className={cn(
                          "h-8 w-8 rounded-lg grid place-items-center border shrink-0 transition-transform group-hover:scale-105",
                          iconConfig.bg
                        )}
                      >
                        <IconComp className="h-3.5 w-3.5" />
                      </div>

                      {/* Middle Content Column */}
                      <div className="flex-1 min-w-0 pr-1 space-y-0.5">
                        <div className="flex items-center gap-1 flex-wrap">
                          <span className="font-medium text-xs text-foreground leading-snug group-hover:text-primary transition-colors">
                            {n.title}
                          </span>
                          {isClickable && (
                            <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                          )}
                        </div>

                        {n.body && (
                          <p className="text-[11px] text-muted-foreground/90 line-clamp-2 leading-relaxed">
                            {n.body}
                          </p>
                        )}

                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground/70 pt-0.5">
                          <Clock className="h-3 w-3" />
                          <span>{formatNotifDateTime(n.created_at)}</span>
                        </div>
                      </div>

                      {/* Right Red Dot Unread Indicator */}
                      {isUnread && (
                        <div className="flex items-center h-full pt-1">
                          <span className="h-2 w-2 rounded-full bg-destructive shadow-xs ring-4 ring-destructive/10 shrink-0" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function NotificationsModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <>
      {/* Click-outside backdrop overlay */}
      <div
        className="fixed inset-0 z-40 bg-black/20 backdrop-blur-xs animate-in fade-in duration-150"
        onClick={() => onOpenChange(false)}
      />

      {/* Right-Side Mini Notification Popover Panel */}
      <div
        ref={panelRef}
        className="fixed inset-x-2 top-13 sm:inset-x-auto sm:right-6 sm:top-16 z-50 animate-in fade-in slide-in-from-top-3 duration-200 max-h-[85vh] flex justify-end"
      >
        <NotificationsModalContent onClose={() => onOpenChange(false)} />
      </div>
    </>
  );
}
