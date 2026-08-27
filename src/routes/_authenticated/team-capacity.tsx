import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, Fragment } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
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
  Pencil,
  Play,
  CheckCircle,
  ExternalLink,
  Layers,
  Sparkles,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Profile, Task, Project, TaskStatus } from "@/lib/types";
import { formatHoursMins } from "@/lib/format";
import { getTodayDateStr, formatToDateStr, isTaskCompletedToday } from "@/lib/task-date-utils";
import { TaskFormDialog } from "@/components/TaskFormDialog";
import { TaskDetailModal } from "@/components/TaskDetailModal";
import { ExecutiveMemberInspectionDrawer } from "./executive";
import { StatusBadge } from "@/components/StatusBadge";
import { PriorityBadge } from "@/components/PriorityBadge";
import { useAuth } from "@/hooks/use-auth";
import { tasksService } from "@/services/tasks";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

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
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [teamFilter, setTeamFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [availabilityFilter, setAvailabilityFilter] = useState("all");
  const [viewMode, setViewMode] = useState<"table" | "card">("table");
  const [selectedAssignMemberId, setSelectedAssignMemberId] = useState<string | null>(null);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [inspectMemberId, setInspectMemberId] = useState<string | null>(null);

  // Universal Task Details Inspection Modal
  const [inspectTaskItem, setInspectTaskItem] = useState<{ task: Task; profile?: Profile } | null>(null);

  // Mini Modals state
  const [activeTaskModalItem, setActiveTaskModalItem] = useState<{ task: Task; member: Profile } | null>(null);
  const [upcomingTasksModalItem, setUpcomingTasksModalItem] = useState<{ member: Profile; tasks: Task[] } | null>(null);

  // Completed History expandable rows state
  const [expandedHistoryMemberIds, setExpandedHistoryMemberIds] = useState<Record<string, boolean>>({});

  // Pagination state
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

  // Extract ALL unique project names
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

  // Member Data Aggregation
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

      // --- Completed Today ---
      const completedTodayTasks = memberTasks.filter((t) => isTaskCompletedToday(t, todayStr));
      const completedTodayHours = completedTodayTasks.reduce(
        (sum, t) => sum + Number(t.actual_hours || t.planned_hours || 0),
        0,
      );

      // --- Completed History ---
      const pastCompletedTasks = completedTasks.filter((t) => {
        const compDate =
          (t.completed_at ? formatToDateStr(t.completed_at) : null) ||
          (t.updated_at ? formatToDateStr(t.updated_at) : null);
        return compDate && compDate < todayStr;
      });

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

      const historyList = Array.from(historyDateMap.values()).sort((a, b) =>
        b.dateStr.localeCompare(a.dateStr)
      );

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

  // Global KPI Summary Metrics
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

  const toggleExpandHistory = (memberId: string) => {
    setExpandedHistoryMemberIds((prev) => ({
      ...prev,
      [memberId]: !prev[memberId],
    }));
  };

  const handleAssignTask = (memberId: string) => {
    setSelectedAssignMemberId(memberId);
    setEditingTask(null);
    setTaskDialogOpen(true);
  };

  const handleEditTask = (task: Task) => {
    setEditingTask(task);
    setSelectedAssignMemberId(task.assigned_to);
    setTaskDialogOpen(true);
  };

  const handleQuickStatusChange = async (task: Task, newStatus: TaskStatus) => {
    if (!user) return;
    try {
      await tasksService.setStatus(task, newStatus, user.id);
      toast.success(`${task.task_code || "Task"} updated to ${newStatus}`);
      queryClient.invalidateQueries({ queryKey: ["capacity-tasks"] });
      if (activeTaskModalItem) {
        setActiveTaskModalItem({
          ...activeTaskModalItem,
          task: { ...activeTaskModalItem.task, status: newStatus },
        });
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to update task status");
    }
  };

  const resetFilters = () => {
    setSearch("");
    setTeamFilter("all");
    setProjectFilter("all");
    setStatusFilter("all");
    setAvailabilityFilter("all");
  };

  return (
    <div className="min-h-screen bg-background text-foreground p-3.5 sm:p-5 space-y-4 font-sans">
      {/* Top Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-3.5">
        <div className="space-y-1">
          <h1 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            Team Capacity & Workload Dashboard
            <span
              title="Overview of team workload, current active tasks, upcoming tasks, and capacity"
              className="text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
            >
              <Info className="h-4 w-4" />
            </span>
          </h1>
          <p className="text-xs text-muted-foreground">
            Monitor real-time team workload, inspect current tasks, track upcoming queues, and balance capacity across projects.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => window.print()}
            className="h-8 text-xs gap-1.5 font-medium border-border bg-card text-foreground hover:bg-accent"
          >
            <BarChart2 className="h-3.5 w-3.5 text-primary" /> Export Report
          </Button>
          <Button
            size="sm"
            onClick={() => handleAssignTask(user?.id ?? "")}
            className="h-8 text-xs font-semibold gap-1.5 shadow-sm px-3.5 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-3.5 w-3.5" /> Assign Work
          </Button>
        </div>
      </div>

      {/* Top Metric KPI Cards Bar (Clean, Minimal, Neutral) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* Card 1: Total Tasks */}
        <div
          onClick={() => {
            setStatusFilter("all");
            setCurrentPage(1);
          }}
          className={cn(
            "bg-card border rounded-xl p-4 space-y-2 cursor-pointer transition-all hover:border-border",
            statusFilter === "all" ? "border-primary/50 ring-1 ring-primary/30" : "border-border/70"
          )}
          title="Click to reset filters and view all tasks"
        >
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <ListTodo className="h-3.5 w-3.5 text-muted-foreground" />
            <span>Total Tasks</span>
          </div>
          <div className="text-2xl md:text-3xl font-bold text-foreground font-mono tracking-tight">{kpis.totalTasksCount}</div>
          <div className="text-[11px] text-muted-foreground">Across all projects</div>
        </div>

        {/* Card 2: Completed Today */}
        <div
          onClick={() => {
            setStatusFilter(statusFilter === "completed" ? "all" : "completed");
            setCurrentPage(1);
          }}
          className={cn(
            "bg-card border rounded-xl p-4 space-y-2 cursor-pointer transition-all hover:border-border",
            statusFilter === "completed" ? "border-primary/50 ring-1 ring-primary/30" : "border-border/70"
          )}
          title="Click to filter members who completed tasks today"
        >
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
            <span>Completed Today</span>
          </div>
          <div className="text-2xl md:text-3xl font-bold text-foreground font-mono tracking-tight">{kpis.completedTodayCount}</div>
          <div className="text-[11px] text-muted-foreground font-mono">
            {kpis.completedTodayHoursTotal} hrs logged
          </div>
        </div>

        {/* Card 3: In Progress */}
        <div
          onClick={() => {
            setStatusFilter(statusFilter === "in_progress" ? "all" : "in_progress");
            setCurrentPage(1);
          }}
          className={cn(
            "bg-card border rounded-xl p-4 space-y-2 cursor-pointer transition-all hover:border-border",
            statusFilter === "in_progress" ? "border-primary/50 ring-1 ring-primary/30" : "border-border/70"
          )}
          title="Click to filter members with tasks in progress"
        >
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            <span>In Progress</span>
          </div>
          <div className="text-2xl md:text-3xl font-bold text-foreground font-mono tracking-tight">{kpis.inProgressCount}</div>
          <div className="text-[11px] text-muted-foreground">{kpis.inProgressPct}% of total</div>
        </div>

        {/* Card 4: To Do */}
        <div
          onClick={() => {
            setStatusFilter(statusFilter === "to_do" ? "all" : "to_do");
            setCurrentPage(1);
          }}
          className={cn(
            "bg-card border rounded-xl p-4 space-y-2 cursor-pointer transition-all hover:border-border",
            statusFilter === "to_do" ? "border-primary/50 ring-1 ring-primary/30" : "border-border/70"
          )}
          title="Click to filter members with queued To Do tasks"
        >
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
            <span>To Do</span>
          </div>
          <div className="text-2xl md:text-3xl font-bold text-foreground font-mono tracking-tight">{kpis.toDoCount}</div>
          <div className="text-[11px] text-muted-foreground">{kpis.toDoPct}% queued</div>
        </div>

        {/* Card 5: Overdue */}
        <div
          onClick={() => {
            setStatusFilter(statusFilter === "overdue" ? "all" : "overdue");
            setCurrentPage(1);
          }}
          className={cn(
            "bg-card border rounded-xl p-4 space-y-2 cursor-pointer transition-all hover:border-border",
            statusFilter === "overdue" ? "border-primary/50 ring-1 ring-primary/30" : "border-border/70"
          )}
          title="Click to filter members with overdue tasks"
        >
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <AlertOctagon className="h-3.5 w-3.5 text-muted-foreground" />
            <span>Overdue</span>
          </div>
          <div className={cn("text-2xl md:text-3xl font-bold font-mono tracking-tight", kpis.overdueCount > 0 ? "text-rose-400" : "text-foreground")}>{kpis.overdueCount}</div>
          <div className="text-[11px] text-muted-foreground">{kpis.overduePct}% past due</div>
        </div>

        {/* Card 6: Total Members */}
        <div
          onClick={() => {
            setSearch("");
            setTeamFilter("all");
            setProjectFilter("all");
            setStatusFilter("all");
            setAvailabilityFilter("all");
            setCurrentPage(1);
          }}
          className="bg-card border border-border/70 rounded-xl p-4 space-y-2 cursor-pointer transition-all hover:border-border"
          title="Click to view all active members"
        >
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Users className="h-3.5 w-3.5 text-muted-foreground" />
            <span>Total Members</span>
          </div>
          <div className="text-2xl md:text-3xl font-bold text-foreground font-mono tracking-tight">{kpis.totalMembersCount}</div>
          <div className="text-[11px] text-muted-foreground">Active Team Members</div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-card border border-border/70 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3 shadow-xs">
        {/* Search input */}
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search members, projects, tasks..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setCurrentPage(1);
            }}
            className="h-8 pl-8 text-xs bg-input/40 border-border text-foreground placeholder:text-muted-foreground/60 focus-visible:ring-1 focus-visible:ring-primary rounded-md"
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
            <SelectTrigger className="h-8 w-32 text-xs bg-input/40 border-border text-foreground rounded-md">
              <SelectValue placeholder="All Teams" />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border text-xs text-popover-foreground z-[9999]">
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
            <SelectTrigger className="h-8 w-36 text-xs bg-input/40 border-border text-foreground rounded-md">
              <SelectValue placeholder="All Projects" />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border text-xs text-popover-foreground z-[9999] max-h-60 overflow-y-auto">
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
            <SelectTrigger className="h-8 w-32 text-xs bg-input/40 border-border text-foreground rounded-md">
              <SelectValue placeholder="All Status" />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border text-xs text-popover-foreground z-[9999]">
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="completed">Completed Today</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="to_do">To Do</SelectItem>
              <SelectItem value="overdue">Overdue</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={availabilityFilter}
            onValueChange={(val) => {
              setAvailabilityFilter(val);
              setCurrentPage(1);
            }}
          >
            <SelectTrigger className="h-8 w-36 text-xs bg-input/40 border-border text-foreground rounded-md">
              <SelectValue placeholder="All Availability" />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border text-xs text-popover-foreground z-[9999]">
              <SelectItem value="all">All Availability</SelectItem>
              <SelectItem value="free">Free Today</SelectItem>
              <SelectItem value="available">Available</SelectItem>
              <SelectItem value="partially">Partially Available</SelectItem>
              <SelectItem value="overloaded">Overloaded</SelectItem>
            </SelectContent>
          </Select>

          {(search || teamFilter !== "all" || projectFilter !== "all" || statusFilter !== "all" || availabilityFilter !== "all") && (
            <Button
              variant="outline"
              size="sm"
              onClick={resetFilters}
              className="h-8 px-2.5 text-xs border-border bg-card text-muted-foreground hover:text-foreground"
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
                className="h-8 w-8 p-0 border-border bg-card text-muted-foreground hover:text-foreground shrink-0"
                title="Capacity Logic Info"
              >
                <Info className="h-3.5 w-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-80 p-3.5 bg-popover border-border text-popover-foreground shadow-2xl text-xs space-y-2.5 z-[9999]"
            >
              <div className="font-bold text-foreground border-b border-border pb-1.5 flex items-center justify-between">
                <span>Availability Rules & Capacity</span>
                <Badge variant="outline" className="text-[9px] border-border text-muted-foreground font-mono">
                  8h Daily Base
                </Badge>
              </div>
              <div className="space-y-2 text-[11px]">
                <div className="flex items-start gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 mt-1 shrink-0" />
                  <div>
                    <span className="font-bold text-foreground">Free / Available (&lt;5.5h):</span>
                    <span className="text-muted-foreground block text-[10px]">Low workload with clear capacity.</span>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <span className="h-2 w-2 rounded-full bg-amber-500 mt-1 shrink-0" />
                  <div>
                    <span className="font-bold text-foreground">Partially Available (5.5h – 8h):</span>
                    <span className="text-muted-foreground block text-[10px]">Near max daily hours.</span>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <span className="h-2 w-2 rounded-full bg-rose-500 mt-1 shrink-0" />
                  <div>
                    <span className="font-bold text-foreground">Overloaded (&gt;8h / Blocked):</span>
                    <span className="text-muted-foreground block text-[10px]">Overcapacity or active blocker.</span>
                  </div>
                </div>
              </div>
            </PopoverContent>
          </Popover>

          {/* View Mode Toggle */}
          <div className="flex items-center gap-1 bg-muted/40 border border-border p-1 rounded-md">
            <Button
              size="sm"
              variant={viewMode === "table" ? "default" : "ghost"}
              onClick={() => setViewMode("table")}
              className={cn(
                "h-6 text-xs px-2.5 gap-1.5 font-medium rounded-xs",
                viewMode === "table"
                  ? "bg-primary text-primary-foreground font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Table className="h-3 w-3" /> Table
            </Button>
            <Button
              size="sm"
              variant={viewMode === "card" ? "default" : "ghost"}
              onClick={() => setViewMode("card")}
              className={cn(
                "h-6 text-xs px-2.5 gap-1.5 font-medium rounded-xs",
                viewMode === "card"
                  ? "bg-primary text-primary-foreground font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Grid className="h-3 w-3" /> Cards
            </Button>
          </div>
        </div>
      </div>

      {/* MAIN TABLE VIEW */}
      {viewMode === "table" ? (
        <div className="bg-card border border-border/70 rounded-xl overflow-x-auto shadow-xs">
          <table className="w-full text-left text-xs border-collapse min-w-[1000px]">
            <thead>
              <tr className="border-b border-border/70 text-muted-foreground text-[11px] font-semibold uppercase tracking-wider">
                <th className="py-3 px-3.5 w-[22%] min-w-[180px] font-semibold">Member</th>
                <th className="py-3 px-3.5 w-[24%] min-w-[200px] font-semibold">Current Work</th>
                <th className="py-3 px-3.5 w-[16%] min-w-[150px] font-semibold">Upcoming Work</th>
                <th className="py-3 px-3.5 w-[16%] min-w-[160px] font-semibold">Capacity</th>
                <th className="py-3 px-3.5 w-[10%] min-w-[110px] font-semibold">Done Today</th>
                <th className="py-3 px-3.5 w-[12%] min-w-[120px] font-semibold">History</th>
                <th className="py-3 px-3.5 w-[10%] min-w-[100px] font-semibold">Projects</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40 font-medium">
              {paginatedMembers.length > 0 ? (
                paginatedMembers.map((item) => {
                  const p = item.profile;
                  const isExpanded = !!expandedHistoryMemberIds[p.id];

                  return (
                    <Fragment key={p.id}>
                      {/* Main Member Table Row */}
                      <tr
                        className={cn(
                          "hover:bg-accent/30 transition-colors text-foreground group",
                          isExpanded && "bg-muted/20"
                        )}
                      >
                        {/* 1. Member Info */}
                        <td
                          className="py-3 px-3.5 cursor-pointer"
                          onClick={() => setInspectMemberId(p.id)}
                        >
                          <div className="flex items-center gap-2.5">
                            <Avatar className="h-8 w-8 border border-border shrink-0">
                              {p.avatar_url ? (
                                <AvatarImage src={p.avatar_url} alt={p.display_name} />
                              ) : (
                                <AvatarFallback className="bg-muted text-foreground text-[10px] font-bold">
                                  {p.display_name.slice(0, 2).toUpperCase()}
                                </AvatarFallback>
                              )}
                            </Avatar>
                            <div className="min-w-0 space-y-0.5">
                              <div className="font-medium text-foreground truncate group-hover:text-primary transition-colors">
                                {p.display_name}
                              </div>
                              <div className="text-[10px] text-muted-foreground truncate">{item.title}</div>
                            </div>
                          </div>
                        </td>

                        {/* 2. Current Work */}
                        <td className="py-3 px-3.5">
                          {item.activeTasks.length > 0 ? (
                            <div className="space-y-1.5">
                              {item.activeTasks.slice(0, 2).map((t) => (
                                <div
                                  key={t.id}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setInspectTaskItem({ task: t, profile: p });
                                  }}
                                  className="flex items-center justify-between gap-2 p-1.5 rounded-md bg-muted/40 hover:bg-muted/80 border border-border/80 cursor-pointer transition-all group/task"
                                  title="Click to view all task details"
                                >
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <span className="h-1.5 w-1.5 rounded-full bg-blue-400 shrink-0" />
                                    <span className="font-medium text-foreground truncate max-w-[140px] group-hover/task:text-primary">
                                      {t.task_name}
                                    </span>
                                  </div>
                                  <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                                    {t.planned_hours ? `${t.planned_hours}h` : "Active"}
                                  </span>
                                </div>
                              ))}
                              {item.activeTasks.length > 2 && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setInspectTaskItem({ task: item.activeTasks[0], profile: p });
                                  }}
                                  className="text-[10px] text-muted-foreground hover:text-foreground font-medium block"
                                >
                                  +{item.activeTasks.length - 2} more
                                </button>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground/60">—</span>
                          )}
                        </td>

                        {/* 3. Upcoming Work */}
                        <td className="py-3 px-3.5">
                          {item.upcomingTasks.length > 0 ? (
                            <div
                              onClick={(e) => {
                                e.stopPropagation();
                                setUpcomingTasksModalItem({ member: p, tasks: item.upcomingTasks });
                              }}
                              className="p-1.5 rounded-md bg-muted/30 hover:bg-muted/70 border border-border/80 cursor-pointer transition-all space-y-1 group/upc"
                              title="Click to inspect queued tasks"
                            >
                              <div className="flex items-center justify-between text-[11px]">
                                <span className="text-[10px] font-medium text-foreground">{item.upcomingTasks.length} queued</span>
                                <span className="text-[10px] font-mono text-muted-foreground">
                                  {item.upcomingTasks.reduce((s, t) => s + Number(t.planned_hours || 0), 0)}h total
                                </span>
                              </div>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground/60">—</span>
                          )}
                        </td>

                        {/* 4. Availability & Capacity */}
                        <td className="py-3 px-3.5">
                          <div className="space-y-1.5 max-w-[180px]">
                            <div className="flex items-center justify-between text-[11px] font-mono">
                              <span className="text-foreground">{formatHoursMins(item.plannedHours)} / 8h</span>
                              <span className="text-[10px] text-muted-foreground">{item.capacityPct}%</span>
                            </div>
                            <div className="h-2 w-full bg-muted/60 rounded-full overflow-hidden flex">
                              <div
                                className={cn(
                                  "h-full rounded-full transition-all",
                                  item.capacityStatus === "overloaded" ? "bg-rose-500" : "bg-blue-500"
                                )}
                                style={{ width: `${Math.min(100, item.capacityPct)}%` }}
                              />
                            </div>
                          </div>
                        </td>

                        {/* 5. Completed Today */}
                        <td className="py-3 px-3.5">
                          <div className="space-y-0.5 font-mono">
                            <div className="text-xs font-semibold text-foreground">
                              {item.completedTodayHours} hrs
                            </div>
                            <div className="text-[10px] text-muted-foreground">
                              {item.completedTodayTasks.length} tasks
                            </div>
                          </div>
                        </td>

                        {/* 6. Completed History */}
                        <td className="py-3 px-3.5" onClick={(e) => e.stopPropagation()}>
                          {item.historyList.length > 0 ? (
                            <button
                              type="button"
                              onClick={() => toggleExpandHistory(p.id)}
                              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground font-medium p-1 rounded hover:bg-muted/40 transition-colors"
                            >
                              <Calendar className="h-3.5 w-3.5" />
                              <span>{item.historyList.length} days</span>
                              {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                            </button>
                          ) : (
                            <span className="text-xs text-muted-foreground/60">—</span>
                          )}
                        </td>

                        {/* 7. Projects */}
                        <td className="py-3 px-3.5">
                          <div className="flex flex-wrap gap-1 max-w-[120px]">
                            {item.skills.length > 0 ? (
                              item.skills.slice(0, 2).map((proj, idx) => (
                                <Badge
                                  key={idx}
                                  variant="secondary"
                                  className="text-[9px] px-1.5 py-0.5 truncate max-w-[90px] bg-muted/60 text-muted-foreground border border-border/60"
                                >
                                  {proj}
                                </Badge>
                              ))
                            ) : (
                              <span className="text-xs text-muted-foreground/60">—</span>
                            )}
                            {item.skills.length > 2 && (
                              <span className="text-[10px] text-muted-foreground font-mono">
                                +{item.skills.length - 2}
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* EXPANDED COMPLETED HISTORY DRAWER ROW */}
                      {isExpanded && (
                        <tr className="bg-muted/20">
                          <td colSpan={7} className="p-4 border-t border-b border-border/80">
                            <div className="space-y-3 max-w-4xl">
                              <div className="flex items-center justify-between border-b border-border pb-2">
                                <div className="flex items-center gap-2 text-xs font-bold text-foreground">
                                  <Calendar className="h-4 w-4 text-primary" />
                                  <span>Completed Tasks History for {p.display_name}</span>
                                </div>
                                <Badge variant="outline" className="text-[10px] border-primary/30 text-primary bg-primary/10 font-mono">
                                  {item.completedTasks.length} Total Tasks Completed
                                </Badge>
                              </div>

                              {item.historyList.length > 0 ? (
                                <div className="space-y-2.5">
                                  {item.historyList.map((hist) => (
                                    <div
                                      key={hist.dateStr}
                                      className="bg-card border border-border rounded-lg p-3 space-y-2"
                                    >
                                      {/* Date Header */}
                                      <div className="flex items-center justify-between text-xs font-semibold text-foreground border-b border-border/80 pb-1.5">
                                        <div className="flex items-center gap-2">
                                          <span>{hist.formattedDate}</span>
                                          {hist.relativeLabel && (
                                            <span className="text-[10px] font-normal text-primary bg-primary/10 px-2 py-0.5 rounded-full border border-primary/20">
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
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setInspectTaskItem({ task, profile: p });
                                            }}
                                            className="flex items-center justify-between gap-2 p-2 bg-muted/40 hover:bg-muted/80 border border-border rounded text-xs cursor-pointer transition-all hover:scale-[1.01] group/histTask"
                                            title="Click to view all task details"
                                          >
                                            <div className="flex items-center gap-2 min-w-0">
                                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                                              <div className="min-w-0 space-y-0.5">
                                                <div className="font-medium text-foreground truncate group-hover/histTask:text-primary" title={task.task_name}>
                                                  {task.task_name}
                                                </div>
                                                {task.project_name && (
                                                  <span className="text-[9px] text-muted-foreground block truncate">
                                                    Proj: {task.project_name}
                                                  </span>
                                                )}
                                              </div>
                                            </div>
                                            <Badge
                                              variant="secondary"
                                              className="text-[9px] font-mono shrink-0 bg-muted text-emerald-400 border border-emerald-500/20"
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
                                <div className="py-3 text-center text-xs text-muted-foreground italic">
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
                  <td colSpan={7} className="py-12 text-center text-xs text-muted-foreground">
                    No team members found matching search & filter criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {/* Pagination Controls */}
          <div className="bg-muted/30 border-t border-border px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
            <div>
              Showing {filteredMembers.length > 0 ? (currentPage - 1) * pageSize + 1 : 0} to{" "}
              {Math.min(currentPage * pageSize, filteredMembers.length)} of {filteredMembers.length} members
            </div>

            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(1)}
                className="h-7 w-7 p-0 border-border bg-card text-foreground disabled:opacity-40"
              >
                <ChevronsLeft className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="h-7 w-7 p-0 border-border bg-card text-foreground disabled:opacity-40"
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
                    "h-7 w-7 p-0 text-xs font-semibold font-mono",
                    pageNum === currentPage
                      ? "bg-primary text-primary-foreground"
                      : "border-border bg-card text-foreground hover:bg-accent"
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
                className="h-7 w-7 p-0 border-border bg-card text-foreground disabled:opacity-40"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage(totalPages)}
                className="h-7 w-7 p-0 border-border bg-card text-foreground disabled:opacity-40"
              >
                <ChevronsRight className="h-3.5 w-3.5" />
              </Button>
            </div>

            <Button
              size="sm"
              onClick={() => handleAssignTask(user?.id ?? "")}
              className="h-8 text-xs font-semibold gap-1.5 shadow-sm px-3.5 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-3.5 w-3.5" /> Add Task
            </Button>
          </div>
        </div>
      ) : (
        /* CARD GRID VIEW MODE */
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredMembers.map((item) => {
            const p = item.profile;
            const isExpanded = !!expandedHistoryMemberIds[p.id];

            return (
              <Card
                key={p.id}
                className="bg-card border-border/70 shadow-xs hover:border-border transition-all flex flex-col justify-between"
              >
                <CardContent className="p-4 space-y-3.5">
                  {/* Card Header */}
                  <div className="flex items-start justify-between gap-2 border-b border-border/70 pb-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Avatar className="h-9 w-9 border border-border shrink-0">
                        {p.avatar_url ? (
                          <AvatarImage src={p.avatar_url} alt={p.display_name} />
                        ) : (
                          <AvatarFallback className="bg-muted text-foreground text-[10px] font-bold">
                            {p.display_name.slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        )}
                      </Avatar>
                      <div className="min-w-0 space-y-0.5">
                        <h3 className="font-semibold text-sm text-foreground truncate">{p.display_name}</h3>
                        <p className="text-xs text-muted-foreground truncate">{item.title}</p>
                      </div>
                    </div>

                    {/* Capacity Indicator */}
                    <div className="flex flex-col items-end space-y-1">
                      <div className="text-xs font-mono font-medium text-foreground">
                        {item.capacityPct}% capacity
                      </div>
                      <span className="text-[10px] font-mono text-muted-foreground">
                        {formatHoursMins(item.plannedHours)} / 8h
                      </span>
                    </div>
                  </div>

                  {/* Current Active Tasks in Card */}
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-semibold text-muted-foreground flex items-center justify-between">
                      <span>Current Active Work</span>
                      {item.activeTasks.length > 0 && (
                        <span className="text-[10px] font-mono text-muted-foreground font-medium">
                          {item.activeTasks.length} active
                        </span>
                      )}
                    </div>
                    {item.activeTasks.length > 0 ? (
                      item.activeTasks.map((t) => (
                        <div
                          key={t.id}
                          onClick={() => setInspectTaskItem({ task: t, profile: p })}
                          className="p-2 rounded-lg bg-muted/40 hover:bg-muted/80 border border-border/70 flex items-center justify-between gap-2 cursor-pointer transition-all group/activeCard"
                          title="Click to view all task details"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="h-1.5 w-1.5 rounded-full bg-blue-400 shrink-0" />
                            <span className="text-xs font-medium text-foreground truncate group-hover/activeCard:text-primary">
                              {t.task_name}
                            </span>
                          </div>
                          <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                            {t.planned_hours ? `${t.planned_hours}h` : "Active"}
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="text-xs text-muted-foreground/60 p-1.5 rounded bg-muted/20">
                        No tasks currently in progress
                      </div>
                    )}
                  </div>

                  {/* Upcoming Tasks in Card */}
                  {item.upcomingTasks.length > 0 && (
                    <div
                      onClick={() => setUpcomingTasksModalItem({ member: p, tasks: item.upcomingTasks })}
                      className="p-2 rounded-lg bg-muted/30 hover:bg-muted/70 border border-border/70 flex items-center justify-between gap-2 cursor-pointer transition-all text-xs"
                    >
                      <div className="flex items-center gap-1.5 text-muted-foreground font-medium">
                        <ListTodo className="h-3.5 w-3.5 text-muted-foreground" />
                        <span>{item.upcomingTasks.length} Queued Tasks</span>
                      </div>
                      <span className="text-[10px] text-foreground font-mono">
                        {item.upcomingTasks.reduce((s, t) => s + Number(t.planned_hours || 0), 0)}h total
                      </span>
                    </div>
                  )}

                  {/* Completed Today Bar in Card */}
                  <div className="p-2.5 bg-muted/40 border border-border/70 rounded-lg flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div>
                        <div className="font-semibold text-foreground">Completed Today</div>
                        <div className="text-[10px] text-muted-foreground font-mono">
                          {item.completedTodayHours} hrs ({item.completedTodayTasks.length} tasks)
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => toggleExpandHistory(p.id)}
                      className="text-xs font-semibold px-2.5 py-1 rounded bg-card hover:bg-accent text-foreground border border-border flex items-center gap-1"
                    >
                      <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>{item.historyList.length} Days</span>
                      {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    </button>
                  </div>

                  {/* Expandable History in Card */}
                  {isExpanded && (
                    <div className="p-3 bg-muted/20 border border-border rounded-lg space-y-2">
                      <div className="text-xs font-bold text-foreground flex items-center justify-between">
                        <span>Completed Tasks History</span>
                        <span className="text-[10px] text-muted-foreground font-mono">{item.completedTasks.length} Total</span>
                      </div>
                      {item.historyList.length > 0 ? (
                        item.historyList.map((hist) => (
                          <div key={hist.dateStr} className="text-xs space-y-1 border-b border-border pb-1.5 last:border-0 last:pb-0">
                            <div className="flex items-center justify-between text-foreground font-semibold text-[11px]">
                              <span>{hist.formattedDate} ({hist.relativeLabel || "Past"})</span>
                              <span className="font-mono text-foreground">{hist.totalHours} hrs</span>
                            </div>
                            {hist.tasks.map((t) => (
                              <div
                                key={t.id}
                                onClick={() => setInspectTaskItem({ task: t, profile: p })}
                                className="text-[11px] text-muted-foreground hover:text-foreground flex items-center justify-between pl-2 cursor-pointer transition-colors"
                              >
                                <span className="truncate">• {t.task_name}</span>
                                <span className="font-mono text-[10px] text-muted-foreground">{t.actual_hours || t.planned_hours || 0}h</span>
                              </div>
                            ))}
                          </div>
                        ))
                      ) : (
                        <div className="text-xs text-muted-foreground/60 italic">No past history recorded</div>
                      )}
                    </div>
                  )}

                  {/* Actions Footer */}
                  <div className="pt-2 border-t border-border flex items-center justify-between gap-3">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {item.skills.map((skill, idx) => (
                        <Badge key={idx} variant="secondary" className="text-[9px] px-1.5 py-0.5 bg-muted text-muted-foreground border border-border">
                          {skill}
                        </Badge>
                      ))}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => setInspectMemberId(p.id)} className="h-7 text-xs border-border text-foreground bg-card hover:bg-accent">
                        Inspect
                      </Button>
                      <Button size="sm" onClick={() => handleAssignTask(p.id)} className="h-7 text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90">
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

      {/* 1. CURRENT WORK MINI MODAL */}
      <Dialog
        open={!!activeTaskModalItem}
        onOpenChange={(open) => {
          if (!open) setActiveTaskModalItem(null);
        }}
      >
        <DialogContent className="max-w-md bg-popover border border-border shadow-2xl rounded-xl p-5 text-popover-foreground space-y-4">
          {activeTaskModalItem && (
            <>
              <DialogHeader className="space-y-1.5 border-b border-border pb-3">
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="outline" className="border-blue-500/30 text-blue-400 bg-blue-500/10 font-mono text-xs flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
                    Currently In Progress
                  </Badge>
                  {activeTaskModalItem.task.task_code && (
                    <span className="font-mono text-xs text-muted-foreground font-semibold">
                      {activeTaskModalItem.task.task_code}
                    </span>
                  )}
                </div>
                <DialogTitle className="text-base font-bold text-foreground leading-snug">
                  {activeTaskModalItem.task.task_name}
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Task actively worked on by {activeTaskModalItem.member.display_name}
                </DialogDescription>
              </DialogHeader>

              {/* Task Details */}
              <div className="space-y-3 text-xs">
                {/* Member Assigned */}
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-muted/40 border border-border">
                  <div className="flex items-center gap-2">
                    <Avatar className="h-7 w-7 border border-border bg-card">
                      {activeTaskModalItem.member.avatar_url ? (
                        <AvatarImage src={activeTaskModalItem.member.avatar_url} alt="" />
                      ) : (
                        <AvatarFallback className="text-foreground text-xs font-semibold bg-primary/20">
                          {activeTaskModalItem.member.display_name.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      )}
                    </Avatar>
                    <span className="font-medium text-foreground">
                      {activeTaskModalItem.member.display_name}
                    </span>
                  </div>
                  <span className="text-[11px] text-muted-foreground font-mono">
                    {activeTaskModalItem.member.email || "Team Member"}
                  </span>
                </div>

                {/* What they are doing (Remarks / Notes) */}
                <div className="space-y-1">
                  <div className="font-semibold text-foreground flex items-center gap-1 text-[11px] uppercase tracking-wider">
                    <Layers className="h-3 w-3 text-primary" /> What they are doing right now:
                  </div>
                  <div className="p-3 rounded-lg bg-card border border-border text-foreground text-xs leading-relaxed max-h-32 overflow-y-auto">
                    {activeTaskModalItem.task.remarks && activeTaskModalItem.task.remarks.trim() ? (
                      activeTaskModalItem.task.remarks
                    ) : (
                      <span className="text-muted-foreground italic">No detailed remarks provided for this in-progress task.</span>
                    )}
                  </div>
                </div>

                {/* Metadata Pills */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2 rounded bg-muted/30 border border-border space-y-0.5">
                    <span className="text-[10px] text-muted-foreground uppercase font-semibold">Project</span>
                    <div className="font-medium text-foreground truncate">
                      {activeTaskModalItem.task.project_name || "General"}
                    </div>
                  </div>
                  <div className="p-2 rounded bg-muted/30 border border-border space-y-0.5">
                    <span className="text-[10px] text-muted-foreground uppercase font-semibold">Hours Logged / Planned</span>
                    <div className="font-mono text-emerald-400 font-bold">
                      {activeTaskModalItem.task.actual_hours || 0} hrs / {activeTaskModalItem.task.planned_hours || 1} hrs
                    </div>
                  </div>
                </div>
              </div>

              <DialogFooter className="border-t border-border pt-3 flex items-center justify-between gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const task = activeTaskModalItem.task;
                    setActiveTaskModalItem(null);
                    handleEditTask(task);
                  }}
                  className="h-8 text-xs border-border bg-card text-foreground hover:bg-accent"
                >
                  <Pencil className="h-3 w-3 mr-1 text-primary" /> Edit Task
                </Button>
                <Button
                  size="sm"
                  onClick={() => setActiveTaskModalItem(null)}
                  className="h-8 text-xs bg-primary text-primary-foreground hover:bg-primary/90 font-medium"
                >
                  Close
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* 2. UPCOMING TASKS MINI MODAL */}
      <Dialog
        open={!!upcomingTasksModalItem}
        onOpenChange={(open) => {
          if (!open) setUpcomingTasksModalItem(null);
        }}
      >
        <DialogContent className="max-w-xl bg-popover border border-border shadow-2xl rounded-xl p-5 text-popover-foreground space-y-4">
          {upcomingTasksModalItem && (
            <>
              <DialogHeader className="space-y-1.5 border-b border-border pb-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Avatar className="h-7 w-7 border border-border bg-muted">
                      {upcomingTasksModalItem.member.avatar_url ? (
                        <AvatarImage src={upcomingTasksModalItem.member.avatar_url} alt="" />
                      ) : (
                        <AvatarFallback className="text-foreground text-xs font-semibold bg-primary/20">
                          {upcomingTasksModalItem.member.display_name.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      )}
                    </Avatar>
                    <span className="font-bold text-sm text-foreground">
                      {upcomingTasksModalItem.member.display_name}
                    </span>
                  </div>
                  <Badge variant="outline" className="border-amber-500/30 text-amber-400 bg-amber-500/10 font-mono text-xs">
                    {upcomingTasksModalItem.tasks.length} Upcoming Tasks Queued
                  </Badge>
                </div>

                <DialogTitle className="text-base font-bold text-foreground">
                  Upcoming Work Queue
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Queued and pending tasks assigned to {upcomingTasksModalItem.member.display_name}
                </DialogDescription>
              </DialogHeader>

              {/* Tasks List */}
              <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
                {upcomingTasksModalItem.tasks.length > 0 ? (
                  upcomingTasksModalItem.tasks.map((task) => (
                    <div
                      key={task.id}
                      onClick={() => {
                        setUpcomingTasksModalItem(null);
                        setInspectTaskItem({ task, profile: upcomingTasksModalItem.member });
                      }}
                      className="p-3 rounded-lg bg-card border border-border hover:border-primary/40 transition-all space-y-1.5 text-xs group cursor-pointer"
                      title="Click to view all task details"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-mono text-[11px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded border border-border">
                            {task.task_code || "TSK"}
                          </span>
                          <span className="font-semibold text-foreground truncate group-hover:text-primary">
                            {task.task_name}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <PriorityBadge priority={task.priority} />
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              setUpcomingTasksModalItem(null);
                              handleEditTask(task);
                            }}
                            className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                            title="Edit task"
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>

                      {task.remarks && (
                        <p className="text-[11px] text-muted-foreground line-clamp-2 pl-1">
                          {task.remarks}
                        </p>
                      )}

                      <div className="flex items-center justify-between text-[11px] text-muted-foreground border-t border-border/60 pt-1.5">
                        <div className="flex items-center gap-2">
                          {task.project_name && (
                            <span className="text-[10px] text-foreground bg-muted/60 px-1.5 py-0.5 rounded">
                              {task.project_name}
                            </span>
                          )}
                          <span className="font-mono text-amber-400">
                            ⏱ {task.planned_hours || 1} hrs planned
                          </span>
                        </div>
                        {task.due_date && (
                          <span className="font-mono text-[10px] flex items-center gap-1">
                            <Calendar className="h-2.5 w-2.5 text-muted-foreground" />
                            Due: {formatToDateStr(task.due_date)}
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="py-8 text-center text-xs text-muted-foreground italic">
                    No upcoming tasks queued for this member.
                  </div>
                )}
              </div>

              <DialogFooter className="border-t border-border pt-3 flex items-center justify-between gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    const memberId = upcomingTasksModalItem.member.id;
                    setUpcomingTasksModalItem(null);
                    handleAssignTask(memberId);
                  }}
                  className="h-8 text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add Task for {upcomingTasksModalItem.member.display_name.split(" ")[0]}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setUpcomingTasksModalItem(null)}
                  className="h-8 text-xs border-border bg-card text-foreground hover:bg-accent"
                >
                  Close
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Task Creation & Edit Form Dialog */}
      {user && (
        <TaskFormDialog
          open={taskDialogOpen}
          onOpenChange={setTaskDialogOpen}
          userId={user.id}
          initial={
            editingTask
              ? editingTask
              : selectedAssignMemberId
              ? ({ assigned_to: selectedAssignMemberId, priority: "Medium", status: "To Do" } as Partial<Task> as any)
              : null
          }
          onSaved={() => {
            setTaskDialogOpen(false);
            setEditingTask(null);
            queryClient.invalidateQueries({ queryKey: ["capacity-tasks"] });
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

      {/* Universal Task Inspection Modal */}
      {inspectTaskItem && (
        <TaskDetailModal
          task={inspectTaskItem.task}
          open={!!inspectTaskItem}
          onOpenChange={(open) => {
            if (!open) setInspectTaskItem(null);
          }}
          assignedProfile={inspectTaskItem.profile || null}
          onEditTask={(task) => {
            setInspectTaskItem(null);
            handleEditTask(task);
          }}
          onTaskUpdated={() => {
            queryClient.invalidateQueries({ queryKey: ["capacity-tasks"] });
          }}
        />
      )}
    </div>
  );
}
