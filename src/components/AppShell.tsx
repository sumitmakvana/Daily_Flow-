import { Link, useLocation } from "@tanstack/react-router";
import { ListChecks, LayoutDashboard, AlertOctagon, BarChart3, Bell, LogOut, Activity, Sun, CalendarRange, Grid3x3, Settings, ShieldAlert, Gauge, Sparkles, Brain, Download, Sunrise, TrendingUp } from "lucide-react";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useAuth, signOut } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { StreakChip } from "@/components/StreakChip";
import { NudgeCenter } from "@/components/NudgeCenter";
import { SyncStatusBadge } from "@/components/SyncStatusBadge";

const memberNav = [
  { to: "/my-day", icon: Sunrise, label: "My Day" },
  { to: "/tasks", icon: ListChecks, label: "Tasks" },
  { to: "/eod-tasks", icon: Sun, label: "EOD" },
  { to: "/blockers", icon: AlertOctagon, label: "Blockers" },
  { to: "/notifications", icon: Bell, label: "Inbox" },
];

const managerNav = [
  { to: "/manager", icon: ShieldAlert, label: "Manager" },
  { to: "/command", icon: Activity, label: "Command" },
  { to: "/executive", icon: Gauge, label: "Exec" },
  { to: "/forecast", icon: TrendingUp, label: "Forecast" },
  { to: "/intelligence", icon: Brain, label: "Intelligence" },
  { to: "/planning-suggestions", icon: Sparkles, label: "Suggestions" },
  { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/tasks", icon: ListChecks, label: "Tasks" },
  { to: "/planning", icon: CalendarRange, label: "Planning" },
  { to: "/eod", icon: Sun, label: "EOD" },
  { to: "/eod-tasks", icon: Sun, label: "My EOD" },
  { to: "/heatmap", icon: Grid3x3, label: "Heatmap" },
  { to: "/blockers", icon: AlertOctagon, label: "Blockers" },
  { to: "/analytics", icon: BarChart3, label: "Analytics" },
  { to: "/exports", icon: Download, label: "Exports" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, isManager, isAdmin } = useAuth();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [unread, setUnread] = useState(0);

  const nav = isManager ? managerNav : memberNav;

  useEffect(() => {
    if (!user) return;
    const load = () =>
      supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .is("read_at", null)
        .then(({ count }) => setUnread(count ?? 0));
    load();
    const ch = supabase
      .channel("notif-count")
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user]);

  const handleLogout = async () => {
    // Sign-out hygiene: cancel in-flight protected queries, clear cache,
    // then clear the session and hard-replace history so Back can't restore.
    await queryClient.cancelQueries();
    queryClient.clear();
    const res = await signOut();
    if (!res || !res.redirected) {
      window.location.replace("/login");
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur">
        <div className="flex h-12 items-center px-3 md:px-4 gap-3">
          <Link to="/today" className="flex items-center gap-2 font-semibold text-sm">
            <Activity className="h-4 w-4 text-primary" />
            <span>Execution OS</span>
          </Link>
          <nav className="hidden md:flex items-center gap-0.5 ml-4">
            {nav.map((n) => {
              const active = location.pathname === n.to || location.pathname.startsWith(n.to + "/");
              return (
                <Link
                  key={n.to}
                  to={n.to}
                  className={cn(
                    "px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5",
                    active ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
                  )}
                >
                  <n.icon className="h-3.5 w-3.5" /> {n.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <SyncStatusBadge />
            <StreakChip className="mr-1" />
            {user && <NudgeCenter userId={user.id} />}
            <Link to="/notifications" className="relative hidden md:inline-flex">
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <Bell className="h-4 w-4" />
              </Button>
              {unread > 0 && (
                <Badge className="absolute -top-1 -right-1 h-4 min-w-4 px-1 text-[10px] bg-primary text-primary-foreground">
                  {unread}
                </Badge>
              )}
            </Link>
            {isAdmin && (
              <>
                <Link to="/configure">
                  <Button variant="ghost" size="sm" className="h-8 text-xs hidden md:inline-flex">Configure</Button>
                </Link>
                <Link to="/admin">
                  <Button variant="ghost" size="sm" className="h-8 text-xs hidden md:inline-flex">Admin</Button>
                </Link>
              </>
            )}
            <Link to="/settings/notifications" className="hidden md:inline-flex">
              <Button variant="ghost" size="icon" className="h-8 w-8" title="Notification settings">
                <Settings className="h-4 w-4" />
              </Button>
            </Link>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleLogout} title="Sign out">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 pb-16 md:pb-0">{children}</main>

      {/* Mobile bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 border-t border-border bg-background/95 backdrop-blur md:hidden">
        <div className="grid grid-cols-4 h-14">
          {nav.slice(0, 4).map((n) => {
            const active = location.pathname === n.to || location.pathname.startsWith(n.to + "/");
            return (
              <Link
                key={n.to}
                to={n.to}
                className={cn(
                  "flex flex-col items-center justify-center gap-0.5 text-[10px]",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <div className="relative">
                  <n.icon className="h-5 w-5" />
                  {n.to === "/notifications" && unread > 0 && (
                    <span className="absolute -top-1 -right-2 h-3.5 min-w-3.5 rounded-full bg-primary text-primary-foreground text-[9px] flex items-center justify-center px-0.5">{unread}</span>
                  )}
                </div>
                {n.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
