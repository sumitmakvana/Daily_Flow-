import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, Fragment } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Users,
  TrendingUp,
  Clock,
  AlertOctagon,
  Search,
  Plus,
  Briefcase,
  Info,
  Table,
  Grid,
  UserCheck,
  MoreVertical,
  UserPlus,
  BarChart2,
  CheckCircle2,
  ListTodo,
  ChevronDown,
  ChevronUp,
  Filter,
  Eye,
  Calendar,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Check,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Profile, Task, Project } from "@/lib/types";
import { formatHoursMins } from "@/lib/format";
import { getTodayDateStr, formatToDateStr, isTaskCompletedToday } from "@/lib/task-date-utils";
import { TaskFormDialog } from "@/components/TaskFormDialog";
import { ExecutiveMemberInspectionDrawer } from "./executive";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/team-capacity")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) return;
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user.id);
    const set = new Set((roles ?? []).map((r) => r.role));
    if (!set.has("admin") && !set.has("manager")) {
      throw redirect({ to: "/today" });
    }
  },
  component: TeamCapacityPage,
});

function TeamCapacityPage() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [teamFilter, setTeamFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [availabilityFilter, setAvailabilityFilter] = useState("all");
  const [viewMode, setViewMode] = useState<"table" | "card">("table");
  const [selectedAssignMemberId, setSelectedAssignMemberId] = useState<string | null>(null);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [inspectMemberId, setInspectMemberId] = useState<string | null>(null);

  // Completed History expandable rows state
  const [expandedHistoryMemberIds, setExpandedHistoryMemberIds] = useState<Record<string, boolean>>({});

  // Selection checkboxes state
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(new Set());

  // Pagination state (Show all members on 1 page)
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 25;

  const todayStr = useMemo(() => getTodayDateStr(), []);

  // Compute yesterday string (YYYY-MM-DD)
  const yesterdayStr = useMemo(() => {
    try {
      const d = new Date(todayStr);
      d.setDate(d.getDate() - 1);
      return d.toISOString().slice(0, 10);
    } catch {
      return "";
    }
  }, [todayStr]);

  // 1. Fetch profiles & user_roles (Real DB)
  const { data: profiles = [] } = useQuery({
    queryKey: ["capacity-profiles"],
    queryFn: async () => {
      const [{ data: profs }, { data: roles }] = await Promise.all([
        supabase.from("profiles").select("*").order("display_name"),
        supabase.from("user_roles").select("user_id, role"),
      ]);

      const rolesMap = new Map<string, string>();
      (roles ?? []).forEach((r) => {
        if (r.user_id && r.role) rolesMap.set(r.user_id, r.role);
      });

      return (profs ?? []).map((p) => ({
        ...p,
        role: rolesMap.get(p.id) || "member",
      })) as (Profile & { role?: string; team_id?: string })[];
    },
    staleTime: 10000,
  });

  // 2. Fetch tasks (Real DB)
  const { data: tasks = [] } = useQuery({
    queryKey: ["capacity-tasks"],
    queryFn: async () => {
      const { data } = await supabase
        .from("tasks")
        .select("*")
        .order("created_at", { ascending: false });
      return (data ?? []) as Task[];
    },
    staleTime: 10000,
  });

  // 3. Fetch teams (Real DB)
  const { data: teams = [] } = useQuery({
    queryKey: ["capacity-teams"],
    queryFn: async () => {
      const { data } = await supabase.from("teams").select("id, name");
      return (data ?? []) as Array<{ id: string; name: string }>;
    },
    staleTime: 30000,
  });

  // 4. Fetch projects (Real DB)
  const { data: projects = [] } = useQuery({
    queryKey: ["capacity-projects"],
    queryFn: async () => {
      const { data } = await supabase.from("projects").select("id, name, client, status");
      return (data ?? []) as Project[];
    },
    staleTime: 30000,
  });

  // Extract ALL unique, clean project names
  const allProjectsList = useMemo(() => {
    const map = new Map<string, string>();
    projects.forEach((pr) => {
      if (pr.name && pr.name.trim()) {
        const clean = pr.name.trim();
        map.set(clean.toLowerCase(), clean);
      }
    });
    tasks.forEach((t) => {
      if (t.project_name && t.project_name.trim()) {
        const clean = t.project_name.trim();
        if (!map.has(clean.toLowerCase())) {
          map.set(clean.toLowerCase(), clean);
        }
      }
    });
    return Array.from(map.values()).sort((a, b) => a.localeCompare(b));
  }, [projects, tasks]);

  // Member Data Aggregation including Completed History & Completed Today
  const memberData = useMemo(() => {
    return profiles.map((p) => {
      const memberTasks = tasks.filter((t) => t.assigned_to === p.id);
      const activeTasks = memberTasks.filter((t) => t.status === "In Progress");
      const upcomingTasks = memberTasks.filter(
        (t) => t.status === "To Do" || (t.status as string) === "Pending",
      );
      const completedTasks = memberTasks.filter((t) => t.status === "Completed");
      const blockedTasks = memberTasks.filter((t) => t.status === "Blocked");

      const overdueTasks = memberTasks.filter((t) => {
        if (t.status === "Completed") return false;
        if (!t.due_date) return false;
        const due = formatToDateStr(t.due_date) || t.due_date.slice(0, 10);
        return due < todayStr;
      });

      // Planned Hours for Capacity
      const plannedHours = memberTasks.reduce(
        (s, t) => (t.status !== "Completed" ? s + Number(t.planned_hours ?? 0) : s),
        0,
      );

      const maxDailyHours = 8;
      const capacityPct = Math.min(150, Math.round((plannedHours / maxDailyHours) * 100));

      let capacityStatus: "free" | "available" | "partially" | "overloaded" = "available";

      if (plannedHours === 0) {
        capacityStatus = "free";
      } else if (plannedHours > 8 || blockedTasks.length > 0) {
        capacityStatus = "overloaded";
      } else if (plannedHours >= 5.5) {
        capacityStatus = "partially";
      } else {
        capacityStatus = "available";
      }

      // --- Completed Today Computation ---
      const completedTodayTasks = memberTasks.filter((t) => isTaskCompletedToday(t, todayStr));
      const completedTodayHours = completedTodayTasks.reduce(
        (sum, t) => sum + Number(t.actual_hours || t.planned_hours || 0),
        0,
      );

      // --- Completed History (Past Days) Computation ---
      const pastCompletedTasks = completedTasks.filter((t) => {
        const compDate =
          (t.completed_at ? formatToDateStr(t.completed_at) : null) ||
          (t.updated_at ? formatToDateStr(t.updated_at) : null);
        return compDate && compDate < todayStr;
      });

      // Group past completed tasks by completion date YYYY-MM-DD
      const historyDateMap = new Map<
        string,
        { dateStr: string; formattedDate: string; relativeLabel: string; totalHours: number; tasks: Task[] }
      >();

      pastCompletedTasks.forEach((t) => {
        const compDate =
          (t.completed_at ? formatToDateStr(t.completed_at) : null) ||
          (t.updated_at ? formatToDateStr(t.updated_at) : null) ||
          "Older";

        if (!historyDateMap.has(compDate)) {
          let formattedDate = compDate;
          let relativeLabel = "";
          try {
            const d = new Date(compDate);
            if (!isNaN(d.getTime())) {
              formattedDate = d.toLocaleDateString("en-GB", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              });

              if (compDate === yesterdayStr) {
                relativeLabel = "Yesterday";
              } else {
                const todayD = new Date(todayStr);
                const diffTime = todayD.getTime() - d.getTime();
                const diffDays = Math.round(diffTime / (1000 * 3600 * 24));
                if (diffDays > 1) relativeLabel = `${diffDays} Days Ago`;
              }
            }
          } catch {
            formattedDate = compDate;
          }

          historyDateMap.set(compDate, {
            dateStr: compDate,
            formattedDate,
            relativeLabel,
            totalHours: 0,
            tasks: [],
          });
        }

        const entry = historyDateMap.get(compDate)!;
        entry.tasks.push(t);
        entry.totalHours += Number(t.actual_hours || t.planned_hours || 0);
      });

      // Sort past dates descending (most recent past date first)
      const historyList = Array.from(historyDateMap.values()).sort((a, b) =>
        b.dateStr.localeCompare(a.dateStr)
      );

      // Extract Yesterday completed tasks specifically
      const yesterdayEntry = historyList.find((h) => h.dateStr === yesterdayStr || h.relativeLabel === "Yesterday");
      const completedYesterdayHours = yesterdayEntry ? yesterdayEntry.totalHours : 0;
      const completedYesterdayCount = yesterdayEntry ? yesterdayEntry.tasks.length : 0;

      const dbRole = p.role || "member";
      const title =
        dbRole === "admin"
          ? "Admin / Lead"
          : dbRole === "manager"
          ? "Manager"
          : "Team Member";

      const teamName = p.team_id
        ? teams.find((tm) => tm.id === p.team_id)?.name || "General Team"
        : "General Team";

      const realProjectSkills = Array.from(
        new Set(memberTasks.map((t) => t.project_name).filter(Boolean)),
      ) as string[];

      const mainProjectName = realProjectSkills[0] || "General Workspace";

      return {
        profile: p,
        memberTasks,
        activeTasks,
        upcomingTasks,
        completedTasks,
        blockedTasks,
        overdueTasks,
        plannedHours,
        maxDailyHours,
        capacityPct,
        capacityStatus,
        title,
        skills: realProjectSkills,
        mainProjectName,
        teamName,
        completedTodayTasks,
        completedTodayHours,
        historyList,
        yesterdayEntry,
        completedYesterdayHours,
        completedYesterdayCount,
      };
    });
  }, [profiles, tasks, teams, todayStr, yesterdayStr]);

  // Filtered Members
  const filteredMembers = useMemo(() => {
    return memberData.filter((item) => {
      const p = item.profile;
      const matchSearch =
        !search.trim() ||
        p.display_name.toLowerCase().includes(search.toLowerCase()) ||
        (p.email && p.email.toLowerCase().includes(search.toLowerCase())) ||
        item.title.toLowerCase().includes(search.toLowerCase()) ||
        item.teamName.toLowerCase().includes(search.toLowerCase()) ||
        item.mainProjectName.toLowerCase().includes(search.toLowerCase()) ||
        item.skills.some((s) => s.toLowerCase().includes(search.toLowerCase())) ||
        item.memberTasks.some((t) => t.task_name.toLowerCase().includes(search.toLowerCase()));

      const matchTeam =
        teamFilter === "all" ||
        item.teamName.toLowerCase() === teamFilter.toLowerCase() ||
        p.team_id === teamFilter;

      const matchProject =
        projectFilter === "all" ||
        item.skills.some((s) => s.toLowerCase().includes(projectFilter.toLowerCase())) ||
        item.memberTasks.some((t) => t.project_name?.toLowerCase().includes(projectFilter.toLowerCase()));

      const matchStatus =
        statusFilter === "all" ||
        (statusFilter === "completed" && item.completedTodayTasks.length > 0) ||
        (statusFilter === "in_progress" && item.activeTasks.length > 0) ||
        (statusFilter === "to_do" && item.upcomingTasks.length > 0) ||
        (statusFilter === "overdue" && item.overdueTasks.length > 0);

      const matchAvailability =
        availabilityFilter === "all" ||
        (availabilityFilter === "free" && item.capacityStatus === "free") ||
        (availabilityFilter === "available" && item.capacityStatus === "available") ||
        (availabilityFilter === "partially" && item.capacityStatus === "partially") ||
        (availabilityFilter === "overloaded" && item.capacityStatus === "overloaded");

      return matchSearch && matchTeam && matchProject && matchStatus && matchAvailability;
    });
  }, [memberData, search, teamFilter, projectFilter, statusFilter, availabilityFilter]);

  // Pagination calculation
  const totalPages = Math.ceil(filteredMembers.length / pageSize) || 1;
  const paginatedMembers = useMemo(() => {
    const startIdx = (currentPage - 1) * pageSize;
    return filteredMembers.slice(startIdx, startIdx + pageSize);
  }, [filteredMembers, currentPage, pageSize]);

  // Global KPI Summary Metrics (matching Image 2)
  const kpis = useMemo(() => {
    const totalTasksCount = tasks.length;
    const completedTodayTasks = tasks.filter((t) => isTaskCompletedToday(t, todayStr));
    const completedTodayCount = completedTodayTasks.length;
    const completedTodayHoursTotal = completedTodayTasks.reduce(
      (sum, t) => sum + Number(t.actual_hours || t.planned_hours || 0),
      0,
    );

    const inProgressCount = tasks.filter((t) => t.status === "In Progress").length;
    const inProgressPct = totalTasksCount > 0 ? Math.round((inProgressCount / totalTasksCount) * 100) : 0;

    const toDoCount = tasks.filter((t) => t.status === "To Do" || (t.status as string) === "Pending").length;
    const toDoPct = totalTasksCount > 0 ? Math.round((toDoCount / totalTasksCount) * 100) : 0;

    const overdueCount = tasks.filter((t) => {
      if (t.status === "Completed") return false;
      if (!t.due_date) return false;
      const due = formatToDateStr(t.due_date) || t.due_date.slice(0, 10);
      return due < todayStr;
    }).length;
    const overduePct = totalTasksCount > 0 ? Math.round((overdueCount / totalTasksCount) * 100) : 0;

    const totalMembersCount = profiles.length;

    return {
      totalTasksCount,
      completedTodayCount,
      completedTodayHoursTotal,
      inProgressCount,
      inProgressPct,
      toDoCount,
      toDoPct,
      overdueCount,
      overduePct,
      totalMembersCount,
    };
  }, [tasks, profiles, todayStr]);

  const toggleSelectAll = () => {
    if (selectedMemberIds.size === paginatedMembers.length) {
      setSelectedMemberIds(new Set());
    } else {
      setSelectedMemberIds(new Set(paginatedMembers.map((m) => m.profile.id)));
    }
  };

  const toggleSelectMember = (id: string) => {
    const next = new Set(selectedMemberIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedMemberIds(next);
  };

  const toggleExpandHistory = (memberId: string) => {
    setExpandedHistoryMemberIds((prev) => ({
      ...prev,
      [memberId]: !prev[memberId],
    }));
  };

  const handleAssignTask = (memberId: string) => {
    setSelectedAssignMemberId(memberId);
    setTaskDialogOpen(true);
  };

  const resetFilters = () => {
    setSearch("");
    setTeamFilter("all");
    setProjectFilter("all");
    setStatusFilter("all");
    setAvailabilityFilter("all");
  };

  return (
    <div className="min-h-screen bg-[#0b0f17] text-slate-100 p-4 sm:p-6 space-y-4 font-sans">
      {/* Top Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 pb-3.5">
        <div className="space-y-0.5">
          <h1 className="text-xl font-bold tracking-tight text-slate-100 flex items-center gap-2">
            Team Capacity & Workload Dashboard
            <span
              title="Overview of team workload, completed tasks history across days, and capacity"
              className="text-slate-400 hover:text-slate-200 cursor-pointer transition-colors"
            >
              <Info className="h-4 w-4" />
            </span>
          </h1>
          <p className="text-xs text-slate-400">
            Monitor team capacity, track completed tasks history per member, and manage workload effectively.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => window.print()}
            className="h-8 text-xs gap-1.5 font-medium border-slate-700 bg-slate-800/60 text-slate-200 hover:bg-slate-700 hover:text-white"
          >
            <BarChart2 className="h-3.5 w-3.5 text-indigo-400" /> Export Report
          </Button>
          <Button
            size="sm"
            onClick={() => handleAssignTask(user?.id ?? "")}
            className="h-8 text-xs font-semibold gap-1.5 shadow-sm px-3.5 bg-indigo-600 hover:bg-indigo-500 text-white border-0"
          >
            <Plus className="h-3.5 w-3.5" /> Assign Work
          </Button>
        </div>
      </div>

      {/* Top Metric KPI Cards Bar (Matching Image 2) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* Card 1: Total Tasks */}
        <div className="bg-[#121929] border border-slate-800/90 rounded-xl p-3.5 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-slate-400 text-[11px] font-medium uppercase tracking-wider">
            <span>Total Tasks</span>
            <div className="p-1.5 bg-indigo-500/10 rounded-lg text-indigo-400">
              <ListTodo className="h-3.5 w-3.5" />
            </div>
          </div>
          <div className="text-xl font-bold text-slate-100">{kpis.totalTasksCount}</div>
          <div className="text-[10px] text-slate-400">Across all projects</div>
        </div>

        {/* Card 2: Completed Today */}
        <div className="bg-[#121929] border border-slate-800/90 rounded-xl p-3.5 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-slate-400 text-[11px] font-medium uppercase tracking-wider">
            <span>Completed Today</span>
            <div className="p-1.5 bg-emerald-500/10 rounded-lg text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
            </div>
          </div>
          <div className="text-xl font-bold text-emerald-400">{kpis.completedTodayCount}</div>
          <div className="text-[10px] text-emerald-400/90 font-medium">
            {kpis.completedTodayHoursTotal} hrs logged
          </div>
        </div>

        {/* Card 3: In Progress */}
        <div className="bg-[#121929] border border-slate-800/90 rounded-xl p-3.5 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-slate-400 text-[11px] font-medium uppercase tracking-wider">
            <span>In Progress</span>
            <div className="p-1.5 bg-blue-500/10 rounded-lg text-blue-400">
              <Clock className="h-3.5 w-3.5" />
            </div>
          </div>
          <div className="text-xl font-bold text-blue-400">{kpis.inProgressCount}</div>
          <div className="text-[10px] text-blue-400/90 font-medium">{kpis.inProgressPct}% of total</div>
        </div>

        {/* Card 4: To Do */}
        <div className="bg-[#121929] border border-slate-800/90 rounded-xl p-3.5 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-slate-400 text-[11px] font-medium uppercase tracking-wider">
            <span>To Do</span>
            <div className="p-1.5 bg-amber-500/10 rounded-lg text-amber-400">
              <TrendingUp className="h-3.5 w-3.5" />
            </div>
          </div>
          <div className="text-xl font-bold text-amber-400">{kpis.toDoCount}</div>
          <div className="text-[10px] text-amber-400/90 font-medium">{kpis.toDoPct}% queued</div>
        </div>

        {/* Card 5: Overdue */}
        <div className="bg-[#121929] border border-slate-800/90 rounded-xl p-3.5 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-slate-400 text-[11px] font-medium uppercase tracking-wider">
            <span>Overdue</span>
            <div className="p-1.5 bg-rose-500/10 rounded-lg text-rose-400">
              <AlertOctagon className="h-3.5 w-3.5" />
            </div>
          </div>
          <div className="text-xl font-bold text-rose-400">{kpis.overdueCount}</div>
          <div className="text-[10px] text-rose-400/90 font-medium">{kpis.overduePct}% past due</div>
        </div>

        {/* Card 6: Total Members */}
        <div className="bg-[#121929] border border-slate-800/90 rounded-xl p-3.5 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-slate-400 text-[11px] font-medium uppercase tracking-wider">
            <span>Total Members</span>
            <div className="p-1.5 bg-purple-500/10 rounded-lg text-purple-400">
              <Users className="h-3.5 w-3.5" />
            </div>
          </div>
          <div className="text-xl font-bold text-slate-100">{kpis.totalMembersCount}</div>
          <div className="text-[10px] text-slate-400">Active Team Members</div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-[#121929] border border-slate-800/90 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 shadow-sm">
        {/* Search input */}
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <Input
            placeholder="Search members, projects, tasks..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setCurrentPage(1);
            }}
            className="h-8 pl-8 text-xs bg-[#0b0f17] border-slate-700/80 text-slate-200 placeholder:text-slate-500 focus:border-indigo-500 rounded-md"
          />
        </div>

        {/* Select Dropdowns */}
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={teamFilter}
            onValueChange={(val) => {
              setTeamFilter(val);
              setCurrentPage(1);
            }}
          >
            <SelectTrigger className="h-8 w-32 text-xs bg-[#0b0f17] border-slate-700/80 text-slate-200 rounded-md">
              <SelectValue placeholder="All Teams" />
            </SelectTrigger>
            <SelectContent className="bg-[#121929] border-slate-800 text-xs text-slate-200 z-[9999]">
              <SelectItem value="all">All Teams</SelectItem>
              {teams.map((tm) => (
                <SelectItem key={tm.id} value={tm.name}>
                  {tm.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={projectFilter}
            onValueChange={(val) => {
              setProjectFilter(val);
              setCurrentPage(1);
            }}
          >
            <SelectTrigger className="h-8 w-36 text-xs bg-[#0b0f17] border-slate-700/80 text-slate-200 rounded-md">
              <SelectValue placeholder="All Projects" />
            </SelectTrigger>
            <SelectContent className="bg-[#121929] border-slate-800 text-xs text-slate-200 z-[9999] max-h-60 overflow-y-auto">
              <SelectItem value="all">All Projects</SelectItem>
              {allProjectsList.map((projName) => (
                <SelectItem key={projName} value={projName}>
                  {projName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={statusFilter}
            onValueChange={(val) => {
              setStatusFilter(val);
              setCurrentPage(1);
            }}
          >
            <SelectTrigger className="h-8 w-32 text-xs bg-[#0b0f17] border-slate-700/80 text-slate-200 rounded-md">
              <SelectValue placeholder="All Status" />
            </SelectTrigger>
            <SelectContent className="bg-[#121929] border-slate-800 text-xs text-slate-200 z-[9999]">
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="completed">🟢 Completed Today</SelectItem>
              <SelectItem value="in_progress">🔵 In Progress</SelectItem>
              <SelectItem value="to_do">🟡 To Do</SelectItem>
              <SelectItem value="overdue">🔴 Overdue</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={availabilityFilter}
            onValueChange={(val) => {
              setAvailabilityFilter(val);
              setCurrentPage(1);
            }}
          >
            <SelectTrigger className="h-8 w-36 text-xs bg-[#0b0f17] border-slate-700/80 text-slate-200 rounded-md">
              <SelectValue placeholder="All Availability" />
            </SelectTrigger>
            <SelectContent className="bg-[#121929] border-slate-800 text-xs text-slate-200 z-[9999]">
              <SelectItem value="all">All Availability</SelectItem>
              <SelectItem value="free">🟢 Free Today</SelectItem>
              <SelectItem value="available">🟢 Available Today</SelectItem>
              <SelectItem value="partially">🟡 Partially Available</SelectItem>
              <SelectItem value="overloaded">🔴 Overloaded</SelectItem>
            </SelectContent>
          </Select>

          {(search || teamFilter !== "all" || projectFilter !== "all" || statusFilter !== "all" || availabilityFilter !== "all") && (
            <Button
              variant="outline"
              size="sm"
              onClick={resetFilters}
              className="h-8 px-2.5 text-xs border-slate-700/80 bg-[#0b0f17] text-slate-400 hover:text-white"
              title="Reset all filters"
            >
              <Filter className="h-3.5 w-3.5 mr-1" /> Clear
            </Button>
          )}

          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0 border-slate-700/80 bg-[#0b0f17] text-slate-400 hover:text-white shrink-0"
                title="Capacity Logic Info"
              >
                <Info className="h-3.5 w-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-80 p-3.5 bg-[#121929] border-slate-800 text-slate-200 shadow-2xl text-xs space-y-2.5 z-[9999]"
            >
              <div className="font-bold text-slate-100 border-b border-slate-800 pb-1.5 flex items-center justify-between">
                <span>Availability Rules & Capacity</span>
                <Badge variant="outline" className="text-[9px] border-slate-700 text-slate-400">
                  8h Daily Base
                </Badge>
              </div>
              <div className="space-y-2 text-[11px]">
                <div className="flex items-start gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 mt-1 shrink-0" />
                  <div>
                    <span className="font-bold text-emerald-400">🟢 Free / Available (&lt;5.5h):</span>
                    <span className="text-slate-400 block text-[10px]">Low workload with clear capacity.</span>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <span className="h-2 w-2 rounded-full bg-amber-500 mt-1 shrink-0" />
                  <div>
                    <span className="font-bold text-amber-400">🟡 Partially Available (5.5h – 8h):</span>
                    <span className="text-slate-400 block text-[10px]">Near max daily hours.</span>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <span className="h-2 w-2 rounded-full bg-rose-500 mt-1 shrink-0" />
                  <div>
                    <span className="font-bold text-rose-400">🔴 Overloaded (&gt;8h / Blocked):</span>
                    <span className="text-slate-400 block text-[10px]">Overcapacity or active blocker.</span>
                  </div>
                </div>
              </div>
            </PopoverContent>
          </Popover>

          {/* View Mode Toggle Buttons */}
          <div className="flex items-center gap-1 bg-[#0b0f17] border border-slate-700/80 p-1 rounded-md">
            <Button
              size="sm"
              variant={viewMode === "table" ? "default" : "ghost"}
              onClick={() => setViewMode("table")}
              className={`h-6 text-xs px-2.5 gap-1.5 font-medium rounded-sm ${
                viewMode === "table" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              <Table className="h-3 w-3" /> Table View
            </Button>
            <Button
              size="sm"
              variant={viewMode === "card" ? "default" : "ghost"}
              onClick={() => setViewMode("card")}
              className={`h-6 text-xs px-2.5 gap-1.5 font-medium rounded-sm ${
                viewMode === "card" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              <Grid className="h-3 w-3" /> Card View
            </Button>
          </div>
        </div>
      </div>

      {/* MAIN NATIVE HTML TABLE VIEW (Clean, Spacious & Beautiful) */}
      {viewMode === "table" ? (
        <div className="bg-[#121929] border border-slate-800/90 rounded-xl overflow-x-auto shadow-sm">
          <table className="w-full text-left text-xs border-collapse min-w-[1100px]">
            <thead>
              <tr className="border-b border-slate-800 bg-[#0d1322] text-slate-400 uppercase tracking-wider text-[10px] font-semibold">
                <th className="py-3 px-3.5 w-[20%] min-w-[170px]">Member</th>
                <th className="py-3 px-3.5 w-[22%] min-w-[180px]">Current Work</th>
                <th className="py-3 px-3.5 w-[18%] min-w-[160px]">Upcoming Work</th>
                <th className="py-3 px-3.5 w-[14%] min-w-[140px]">Availability & Capacity</th>
                <th className="py-3 px-3.5 w-[12%] min-w-[120px]">Completed Today</th>
                <th className="py-3 px-3.5 w-[14%] min-w-[140px]">Completed History</th>
                <th className="py-3 px-3.5 w-[10%] min-w-[100px]">Projects</th>
                <th className="py-3 px-2 text-center w-[4%] min-w-[70px]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {paginatedMembers.length > 0 ? (
                paginatedMembers.map((item) => {
                  const p = item.profile;
                  const isExpanded = !!expandedHistoryMemberIds[p.id];
                  const isSelected = selectedMemberIds.has(p.id);

                  return (
                    <Fragment key={p.id}>
                      {/* Main Member Table Row */}
                      <tr
                        onClick={() => setInspectMemberId(p.id)}
                        className={cn(
                          "hover:bg-slate-800/40 transition-colors cursor-pointer text-slate-200 group",
                          isExpanded && "bg-slate-800/30"
                        )}
                      >
                        {/* 1. Member Info */}
                        <td className="py-3 px-3.5">
                          <div className="flex items-center gap-2.5">
                            <div className="relative shrink-0">
                              <Avatar className="h-8 w-8 border border-slate-700 bg-slate-800">
                                {p.avatar_url ? (
                                  <AvatarImage src={p.avatar_url} alt={p.display_name} />
                                ) : (
                                  <AvatarFallback className="text-slate-200 text-xs font-semibold bg-indigo-900/60">
                                    {p.display_name.slice(0, 2).toUpperCase()}
                                  </AvatarFallback>
                                )}
                              </Avatar>
                              <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-[#121929]" />
                            </div>
                            <div className="min-w-0 space-y-0.5">
                              <div className="font-semibold text-slate-100 truncate group-hover:text-indigo-400 transition-colors">
                                {p.display_name}
                              </div>
                              <div className="text-[11px] text-slate-400 truncate">{item.title}</div>
                            </div>
                          </div>
                        </td>

                        {/* 3. Current Work */}
                        <td className="py-3 px-3.5">
                          {item.activeTasks.length > 0 ? (
                            <div className="space-y-1">
                              {item.activeTasks.slice(0, 2).map((t) => (
                                <div key={t.id} className="flex items-center justify-between gap-2 text-xs">
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 shrink-0 animate-pulse" />
                                    <span className="font-medium text-slate-200 truncate max-w-[140px]" title={t.task_name}>
                                      {t.task_name}
                                    </span>
                                  </div>
                                  <Badge variant="outline" className="text-[9px] px-1.5 py-0 shrink-0 border-indigo-500/30 text-indigo-400 bg-indigo-500/10">
                                    In Progress
                                  </Badge>
                                </div>
                              ))}
                              {item.activeTasks.length > 2 && (
                                <span className="text-[10px] text-slate-400">+{item.activeTasks.length - 2} more tasks</span>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-500 italic">— No Active Tasks</span>
                          )}
                        </td>

                        {/* 4. Upcoming Work */}
                        <td className="py-3 px-3.5">
                          {item.upcomingTasks.length > 0 ? (
                            <div className="space-y-1">
                              {item.upcomingTasks.slice(0, 2).map((t) => (
                                <div key={t.id} className="flex items-center justify-between gap-2 text-xs">
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />
                                    <span className="font-medium text-slate-300 truncate max-w-[140px]" title={t.task_name}>
                                      {t.task_name}
                                    </span>
                                  </div>
                                  <Badge variant="outline" className="text-[9px] px-1.5 py-0 shrink-0 border-amber-500/30 text-amber-400 bg-amber-500/10">
                                    To Do
                                  </Badge>
                                </div>
                              ))}
                              {item.upcomingTasks.length > 2 && (
                                <span className="text-[10px] text-slate-400">+{item.upcomingTasks.length - 2} more tasks</span>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-500 italic">— No Queued Tasks</span>
                          )}
                        </td>

                        {/* 5. Availability & Capacity */}
                        <td className="py-3 px-3.5">
                          <div className="flex items-center gap-2.5">
                            {/* Ring */}
                            <div className="relative h-8 w-8 flex items-center justify-center shrink-0">
                              <svg className="h-full w-full transform -rotate-90" viewBox="0 0 36 36">
                                <path
                                  className="text-slate-800"
                                  strokeWidth="3.5"
                                  stroke="currentColor"
                                  fill="none"
                                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                                />
                                <path
                                  className={
                                    item.capacityPct > 100
                                      ? "text-rose-500"
                                      : item.capacityPct >= 70
                                      ? "text-amber-500"
                                      : "text-emerald-500"
                                  }
                                  strokeDasharray={`${Math.min(100, item.capacityPct)}, 100`}
                                  strokeWidth="3.5"
                                  strokeLinecap="round"
                                  stroke="currentColor"
                                  fill="none"
                                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                                />
                              </svg>
                              <span className="absolute text-[8px] font-bold text-slate-200">
                                {item.capacityPct}%
                              </span>
                            </div>

                            <div className="space-y-0.5 shrink-0">
                              <Badge
                                variant="outline"
                                className={cn(
                                  "text-[9px] px-1.5 py-0 font-medium flex items-center gap-1 w-fit border-0",
                                  item.capacityStatus === "free" || item.capacityStatus === "available"
                                    ? "bg-emerald-500/10 text-emerald-400"
                                    : item.capacityStatus === "partially"
                                    ? "bg-amber-500/10 text-amber-400"
                                    : "bg-rose-500/10 text-rose-400"
                                )}
                              >
                                {item.capacityStatus === "free"
                                  ? "Free Today"
                                  : item.capacityStatus === "available"
                                  ? "Available"
                                  : item.capacityStatus === "partially"
                                  ? "Partially Free"
                                  : "Overloaded"}
                              </Badge>
                              <div className="text-[10px] font-mono text-slate-400 whitespace-nowrap">
                                {formatHoursMins(item.plannedHours)} / 8 hrs
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* 6. Completed Today */}
                        <td className="py-3 px-3.5">
                          <div className="flex items-center gap-2">
                            <CheckCircle2
                              className={cn(
                                "h-4 w-4 shrink-0",
                                item.completedTodayTasks.length > 0 ? "text-emerald-400" : "text-slate-600"
                              )}
                            />
                            <div className="space-y-0.5">
                              <div className="text-xs font-semibold text-slate-200">
                                {item.completedTodayHours} hrs
                              </div>
                              <div className="text-[10px] text-slate-400 font-mono">
                                {item.completedTodayTasks.length} tasks today
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* 7. Completed History (Yesterday & Past Days - Direct Visibility) */}
                        <td className="py-3 px-3.5" onClick={(e) => e.stopPropagation()}>
                          {item.historyList.length > 0 ? (
                            <div
                              onClick={() => toggleExpandHistory(p.id)}
                              className={cn(
                                "p-1.5 rounded-md border cursor-pointer transition-all space-y-1 group/hist",
                                isExpanded
                                  ? "bg-indigo-950/40 border-indigo-500/40"
                                  : "bg-slate-800/50 border-slate-700/70 hover:bg-slate-800 hover:border-slate-600"
                              )}
                              title="Click to toggle detailed task breakdown"
                            >
                              <div className="flex items-center justify-between gap-1 text-[11px]">
                                <div className="flex items-center gap-1 font-medium text-slate-300">
                                  <Calendar className="h-3 w-3 text-indigo-400 shrink-0" />
                                  <span className="text-[10px] text-slate-400">Past History</span>
                                </div>
                                {isExpanded ? (
                                  <ChevronUp className="h-3 w-3 text-indigo-400 shrink-0" />
                                ) : (
                                  <ChevronDown className="h-3 w-3 text-slate-400 group-hover/hist:text-slate-200 shrink-0" />
                                )}
                              </div>

                              {/* DIRECT VISIBILITY: Shows 1-2 days completed totals right in the cell */}
                              <div className="space-y-0.5">
                                {item.historyList.slice(0, 2).map((hist) => (
                                  <div
                                    key={hist.dateStr}
                                    className="flex items-center justify-between gap-1.5 text-[10px] bg-[#0b0f17]/70 px-1.5 py-0.5 rounded border border-slate-800/80"
                                  >
                                    <span className="text-slate-300 font-medium truncate max-w-[90px]">
                                      {hist.relativeLabel || hist.formattedDate}:
                                    </span>
                                    <span className="text-emerald-400 font-mono font-bold shrink-0">
                                      {hist.totalHours}h ({hist.tasks.length}t)
                                    </span>
                                  </div>
                                ))}
                                {item.historyList.length > 2 && (
                                  <div className="text-[9px] font-medium text-indigo-400 text-right pr-0.5">
                                    +{item.historyList.length - 2} more days...
                                  </div>
                                )}
                              </div>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-500 italic">— No Past History</span>
                          )}
                        </td>

                        {/* 8. Projects */}
                        <td className="py-3 px-3.5">
                          <div className="flex flex-wrap gap-1 max-w-[120px]">
                            {item.skills.length > 0 ? (
                              item.skills.slice(0, 2).map((proj, idx) => (
                                <Badge
                                  key={idx}
                                  variant="secondary"
                                  className="text-[9px] px-1.5 py-0.5 truncate max-w-[90px] bg-slate-800 text-slate-300 border border-slate-700/60"
                                >
                                  {proj}
                                </Badge>
                              ))
                            ) : (
                              <span className="text-xs text-slate-500 italic">—</span>
                            )}
                            {item.skills.length > 2 && (
                              <Badge
                                variant="outline"
                                className="text-[9px] px-1 py-0 border-slate-700 text-slate-400 bg-slate-800/40"
                              >
                                +{item.skills.length - 2}
                              </Badge>
                            )}
                          </div>
                        </td>

                        {/* 9. Actions */}
                        <td className="py-3 px-2 text-center" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleAssignTask(p.id)}
                              className="h-7 w-7 p-0 rounded-md hover:bg-slate-700 text-slate-300"
                              title="Assign Task"
                            >
                              <UserPlus className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setInspectMemberId(p.id)}
                              className="h-7 w-7 p-0 rounded-md hover:bg-slate-700 text-slate-400"
                              title="Member Details / Actions"
                            >
                              <MoreVertical className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>

                      {/* EXPANDED COMPLETED HISTORY DRAWER ROW */}
                      {isExpanded && (
                        <tr className="bg-[#0a0e18]">
                          <td colSpan={8} className="p-4 border-t border-b border-indigo-500/20">
                            <div className="space-y-3 max-w-4xl">
                              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                                <div className="flex items-center gap-2 text-xs font-bold text-indigo-300">
                                  <Calendar className="h-4 w-4 text-indigo-400" />
                                  <span>Completed Tasks History for {p.display_name}</span>
                                </div>
                                <Badge variant="outline" className="text-[10px] border-indigo-500/30 text-indigo-300 bg-indigo-500/10 font-mono">
                                  {item.completedTasks.length} Total Tasks Completed
                                </Badge>
                              </div>

                              {item.historyList.length > 0 ? (
                                <div className="space-y-2.5">
                                  {item.historyList.map((hist) => (
                                    <div
                                      key={hist.dateStr}
                                      className="bg-[#121929] border border-slate-800 rounded-lg p-3 space-y-2"
                                    >
                                      {/* Date Header */}
                                      <div className="flex items-center justify-between text-xs font-semibold text-slate-200 border-b border-slate-800/80 pb-1.5">
                                        <div className="flex items-center gap-2">
                                          <span className="text-slate-100">{hist.formattedDate}</span>
                                          {hist.relativeLabel && (
                                            <span className="text-[10px] font-normal text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded-full border border-indigo-500/20">
                                              {hist.relativeLabel}
                                            </span>
                                          )}
                                        </div>
                                        <span className="text-emerald-400 font-mono text-[11px]">
                                          {hist.totalHours} hrs Completed
                                        </span>
                                      </div>

                                      {/* Completed Tasks List */}
                                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-0.5">
                                        {hist.tasks.map((task) => (
                                          <div
                                            key={task.id}
                                            className="flex items-center justify-between gap-2 p-2 bg-[#0b0f17] border border-slate-800/80 rounded text-xs"
                                          >
                                            <div className="flex items-center gap-2 min-w-0">
                                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                                              <div className="min-w-0 space-y-0.5">
                                                <div className="font-medium text-slate-200 truncate" title={task.task_name}>
                                                  {task.task_name}
                                                </div>
                                                {task.project_name && (
                                                  <span className="text-[9px] text-slate-400 block truncate">
                                                    Proj: {task.project_name}
                                                  </span>
                                                )}
                                              </div>
                                            </div>
                                            <Badge
                                              variant="secondary"
                                              className="text-[9px] font-mono shrink-0 bg-slate-800 text-emerald-400 border border-emerald-500/20"
                                            >
                                              {task.actual_hours || task.planned_hours || 0} hrs
                                            </Badge>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="py-3 text-center text-xs text-slate-500 italic">
                                  No past completed tasks recorded for this member.
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-xs text-slate-400">
                    No team members found matching search & filter criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {/* Pagination & Footer Controls */}
          <div className="bg-[#0d1322] border-t border-slate-800 px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
            <div>
              Showing {filteredMembers.length > 0 ? (currentPage - 1) * pageSize + 1 : 0} to{" "}
              {Math.min(currentPage * pageSize, filteredMembers.length)} of {filteredMembers.length} members
            </div>

            {/* Pagination Controls */}
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(1)}
                className="h-7 w-7 p-0 border-slate-800 bg-slate-900 text-slate-300 disabled:opacity-40"
              >
                <ChevronsLeft className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="h-7 w-7 p-0 border-slate-800 bg-slate-900 text-slate-300 disabled:opacity-40"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>

              {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => (
                <Button
                  key={pageNum}
                  variant={pageNum === currentPage ? "default" : "outline"}
                  size="sm"
                  onClick={() => setCurrentPage(pageNum)}
                  className={cn(
                    "h-7 w-7 p-0 text-xs font-semibold",
                    pageNum === currentPage
                      ? "bg-indigo-600 text-white"
                      : "border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800"
                  )}
                >
                  {pageNum}
                </Button>
              ))}

              <Button
                variant="outline"
                size="sm"
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                className="h-7 w-7 p-0 border-slate-800 bg-slate-900 text-slate-300 disabled:opacity-40"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage(totalPages)}
                className="h-7 w-7 p-0 border-slate-800 bg-slate-900 text-slate-300 disabled:opacity-40"
              >
                <ChevronsRight className="h-3.5 w-3.5" />
              </Button>
            </div>

            {/* Bottom Add Task Action */}
            <Button
              size="sm"
              onClick={() => handleAssignTask(user?.id ?? "")}
              className="h-8 text-xs font-semibold gap-1.5 shadow-sm px-3.5 bg-indigo-600 hover:bg-indigo-500 text-white"
            >
              <Plus className="h-3.5 w-3.5" /> Add Task
            </Button>
          </div>
        </div>
      ) : (
        /* CARD VIEW MODE */
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {paginatedMembers.map((item) => {
            const p = item.profile;
            const isExpanded = !!expandedHistoryMemberIds[p.id];

            return (
              <Card
                key={p.id}
                className="bg-[#121929] border border-slate-800 hover:border-indigo-500/40 rounded-xl overflow-hidden shadow-sm transition-all duration-200 text-slate-200"
              >
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Avatar className="h-9 w-9 border border-slate-700 bg-slate-800 shrink-0">
                        {p.avatar_url ? (
                          <AvatarImage src={p.avatar_url} alt={p.display_name} />
                        ) : (
                          <AvatarFallback className="text-slate-200 text-xs font-semibold bg-indigo-900/60">
                            {p.display_name.slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        )}
                      </Avatar>
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-bold text-sm text-slate-100 truncate">
                            {p.display_name}
                          </h3>
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[9px] px-1.5 py-0 border-0",
                              item.capacityStatus === "free" || item.capacityStatus === "available"
                                ? "bg-emerald-500/10 text-emerald-400"
                                : item.capacityStatus === "partially"
                                ? "bg-amber-500/10 text-amber-400"
                                : "bg-rose-500/10 text-rose-400"
                            )}
                          >
                            {item.capacityStatus === "free"
                              ? "Free Today"
                              : item.capacityStatus === "available"
                              ? "Available"
                              : item.capacityStatus === "partially"
                              ? "Partially Available"
                              : "Overloaded"}
                          </Badge>
                        </div>
                        <p className="text-xs text-slate-400 truncate font-medium">{item.title}</p>
                      </div>
                    </div>

                    {/* Capacity Ring */}
                    <div className="flex flex-col items-center shrink-0">
                      <div className="relative h-10 w-10 flex items-center justify-center">
                        <svg className="h-full w-full transform -rotate-90" viewBox="0 0 36 36">
                          <path
                            className="text-slate-800"
                            strokeWidth="3.5"
                            stroke="currentColor"
                            fill="none"
                            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                          />
                          <path
                            className={
                              item.capacityPct > 100
                                ? "text-rose-500"
                                : item.capacityPct >= 70
                                ? "text-amber-500"
                                : "text-emerald-500"
                            }
                            strokeDasharray={`${Math.min(100, item.capacityPct)}, 100`}
                            strokeWidth="3.5"
                            strokeLinecap="round"
                            stroke="currentColor"
                            fill="none"
                            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                          />
                        </svg>
                        <span className="absolute text-[9px] font-bold text-slate-200">
                          {item.capacityPct}%
                        </span>
                      </div>
                      <span className="text-[10px] font-mono text-slate-400 mt-0.5">
                        {formatHoursMins(item.plannedHours)} / 8 hrs
                      </span>
                    </div>
                  </div>

                  {/* Completed Today & History bar in Card */}
                  <div className="p-2.5 bg-[#0d1322] border border-slate-800 rounded-lg flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                      <div>
                        <div className="font-semibold text-slate-200">Completed Today</div>
                        <div className="text-[10px] text-emerald-400 font-mono">
                          {item.completedTodayHours} hrs ({item.completedTodayTasks.length} tasks)
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => toggleExpandHistory(p.id)}
                      className="text-xs font-semibold px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-indigo-300 border border-slate-700 flex items-center gap-1"
                    >
                      <Calendar className="h-3.5 w-3.5 text-indigo-400" />
                      <span>{item.historyList.length} Days</span>
                      {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    </button>
                  </div>

                  {/* Expandable History in Card */}
                  {isExpanded && (
                    <div className="p-3 bg-[#0b101c] border border-indigo-500/20 rounded-lg space-y-2">
                      <div className="text-xs font-bold text-indigo-300 flex items-center justify-between">
                        <span>Completed Tasks History</span>
                        <span className="text-[10px] text-slate-400">{item.completedTasks.length} Total</span>
                      </div>
                      {item.historyList.length > 0 ? (
                        item.historyList.map((hist) => (
                          <div key={hist.dateStr} className="text-xs space-y-1 border-b border-slate-800/80 pb-1.5 last:border-0 last:pb-0">
                            <div className="flex items-center justify-between text-slate-300 font-semibold text-[11px]">
                              <span>{hist.formattedDate} ({hist.relativeLabel || "Past"})</span>
                              <span className="text-emerald-400 font-mono">{hist.totalHours} hrs</span>
                            </div>
                            {hist.tasks.map((t) => (
                              <div key={t.id} className="text-[11px] text-slate-400 flex items-center justify-between pl-2">
                                <span className="truncate">✓ {t.task_name}</span>
                                <span className="font-mono text-[10px] text-emerald-400">{t.actual_hours || t.planned_hours || 0}h</span>
                              </div>
                            ))}
                          </div>
                        ))
                      ) : (
                        <div className="text-[11px] text-slate-500 italic">No past completed history.</div>
                      )}
                    </div>
                  )}

                  {/* Actions Footer */}
                  <div className="pt-2 border-t border-slate-800 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {item.skills.map((skill, idx) => (
                        <Badge key={idx} variant="secondary" className="text-[9px] px-1.5 py-0.5 bg-slate-800 text-slate-300 border border-slate-700">
                          {skill}
                        </Badge>
                      ))}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => setInspectMemberId(p.id)} className="h-7 text-xs border-slate-700 text-slate-300 bg-slate-800 hover:bg-slate-700">
                        Inspect
                      </Button>
                      <Button size="sm" onClick={() => handleAssignTask(p.id)} className="h-7 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white">
                        Assign Task
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Task Creation Form Dialog */}
      {user && (
        <TaskFormDialog
          open={taskDialogOpen}
          onOpenChange={setTaskDialogOpen}
          userId={user.id}
          initial={
            selectedAssignMemberId
              ? ({ assigned_to: selectedAssignMemberId, priority: "Medium", status: "To Do" } as Partial<Task> as any)
              : null
          }
          onSaved={() => {
            setTaskDialogOpen(false);
          }}
        />
      )}

      {/* Member Inspection Drawer */}
      {inspectMemberId && (
        <ExecutiveMemberInspectionDrawer
          memberId={inspectMemberId}
          onClose={() => setInspectMemberId(null)}
          profiles={profiles}
          tasks={tasks}
          projects={projects}
          checkins={[]}
        />
      )}
    </div>
  );
}
