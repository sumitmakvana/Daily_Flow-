import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import {
  ListChecks,
  LayoutDashboard,
  AlertOctagon,
  BarChart3,
  Bell,
  LogOut,
  Activity,
  Sun,
  CalendarRange,
  Grid3x3,
  Settings,
  ShieldAlert,
  Gauge,
  Sparkles,
  Brain,
  Download,
  Sunrise,
  TrendingUp,
  Users,
  Menu,
  ChevronDown,
  Accessibility,
  Search,
  PlusSquare,
  Eye,
  HelpCircle,
  LayoutGrid,
  Loader2,
  X,
  ChevronRight,
  User,
  Palmtree,
  Clock,
} from "lucide-react";
import { useEffect, useState, useRef } from "react";
import { toast } from "sonner";
import { HolidayBanner } from "@/components/HolidayBanner";
import { AnnouncementNoticeBanner } from "@/components/AnnouncementNoticeBanner";
import { DesktopNotificationPromptBanner } from "@/components/DesktopNotificationPromptBanner";
import { UX4GAccessibilityToolbar } from "@/components/UX4GAccessibilityToolbar";
import { GlobalFeedbackWidget } from "@/components/GlobalFeedbackWidget";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth, signOut } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { SyncStatusBadge } from "@/components/SyncStatusBadge";
import { NotificationsModal } from "@/components/NotificationsModal";
import { useBrowserNotifications } from "@/hooks/use-browser-notifications";
import { GlobalCompleteTaskEodDialog } from "@/components/CompleteTaskEodDialog";
import { TaskFormDialog } from "@/components/TaskFormDialog";
import { GlobalSearchModal } from "@/components/GlobalSearchModal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetClose } from "@/components/ui/sheet";

const memberNav = [
  { to: "/my-day", icon: Sunrise, label: "My Day" },
  { to: "/tasks", icon: ListChecks, label: "Tasks" },
  { to: "/calendar", icon: CalendarRange, label: "Calendar" },
  { to: "/eod-tasks", icon: Sun, label: "EOD" },
  { to: "/blockers", icon: AlertOctagon, label: "Blockers" },
  { to: "/notifications", icon: Bell, label: "Inbox" },
];

