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
} from "lucide-react";
import { useEffect, useState, useRef } from "react";
import { toast } from "sonner";
import { HolidayBanner } from "@/components/HolidayBanner";
import { AnnouncementNoticeBanner } from "@/components/AnnouncementNoticeBanner";
import { UX4GAccessibilityToolbar } from "@/components/UX4GAccessibilityToolbar";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth, signOut } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { SyncStatusBadge } from "@/components/SyncStatusBadge";
import { NotificationsModal } from "@/components/NotificationsModal";
import { useBrowserNotifications } from "@/hooks/use-browser-notifications";
import { DesktopNotificationPromptBanner } from "@/components/DesktopNotificationPromptBanner";
import { GlobalCompleteTaskEodDialog } from "@/components/CompleteTaskEodDialog";
import { TaskFormDialog } from "@/components/TaskFormDialog";
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
  { to: "/leaves", icon: Palmtree, label: "Team Leaves" },
  { to: "/my-day", icon: Sunrise, label: "My Day" },
  { to: "/manager", icon: ShieldAlert, label: "Manager" },
  { to: "/command", icon: Activity, label: "Command" },
  { to: "/executive", icon: Gauge, label: "Exec" },
  { to: "/forecast", icon: TrendingUp, label: "Forecast" },
  { to: "/intelligence", icon: Brain, label: "Intelligence" },
  { to: "/planning-suggestions", icon: Sparkles, label: "Suggestions" },
  { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/tasks", icon: ListChecks, label: "Tasks" },
  { to: "/calendar", icon: CalendarRange, label: "Calendar" },
  { to: "/planning", icon: CalendarRange, label: "Planning" },
  { to: "/eod", icon: Sun, label: "EOD" },
  { to: "/eod-tasks", icon: Sun, label: "My EOD" },
  { to: "/heatmap", icon: Grid3x3, label: "Heatmap" },
  { to: "/blockers", icon: AlertOctagon, label: "Blockers" },
  { to: "/analytics", icon: BarChart3, label: "Analytics" },
  { to: "/exports", icon: Download, label: "Exports" },
];

const primaryManagerNav = [
  { to: "/my-day", icon: Sunrise, label: "My Day" },
  { to: "/tasks", icon: ListChecks, label: "Tasks" },
  { to: "/calendar", icon: CalendarRange, label: "Calendar" },
  { to: "/leaves", icon: Palmtree, label: "Team Leaves" },
  { to: "/eod", icon: Sun, label: "EOD" },
  { to: "/team-capacity", icon: Users, label: "Team Capacity" },
  { to: "/executive", icon: Gauge, label: "Exec" },
  { to: "/manager", icon: ShieldAlert, label: "Manager" },
];

