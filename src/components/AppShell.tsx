import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { ListChecks, LayoutDashboard, AlertOctagon, BarChart3, Bell, LogOut, Activity, Sun, CalendarRange, Grid3x3, Settings, ShieldAlert, Gauge, Sparkles, Brain, Download, Sunrise, TrendingUp, Menu, ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useAuth, signOut } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { StreakChip } from "@/components/StreakChip";
import { NudgeCenter } from "@/components/NudgeCenter";
import { SyncStatusBadge } from "@/components/SyncStatusBadge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetClose,
} from "@/components/ui/sheet";
import noesisLogo from "@/components/ui/noesis_analytics_logo.svg";

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

const primaryManagerNav = [
  { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/tasks", icon: ListChecks, label: "Tasks" },
  { to: "/planning", icon: CalendarRange, label: "Planning" },
  { to: "/eod", icon: Sun, label: "EOD" },
  { to: "/manager", icon: ShieldAlert, label: "Manager" },
];

const secondaryManagerNav = [
  { to: "/command", icon: Activity, label: "Command" },
  { to: "/executive", icon: Gauge, label: "Exec" },
  { to: "/forecast", icon: TrendingUp, label: "Forecast" },
  { to: "/intelligence", icon: Brain, label: "Intelligence" },
  { to: "/planning-suggestions", icon: Sparkles, label: "Suggestions" },
  { to: "/eod-tasks", icon: Sun, label: "My EOD" },
  { to: "/heatmap", icon: Grid3x3, label: "Heatmap" },
  { to: "/blockers", icon: AlertOctagon, label: "Blockers" },
  { to: "/analytics", icon: BarChart3, label: "Analytics" },
  { to: "/exports", icon: Download, label: "Exports" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, isManager, isAdmin } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [unread, setUnread] = useState(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const nav = isManager ? managerNav : memberNav;

  const mobileBottomNav = isManager ? [
    { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
    { to: "/tasks", icon: ListChecks, label: "Tasks" },
    { to: "/eod", icon: Sun, label: "EOD" },
  ] : [
    { to: "/my-day", icon: Sunrise, label: "My Day" },
    { to: "/tasks", icon: ListChecks, label: "Tasks" },
    { to: "/eod-tasks", icon: Sun, label: "EOD" },
  ];

  useEffect(() => {
    if (!user) return;

    const knownIds = new Set<string>();
    let firstLoad = true;

    const checkNotifications = async () => {
      try {
        const { data, error } = await supabase
          .from("notifications")
          .select("id, title, body, read_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(50);

        if (error || !data) return;

        const unreadCount = data.filter((n) => !n.read_at).length;
        setUnread(unreadCount);

        data.forEach((n) => {
          if (!knownIds.has(n.id)) {
            knownIds.add(n.id);
            if (!n.read_at && !firstLoad) {
              toast(n.title, {
                description: n.body ?? undefined,
                action: {
                  label: "View",
                  onClick: () => {
                    navigate({ to: "/notifications" });
                  },
                },
              });
            }
          }
        });

        firstLoad = false;
      } catch (err) {
        console.warn("Error polling notifications:", err);
      }
    };

    checkNotifications();
    const interval = setInterval(checkNotifications, 5000);

    return () => {
      clearInterval(interval);
    };
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
          <Link to="/today" className="flex items-center gap-2 font-semibold text-sm mr-2 shrink-0">
            <img src={noesisLogo} alt="Noesis Analytics" className="h-7 w-auto" />
          </Link>
          <nav className="hidden md:flex items-center gap-0.5 ml-4">
            {!isManager ? (
              memberNav.map((n) => {
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
              })
            ) : (
              <>
                {primaryManagerNav.map((n) => {
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
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="px-2.5 py-1.5 h-8 text-xs font-medium flex items-center gap-1 text-muted-foreground hover:text-foreground hover:bg-accent/50 data-[state=open]:bg-accent data-[state=open]:text-foreground"
                    >
                      More <ChevronDown className="h-3 w-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-48 max-h-[70vh] overflow-y-auto">
                    {secondaryManagerNav.map((n) => {
                      const active = location.pathname === n.to || location.pathname.startsWith(n.to + "/");
                      return (
                        <DropdownMenuItem key={n.to} asChild>
                          <Link
                            to={n.to}
                            className={cn(
                              "w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded-sm transition-colors",
                              active ? "bg-accent text-foreground font-semibold" : "text-muted-foreground hover:text-foreground"
                            )}
                          >
                            <n.icon className="h-3.5 w-3.5" />
                            {n.label}
                          </Link>
                        </DropdownMenuItem>
                      );
                    })}
                    {isAdmin && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem asChild>
                          <Link
                            to="/configure"
                            className={cn(
                              "w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded-sm transition-colors",
                              location.pathname === "/configure" ? "bg-accent text-foreground font-semibold" : "text-muted-foreground hover:text-foreground"
                            )}
                          >
                            <Settings className="h-3.5 w-3.5" />
                            Configure
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <Link
                            to="/admin"
                            className={cn(
                              "w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded-sm transition-colors",
                              location.pathname === "/admin" ? "bg-accent text-foreground font-semibold" : "text-muted-foreground hover:text-foreground"
                            )}
                          >
                            <ShieldAlert className="h-3.5 w-3.5" />
                            Admin
                          </Link>
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
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
          {mobileBottomNav.map((n) => {
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
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="flex flex-col items-center justify-center gap-0.5 text-[10px] text-muted-foreground hover:text-primary transition-colors cursor-pointer"
          >
            <Menu className="h-5 w-5" />
            Menu
          </button>
        </div>
      </nav>

      {/* Mobile Drawer (Sheet) */}
      <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <SheetContent side="right" className="w-72 p-0 flex flex-col h-full bg-background border-l border-border">
          <div className="p-4 border-b border-border/60 flex items-center justify-between">
            <img src={noesisLogo} alt="Noesis Analytics" className="h-6 w-auto" />
          </div>
          
          <div className="flex-1 overflow-y-auto px-2 py-4 space-y-6">
            <div className="space-y-1">
              <div className="px-3 mb-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Navigation</div>
              {nav.map((n) => {
                const active = location.pathname === n.to || location.pathname.startsWith(n.to + "/");
                return (
                  <SheetClose key={n.to} asChild>
                    <Link
                      to={n.to}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
                        active ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/40"
                      )}
                    >
                      <div className="relative">
                        <n.icon className="h-4 w-4" />
                        {n.to === "/notifications" && unread > 0 && (
                          <span className="absolute -top-1 -right-2 h-3.5 min-w-3.5 rounded-full bg-primary text-primary-foreground text-[9px] flex items-center justify-center px-0.5">{unread}</span>
                        )}
                      </div>
                      <span>{n.label}</span>
                    </Link>
                  </SheetClose>
                );
              })}
            </div>
            
            {isAdmin && (
              <div className="space-y-1">
                <div className="px-3 mb-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Admin Controls</div>
                <SheetClose asChild>
                  <Link
                    to="/configure"
                    className={cn(
                      "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
                      location.pathname === "/configure" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/40"
                    )}
                  >
                    <Settings className="h-4 w-4" />
                    <span>Configure</span>
                  </Link>
                </SheetClose>
                <SheetClose asChild>
                  <Link
                    to="/admin"
                    className={cn(
                      "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
                      location.pathname === "/admin" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/40"
                    )}
                  >
                    <ShieldAlert className="h-4 w-4" />
                    <span>Admin Panel</span>
                  </Link>
                </SheetClose>
              </div>
            )}

            <div className="space-y-1">
              <div className="px-3 mb-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Account</div>
              <SheetClose asChild>
                <Link
                  to="/settings/notifications"
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
                    location.pathname.startsWith("/settings") ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/40"
                  )}
                >
                  <Settings className="h-4 w-4" />
                  <span>Settings</span>
                </Link>
              </SheetClose>
              <button
                onClick={() => {
                  setMobileMenuOpen(false);
                  handleLogout();
                }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
              >
                <LogOut className="h-4 w-4" />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