const managerNav = [
  { to: "/team-capacity", icon: Users, label: "Team Capacity" },
  { to: "/executive", icon: Gauge, label: "Executive" },
  { to: "/my-day", icon: Sunrise, label: "My Day" },
  { to: "/tasks", icon: ListChecks, label: "Tasks" },
  { to: "/calendar", icon: CalendarRange, label: "Calendar" },
  { to: "/leaves", icon: Palmtree, label: "Team Leaves" },
  { to: "/eod", icon: Sun, label: "EOD" },
  { to: "/eod-tasks", icon: Sun, label: "My EOD" },
  { to: "/blockers", icon: AlertOctagon, label: "Blockers" },
  { to: "/exports", icon: Download, label: "Exports & Reports" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, isManager, isAdmin } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [unread, setUnread] = useState(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notifModalOpen, setNotifModalOpen] = useState(false);
  const [accessibilityOpen, setAccessibilityOpen] = useState(false);
  const [addTaskOpen, setAddTaskOpen] = useState(false);
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  
  const [profile, setProfile] = useState<{
    display_name: string | null;
    email: string | null;
    avatar_url: string | null;
  } | null>(null);

  // Global Ctrl+K Shortcut Handler for ClickUp Command Modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchModalOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);



  useEffect(() => {
    if (!user) {
      setProfile(null);
      return;
    }

    const loadProfile = async () => {
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("display_name, email, avatar_url")
          .eq("id", user.id)
          .maybeSingle();

        if (!error && data) {
          setProfile(data);
        } else {
          setProfile({
            display_name: user.user_metadata?.display_name || user.user_metadata?.full_name || null,
            email: user.email || null,
            avatar_url: user.user_metadata?.avatar_url || null,
          });
        }
      } catch (err) {
        console.warn("Failed to load profile in AppShell:", err);
      }
    };

    loadProfile();
  }, [user]);

  const nav = isManager ? managerNav : memberNav;

  const mobileBottomNav = isManager
    ? [
        { to: "/team-capacity", icon: Users, label: "Capacity" },
        { to: "/executive", icon: Gauge, label: "Exec" },
        { to: "/my-day", icon: Sunrise, label: "My Day" },
        { to: "/tasks", icon: ListChecks, label: "Tasks" },
        { to: "/eod", icon: Sun, label: "EOD" },
      ]
    : [
        { to: "/my-day", icon: Sunrise, label: "My Day" },
        { to: "/tasks", icon: ListChecks, label: "Tasks" },
        { to: "/eod-tasks", icon: Sun, label: "EOD" },
      ];

  // Global Operon Chrome/Browser Desktop Notifications & Realtime Sync
  const { triggerDesktopNotification } = useBrowserNotifications(user?.id, {
    onUnreadChange: setUnread,
  });

  const handleLogout = async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    const res = await signOut();
    if (!res || !res.redirected) {
      window.location.replace("/login");
    }
  };

  const displayName = profile?.display_name || user?.user_metadata?.display_name || user?.user_metadata?.full_name || profile?.email?.split("@")[0] || "User";
  const userAvatarInitial = displayName.charAt(0).toUpperCase();

  return (
    <div className="min-h-screen flex flex-col bg-background font-sans">
      {/* Desktop Notification Banner */}
      <DesktopNotificationPromptBanner />

      {/* UX4G Accessibility Toolbar */}
      <UX4GAccessibilityToolbar isOpen={accessibilityOpen} onOpenChange={setAccessibilityOpen} />

      {/* 1. TOP HEADER - Unified App Theme Background */}
      <header className="sticky top-0 z-30 bg-background text-foreground border-b border-border/60 shadow-2xs transform-gpu">
        <div className="flex h-14 items-center px-3 sm:px-4 gap-2 md:gap-4 w-full justify-between relative">
          
          {/* Logo Section with Official Manifest Icon SVG & Styled Operon Title */}
          <Link
            to={isManager ? "/executive" : "/my-day"}
            className="flex items-center gap-2.5 select-none group shrink-0"
          >
            <img
              src="/icon.svg"
              alt="Operon Logo"
              className="h-8 w-8 rounded-lg shadow-xs shrink-0 transition-transform group-hover:scale-105 object-contain"
            />
            <div className="flex items-center gap-1.5 select-none">
              <span className="font-bold text-lg sm:text-xl tracking-tight bg-gradient-to-b from-white via-slate-100 to-slate-300 bg-clip-text text-transparent drop-shadow-xs font-sans transition-opacity group-hover:opacity-90">
                Operon
              </span>
              <span className="h-1.5 w-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.7)] inline-block"></span>
            </div>
          </Link>

          {/* Center ClickUp-Style Command Search Bar */}
          <div className="hidden md:flex flex-1 max-w-xl mx-2 lg:mx-6 relative items-center">
            <button
              type="button"
              onClick={() => setSearchModalOpen(true)}
              className="w-full bg-[#070B14] hover:bg-[#0D1525] text-slate-100 pl-10 pr-4 py-1.5 rounded-lg text-xs sm:text-sm font-normal border border-[#1A2538] hover:border-slate-700/80 shadow-inner transition-all flex items-center justify-between text-left group cursor-pointer"
            >
              <div className="flex items-center gap-2 text-slate-400 group-hover:text-slate-200">
                <Search className="h-4 w-4 text-slate-400 group-hover:text-indigo-400 transition-colors" />
                <span className="truncate">Search tasks, team members...</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[10px] font-mono font-medium text-slate-500 bg-slate-800/80 px-1.5 py-0.5 rounded border border-slate-700">
                  Ctrl K
                </span>
              </div>
            </button>
          </div>

          {/* Right Header Options */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            
            {/* Mobile Search Button */}
            <button
              type="button"
              onClick={() => setSearchModalOpen(true)}
              className="md:hidden flex items-center justify-center h-8 w-8 rounded text-slate-300 hover:text-white hover:bg-slate-800/60 transition-colors"
              title="Search"
            >
              <Search className="h-4 w-4" />
            </button>

            {/* Realtime Sync Status Badge - hidden on mobile for space */}
            <span className="hidden sm:inline-flex">
              <SyncStatusBadge />
            </span>

            {/* Notifications Icon Button */}
            <button
              type="button"
              onClick={() => setNotifModalOpen(true)}
              className="relative flex items-center justify-center h-8 w-8 rounded-md text-slate-300 hover:text-white hover:bg-slate-800/50 transition-colors"
              title="Notifications"
            >
              <Bell className="h-4 w-4" />
              {unread > 0 && (
                <span className="absolute -top-0.5 -right-0.5 h-3.5 min-w-3.5 rounded-full bg-[#5C8EFA] text-[#0A0F1D] text-[9px] font-bold flex items-center justify-center px-0.5">
                  {unread}
                </span>
              )}
            </button>

            {/* Profile Dropdown */}
            {user ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-2 pl-2 border-l border-slate-800 text-slate-200 hover:text-white cursor-pointer select-none outline-none group"
                  >
                    {profile?.avatar_url ? (
                      <img
                        src={profile.avatar_url}
                        alt={displayName}
                        className="h-7 w-7 rounded-full border border-slate-700 object-cover shrink-0"
                      />
                    ) : (
                      <div className="h-7 w-7 rounded-full bg-[#5C8EFA]/20 text-[#5C8EFA] flex items-center justify-center text-xs font-bold border border-[#5C8EFA]/40 shrink-0">
                        {userAvatarInitial}
                      </div>
                    )}
                    <span className="text-xs font-semibold max-w-[120px] truncate hidden sm:inline-block">
                      {displayName}
                    </span>
                    <ChevronDown className="h-3.5 w-3.5 text-slate-400 group-hover:text-white transition-colors hidden sm:block" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col space-y-1">
                      <p className="text-sm font-semibold leading-none">{displayName}</p>
                      <p className="text-xs leading-none text-muted-foreground truncate">
                        {profile?.email || user.email}
                      </p>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link to="/my-day" className="cursor-pointer">
                      <Sunrise className="mr-2 h-4 w-4" />
                      <span>My Day</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/time-tracking" className="cursor-pointer">
                      <Clock className="mr-2 h-4 w-4 text-amber-400" />
                      <span>Time Tracking</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/settings/notifications" className="cursor-pointer">
                      <Settings className="mr-2 h-4 w-4" />
                      <span>Settings</span>
                    </Link>
                  </DropdownMenuItem>
                  {(isManager || isAdmin) && (
                    <DropdownMenuItem asChild>
                      <Link to="/exports" className="cursor-pointer">
                        <Download className="mr-2 h-4 w-4 text-primary" />
                        <span>Exports & Reports</span>
                      </Link>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => setAccessibilityOpen(true)} className="cursor-pointer">
                    <Accessibility className="mr-2 h-4 w-4" />
                    <span>Accessibility Toolbar</span>
                  </DropdownMenuItem>
                  {isAdmin && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem asChild>
                        <Link to="/configure" className="cursor-pointer">
                          <Settings className="mr-2 h-4 w-4" />
                          <span>Configure</span>
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link to="/admin" className="cursor-pointer">
                          <ShieldAlert className="mr-2 h-4 w-4" />
                          <span>Admin Controls</span>
                        </Link>
                      </DropdownMenuItem>
                    </>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleLogout} className="text-destructive cursor-pointer">
                    <LogOut className="mr-2 h-4 w-4" />
                    <span>Sign Out</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}

          </div>
        </div>
      </header>

      {/* 2. SECONDARY NAVIGATION BAR - Desktop only (mobile uses bottom nav + drawer) */}
      <nav className="sticky top-14 z-20 bg-background border-b border-border/60 text-foreground transform-gpu hidden md:block">
        <div className="flex h-10 items-center px-2 md:px-4 w-full justify-between overflow-x-auto no-scrollbar scrollbar-none">
          
          {/* Main Horizontal Links */}
          <div className="flex items-center gap-0.5 min-w-0 flex-1 overflow-x-auto no-scrollbar scrollbar-none py-0.5">
            
            {/* Quick Action: Add Task */}
            <button
              type="button"
              onClick={() => setAddTaskOpen(true)}
              className="px-3 py-1 rounded-md text-xs font-bold text-[#0A0F1D] bg-[#5C8EFA] hover:bg-[#4A7DE7] flex items-center gap-1.5 transition-all cursor-pointer shadow-xs shrink-0 group"
            >
              <PlusSquare className="h-3.5 w-3.5 text-[#0A0F1D] group-hover:scale-110 transition-transform" />
              <span>Add Task</span>
            </button>

            <span className="text-slate-700 select-none px-1.5 font-light">|</span>

            {/* Nav Items */}
            {nav.map((n, idx) => {
              const active =
                location.pathname === n.to || location.pathname.startsWith(n.to + "/");
              return (
                <div key={n.to} className="flex items-center shrink-0">
                  <Link
                    to={n.to}
                    className={cn(
                      "px-2.5 py-1 rounded-md text-xs font-semibold transition-all flex items-center gap-1.5 whitespace-nowrap",
                      active
                        ? "text-white bg-[#141F36] font-bold border-b-2 border-[#5C8EFA]"
                        : "text-slate-300 hover:text-white hover:bg-slate-800/50",
                    )}
                  >
                    <n.icon className={cn("h-3.5 w-3.5 shrink-0", active ? "text-[#5C8EFA]" : "text-slate-400")} />
                    <span>{n.label}</span>
                  </Link>
                  {idx < nav.length - 1 && (
                    <span className="text-slate-700 select-none px-1 font-light">|</span>
                  )}
                </div>
              );
            })}
          </div>

        </div>
      </nav>

      {/* MAIN CONTENT AREA */}
      <main id="main-content" tabIndex={-1} className="flex-1 pb-16 md:pb-0 focus:outline-none">
        <HolidayBanner />
        {/* <AnnouncementNoticeBanner /> */}
        {children}
      </main>

      {/* MOBILE BOTTOM NAVIGATION BAR */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 border-t border-[#1A2336] bg-[#0B111E]/95 backdrop-blur md:hidden">
        <div
          className="h-14 grid"
          style={{ gridTemplateColumns: `repeat(${mobileBottomNav.length + 1}, minmax(0, 1fr))` }}
        >
          {mobileBottomNav.map((n) => {
            const active = location.pathname === n.to || location.pathname.startsWith(n.to + "/");
            return (
              <Link
                key={n.to}
                to={n.to}
                className={cn(
                  "flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors",
                  active ? "text-[#5C8EFA] font-bold" : "text-slate-400",
                )}
              >
                <div className="relative">
                  <n.icon className="h-5 w-5" />
                  {n.to === "/notifications" && unread > 0 && (
                    <span className="absolute -top-1 -right-2 h-3.5 min-w-3.5 rounded-full bg-[#5C8EFA] text-[#0A0F1D] text-[9px] font-bold flex items-center justify-center px-0.5">
                      {unread}
                    </span>
                  )}
                </div>
                <span>{n.label}</span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            className="flex flex-col items-center justify-center gap-0.5 text-[10px] text-slate-400 hover:text-[#5C8EFA] transition-colors cursor-pointer"
          >
            <Menu className="h-5 w-5" />
            <span>Menu</span>
          </button>
        </div>
      </nav>

      {/* MOBILE DRAWER SHEET */}
      <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <SheetContent
          side="right"
          className="w-72 p-0 flex flex-col h-full bg-[#0B111E] text-white border-l border-[#1A2336]"
        >
          <div className="p-4 bg-[#070B14] border-b border-[#1A2336] flex flex-col gap-3">
            <div className="flex items-center gap-2.5">
              <img
                src="/icon.svg"
                alt="Operon Logo"
                className="h-7 w-7 rounded-md object-contain"
              />
              <div className="flex items-center gap-1.5 select-none">
                <span className="font-bold text-lg tracking-tight bg-gradient-to-b from-white via-slate-100 to-slate-300 bg-clip-text text-transparent font-sans">
                  Operon
                </span>
                <span className="h-1.5 w-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.7)] inline-block"></span>
              </div>
            </div>
            {profile && (
              <div className="flex items-center gap-3 pt-1 border-t border-[#1A2336]">
                {profile.avatar_url ? (
                  <img
                    src={profile.avatar_url}
                    alt={displayName}
                    className="h-8 w-8 rounded-full border border-slate-700 object-cover shrink-0"
                  />
                ) : (
                  <div className="h-8 w-8 rounded-full bg-[#5C8EFA]/20 text-[#5C8EFA] flex items-center justify-center text-xs font-bold border border-[#5C8EFA]/40 shrink-0">
                    {userAvatarInitial}
                  </div>
                )}
                <div className="flex flex-col min-w-0 select-none">
                  <span className="text-xs font-semibold truncate leading-tight">
                    {displayName}
                  </span>
                  {profile.email && (
                    <span className="text-[11px] text-slate-400 truncate leading-tight mt-0.5">
                      {profile.email}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-2 py-4 space-y-5">
            
            {/* Quick Action Button */}
            <div className="px-1">
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  setAddTaskOpen(true);
                }}
                className="w-full py-2 px-3 rounded-md bg-[#5C8EFA] text-[#0A0F1D] text-xs font-bold flex items-center justify-center gap-2 shadow-xs hover:bg-[#4A7DE7] transition-colors"
              >
                <PlusSquare className="h-4 w-4" />
                <span>Create New Task</span>
              </button>
            </div>

            {/* Navigation Modules */}
            <div className="space-y-1">
              <div className="px-3 mb-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Modules
              </div>
              {nav.map((n) => {
                const active =
                  location.pathname === n.to || location.pathname.startsWith(n.to + "/");
                return (
                  <SheetClose key={n.to} asChild>
                    <Link
                      to={n.to}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2 rounded-md text-xs font-semibold transition-colors",
                        active
                          ? "bg-[#141F36] text-[#5C8EFA] font-bold"
                          : "text-slate-300 hover:text-white hover:bg-slate-800/50",
                      )}
                    >
                      <div className="relative">
                        <n.icon className="h-4 w-4" />
                        {n.to === "/notifications" && unread > 0 && (
                          <span className="absolute -top-1 -right-2 h-3.5 min-w-3.5 rounded-full bg-[#5C8EFA] text-[#0A0F1D] text-[9px] font-bold flex items-center justify-center px-0.5">
                            {unread}
                          </span>
                        )}
                      </div>
                      <span>{n.label}</span>
                    </Link>
                  </SheetClose>
                );
              })}
            </div>

            {/* Admin Controls */}
            {isAdmin && (
              <div className="space-y-1">
                <div className="px-3 mb-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  Admin Tools
                </div>
                <SheetClose asChild>
                  <Link
                    to="/configure"
                    className={cn(
                      "flex items-center gap-3 px-3 py-2 rounded-md text-xs font-semibold transition-colors",
                      location.pathname === "/configure"
                        ? "bg-[#141F36] text-[#5C8EFA] font-bold"
                        : "text-slate-300 hover:text-white hover:bg-slate-800/50",
                    )}
                  >
                    <Settings className="h-4 w-4" />
                    <span>Configure System</span>
                  </Link>
                </SheetClose>
                <SheetClose asChild>
                  <Link
                    to="/admin"
                    className={cn(
                      "flex items-center gap-3 px-3 py-2 rounded-md text-xs font-semibold transition-colors",
                      location.pathname === "/admin"
                        ? "bg-[#141F36] text-[#5C8EFA] font-bold"
                        : "text-slate-300 hover:text-white hover:bg-slate-800/50",
                    )}
                  >
                    <ShieldAlert className="h-4 w-4" />
                    <span>Admin Panel</span>
                  </Link>
                </SheetClose>
              </div>
            )}

            {/* Account Controls */}
            <div className="space-y-1">
              <div className="px-3 mb-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Account & Data
              </div>
              {(isManager || isAdmin) && (
                <SheetClose asChild>
                  <Link
                    to="/exports"
                    className={cn(
                      "flex items-center gap-3 px-3 py-2 rounded-md text-xs font-semibold transition-colors",
                      location.pathname === "/exports"
                        ? "bg-[#141F36] text-[#5C8EFA] font-bold"
                        : "text-slate-300 hover:text-white hover:bg-slate-800/50",
                    )}
                  >
                    <Download className="h-4 w-4 text-[#5C8EFA]" />
                    <span>Exports & Reports</span>
                  </Link>
                </SheetClose>
              )}
              <SheetClose asChild>
                <Link
                  to="/settings/notifications"
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-md text-xs font-semibold transition-colors",
                    location.pathname.startsWith("/settings")
                      ? "bg-[#141F36] text-[#5C8EFA] font-bold"
                      : "text-slate-300 hover:text-white hover:bg-slate-800/50",
                  )}
                >
                  <Settings className="h-4 w-4" />
                  <span>Settings</span>
                </Link>
              </SheetClose>
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  handleLogout();
                }}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-xs font-semibold text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
              >
                <LogOut className="h-4 w-4" />
                <span>Sign Out</span>
              </button>
            </div>

          </div>
        </SheetContent>
      </Sheet>

      {/* Modals & Floating Widgets */}
      <NotificationsModal open={notifModalOpen} onOpenChange={setNotifModalOpen} />
      <GlobalSearchModal
        open={searchModalOpen}
        onOpenChange={setSearchModalOpen}
        onOpenCreateTask={() => setAddTaskOpen(true)}
      />
      <GlobalCompleteTaskEodDialog />
      <GlobalFeedbackWidget />
      {user && (
        <TaskFormDialog
          open={addTaskOpen}
          onOpenChange={setAddTaskOpen}
          userId={user.id}
          onSaved={() => queryClient.invalidateQueries()}
        />
      )}
    </div>
  );
}