const secondaryManagerNav = [
  { to: "/command", icon: Activity, label: "Command Center" },
  { to: "/forecast", icon: TrendingUp, label: "Forecast" },
  { to: "/intelligence", icon: Brain, label: "Intelligence" },
  { to: "/planning-suggestions", icon: Sparkles, label: "Suggestions" },
  { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/eod-tasks", icon: Sun, label: "My EOD" },
  { to: "/heatmap", icon: Grid3x3, label: "Heatmap" },
  { to: "/blockers", icon: AlertOctagon, label: "Blockers" },
  { to: "/analytics", icon: BarChart3, label: "Analytics" },
  { to: "/exports", icon: Download, label: "Exports" },
  { to: "/admin", icon: Sparkles, label: "⭐ App Feedback" },
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
  
  // Interactive Live Search States
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<{
    tasks: Array<{ id: string; task_name: string; task_code: string | null; status: string }>;
    members: Array<{ id: string; display_name: string | null; email: string | null; avatar_url: string | null }>;
  }>({ tasks: [], members: [] });

  const searchContainerRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const [profile, setProfile] = useState<{
    display_name: string | null;
    email: string | null;
    avatar_url: string | null;
  } | null>(null);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) return;
    setSearchFocused(false);
    navigate({
      to: "/tasks",
      search: { search: q, tab: "all_tasks" } as any,
    });
  };

  // Global Ctrl+K Shortcut Handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Handle click outside to close search dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setSearchFocused(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Debounced Live Search Fetching
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 1) {
      setSearchResults({ tasks: [], members: [] });
      setIsSearching(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const [{ data: tasksData }, { data: membersData }] = await Promise.all([
          supabase
            .from("tasks")
            .select("id, task_name, task_code, status")
            .or(`task_name.ilike.%${q}%,task_code.ilike.%${q}%,project_name.ilike.%${q}%,client.ilike.%${q}%`)
            .limit(5),
          supabase
            .from("profiles")
            .select("id, display_name, email, avatar_url")
            .or(`display_name.ilike.%${q}%,email.ilike.%${q}%`)
            .limit(5),
        ]);

        setSearchResults({
          tasks: (tasksData ?? []) as any,
          members: (membersData ?? []) as any,
        });
      } catch (err) {
        console.warn("Search error:", err);
      } finally {
        setIsSearching(false);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [searchQuery]);

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

          {/* Center Interactive Live Search Bar */}
          <div ref={searchContainerRef} className="hidden md:flex flex-1 max-w-xl mx-2 lg:mx-6 relative items-center">
            <form onSubmit={handleSearchSubmit} className="w-full relative flex items-center">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => setSearchFocused(true)}
                placeholder="Search by Team Member Name or Task (Ctrl+K)"
                className="w-full bg-[#070B14] text-slate-100 placeholder:text-slate-500 pl-10 pr-16 py-1.5 rounded-md text-xs sm:text-sm font-normal border border-[#1A2538] focus:outline-none focus:border-[#5C8EFA] focus:ring-1 focus:ring-[#5C8EFA] shadow-inner transition-all"
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-0.5 transition-colors"
                  title="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-mono font-medium text-slate-500 bg-slate-800/80 px-1.5 py-0.5 rounded border border-slate-700 pointer-events-none">
                  Ctrl K
                </span>
              )}
            </form>

            {/* Live Search Results Dropdown Popup */}
            {searchFocused && searchQuery.trim().length >= 1 && (
              <div className="absolute top-full left-0 right-0 mt-1.5 bg-[#0B1220] border border-slate-700/80 rounded-lg shadow-2xl overflow-hidden z-50 divide-y divide-slate-800/80 animate-in fade-in slide-in-from-top-1 duration-150">
                {isSearching ? (
                  <div className="p-3.5 text-xs text-slate-400 flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-[#5C8EFA]" />
                    <span>Searching tasks and team members...</span>
                  </div>
                ) : (
                  <>
                    {/* Tasks Section */}
                    <div className="p-2 space-y-1">
                      <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center justify-between">
                        <span>Tasks</span>
                        <span className="text-slate-500">{searchResults.tasks.length} matches</span>
                      </div>
                      {searchResults.tasks.length === 0 ? (
                        <p className="px-2 py-1 text-xs text-slate-500 italic">No matching tasks</p>
                      ) : (
                        searchResults.tasks.map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => {
                              setSearchFocused(false);
                              navigate({ to: "/tasks", search: { highlightId: t.id, tab: "all_tasks" } as any });
                            }}
                            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs hover:bg-[#141F36] transition-colors text-left group"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <ListChecks className="h-3.5 w-3.5 text-[#5C8EFA] shrink-0" />
                              <span className="truncate text-slate-200 group-hover:text-white font-medium">
                                {t.task_name}
                              </span>
                            </div>
                            {t.task_code && (
                              <span className="text-[10px] font-mono text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded shrink-0 ml-2 border border-slate-700">
                                {t.task_code}
                              </span>
                            )}
                          </button>
                        ))
                      )}
                    </div>

                    {/* Team Members Section */}
                    <div className="p-2 space-y-1">
                      <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center justify-between">
                        <span>Team Members</span>
                        <span className="text-slate-500">{searchResults.members.length} matches</span>
                      </div>
                      {searchResults.members.length === 0 ? (
                        <p className="px-2 py-1 text-xs text-slate-500 italic">No matching team members</p>
                      ) : (
                        searchResults.members.map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => {
                              setSearchFocused(false);
                              navigate({
                                to: "/tasks",
                                search: { assignee: m.id, tab: "all_tasks" } as any,
                              });
                            }}
                            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs hover:bg-[#141F36] transition-colors text-left group"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              {m.avatar_url ? (
                                <img src={m.avatar_url} alt="" className="h-5 w-5 rounded-full object-cover shrink-0" />
                              ) : (
                                <div className="h-5 w-5 rounded-full bg-indigo-500/20 text-[#5C8EFA] flex items-center justify-center text-[10px] font-bold shrink-0">
                                  {(m.display_name || m.email || "U").charAt(0).toUpperCase()}
                                </div>
                              )}
                              <div className="min-w-0">
                                <div className="truncate text-slate-200 group-hover:text-white font-medium">
                                  {m.display_name || m.email}
                                </div>
                              </div>
                            </div>
                            <span className="text-[10px] text-[#5C8EFA] opacity-0 group-hover:opacity-100 transition-opacity font-medium">
                              View Tasks ↗
                            </span>
                          </button>
                        ))
                      )}
                    </div>

                    {/* Footer View All Search Results */}
                    <button
                      type="button"
                      onClick={() => {
                        setSearchFocused(false);
                        navigate({ to: "/tasks", search: { search: searchQuery.trim(), tab: "all_tasks" } as any });
                      }}
                      className="w-full px-3 py-2 text-center text-xs font-semibold text-[#5C8EFA] bg-[#070B14] hover:bg-[#141F36] transition-colors flex items-center justify-center gap-1"
                    >
                      <span>Press Enter or click to view all search results</span>
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Right Header Options */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            
            {/* Mobile Search Button */}
            <button
              type="button"
              onClick={() => navigate({ to: "/tasks" })}
              className="md:hidden flex items-center justify-center h-8 w-8 rounded text-slate-300 hover:text-white hover:bg-slate-800/60 transition-colors"
              title="Search"
            >
              <Search className="h-4 w-4" />
            </button>

            {/* Realtime Sync Status Badge */}
            <SyncStatusBadge />

            {/* Notification Bell Button */}
            <button
              type="button"
              onClick={() => setNotifModalOpen(true)}
              className="relative flex items-center justify-center h-8 w-8 rounded text-slate-300 hover:text-white hover:bg-slate-800/80 transition-colors cursor-pointer"
              title="Notifications"
            >
              <Bell className="h-4 w-4" />
              {unread > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white shadow-sm ring-2 ring-[#0B1120] animate-pulse">
                  {unread > 99 ? "99+" : unread}
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
                    <ChevronDown className="h-3.5 w-3.5 text-slate-400 group-hover:text-white transition-colors" />
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
                    <Link to="/settings/notifications" className="cursor-pointer">
                      <Settings className="mr-2 h-4 w-4" />
                      <span>Settings</span>
                    </Link>
                  </DropdownMenuItem>
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

            {/* Mobile Drawer Button */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="md:hidden flex items-center justify-center h-8 w-8 rounded text-slate-300 hover:text-white hover:bg-slate-800/60 transition-colors"
            >
              <Menu className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      {/* 2. SECONDARY NAVIGATION BAR - Unified App Theme Background */}
      <nav className="sticky top-14 z-20 bg-background border-b border-border/60 text-foreground transform-gpu">
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

            {/* Primary Nav Items */}
            {!isManager
              ? memberNav.map((n, idx) => {
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
                      {idx < memberNav.length - 1 && (
                        <span className="text-slate-700 select-none px-1 font-light">|</span>
                      )}
                    </div>
                  );
                })
              : (
                <>
                  {primaryManagerNav.map((n, idx) => {
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
                        <span className="text-slate-700 select-none px-1 font-light">|</span>
                      </div>
                    );
                  })}

                  {/* Secondary Manager Nav Dropdown */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="px-2.5 py-1 rounded-md text-xs font-semibold flex items-center gap-1 text-slate-300 hover:text-white hover:bg-slate-800/50 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <span>More</span>
                        <ChevronDown className="h-3 w-3 shrink-0 text-slate-400" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-52 max-h-[70vh] overflow-y-auto">
                      {secondaryManagerNav.map((n) => {
                        const active =
                          location.pathname === n.to || location.pathname.startsWith(n.to + "/");
                        return (
                          <DropdownMenuItem key={n.to} asChild>
                            <Link
                              to={n.to}
                              className={cn(
                                "w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded-sm transition-colors cursor-pointer",
                                active
                                  ? "bg-[#141F36] text-[#5C8EFA] font-bold"
                                  : "text-slate-300 hover:text-white",
                              )}
                            >
                              <n.icon className="h-3.5 w-3.5 text-slate-400" />
                              <span>{n.label}</span>
                            </Link>
                          </DropdownMenuItem>
                        );
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              )}
          </div>

          {/* Right Section Action Buttons */}
          <div className="flex items-center gap-1 shrink-0 ml-2 pl-2 border-l border-[#1A2336]">
            
            {/* Notifications Icon */}
            <button
              type="button"
              onClick={() => setNotifModalOpen(true)}
              className="relative flex items-center justify-center h-7 w-7 rounded-md text-slate-300 hover:text-white hover:bg-slate-800/50 transition-colors"
              title="Notifications"
            >
              <Bell className="h-4 w-4" />
              {unread > 0 && (
                <span className="absolute -top-0.5 -right-0.5 h-3.5 min-w-3.5 rounded-full bg-[#5C8EFA] text-[#0A0F1D] text-[9px] font-bold flex items-center justify-center px-0.5">
                  {unread}
                </span>
              )}
            </button>

            {/* Settings Link */}
            <Link to="/settings/notifications" className="hidden sm:inline-flex">
              <button
                type="button"
                className="flex items-center justify-center h-7 w-7 rounded-md text-slate-300 hover:text-white hover:bg-slate-800/50 transition-colors"
                title="Settings"
              >
                <Settings className="h-4 w-4" />
              </button>
            </Link>

            {/* Help / Accessibility Button */}
            <button
              type="button"
              onClick={() => setAccessibilityOpen(true)}
              className="flex items-center justify-center h-7 w-7 rounded-md text-slate-300 hover:text-white hover:bg-slate-800/50 transition-colors"
              title="Help & Accessibility Options"
            >
              <HelpCircle className="h-4 w-4" />
            </button>

          </div>

        </div>
      </nav>

      {/* MAIN CONTENT AREA */}
      <main id="main-content" tabIndex={-1} className="flex-1 pb-16 md:pb-0 focus:outline-none">
        <DesktopNotificationPromptBanner />
        <HolidayBanner />
        {/* <AnnouncementNoticeBanner /> */}
        {children}
      </main>

      {/* MOBILE BOTTOM NAVIGATION BAR */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 border-t border-[#1A2336] bg-[#0B111E]/95 backdrop-blur md:hidden">
        <div className="grid grid-cols-5 h-14">
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
                Account
              </div>
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

      {/* Modals */}
      <NotificationsModal open={notifModalOpen} onOpenChange={setNotifModalOpen} />
      <GlobalCompleteTaskEodDialog />
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
