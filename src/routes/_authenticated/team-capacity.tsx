import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
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
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Profile, Task, Project } from "@/lib/types";
import { formatHoursMins } from "@/lib/format";
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
  const [availabilityFilter, setAvailabilityFilter] = useState("all");
  const [viewMode, setViewMode] = useState<"table" | "card">("table");
  const [selectedAssignMemberId, setSelectedAssignMemberId] = useState<string | null>(null);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [inspectMemberId, setInspectMemberId] = useState<string | null>(null);

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

  // Calculate REAL Capacity & Workload per Member strictly from DB
  const memberData = useMemo(() => {
    return profiles.map((p) => {
      const memberTasks = tasks.filter((t) => t.assigned_to === p.id);
      const activeTasks = memberTasks.filter((t) => t.status === "In Progress");
      const upcomingTasks = memberTasks.filter(
        (t) => t.status === "To Do" || t.status === "Pending",
      );
      const completedTasks = memberTasks.filter((t) => t.status === "Completed");
      const blockedTasks = memberTasks.filter((t) => t.status === "Blocked");

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
        plannedHours,
        maxDailyHours,
        capacityPct,
        capacityStatus,
        title,
        skills: realProjectSkills,
        mainProjectName,
        teamName,
      };
    });
  }, [profiles, tasks, teams]);

  // Dynamic Filtering
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
        item.skills.some((s) => s.toLowerCase().includes(search.toLowerCase()));

      const matchTeam =
        teamFilter === "all" ||
        item.teamName.toLowerCase() === teamFilter.toLowerCase() ||
        p.team_id === teamFilter;

      const matchProject =
        projectFilter === "all" ||
        item.mainProjectName.toLowerCase().includes(projectFilter.toLowerCase());

      const matchAvailability =
        availabilityFilter === "all" ||
        (availabilityFilter === "free" && item.capacityStatus === "free") ||
        (availabilityFilter === "available" && item.capacityStatus === "available") ||
        (availabilityFilter === "partially" && item.capacityStatus === "partially") ||
        (availabilityFilter === "overloaded" && item.capacityStatus === "overloaded");

      return matchSearch && matchTeam && matchProject && matchAvailability;
    });
  }, [memberData, search, teamFilter, projectFilter, availabilityFilter]);

  // Real Database Metrics KPI Summary Bar
  const kpis = useMemo(() => {
    const totalMembers = profiles.length;
    const currentlyWorking = memberData.filter((m) => m.activeTasks.length > 0).length;
    const workingPct = totalMembers > 0 ? Math.round((currentlyWorking / totalMembers) * 100) : 0;
    const freeMembers = memberData.filter((m) => m.capacityStatus === "free" || m.capacityStatus === "available").length;
    const freePct = totalMembers > 0 ? Math.round((freeMembers / totalMembers) * 100) : 0;
    const partiallyAvailable = memberData.filter((m) => m.capacityStatus === "partially").length;
    const partiallyPct = totalMembers > 0 ? Math.round((partiallyAvailable / totalMembers) * 100) : 0;
    const overloadedCount = memberData.filter((m) => m.capacityStatus === "overloaded").length;
    const overloadedPct = totalMembers > 0 ? Math.round((overloadedCount / totalMembers) * 100) : 0;
    const upcomingProjectsCount = new Set(tasks.map((t) => t.project_name).filter(Boolean)).size;

    return {
      totalMembers,
      currentlyWorking,
      workingPct,
      freeMembers,
      freePct,
      partiallyAvailable,
      partiallyPct,
      overloadedCount,
      overloadedPct,
      upcomingProjectsCount,
    };
  }, [profiles, memberData, tasks]);

  const handleAssignTask = (memberId: string) => {
    setSelectedAssignMemberId(memberId);
    setTaskDialogOpen(true);
  };

  return (
    <div className="max-w-[1650px] mx-auto px-4 sm:px-6 py-5 space-y-4 text-foreground">
      {/* Top Page Header Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-3.5">
        <div className="space-y-0.5">
          <h1 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
            Team Capacity Dashboard
            <span
              title="Overview of team workload, availability and upcoming assignments"
              className="text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
            >
              <Info className="h-3.5 w-3.5" />
            </span>
          </h1>
          <p className="text-xs text-muted-foreground">
            Overview of team workload, availability and upcoming assignments
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => window.print()}
            className="h-8 text-xs gap-1.5 font-medium border-border hover:bg-accent"
          >
            <BarChart2 className="h-3.5 w-3.5 text-primary" /> Export Report
          </Button>
          <Button
            size="sm"
            onClick={() => handleAssignTask(user?.id ?? "")}
            className="h-8 text-xs font-semibold gap-1.5 shadow-sm px-3.5"
          >
            <Plus className="h-3.5 w-3.5" /> Assign Work
          </Button>
        </div>
      </div>

      {/* Top Metric Cards Grid (Strictly Global Design System Tokens) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* Card 1: Total Members */}
        <div className="bg-card border border-border rounded-xl p-3.5 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-muted-foreground text-[11px] font-medium uppercase tracking-wider">
            <span>Total Members</span>
            <Users className="h-3.5 w-3.5 text-primary" />
          </div>
          <div className="text-xl font-bold text-foreground">{kpis.totalMembers}</div>
          <div className="text-[10px] text-muted-foreground">All Team Members</div>
        </div>

        {/* Card 2: Currently Working */}
        <div className="bg-card border border-border rounded-xl p-3.5 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-muted-foreground text-[11px] font-medium uppercase tracking-wider">
            <span>Currently Working</span>
            <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
          </div>
          <div className="text-xl font-bold text-foreground">{kpis.currentlyWorking}</div>
          <div className="text-[10px] text-emerald-500 font-medium">{kpis.workingPct}% of team</div>
        </div>

        {/* Card 3: Free Members */}
        <div className="bg-card border border-border rounded-xl p-3.5 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-muted-foreground text-[11px] font-medium uppercase tracking-wider">
            <span>Free Members</span>
            <UserCheck className="h-3.5 w-3.5 text-primary" />
          </div>
          <div className="text-xl font-bold text-foreground">{kpis.freeMembers}</div>
          <div className="text-[10px] text-primary font-medium">{kpis.freePct}% available</div>
        </div>

        {/* Card 4: Partially Available */}
        <div className="bg-card border border-border rounded-xl p-3.5 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-muted-foreground text-[11px] font-medium uppercase tracking-wider">
            <span>Partially Available</span>
            <Clock className="h-3.5 w-3.5 text-amber-500" />
          </div>
          <div className="text-xl font-bold text-foreground">{kpis.partiallyAvailable}</div>
          <div className="text-[10px] text-amber-500 font-medium">{kpis.partiallyPct}% partially free</div>
        </div>

        {/* Card 5: Overloaded */}
        <div className="bg-card border border-border rounded-xl p-3.5 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-muted-foreground text-[11px] font-medium uppercase tracking-wider">
            <span>Overloaded</span>
            <AlertOctagon className="h-3.5 w-3.5 text-rose-500" />
          </div>
          <div className="text-xl font-bold text-rose-500">{kpis.overloadedCount}</div>
          <div className="text-[10px] text-rose-500/80 font-medium">{kpis.overloadedPct}% over capacity</div>
        </div>

        {/* Card 6: Active Projects */}
        <div className="bg-card border border-border rounded-xl p-3.5 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-muted-foreground text-[11px] font-medium uppercase tracking-wider">
            <span>Active Projects</span>
            <Briefcase className="h-3.5 w-3.5 text-primary" />
          </div>
          <div className="text-xl font-bold text-foreground">{kpis.upcomingProjectsCount}</div>
          <div className="text-[10px] text-muted-foreground">Projects with Tasks</div>
        </div>
      </div>

      {/* Filter Toolbar (Global Token `bg-card` and `border-border`) */}
      <div className="bg-card border border-border rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 shadow-sm">
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search members, projects, tasks..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-8 text-xs bg-background border-input text-foreground focus:border-ring rounded-md"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select value={teamFilter} onValueChange={setTeamFilter}>
            <SelectTrigger className="h-8 w-32 text-xs bg-background border-input text-foreground rounded-md">
              <SelectValue placeholder="All Teams" />
            </SelectTrigger>
            <SelectContent className="bg-card border-border text-xs text-foreground z-[9999]">
              <SelectItem value="all">All Teams</SelectItem>
              {teams.map((tm) => (
                <SelectItem key={tm.id} value={tm.name}>{tm.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={projectFilter} onValueChange={setProjectFilter}>
            <SelectTrigger className="h-8 w-36 text-xs bg-background border-input text-foreground rounded-md">
              <SelectValue placeholder="All Projects" />
            </SelectTrigger>
            <SelectContent className="bg-card border-border text-xs text-foreground z-[9999]">
              <SelectItem value="all">All Projects</SelectItem>
              {projects.map((pr) => (
                <SelectItem key={pr.id} value={pr.name}>{pr.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={availabilityFilter} onValueChange={setAvailabilityFilter}>
            <SelectTrigger className="h-8 w-36 text-xs bg-background border-input text-foreground rounded-md">
              <SelectValue placeholder="Availability" />
            </SelectTrigger>
            <SelectContent className="bg-card border-border text-xs text-foreground z-[9999]">
              <SelectItem value="all">All Availability</SelectItem>
              <SelectItem value="free">🟢 Free Today</SelectItem>
              <SelectItem value="available">🟢 Available Today</SelectItem>
              <SelectItem value="partially">🟡 Partially Available</SelectItem>
              <SelectItem value="overloaded">🔴 Overloaded</SelectItem>
            </SelectContent>
          </Select>

          {/* View Mode Toggle */}
          <div className="flex items-center gap-1 bg-background border border-input p-1 rounded-md">
            <Button
              size="sm"
              variant={viewMode === "table" ? "default" : "ghost"}
              onClick={() => setViewMode("table")}
              className={`h-6 text-xs px-2.5 gap-1.5 font-medium rounded-sm ${viewMode === "table" ? "" : "text-muted-foreground"}`}
            >
              <Table className="h-3 w-3" /> Table View
            </Button>
            <Button
              size="sm"
              variant={viewMode === "card" ? "default" : "ghost"}
              onClick={() => setViewMode("card")}
              className={`h-6 text-xs px-2.5 gap-1.5 font-medium rounded-sm ${viewMode === "card" ? "" : "text-muted-foreground"}`}
            >
              <Grid className="h-3 w-3" /> Card View
            </Button>
          </div>
        </div>
      </div>

      {/* MAIN TABLE VIEW (STRICTLY GLOBAL DESIGN SYSTEM TOKENS) */}
      {viewMode === "table" ? (
        <div className="bg-card border border-border rounded-xl overflow-x-auto shadow-sm">
          <table className="w-full text-left text-xs border-collapse min-w-[950px]">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-muted-foreground uppercase tracking-wider text-[10px] font-semibold">
                <th className="py-3 px-3.5 w-[20%] min-w-[160px]">Member</th>
                <th className="py-3 px-3.5 w-[26%] min-w-[220px]">Current Work</th>
                <th className="py-3 px-3.5 w-[24%] min-w-[200px]">Upcoming Work</th>
                <th className="py-3 px-3.5 w-[16%] min-w-[160px]">Availability & Capacity</th>
                <th className="py-3 px-3.5 w-[10%] min-w-[120px]">Projects</th>
                <th className="py-3 px-2 text-center w-[4%] min-w-[70px]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filteredMembers.length > 0 ? (
                filteredMembers.map((item) => {
                  const p = item.profile;
                  return (
                    <tr
                      key={p.id}
                      onClick={() => setInspectMemberId(p.id)}
                      className="hover:bg-accent/40 transition-colors group cursor-pointer"
                    >
                      {/* 1. Member Column */}
                      <td className="py-3 px-3.5">
                        <div className="flex items-center gap-2.5">
                          <Avatar className="h-8 w-8 border border-border bg-muted shrink-0">
                            {p.avatar_url ? (
                              <AvatarImage src={p.avatar_url} alt={p.display_name} />
                            ) : (
                              <AvatarFallback className="text-foreground text-xs font-semibold">
                                {p.display_name.slice(0, 2).toUpperCase()}
                              </AvatarFallback>
                            )}
                          </Avatar>
                          <div className="min-w-0 space-y-0.5">
                            <div className="font-semibold text-foreground flex items-center gap-1.5 group-hover:text-primary transition-colors">
                              <span className="truncate">{p.display_name}</span>
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                            </div>
                            <div className="text-[11px] text-muted-foreground truncate">{item.title}</div>
                          </div>
                        </div>
                      </td>

                      {/* 2. Current Work Column */}
                      <td className="py-3 px-3.5">
                        {item.activeTasks.length > 0 ? (
                          <div className="space-y-1">
                            {item.activeTasks.slice(0, 2).map((t) => (
                              <div key={t.id} className="flex items-center justify-between gap-2 text-xs">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 shrink-0" />
                                  <span className="font-medium text-foreground truncate max-w-[150px]" title={t.task_name}>
                                    {t.task_name}
                                  </span>
                                </div>
                                <Badge variant="outline" className="text-[9px] px-1.5 py-0 shrink-0 border-border text-muted-foreground">
                                  In Progress
                                </Badge>
                              </div>
                            ))}
                            {item.activeTasks.length > 2 && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setInspectMemberId(p.id);
                                }}
                                className="text-[10px] font-semibold text-muted-foreground hover:text-primary transition-colors pt-0.5 flex items-center gap-1 cursor-pointer group/more"
                              >
                                <span className="bg-muted/60 text-muted-foreground group-hover/more:bg-primary/20 group-hover/more:text-primary px-1.5 py-0.5 rounded border border-border/40 font-mono text-[9px] transition-colors">
                                  +{item.activeTasks.length - 2}
                                </span>
                                <span className="group-hover/more:underline">more tasks</span>
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground/60 italic">— No Active Tasks</span>
                        )}
                      </td>

                      {/* 3. Upcoming Work Column */}
                      <td className="py-3 px-3.5">
                        {item.upcomingTasks.length > 0 ? (
                          <div className="space-y-1">
                            {item.upcomingTasks.slice(0, 2).map((t) => (
                              <div key={t.id} className="flex items-center justify-between gap-2 text-xs">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
                                  <span className="font-medium text-foreground/90 truncate max-w-[150px]" title={t.task_name}>
                                    {t.task_name}
                                  </span>
                                </div>
                                <Badge variant="outline" className="text-[9px] px-1.5 py-0 shrink-0 border-border text-muted-foreground">
                                  To Do
                                </Badge>
                              </div>
                            ))}
                            {item.upcomingTasks.length > 2 && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setInspectMemberId(p.id);
                                }}
                                className="text-[10px] font-semibold text-muted-foreground hover:text-primary transition-colors pt-0.5 flex items-center gap-1 cursor-pointer group/more"
                              >
                                <span className="bg-muted/60 text-muted-foreground group-hover/more:bg-primary/20 group-hover/more:text-primary px-1.5 py-0.5 rounded border border-border/40 font-mono text-[9px] transition-colors">
                                  +{item.upcomingTasks.length - 2}
                                </span>
                                <span className="group-hover/more:underline">more tasks</span>
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground/60 italic">— No Queued Tasks</span>
                        )}
                      </td>

                      {/* 4. Availability & Capacity Column */}
                      <td className="py-3 px-3.5 min-w-[160px]">
                        <div className="flex items-center gap-2.5 flex-nowrap">
                          <div className="relative h-8 w-8 flex items-center justify-center shrink-0">
                            <svg className="h-full w-full transform -rotate-90" viewBox="0 0 36 36">
                              <path
                                className="text-muted/60"
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
                            <span className="absolute text-[9px] font-bold text-foreground">
                              {item.capacityPct}%
                            </span>
                          </div>
                          <div className="space-y-0.5 shrink-0">
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[9px] px-1.5 py-0 font-medium flex items-center gap-1 w-fit border-border whitespace-nowrap",
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
                                ? "Available Today"
                                : item.capacityStatus === "partially"
                                ? "Partially Available"
                                : "Overloaded"}
                            </Badge>
                            <div className="text-[10px] font-mono text-muted-foreground whitespace-nowrap">
                              {formatHoursMins(item.plannedHours)} / 8 hrs
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* 5. Real Projects Column */}
                      <td className="py-3 px-3.5">
                        <div className="flex flex-wrap gap-1 max-w-[160px]">
                          {item.skills.length > 0 ? (
                            item.skills.slice(0, 2).map((proj, idx) => (
                              <Badge
                                key={idx}
                                variant="secondary"
                                className="text-[9px] px-1.5 py-0.5 truncate max-w-[120px]"
                              >
                                {proj}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-xs text-muted-foreground/60 italic">—</span>
                          )}
                          {item.skills.length > 2 && (
                            <Badge variant="outline" className="text-[9px] px-1 py-0 border-border text-muted-foreground">
                              +{item.skills.length - 2}
                            </Badge>
                          )}
                        </div>
                      </td>

                      {/* 6. Actions Column */}
                      <td className="py-3 px-3.5 text-center">
                        <div className="flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleAssignTask(p.id)}
                            className="h-7 w-7 p-0 rounded-md hover:bg-accent text-foreground"
                            title="Assign Task"
                          >
                            <UserPlus className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setInspectMemberId(p.id)}
                            className="h-7 w-7 p-0 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"
                            title="Inspect Member Details"
                          >
                            <MoreVertical className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-xs text-muted-foreground">
                    No team members found matching search & filter criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        /* CARD VIEW MODE */
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {filteredMembers.map((item) => {
            const p = item.profile;
            return (
              <Card
                key={p.id}
                className="bg-card border border-border hover:border-primary/40 rounded-xl overflow-hidden shadow-sm transition-all duration-200"
              >
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Avatar className="h-9 w-9 border border-border bg-muted shrink-0">
                        {p.avatar_url ? (
                          <AvatarImage src={p.avatar_url} alt={p.display_name} />
                        ) : (
                          <AvatarFallback className="text-foreground text-xs font-semibold">
                            {p.display_name.slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        )}
                      </Avatar>
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-bold text-sm text-foreground truncate">
                            {p.display_name}
                          </h3>
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[9px] px-1.5 py-0 border-border",
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
                              ? "Available Today"
                              : item.capacityStatus === "partially"
                              ? "Partially Available"
                              : "Overloaded"}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground truncate font-medium">{item.title}</p>
                      </div>
                    </div>

                    <div className="flex flex-col items-center shrink-0">
                      <div className="relative h-10 w-10 flex items-center justify-center">
                        <svg className="h-full w-full transform -rotate-90" viewBox="0 0 36 36">
                          <path
                            className="text-muted/60"
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
                        <span className="absolute text-[9px] font-bold text-foreground">
                          {item.capacityPct}%
                        </span>
                      </div>
                      <span className="text-[10px] font-mono text-muted-foreground mt-0.5">
                        {formatHoursMins(item.plannedHours)} / 8 hrs
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    <div className="space-y-1.5 bg-muted/40 border border-border p-2.5 rounded-lg">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" /> Current Work
                      </div>
                      <div className="space-y-1 max-h-28 overflow-y-auto">
                        {item.activeTasks.length > 0 ? (
                          item.activeTasks.map((t) => (
                            <div key={t.id} className="text-xs space-y-0.5 border-b border-border/40 pb-1 last:border-0 last:pb-0">
                              <div className="font-medium text-foreground flex items-center gap-1.5">
                                <span className="font-mono text-indigo-400 text-[10px] shrink-0">{t.task_code}</span>
                                <span className="truncate">{t.task_name}</span>
                              </div>
                            </div>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground/60 italic">No active tasks</span>
                        )}
                      </div>
                    </div>

                    <div className="space-y-1.5 bg-muted/40 border border-border p-2.5 rounded-lg">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Upcoming Work
                      </div>
                      <div className="space-y-1 max-h-28 overflow-y-auto">
                        {item.upcomingTasks.length > 0 ? (
                          item.upcomingTasks.map((t) => (
                            <div key={t.id} className="text-xs space-y-0.5 border-b border-border/40 pb-1 last:border-0 last:pb-0">
                              <div className="font-medium text-foreground flex items-center gap-1.5">
                                <span className="font-mono text-amber-400 text-[10px] shrink-0">{t.task_code}</span>
                                <span className="truncate">{t.task_name}</span>
                              </div>
                            </div>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground/60 italic">No queued tasks</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-border flex items-center justify-between gap-3">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {item.skills.map((skill, idx) => (
                        <Badge key={idx} variant="secondary" className="text-[9px] px-1.5 py-0.5">
                          {skill}
                        </Badge>
                      ))}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => setInspectMemberId(p.id)} className="h-7 text-xs border-border">
                        Inspect
                      </Button>
                      <Button size="sm" onClick={() => handleAssignTask(p.id)} className="h-7 text-xs font-semibold">
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
