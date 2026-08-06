import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  AlertOctagon,
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Gauge,
  ShieldAlert,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Users,
  Activity,
  Building2,
  Clock,
  Briefcase,
  Mail,
  Search,
  Download,
  Filter,
  User,
  Calendar,
  ListFilter,
  BarChart2,
  Hourglass,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import {
  getExecSummary,
  getExecScope,
  type ExecSummary,
  type ExecScopeBootstrap,
} from "@/lib/executive.functions";
import type { Task, Profile, Project, EodCheckin } from "@/lib/types";
import { generateEodHtmlReport } from "@/services/pdf-report.generator";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/executive")({
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
  component: ExecutivePage,
});

type RangeKey = "1" | "7" | "14" | "30" | "90";
const RANGE_LABEL: Record<RangeKey, string> = {
  "1": "Today",
  "7": "7 days",
  "14": "14 days",
  "30": "30 days",
  "90": "90 days",
};

/* ----- Scope (E0.1E) ----- */
type Scope = { kind: "org" } | { kind: "team"; id: string } | { kind: "manager"; id: string };

const SCOPE_STORAGE_KEY = "exec.scope.v1";

function readStoredScope(): Scope | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SCOPE_STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (v?.kind === "org") return { kind: "org" };
    if ((v?.kind === "team" || v?.kind === "manager") && typeof v.id === "string") return v;
  } catch {
    /* ignore */
  }
  return null;
}

function persistScope(s: Scope) {
  try {
    window.localStorage.setItem(SCOPE_STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

function deriveDefaultScope(boot: ExecScopeBootstrap): Scope {
  if (boot.primaryTeamId) return { kind: "team", id: boot.primaryTeamId };
  if (boot.isManager && !boot.isAdmin) return { kind: "manager", id: boot.userId };
  return { kind: "org" };
}

function scopeToFilters(s: Scope): { team: string | null; manager: string | null } {
  if (s.kind === "team") return { team: s.id, manager: null };
  if (s.kind === "manager") return { team: null, manager: s.id };
  return { team: null, manager: null };
}

function ExecutivePage() {
  const [range, setRange] = useState<RangeKey>("7");
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [scope, setScopeState] = useState<Scope | null>(() => readStoredScope());

  // Interactive member drilldown state
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);

  const fetchBootstrap = useServerFn(getExecScope);
  const { data: boot } = useQuery({
    queryKey: ["exec-scope-bootstrap"],
    queryFn: () => fetchBootstrap(),
    staleTime: Infinity,
  });

  const { data: eodTasks = [] } = useQuery({
    queryKey: ["eod-widget-tasks"],
    queryFn: async () => {
      const { data } = await supabase
        .from("tasks")
        .select(
          "id, task_code, task_name, assigned_to, project_name, project_id, type_id, team_id, status, priority, due_date, completed_at, blocker_reason, remarks, planned_hours, actual_hours, carry_forward_count, created_at",
        );
      return (data ?? []) as Task[];
    },
    staleTime: 5000,
  });

  const { data: eodProfiles = [] } = useQuery({
    queryKey: ["eod-widget-profiles"],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, display_name, email, avatar_url, manager_id, team_id");
      return (data ?? []) as Profile[];
    },
    staleTime: 30000,
  });

  const { data: projectsList = [] } = useQuery({
    queryKey: ["exec-projects"],
    queryFn: async () => {
      const { data } = await supabase.from("projects").select("id, name, client, status");
      return (data ?? []) as Project[];
    },
    staleTime: 30000,
  });

  const { data: teamsList = [] } = useQuery({
    queryKey: ["exec-teams"],
    queryFn: async () => {
      const { data } = await supabase.from("teams").select("id, name");
      return (data ?? []) as Array<{ id: string; name: string }>;
    },
    staleTime: 30000,
  });

  const { data: eodCheckinsList = [] } = useQuery({
    queryKey: ["exec-checkins"],
    queryFn: async () => {
      const { data } = await supabase
        .from("eod_checkins")
        .select("*")
        .order("checkin_date", { ascending: false });
      return (data ?? []) as EodCheckin[];
    },
    staleTime: 10000,
  });

  // First-load default when no persisted scope.
  useEffect(() => {
    if (scope || !boot) return;
    setScopeState(deriveDefaultScope(boot));
  }, [boot, scope]);

  const setScope = (next: Scope) => {
    setScopeState(next);
    persistScope(next);
  };

  const filters = scope ? scopeToFilters(scope) : null;
  const fetchSummary = useServerFn(getExecSummary);
  const { data: summary } = useQuery({
    queryKey: ["exec-summary", range, scope, selectedProjects, selectedTypes],
    queryFn: () =>
      fetchSummary({
        data: {
          days: Number(range),
          team: filters!.team,
          manager: filters!.manager,
          project: selectedProjects.length > 0 ? selectedProjects[0] : null,
          type: selectedTypes.length > 0 ? selectedTypes[0] : null,
        },
      }),
    enabled: !!filters,
    staleTime: 1000,
    refetchInterval: 5000,
  });

  // Dynamic Teams and Managers list for Scope select
  const availableTeams = useMemo(() => {
    const map = new Map<string, string>();
    (summary?.filters.teams ?? []).forEach((t) => map.set(t.id, t.name));
    teamsList.forEach((t) => map.set(t.id, t.name));
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [summary, teamsList]);

  const availableManagers = useMemo(() => {
    const map = new Map<string, string>();
    (summary?.filters.managers ?? []).forEach((m) => map.set(m.id, m.name));
    const managerIds = new Set<string>();
    if (boot?.userId) managerIds.add(boot.userId);
    eodProfiles.forEach((p) => {
      if (p.manager_id) managerIds.add(p.manager_id);
    });
    managerIds.forEach((id) => {
      const p = eodProfiles.find((x) => x.id === id);
      if (p && !map.has(id)) {
        map.set(id, p.display_name);
      }
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [summary, eodProfiles, boot]);

  // Dynamic Projects list for Project select (Combining Projects DB + Tasks table)
  const availableProjects = useMemo(() => {
    const map = new Map<string, string>();
    (summary?.filters.projects ?? []).forEach((p) => map.set(p.id, p.name));
    projectsList.forEach((p) => map.set(p.id, p.name));
    eodTasks.forEach((t) => {
      if (t.project_name?.trim()) {
        const pName = t.project_name.trim();
        if (t.project_id && !map.has(t.project_id)) {
          map.set(t.project_id, pName);
        } else if (!map.has(pName)) {
          map.set(pName, pName);
        }
      }
    });
    return Array.from(map.entries()).map(([id, name]) => [id, name] as [string, string]);
  }, [summary, projectsList, eodTasks]);

  // Work Types list
  const availableTypes = useMemo(() => {
    return (summary?.filters.types ?? []).map((t) => [t.id, t.name] as [string, string]);
  }, [summary]);

  const scopeLabel = useMemo(() => {
    if (!scope || !boot) return "Organization";
    if (scope.kind === "org") return "Organization";
    if (scope.kind === "team") {
      if (scope.id === boot.primaryTeamId) return `My Team · ${boot.primaryTeamName ?? "—"}`;
      const t = availableTeams.find((x) => x.id === scope.id);
      return `Team · ${t?.name ?? "Team"}`;
    }
    if (scope.id === boot.userId) return "My Hierarchy";
    const m = availableManagers.find((x) => x.id === scope.id);
    return `Manager · ${m?.name ?? "Manager"}`;
  }, [scope, boot, availableTeams, availableManagers]);

  const handleExportGlobalReport = () => {
    const completedTasks = eodTasks.filter((t) => t.status === "Completed").length;
    const inProgressTasks = eodTasks.filter((t) => t.status === "In Progress").length;
    const blockedTasks = eodTasks.filter((t) => t.status === "Blocked").length;
    const pendingTasks = eodTasks.filter((t) => t.status !== "Completed" && t.status !== "In Progress" && t.status !== "Blocked").length;
    const totalTasks = eodTasks.length;
    const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    const memberSummaries = eodProfiles.map((p) => {
      const pTasks = eodTasks.filter((t) => t.assigned_to === p.id);
      return {
        name: p.display_name,
        completedCount: pTasks.filter((t) => t.status === "Completed").length,
        inProgressCount: pTasks.filter((t) => t.status === "In Progress").length,
        blockedCount: pTasks.filter((t) => t.status === "Blocked").length,
        pendingCount: pTasks.filter((t) => t.status !== "Completed" && t.status !== "In Progress" && t.status !== "Blocked").length,
        tasks: pTasks.map((t) => ({ code: t.task_code, name: t.task_name, status: t.status, remarks: t.remarks })),
      };
    });

    const blockedAlerts = eodTasks
      .filter((t) => t.status === "Blocked" && t.blocker_reason)
      .map((t) => {
        const p = eodProfiles.find((x) => x.id === t.assigned_to);
        return {
          code: t.task_code,
          name: t.task_name,
          memberName: p?.display_name || "Unassigned",
          reason: t.blocker_reason || "Blocked",
        };
      });

    const htmlContent = generateEodHtmlReport({
      dateStr: new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", year: "numeric" }),
      totalTasks,
      completedTasks,
      inProgressTasks,
      blockedTasks,
      pendingTasks,
      completionRate,
      memberSummaries,
      blockedAlerts,
    });

    const blob = new Blob([htmlContent], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `EOD_Executive_Report_${new Date().toISOString().slice(0, 10)}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Executive EOD HTML Report exported successfully!");
  };

  return (
    <div className="max-w-7xl mx-auto px-3 md:px-6 py-4 md:py-6 space-y-6">
      {/* Header controls */}
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:flex sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-xl md:text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <Gauge className="h-6 w-6 text-indigo-400" /> Executive Command Center
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs md:text-sm text-muted-foreground">
            <Badge variant="secondary" className="gap-1 font-medium bg-secondary/80">
              <Building2 className="h-3 w-3" /> Scope: {scopeLabel}
            </Badge>
            <span>· {RANGE_LABEL[range]}</span>
            {summary && summary.meta.visible_team_count > 0 && (
              <span className="hidden md:inline">
                · {summary.meta.visible_team_count} team(s) visible
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0 items-center">
          <ScopeSelect
            scope={scope || { kind: "org" }}
            boot={boot || { userId: "", displayName: null, isAdmin: true, isManager: true, primaryTeamId: null, primaryTeamName: null }}
            teams={availableTeams}
            managers={availableManagers}
            onChange={setScope}
          />
          <FilterSelect
            value={range}
            onChange={(v) => setRange(v as RangeKey)}
            label="Range"
            options={[
              ["1", "Today"],
              ["7", "7d"],
              ["14", "14d"],
              ["30", "30d"],
              ["90", "90d"],
            ]}
          />
          <MultiSelectFilterPopover
            label="Project"
            options={availableProjects.map(([id, name]) => ({ id, label: name }))}
            selectedValues={selectedProjects}
            onChange={setSelectedProjects}
          />
          <MultiSelectFilterPopover
            label="Member"
            options={eodProfiles.map((p) => ({ id: p.id, label: p.display_name }))}
            selectedValues={selectedMembers}
            onChange={setSelectedMembers}
          />
          {availableTypes.length > 0 && (
            <MultiSelectFilterPopover
              label="Type"
              options={availableTypes.map(([id, name]) => ({ id, label: name }))}
              selectedValues={selectedTypes}
              onChange={setSelectedTypes}
            />
          )}
          <Button
            size="sm"
            onClick={handleExportGlobalReport}
            className="h-8 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold gap-1.5 shadow-md"
          >
            <Download className="h-3.5 w-3.5" /> Export EOD Report
          </Button>
        </div>
      </header>

      {/* Primary Executive Dashboard: Fully Filterable Real App Dashboard */}
      <ExecutiveRealDashboard
        profiles={eodProfiles}
        tasks={eodTasks}
        projects={projectsList}
        checkins={eodCheckinsList}
        range={range}
        scope={scope}
        selectedProjects={selectedProjects}
        selectedMembers={selectedMembers}
        selectedTypes={selectedTypes}
        onSelectMember={(id) => setSelectedMemberId(id)}
      />

      {/* Member Details Drilldown Drawer */}
      <MemberDetailSheet
        memberId={selectedMemberId}
        onClose={() => setSelectedMemberId(null)}
        profiles={eodProfiles}
        tasks={eodTasks}
        projects={projectsList}
        checkins={eodCheckinsList}
      />

      {/* Executive Health & Operations Sections */}
      {summary && (
        <>
          <ExecutionHealth s={summary} />
          <DeliveryHealth s={summary} />
          <RiskCenter s={summary} />
          <WorkloadBalance s={summary} />
          <ExecutionDiscipline s={summary} />
          <AutomationROI s={summary} />
          <AdoptionMetrics s={summary} />
          <TeamHealthSection s={summary} />
          <ManagerEffectivenessSection s={summary} />
          <ExecutiveInsights s={summary} />
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*       REAL APP EXECUTIVE DASHBOARD (REAL CHARTS, GRAPHS & REPORT METRICS)  */
/* -------------------------------------------------------------------------- */

function ExecutiveRealDashboard({
  profiles,
  tasks,
  projects,
  checkins,
  range,
  scope,
  selectedProjects = [],
  selectedMembers = [],
  selectedTypes = [],
  onSelectMember,
}: {
  profiles: Profile[];
  tasks: Task[];
  projects: Project[];
  checkins: EodCheckin[];
  range: string;
  scope: Scope | null;
  selectedProjects?: string[];
  selectedMembers?: string[];
  selectedTypes?: string[];
  onSelectMember: (memberId: string) => void;
}) {
  const [memberSearch, setMemberSearch] = useState("");
  const [taskFilter, setTaskFilter] = useState<"all" | "Completed" | "In Progress" | "Blocked" | "Pending">("all");
  const [showOnlyActiveMembers, setShowOnlyActiveMembers] = useState(false);

  // 1. Dynamic Filtering for Profiles by Scope & Member Filter
  const filteredProfiles = useMemo(() => {
    let result = profiles;

    if (selectedMembers && selectedMembers.length > 0) {
      result = result.filter((p) => selectedMembers.includes(p.id));
    } else if (scope && scope.kind === "team") {
      result = result.filter((p) => (p as any).team_id === scope.id);
    } else if (scope && scope.kind === "manager") {
      result = result.filter((p) => p.manager_id === scope.id || p.id === scope.id);
    }

    return result;
  }, [profiles, scope, selectedMembers]);

  // 2. Dynamic Filtering for Tasks by Scope, Project, Member, Type & Range
  const filteredTasks = useMemo(() => {
    let result = tasks;

    // Member filter (multi-select)
    if (selectedMembers && selectedMembers.length > 0) {
      result = result.filter((t) => t.assigned_to && selectedMembers.includes(t.assigned_to));
    } else if (scope && scope.kind === "team") {
      const teamMemberIds = new Set(profiles.filter((p) => (p as any).team_id === scope.id).map((p) => p.id));
      result = result.filter(
        (t) => (t.assigned_to && teamMemberIds.has(t.assigned_to)) || t.team_id === scope.id,
      );
    } else if (scope && scope.kind === "manager") {
      const managedMemberIds = new Set(
        profiles.filter((p) => p.manager_id === scope.id || p.id === scope.id).map((p) => p.id),
      );
      result = result.filter((t) => t.assigned_to && managedMemberIds.has(t.assigned_to));
    }

    // Project filter (multi-select)
    if (selectedProjects && selectedProjects.length > 0) {
      result = result.filter((t) => {
        return selectedProjects.some((sp) => {
          if (t.project_id === sp) return true;
          if (t.project_name && t.project_name.trim().toLowerCase() === sp.trim().toLowerCase()) return true;
          const projObj = projects.find((p) => p.id === sp || p.name.trim().toLowerCase() === sp.trim().toLowerCase());
          return projObj && t.project_name && t.project_name.trim().toLowerCase() === projObj.name.trim().toLowerCase();
        });
      });
    }

    // Type filter (multi-select)
    if (selectedTypes && selectedTypes.length > 0) {
      result = result.filter((t) => t.type_id && selectedTypes.includes(t.type_id));
    }

    // Range / Timeframe filter
    const days = Number(range) || 7;
    if (range === "1") {
      const today = new Date().toISOString().slice(0, 10);
      result = result.filter((t) => {
        const createdDay = t.created_at ? t.created_at.slice(0, 10) : "";
        const completedDay = t.completed_at ? t.completed_at.slice(0, 10) : "";
        const dueDay = t.due_date ? t.due_date.slice(0, 10) : "";
        return createdDay === today || completedDay === today || dueDay === today;
      });
    } else {
      const cutoff = Date.now() - days * 86400000;
      result = result.filter((t) => {
        const createdTime = new Date(t.created_at).getTime();
        const completedTime = t.completed_at ? new Date(t.completed_at).getTime() : 0;
        return createdTime >= cutoff || completedTime >= cutoff;
      });
    }

    return result;
  }, [tasks, scope, selectedProjects, selectedMembers, selectedTypes, range, profiles, projects]);

  // 3. Dynamic Metrics derived from filteredTasks
  const metrics = useMemo(() => {
    const completed = filteredTasks.filter((t) => t.status === "Completed").length;
    const inProgress = filteredTasks.filter((t) => t.status === "In Progress").length;
    const blocked = filteredTasks.filter((t) => t.status === "Blocked").length;
    const pending = filteredTasks.filter(
      (t) => t.status !== "Completed" && t.status !== "In Progress" && t.status !== "Blocked",
    ).length;
    const total = filteredTasks.length;
    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

    return { completed, inProgress, blocked, pending, total, completionRate };
  }, [filteredTasks]);

  // 4. Dynamic Memberwise Bar Chart Data
  const memberBarChartData = useMemo(() => {
    const targetProfiles = filteredProfiles.length > 0 ? filteredProfiles : profiles;
    const list = targetProfiles.map((p) => {
      const pTasks = filteredTasks.filter((t) => t.assigned_to === p.id);
      const completed = pTasks.filter((t) => t.status === "Completed").length;
      const inProgress = pTasks.filter((t) => t.status === "In Progress").length;
      const blocked = pTasks.filter((t) => t.status === "Blocked").length;
      const pending = pTasks.filter(
        (t) => t.status !== "Completed" && t.status !== "In Progress" && t.status !== "Blocked",
      ).length;

      const cleanName = p.display_name.includes("@")
        ? p.display_name.split("@")[0]
        : p.display_name;

      return {
        name: cleanName,
        fullName: p.display_name,
        Completed: completed,
        InProgress: inProgress,
        Blocked: blocked,
        Pending: pending,
        total: pTasks.length,
      };
    });

    if (showOnlyActiveMembers) {
      return list.filter((m) => m.total > 0);
    }
    return list;
  }, [filteredProfiles, profiles, filteredTasks, showOnlyActiveMembers]);

  // 5. Original Report Graph: Planned vs Actual Hours BarChart
  const planVsActualData = useMemo(() => {
    const targetProfiles = filteredProfiles.length > 0 ? filteredProfiles : profiles;
    return targetProfiles.map((p) => {
      const pTasks = filteredTasks.filter((t) => t.assigned_to === p.id);
      const planned = pTasks.reduce((s, t) => s + Number(t.planned_hours ?? 0), 0);
      const actual = pTasks.reduce((s, t) => s + Number(t.actual_hours ?? 0), 0);
      return {
        name: p.display_name.includes("@") ? p.display_name.split("@")[0] : p.display_name.split(" ")[0],
        fullName: p.display_name,
        planned,
        actual,
      };
    });
  }, [filteredProfiles, profiles, filteredTasks]);

  // 6. Original Report Graph: Task Aging BarChart (Open Tasks)
  const taskAgingData = useMemo(() => {
    const buckets = { "0-3d": 0, "4-7d": 0, "8-14d": 0, "15d+": 0 };
    filteredTasks
      .filter((t) => t.status !== "Completed")
      .forEach((t) => {
        const age = Math.floor((Date.now() - new Date(t.created_at).getTime()) / 86400000);
        if (age <= 3) buckets["0-3d"]++;
        else if (age <= 7) buckets["4-7d"]++;
        else if (age <= 14) buckets["8-14d"]++;
        else buckets["15d+"]++;
      });
    return Object.entries(buckets).map(([k, v]) => ({ bucket: k, count: v }));
  }, [filteredTasks]);

  // 7. Dynamic Team Completion Velocity Line Chart
  const completionTrendData = useMemo(() => {
    const days: Array<{ date: string; completed: number }> = [];
    const daysCount = range === "1" ? 1 : Number(range) || 7;

    for (let i = daysCount - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const count = filteredTasks.filter(
        (t) => t.completed_at && t.completed_at.slice(0, 10) === key,
      ).length;

      days.push({
        date: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        completed: count,
      });
    }

    return days;
  }, [filteredTasks, range]);

  // 8. Workload Donut Chart Data
  const donutData = useMemo(() => {
    const list = [
      { name: "Completed", value: metrics.completed, color: "#10b981" },
      { name: "In Progress", value: metrics.inProgress, color: "#3b82f6" },
      { name: "Blocked", value: metrics.blocked, color: "#f43f5e" },
      { name: "Pending", value: metrics.pending, color: "#f59e0b" },
    ].filter((item) => item.value > 0);

    return list.length > 0
      ? list
      : [
          { name: "Completed", value: 1, color: "#10b981" },
          { name: "In Progress", value: 0, color: "#3b82f6" },
        ];
  }, [metrics]);

  // 9. Member Performance Table Data
  const memberPerformanceList = useMemo(() => {
    const targetProfiles = filteredProfiles.length > 0 ? filteredProfiles : profiles;
    return targetProfiles
      .map((p) => {
        const pTasks = filteredTasks.filter((t) => t.assigned_to === p.id);
        const completed = pTasks.filter((t) => t.status === "Completed").length;
        const inProgress = pTasks.filter((t) => t.status === "In Progress").length;
        const blocked = pTasks.filter((t) => t.status === "Blocked").length;
        const pending = pTasks.filter(
          (t) => t.status !== "Completed" && t.status !== "In Progress" && t.status !== "Blocked",
        ).length;
        const total = pTasks.length;
        const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

        const userProjects =
          Array.from(new Set(pTasks.map((t) => t.project_name).filter(Boolean))).join(", ") ||
          "General Workspace";

        return {
          id: p.id,
          name: p.display_name,
          email: p.email || `${p.display_name.toLowerCase().replace(/\s+/g, ".")}@example.com`,
          avatar: p.avatar_url,
          completed,
          inProgress,
          blocked,
          pending,
          total,
          completionRate,
          userProjects,
        };
      })
      .filter(
        (m) =>
          m.name.toLowerCase().includes(memberSearch.toLowerCase()) ||
          m.email.toLowerCase().includes(memberSearch.toLowerCase()) ||
          m.userProjects.toLowerCase().includes(memberSearch.toLowerCase()),
      );
  }, [filteredProfiles, profiles, filteredTasks, memberSearch]);

  // 10. Inspected Tasks
  const inspectedTasks = useMemo(() => {
    if (taskFilter === "all") return filteredTasks;
    if (taskFilter === "Pending") {
      return filteredTasks.filter(
        (t) => t.status !== "Completed" && t.status !== "In Progress" && t.status !== "Blocked",
      );
    }
    return filteredTasks.filter((t) => t.status === taskFilter);
  }, [filteredTasks, taskFilter]);

  return (
    <div className="rounded-2xl bg-[#0c0d18] border border-[#1d1f36] p-4 md:p-6 text-[#e2e8f0] shadow-2xl space-y-6">
      {/* 1. Top Real Metric Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Completed Tasks */}
        <div className="bg-[#131424] border border-[#1e2038] rounded-xl p-4 flex items-center justify-between shadow-lg hover:border-emerald-500/50 hover:shadow-emerald-500/5 hover:-translate-y-0.5 transition-all duration-200">
          <div className="space-y-1">
            <div className="text-xs font-semibold text-[#94a3b8] uppercase tracking-wider">Completed Tasks</div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-black text-white">{metrics.completed}</span>
              <span className="text-xs font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/25">
                {metrics.completionRate}% rate
              </span>
            </div>
            <div className="text-[11px] text-[#64748b]">Out of {metrics.total} total assigned</div>
          </div>
          <div className="h-11 w-11 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-inner">
            <CheckCircle2 className="h-5 w-5" />
          </div>
        </div>

        {/* Card 2: In Progress Tasks */}
        <div className="bg-[#131424] border border-[#1e2038] rounded-xl p-4 flex items-center justify-between shadow-lg hover:border-indigo-500/50 hover:shadow-indigo-500/5 hover:-translate-y-0.5 transition-all duration-200">
          <div className="space-y-1">
            <div className="text-xs font-semibold text-[#94a3b8] uppercase tracking-wider">In Progress Tasks</div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-black text-white">{metrics.inProgress}</span>
              <span className="text-xs font-bold text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded-full border border-indigo-500/25">
                Active Work
              </span>
            </div>
            <div className="text-[11px] text-[#64748b]">Currently being worked on</div>
          </div>
          <div className="h-11 w-11 rounded-xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shadow-inner">
            <Clock className="h-5 w-5" />
          </div>
        </div>

        {/* Card 3: Blocked Tasks */}
        <div className="bg-[#131424] border border-[#1e2038] rounded-xl p-4 flex items-center justify-between shadow-lg hover:border-rose-500/50 hover:shadow-rose-500/5 hover:-translate-y-0.5 transition-all duration-200">
          <div className="space-y-1">
            <div className="text-xs font-semibold text-[#94a3b8] uppercase tracking-wider">Blocked Tasks</div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-black text-rose-400">{metrics.blocked}</span>
              <span className="text-xs font-bold text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded-full border border-rose-500/25">
                Risk Alert
              </span>
            </div>
            <div className="text-[11px] text-[#64748b]">Requires manager unblock</div>
          </div>
          <div className="h-11 w-11 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400 shadow-inner">
            <AlertOctagon className="h-5 w-5" />
          </div>
        </div>

        {/* Card 4: Total Assigned & Active Members */}
        <div className="bg-[#131424] border border-[#1e2038] rounded-xl p-4 flex items-center justify-between shadow-lg hover:border-slate-500/50 hover:shadow-slate-500/5 hover:-translate-y-0.5 transition-all duration-200">
          <div className="space-y-1">
            <div className="text-xs font-semibold text-[#94a3b8] uppercase tracking-wider">Pending Queue</div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-black text-white">{metrics.pending}</span>
              <span className="text-xs font-bold text-slate-300 bg-slate-500/10 px-2 py-0.5 rounded-full border border-slate-500/25">
                {filteredProfiles.length} Members
              </span>
            </div>
            <div className="text-[11px] text-[#64748b]">To Do & Review queue</div>
          </div>
          <div className="h-11 w-11 rounded-xl bg-slate-500/10 border border-slate-500/30 flex items-center justify-center text-slate-300 shadow-inner">
            <Users className="h-5 w-5" />
          </div>
        </div>
      </div>

      {/* 2. Top Charts Grid: Real Member Bar Chart (Left) + Completion Velocity Trend (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left: Memberwise Task Breakdown Bar Chart */}
        <div className="lg:col-span-7 bg-[#161726] border border-[#25273e] rounded-xl p-5 shadow-md space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-white tracking-tight">Memberwise Task Status</h3>
              <p className="text-xs text-[#94a3b8]">Real task allocation per team member</p>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <div className="flex items-center gap-1 bg-[#121320] border border-[#25273e] p-0.5 rounded-lg">
                <Button
                  size="sm"
                  variant={!showOnlyActiveMembers ? "default" : "ghost"}
                  onClick={() => setShowOnlyActiveMembers(false)}
                  className={`h-6 text-[11px] px-2 ${!showOnlyActiveMembers ? "bg-indigo-600 text-white" : "text-[#94a3b8]"}`}
                >
                  All Members
                </Button>
                <Button
                  size="sm"
                  variant={showOnlyActiveMembers ? "default" : "ghost"}
                  onClick={() => setShowOnlyActiveMembers(true)}
                  className={`h-6 text-[11px] px-2 ${showOnlyActiveMembers ? "bg-indigo-600 text-white" : "text-[#94a3b8]"}`}
                >
                  Active Only
                </Button>
              </div>
              <div className="hidden sm:flex items-center gap-2">
                <span className="flex items-center gap-1 text-emerald-400 font-medium">
                  <span className="h-2.5 w-2.5 rounded-sm bg-[#10b981]" /> Done
                </span>
                <span className="flex items-center gap-1 text-indigo-400 font-medium">
                  <span className="h-2.5 w-2.5 rounded-sm bg-[#6366f1]" /> In Prog
                </span>
                <span className="flex items-center gap-1 text-rose-400 font-medium">
                  <span className="h-2.5 w-2.5 rounded-sm bg-[#f43f5e]" /> Blocked
                </span>
                <span className="flex items-center gap-1 text-slate-400 font-medium">
                  <span className="h-2.5 w-2.5 rounded-sm bg-[#64748b]" /> Pending
                </span>
              </div>
            </div>
          </div>

          <div className="h-[290px] w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={memberBarChartData} margin={{ top: 10, right: 10, left: -20, bottom: 25 }}>
                <XAxis
                  dataKey="name"
                  stroke="#64748b"
                  fontSize={10}
                  tickLine={false}
                  axisLine={{ stroke: "#25273e" }}
                  interval={0}
                  angle={-25}
                  textAnchor="end"
                  height={50}
                />
                <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (active && payload && payload.length) {
                      const full = payload[0]?.payload?.fullName || label;
                      const tot = payload[0]?.payload?.total || 0;
                      return (
                        <div className="bg-[#1a1c2e]/95 border border-[#313454] rounded-xl p-3 shadow-2xl text-xs space-y-1.5 min-w-[160px]">
                          <div className="font-bold text-indigo-300 border-b border-[#313454] pb-1.5 flex items-center justify-between">
                            <span>{full}</span>
                            <span className="text-[10px] text-slate-400 font-normal">({tot} tasks)</span>
                          </div>
                          {payload.map((entry: any, i: number) => (
                            <div key={i} className="flex items-center justify-between gap-3">
                              <span style={{ color: entry.color }} className="font-medium">{entry.name}:</span>
                              <span className="font-bold text-white">{entry.value}</span>
                            </div>
                          ))}
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Bar dataKey="Completed" fill="#10b981" stackId="a" radius={[0, 0, 0, 0]} barSize={22} />
                <Bar dataKey="InProgress" fill="#6366f1" stackId="a" radius={[0, 0, 0, 0]} barSize={22} />
                <Bar dataKey="Blocked" fill="#f43f5e" stackId="a" radius={[0, 0, 0, 0]} barSize={22} />
                <Bar dataKey="Pending" fill="#64748b" stackId="a" radius={[3, 3, 0, 0]} barSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Right: Team Completion Velocity Line Chart */}
        <div className="lg:col-span-5 bg-[#161726] border border-[#25273e] rounded-xl p-5 shadow-md space-y-4">
          <div>
            <h3 className="text-base font-bold text-white tracking-tight">Team Completion Velocity</h3>
            <p className="text-xs text-[#94a3b8]">Daily task completions over {RANGE_LABEL[range as RangeKey]}</p>
          </div>

          <div className="h-[290px] w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={completionTrendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <XAxis dataKey="date" stroke="#64748b" fontSize={11} tickLine={false} axisLine={{ stroke: "#25273e" }} />
                <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (active && payload && payload.length) {
                      return (
                        <div className="bg-[#1a1c2e]/95 border border-emerald-500/40 rounded-xl p-3 shadow-2xl text-xs space-y-1">
                          <div className="font-bold text-slate-300 border-b border-[#313454] pb-1">{label}</div>
                          <div className="flex items-center justify-between gap-4 font-bold text-emerald-400">
                            <span>Tasks Completed:</span>
                            <span className="text-sm font-extrabold">{payload[0]?.value}</span>
                          </div>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="completed"
                  stroke="#10b981"
                  strokeWidth={3}
                  dot={{ r: 4, fill: "#10b981" }}
                  activeDot={{ r: 6, strokeWidth: 2, stroke: "#161726" }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* 3. Original Reports Charts Grid: Planned vs Actual Hours & Task Aging */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Graph 1: Planned vs Actual Hours per Member */}
        <div className="lg:col-span-7 bg-[#161726] border border-[#25273e] rounded-xl p-5 shadow-md space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                <BarChart2 className="h-4 w-4 text-indigo-400" /> Planned vs Actual Hours
              </h3>
              <p className="text-xs text-[#94a3b8]">Comparison of planned hours vs actual work logged</p>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1.5 text-indigo-300 font-medium">
                <span className="h-2.5 w-2.5 rounded-sm bg-[#6366f1]" /> Planned
              </span>
              <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
                <span className="h-2.5 w-2.5 rounded-sm bg-[#10b981]" /> Actual
              </span>
            </div>
          </div>

          <div className="h-[250px] w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={planVsActualData} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
                <XAxis dataKey="name" stroke="#64748b" fontSize={10} tickLine={false} axisLine={{ stroke: "#25273e" }} interval={0} angle={-20} textAnchor="end" />
                <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (active && payload && payload.length) {
                      const full = payload[0]?.payload?.fullName || label;
                      return (
                        <div className="bg-[#1a1c2e]/95 border border-[#313454] rounded-xl p-3 shadow-2xl text-xs space-y-1.5 min-w-[150px]">
                          <div className="font-bold text-indigo-300 border-b border-[#313454] pb-1">{full}</div>
                          {payload.map((entry: any, i: number) => (
                            <div key={i} className="flex items-center justify-between gap-3">
                              <span style={{ color: entry.color }} className="font-medium">{entry.name}:</span>
                              <span className="font-bold text-white">{entry.value}h</span>
                            </div>
                          ))}
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Bar dataKey="planned" fill="#6366f1" radius={[3, 3, 0, 0]} barSize={16} />
                <Bar dataKey="actual" fill="#10b981" radius={[3, 3, 0, 0]} barSize={16} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Graph 2: Task Aging (Open Tasks) */}
        <div className="lg:col-span-5 bg-[#161726] border border-[#25273e] rounded-xl p-5 shadow-md space-y-4">
          <div>
            <h3 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
              <Hourglass className="h-4 w-4 text-amber-400" /> Task Aging (Open Tasks)
            </h3>
            <p className="text-xs text-[#94a3b8]">Age distribution of active incomplete tasks</p>
          </div>

          <div className="h-[250px] w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={taskAgingData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <XAxis dataKey="bucket" stroke="#64748b" fontSize={11} tickLine={false} axisLine={{ stroke: "#25273e" }} />
                <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (active && payload && payload.length) {
                      return (
                        <div className="bg-[#1a1c2e]/95 border border-amber-500/40 rounded-xl p-3 shadow-2xl text-xs space-y-1">
                          <div className="font-bold text-amber-300 border-b border-[#313454] pb-1">Age Bucket: {label}</div>
                          <div className="flex items-center justify-between gap-4 font-bold text-white">
                            <span>Open Tasks:</span>
                            <span className="text-amber-400 font-extrabold">{payload[0]?.value}</span>
                          </div>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Bar dataKey="count" fill="#f59e0b" radius={[4, 4, 0, 0]} barSize={32} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* 4. Middle Section: Real Work Distribution Donut & Member Breakdown Table */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Donut Chart: Task Status Breakdown */}
        <div className="lg:col-span-4 bg-[#161726] border border-[#25273e] rounded-xl p-5 shadow-md flex flex-col justify-between space-y-4">
          <h3 className="text-base font-bold text-white tracking-tight">Workload Distribution</h3>

          <div className="relative h-[200px] w-full flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={donutData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={85}
                  paddingAngle={4}
                  dataKey="value"
                >
                  {donutData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} stroke="#161726" strokeWidth={3} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center">
              <span className="text-2xl font-black text-white">{metrics.total}</span>
              <span className="text-[11px] font-medium text-[#94a3b8]">Total Tasks</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs pt-1">
            {donutData.map((item, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-sm shrink-0" style={{ backgroundColor: item.color }} />
                <span className="text-[#cbd5e1] font-medium truncate">{item.name}: {item.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Member Performance Breakdown Table (With Click Drilldown) */}
        <div className="lg:col-span-8 bg-[#161726] border border-[#25273e] rounded-xl p-5 shadow-md space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-white tracking-tight">Member Performance Breakdown</h3>
              <p className="text-xs text-[#94a3b8]">Click any member row for full task & project inspection</p>
            </div>
            <Input
              placeholder="Filter members or projects..."
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
              className="h-8 w-48 text-xs bg-[#121320] border-[#25273e]"
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#25273e] text-[#94a3b8]">
                  <th className="py-3 px-3 font-semibold">Team Member</th>
                  <th className="py-3 px-3 font-semibold text-center">Completed</th>
                  <th className="py-3 px-3 font-semibold text-center">In Progress</th>
                  <th className="py-3 px-3 font-semibold text-center">Blocked</th>
                  <th className="py-3 px-3 font-semibold text-center">Total</th>
                  <th className="py-3 px-3 font-semibold text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#25273e]/50">
                {memberPerformanceList.map((m) => (
                  <tr
                    key={m.id}
                    onClick={() => onSelectMember(m.id)}
                    className="hover:bg-[#202237] transition-colors cursor-pointer group"
                  >
                    <td className="py-3 px-3 flex items-center gap-3">
                      <Avatar className="h-8 w-8 border border-[#313454]">
                        {m.avatar ? (
                          <AvatarImage src={m.avatar} alt={m.name} />
                        ) : (
                          <AvatarFallback className="bg-[#2a2c47] text-white text-xs font-bold">
                            {m.name.slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        )}
                      </Avatar>
                      <div>
                        <div className="font-semibold text-white group-hover:text-indigo-400 transition-colors">
                          {m.name}
                        </div>
                        <div className="text-[11px] text-[#64748b] truncate max-w-[180px]">{m.userProjects}</div>
                      </div>
                    </td>
                    <td className="py-3 px-3 text-center">
                      <span className="bg-emerald-500/10 text-emerald-400 font-bold px-2 py-0.5 rounded border border-emerald-500/20">
                        {m.completed}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-center">
                      <span className="bg-blue-500/10 text-blue-400 font-bold px-2 py-0.5 rounded border border-blue-500/20">
                        {m.inProgress}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-center">
                      <span className="bg-rose-500/10 text-rose-400 font-bold px-2 py-0.5 rounded border border-rose-500/20">
                        {m.blocked}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-center font-bold text-white">{m.total}</td>
                    <td className="py-3 px-3 text-right">
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-indigo-400 hover:text-white hover:bg-indigo-600/30">
                        Inspect
                      </Button>
                    </td>
                  </tr>
                ))}
                {memberPerformanceList.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-xs text-[#94a3b8]">
                      No team members match your search query
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* 5. Interactive Task Inspection List */}
      <div className="bg-[#161726] border border-[#25273e] rounded-xl p-5 shadow-md space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-white tracking-tight">Interactive Task Inspection</h3>
            <p className="text-xs text-[#94a3b8]">Review real task statuses, codes, priorities and blocker reasons</p>
          </div>
          <div className="flex items-center gap-2">
            {(["all", "Completed", "In Progress", "Blocked", "Pending"] as const).map((st) => (
              <Button
                key={st}
                size="sm"
                variant={taskFilter === st ? "default" : "outline"}
                onClick={() => setTaskFilter(st)}
                className={`h-7 text-xs ${
                  taskFilter === st
                    ? "bg-indigo-600 text-white"
                    : "bg-[#121320] border-[#25273e] text-[#94a3b8] hover:text-white"
                }`}
              >
                {st}
              </Button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-72 overflow-y-auto">
          {inspectedTasks.slice(0, 14).map((t) => (
            <div
              key={t.id}
              className="bg-[#121320] border border-[#25273e] rounded-xl p-3 space-y-2 hover:border-[#313454] transition-all text-xs"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-medium text-white">
                  <span className="font-mono text-indigo-400 font-bold">{t.task_code}</span>
                  <span className="truncate max-w-[220px]">{t.task_name}</span>
                </div>
                <Badge
                  variant="secondary"
                  className={
                    t.status === "Completed"
                      ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                      : t.status === "Blocked"
                      ? "bg-rose-500/10 text-rose-400 border border-rose-500/30"
                      : "bg-blue-500/10 text-blue-400 border border-blue-500/30"
                  }
                >
                  {t.status}
                </Badge>
              </div>
              <div className="flex flex-wrap items-center justify-between text-[11px] text-[#94a3b8]">
                <span>Project: {t.project_name || "General"}</span>
                <span>Priority: {t.priority}</span>
              </div>
              {t.status === "Blocked" && t.blocker_reason && (
                <div className="text-[11px] text-rose-400 bg-rose-500/10 p-1.5 rounded border border-rose-500/20 font-medium">
                  🚨 Blocker: {t.blocker_reason}
                </div>
              )}
            </div>
          ))}
          {inspectedTasks.length === 0 && (
            <div className="col-span-2 py-6 text-center text-xs text-[#94a3b8]">
              No tasks found under filter "{taskFilter}"
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*            MULTI-SELECT FILTER POPOVER COMPONENT                          */
/* -------------------------------------------------------------------------- */

function MultiSelectFilterPopover({
  label,
  options,
  selectedValues,
  onChange,
}: {
  label: string;
  options: Array<{ id: string; label: string }>;
  selectedValues: string[];
  onChange: (vals: string[]) => void;
}) {
  const [open, setOpen] = useState(false);

  const toggleValue = (id: string) => {
    if (selectedValues.includes(id)) {
      onChange(selectedValues.filter((v) => v !== id));
    } else {
      onChange([...selectedValues, id]);
    }
  };

  const displayText =
    selectedValues.length === 0
      ? `All ${label}s`
      : selectedValues.length === options.length
      ? `All ${label}s`
      : `${selectedValues.length} ${label}${selectedValues.length > 1 ? "s" : ""}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2.5 text-xs bg-[#121320] border-[#25273e] text-white hover:bg-[#1c1e33] justify-between gap-1.5 font-normal"
        >
          <span className="truncate max-w-[110px]">{displayText}</span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-52 p-2 bg-[#161726] border-[#25273e] text-white shadow-2xl z-[100]"
        align="start"
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <div className="flex items-center justify-between border-b border-[#25273e] pb-1.5 mb-1.5 px-1">
          <span className="text-[11px] font-bold text-[#94a3b8] uppercase">{label}s</span>
          {selectedValues.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="text-[10px] text-indigo-400 hover:underline cursor-pointer"
            >
              Clear
            </button>
          )}
        </div>
        <div className="max-h-52 overflow-y-auto space-y-1">
          {options.map((opt) => {
            const checked = selectedValues.includes(opt.id);
            return (
              <div
                key={opt.id}
                onClick={() => toggleValue(opt.id)}
                className="flex items-center space-x-2 px-2 py-1.5 hover:bg-[#202238] rounded cursor-pointer text-xs"
              >
                <Checkbox checked={checked} className="border-indigo-400/50 data-[state=checked]:bg-indigo-600" />
                <span className="flex-1 truncate">{opt.label}</span>
              </div>
            );
          })}
          {options.length === 0 && (
            <div className="text-[11px] text-[#94a3b8] italic p-2 text-center">No options available</div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* -------------------------------------------------------------------------- */
/*            INTERACTIVE MEMBER DRILLDOWN SHEET / DRAWER COMPONENT          */
/* -------------------------------------------------------------------------- */

function MemberDetailSheet({
  memberId,
  onClose,
  profiles,
  tasks,
  projects,
  checkins,
}: {
  memberId: string | null;
  onClose: () => void;
  profiles: Profile[];
  tasks: Task[];
  projects: Project[];
  checkins: EodCheckin[];
}) {
  const [taskSearch, setTaskSearch] = useState("");
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [drawerRange, setDrawerRange] = useState("all");
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);

  const statusOptions = [
    { id: "In Progress", label: "In Progress" },
    { id: "Completed", label: "Completed" },
    { id: "Blocked", label: "Blocked" },
    { id: "To Do", label: "To Do" },
  ];

  const member = useMemo(
    () => profiles.find((p) => p.id === memberId) || null,
    [profiles, memberId],
  );

  const memberTasks = useMemo(() => {
    if (!memberId) return [];
    return tasks.filter((t) => t.assigned_to === memberId);
  }, [tasks, memberId]);

  const availableDrawerProjects = useMemo(() => {
    const map = new Map<string, { id: string; label: string }>();

    // 1. Add projects directly from member's tasks (e.g. TicketTape, TerraCognita)
    memberTasks.forEach((t) => {
      if (t.project_name?.trim()) {
        const name = t.project_name.trim();
        const key = name.toLowerCase();
        if (!map.has(key)) {
          map.set(key, { id: name, label: name });
        }
      }
    });

    // 2. Add projects from master projects list
    projects.forEach((p) => {
      if (p.name?.trim()) {
        const name = p.name.trim();
        const key = name.toLowerCase();
        if (!map.has(key)) {
          map.set(key, { id: name, label: name });
        }
      }
    });

    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [memberTasks, projects]);

  const filteredTasks = useMemo(() => {
    return memberTasks.filter((t) => {
      // 1. Search text filter
      const matchSearch =
        !taskSearch.trim() ||
        t.task_name.toLowerCase().includes(taskSearch.toLowerCase()) ||
        t.task_code.toLowerCase().includes(taskSearch.toLowerCase()) ||
        (t.project_name && t.project_name.toLowerCase().includes(taskSearch.toLowerCase()));

      // 2. Multi-select Status filter
      const matchStatus =
        selectedStatuses.length === 0 || selectedStatuses.includes(t.status);

      // 3. Multi-select Project filter
      const matchProject =
        selectedProjects.length === 0 ||
        (t.project_name && selectedProjects.some((sp) => sp.toLowerCase() === t.project_name?.toLowerCase())) ||
        (t.project_id && selectedProjects.includes(t.project_id));

      // 4. Range filter (Today, 7d, 14d, 30d, 90d, All Time)
      let matchRange = true;
      if (drawerRange === "1") {
        const today = new Date().toISOString().slice(0, 10);
        const createdDay = t.created_at ? t.created_at.slice(0, 10) : "";
        const completedDay = t.completed_at ? t.completed_at.slice(0, 10) : "";
        const dueDay = t.due_date ? t.due_date.slice(0, 10) : "";
        matchRange = createdDay === today || completedDay === today || dueDay === today;
      } else if (drawerRange !== "all") {
        const days = Number(drawerRange) || 7;
        const cutoff = Date.now() - days * 86400000;
        const createdTime = new Date(t.created_at).getTime();
        const completedTime = t.completed_at ? new Date(t.completed_at).getTime() : 0;
        matchRange = createdTime >= cutoff || completedTime >= cutoff;
      }

      return matchSearch && matchStatus && matchProject && matchRange;
    });
  }, [memberTasks, taskSearch, selectedStatuses, selectedProjects, drawerRange]);

  const memberCheckins = useMemo(() => {
    if (!memberId) return [];
    return checkins.filter((c) => c.user_id === memberId);
  }, [checkins, memberId]);

  const stats = useMemo(() => {
    const total = filteredTasks.length;
    const completed = filteredTasks.filter((t) => t.status === "Completed").length;
    const inProgress = filteredTasks.filter((t) => t.status === "In Progress").length;
    const blocked = filteredTasks.filter((t) => t.status === "Blocked").length;
    const plannedHours = filteredTasks.reduce((s, t) => s + (t.planned_hours ?? 0), 0);
    const actualHours = filteredTasks.reduce((s, t) => s + (t.actual_hours ?? 0), 0);
    const completionPct = total > 0 ? Math.round((completed / total) * 100) : 0;

    return { total, completed, inProgress, blocked, plannedHours, actualHours, completionPct };
  }, [filteredTasks]);

  const memberProjects = useMemo(() => {
    const set = new Set<string>();
    memberTasks.forEach((t) => {
      if (t.project_name) set.add(t.project_name);
    });
    return Array.from(set);
  }, [memberTasks]);

  if (!memberId || !member) return null;

  return (
    <Sheet open={!!memberId} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl overflow-y-auto bg-[#0f101d] border-l border-[#25273e] text-[#e2e8f0] p-6 space-y-6"
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <SheetHeader className="space-y-3 border-b border-[#25273e] pb-4">
          <div className="flex items-center gap-4">
            <Avatar className="h-14 w-14 border-2 border-indigo-500">
              {member.avatar_url ? (
                <AvatarImage src={member.avatar_url} alt={member.display_name} />
              ) : (
                <AvatarFallback className="bg-[#272942] text-white text-lg font-bold">
                  {member.display_name.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              )}
            </Avatar>
            <div className="space-y-0.5">
              <SheetTitle className="text-xl font-bold text-white flex items-center gap-2">
                {member.display_name}
                <Badge variant="outline" className="text-xs bg-[#241f3d] text-indigo-300 border-indigo-500/30">
                  Team Member
                </Badge>
              </SheetTitle>
              <SheetDescription className="text-xs text-[#94a3b8] flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <Mail className="h-3.5 w-3.5 text-indigo-400" />
                  {member.email || `${member.display_name.toLowerCase().replace(/\s+/g, ".")}@example.com`}
                </span>
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        {/* Member Filters Bar (Range, Project, Status & Search) */}
        <div className="bg-[#161726] border border-[#25273e] p-3 rounded-xl space-y-2">
          <div className="text-[11px] font-bold uppercase tracking-wider text-indigo-400 flex items-center gap-1.5">
            <Filter className="h-3.5 w-3.5" /> Member View Filters
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={drawerRange} onValueChange={setDrawerRange}>
              <SelectTrigger className="h-7 w-28 text-xs bg-[#121320] border-[#25273e] text-white">
                <SelectValue placeholder="Timeframe" />
              </SelectTrigger>
              <SelectContent className="bg-[#161726] border-[#25273e] text-xs text-white">
                <SelectItem value="all">All Time</SelectItem>
                <SelectItem value="1">Today</SelectItem>
                <SelectItem value="7">7 Days</SelectItem>
                <SelectItem value="14">14 Days</SelectItem>
                <SelectItem value="30">30 Days</SelectItem>
              </SelectContent>
            </Select>

            <MultiSelectFilterPopover
              label="Project"
              options={availableDrawerProjects}
              selectedValues={selectedProjects}
              onChange={setSelectedProjects}
            />

            <MultiSelectFilterPopover
              label="Status"
              options={statusOptions}
              selectedValues={selectedStatuses}
              onChange={setSelectedStatuses}
            />

            <Input
              placeholder="Search tasks..."
              value={taskSearch}
              onChange={(e) => setTaskSearch(e.target.value)}
              className="h-7 w-36 text-xs bg-[#121320] border-[#25273e] text-white"
            />
          </div>
        </div>

        {/* Member KPI Summary Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-[#161726] border border-[#25273e] p-3 rounded-xl space-y-1">
            <div className="text-[11px] font-medium text-[#94a3b8]">Assigned Tasks</div>
            <div className="text-xl font-bold text-white">{stats.total}</div>
          </div>
          <div className="bg-[#161726] border border-[#25273e] p-3 rounded-xl space-y-1">
            <div className="text-[11px] font-medium text-[#94a3b8]">Completed</div>
            <div className="text-xl font-bold text-emerald-400">{stats.completed} ({stats.completionPct}%)</div>
          </div>
          <div className="bg-[#161726] border border-[#25273e] p-3 rounded-xl space-y-1">
            <div className="text-[11px] font-medium text-[#94a3b8]">Work Hours</div>
            <div className="text-xl font-bold text-indigo-300">{stats.actualHours}h / {stats.plannedHours}h</div>
          </div>
          <div className="bg-[#161726] border border-[#25273e] p-3 rounded-xl space-y-1">
            <div className="text-[11px] font-medium text-[#94a3b8]">Active Blockers</div>
            <div className="text-xl font-bold text-rose-400">{stats.blocked}</div>
          </div>
        </div>

        {/* Active Projects List for Member */}
        <div className="space-y-2">
          <h4 className="text-xs font-bold uppercase tracking-wider text-[#94a3b8] flex items-center gap-1.5">
            <Briefcase className="h-3.5 w-3.5 text-amber-400" /> Associated Projects ({memberProjects.length})
          </h4>
          <div className="flex flex-wrap gap-2">
            {memberProjects.length > 0 ? (
              memberProjects.map((pName, i) => (
                <Badge key={i} className="bg-[#1c1e33] border border-[#313454] text-white px-3 py-1 text-xs rounded-lg flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-amber-400" />
                  {pName}
                </Badge>
              ))
            ) : (
              <span className="text-xs text-[#94a3b8] italic">No active projects assigned</span>
            )}
          </div>
        </div>

        {/* Assigned Tasks List */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-[#94a3b8] flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> Member Tasks ({filteredTasks.length})
            </h4>
            <div className="flex items-center gap-2">
              <Input
                placeholder="Search tasks..."
                value={taskSearch}
                onChange={(e) => setTaskSearch(e.target.value)}
                className="h-7 w-36 text-xs bg-[#161726] border-[#25273e]"
              />
              <MultiSelectFilterPopover
                label="Project"
                options={availableDrawerProjects}
                selectedValues={selectedProjects}
                onChange={setSelectedProjects}
              />
              <MultiSelectFilterPopover
                label="Status"
                options={statusOptions}
                selectedValues={selectedStatuses}
                onChange={setSelectedStatuses}
              />
            </div>
          </div>

          <div className="border border-[#25273e] rounded-xl overflow-hidden bg-[#161726]">
            <div className="max-h-64 overflow-y-auto divide-y divide-[#25273e]/50">
              {filteredTasks.length > 0 ? (
                filteredTasks.map((t) => (
                  <div key={t.id} className="p-3 hover:bg-[#1f2136] transition-colors space-y-1 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 font-medium text-white">
                        <span className="font-mono text-indigo-400 text-[11px]">{t.task_code}</span>
                        <span>{t.task_name}</span>
                      </div>
                      <Badge
                        variant="secondary"
                        className={
                          t.status === "Completed"
                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                            : t.status === "Blocked"
                            ? "bg-rose-500/10 text-rose-400 border border-rose-500/30"
                            : "bg-indigo-500/10 text-indigo-300 border border-indigo-500/30"
                        }
                      >
                        {t.status}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap items-center justify-between text-[11px] text-[#94a3b8] pt-1">
                      <span>Project: {t.project_name || "General"}</span>
                      <span>Hours: {t.actual_hours ?? 0}h / {t.planned_hours ?? 0}h</span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-6 text-center text-xs text-[#94a3b8]">No tasks found for this member</div>
              )}
            </div>
          </div>
        </div>

        {/* EOD Check-ins History */}
        <div className="space-y-3 pt-2">
          <h4 className="text-xs font-bold uppercase tracking-wider text-[#94a3b8] flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-indigo-400" /> Recent EOD Check-ins ({memberCheckins.length})
          </h4>
          <div className="space-y-2">
            {memberCheckins.slice(0, 3).map((c) => (
              <div key={c.id} className="bg-[#161726] border border-[#25273e] p-3 rounded-xl space-y-1 text-xs">
                <div className="flex items-center justify-between font-semibold text-white">
                  <span>Check-in Date: {c.checkin_date}</span>
                  <span className="text-emerald-400 font-mono">{c.completed_count} tasks completed</span>
                </div>
                {c.note && <div className="text-[#cbd5e1] italic">"{c.note}"</div>}
              </div>
            ))}
            {memberCheckins.length === 0 && (
              <div className="text-xs text-[#94a3b8] italic">No recent EOD check-in logs submitted</div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ---------------- Scope picker ---------------- */

function scopeToValue(s: Scope): string {
  if (s.kind === "org") return "org";
  return `${s.kind}:${s.id}`;
}

function valueToScope(v: string): Scope {
  if (v === "org") return { kind: "org" };
  const [kind, id] = v.split(":");
  if (kind === "team") return { kind: "team", id };
  if (kind === "manager") return { kind: "manager", id };
  return { kind: "org" };
}

function ScopeSelect({
  scope,
  boot,
  teams,
  managers,
  onChange,
}: {
  scope: Scope;
  boot: ExecScopeBootstrap;
  teams: Array<{ id: string; name: string }>;
  managers: Array<{ id: string; name: string }>;
  onChange: (s: Scope) => void;
}) {
  const canSeeOrg = boot.isAdmin;
  return (
    <Select value={scopeToValue(scope)} onValueChange={(v) => onChange(valueToScope(v))}>
      <SelectTrigger className="h-8 w-[190px] text-xs bg-[#161726] border-[#25273e] text-white">
        <SelectValue placeholder="Scope" />
      </SelectTrigger>
      <SelectContent className="bg-[#161726] border-[#25273e] text-xs text-white">
        {canSeeOrg && (
          <SelectGroup>
            <SelectLabel className="text-[10px] uppercase tracking-wide text-indigo-400">Scope</SelectLabel>
            <SelectItem value="org" className="text-xs">
              Organization
            </SelectItem>
          </SelectGroup>
        )}
        {teams.length > 0 && (
          <SelectGroup>
            <SelectLabel className="text-[10px] uppercase tracking-wide text-indigo-400">Teams</SelectLabel>
            {boot.primaryTeamId && (
              <SelectItem value={`team:${boot.primaryTeamId}`} className="text-xs">
                My Team · {boot.primaryTeamName ?? "—"}
              </SelectItem>
            )}
            {teams
              .filter((t) => t.id !== boot.primaryTeamId)
              .slice(0, 50)
              .map((t) => (
                <SelectItem key={t.id} value={`team:${t.id}`} className="text-xs">
                  {t.name}
                </SelectItem>
              ))}
          </SelectGroup>
        )}
        {managers.length > 0 && (
          <SelectGroup>
            <SelectLabel className="text-[10px] uppercase tracking-wide text-indigo-400">Managers</SelectLabel>
            {(boot.isManager || boot.isAdmin) && (
              <SelectItem value={`manager:${boot.userId}`} className="text-xs">
                My Hierarchy
              </SelectItem>
            )}
            {managers
              .filter((m) => m.id !== boot.userId)
              .slice(0, 50)
              .map((m) => (
                <SelectItem key={m.id} value={`manager:${m.id}`} className="text-xs">
                  {m.name}
                </SelectItem>
              ))}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  );
}

/* ---------------- Shared primitives ---------------- */

function FilterSelect({
  value,
  onChange,
  label,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  options: [string, string][];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 w-[130px] text-xs bg-[#161726] border-[#25273e] text-white">
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent className="bg-[#161726] border-[#25273e] text-xs text-white">
        {options.map(([v, l]) => (
          <SelectItem key={v} value={v} className="text-xs">
            {l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Section({
  title,
  icon,
  children,
  action,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          {icon} {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Kpi({
  label,
  value,
  sub,
  tone,
  to,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "good" | "warn" | "bad" | "neutral";
  to?: string;
}) {
  const toneClass =
    tone === "good"
      ? "border-status-completed/40"
      : tone === "warn"
        ? "border-priority-medium/40"
        : tone === "bad"
          ? "border-priority-high/40"
          : "";
  const body = (
    <Card className={`p-3 md:p-4 h-full ${toneClass}`}>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl md:text-2xl font-semibold">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>}
    </Card>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

function toneForPct(pct: number): "good" | "warn" | "bad" {
  if (pct > 85) return "good";
  if (pct >= 70) return "warn";
  return "bad";
}

function StatusDot({ tone }: { tone: "good" | "warn" | "bad" }) {
  const c =
    tone === "good"
      ? "bg-status-completed"
      : tone === "warn"
        ? "bg-priority-medium"
        : "bg-priority-high";
  return <span className={`inline-block h-2 w-2 rounded-full ${c}`} />;
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "warn" | "bad";
}) {
  const c = tone === "bad" ? "text-priority-high" : tone === "warn" ? "text-priority-medium" : "";
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-medium tabular-nums ${c}`}>{value}</span>
    </div>
  );
}

/* ---------------- 1. Execution Health ---------------- */

function ExecutionHealth({ s }: { s: ExecSummary }) {
  const e = s.execution;
  const pct = e.planned_today ? Math.round((e.completed_today / e.planned_today) * 100) : 0;
  const weekPct = e.week_due ? Math.round((e.week_done / e.week_due) * 100) : 0;

  return (
    <Section title="Execution Health" icon={<Gauge className="h-4 w-4 text-primary" />}>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi
          label="Today's Target"
          value={`${e.completed_today}/${e.planned_today}`}
          sub={`${pct}% completed`}
          tone={toneForPct(pct)}
          to="/today"
        />
        <Kpi
          label="Week Target"
          value={`${e.week_done}/${e.week_due}`}
          sub={`${weekPct}% completed`}
          tone={toneForPct(weekPct)}
          to="/planning"
        />
        <Kpi
          label="Prev Week Target"
          value={`${e.prev_week_done}/${e.prev_week_due}`}
          sub={
            e.prev_week_due
              ? `${Math.round((e.prev_week_done / e.prev_week_due) * 100)}% completed`
              : "—"
          }
          tone="neutral"
        />
        <Kpi
          label="Active Capacity"
          value={`${s.meta.capacity}h`}
          sub="daily capacity"
          tone="neutral"
        />
      </div>
    </Section>
  );
}

/* ---------------- 2. Delivery Health ---------------- */

function DeliveryHealth({ s }: { s: ExecSummary }) {
  const d = s.delivery;
  return (
    <Section title="Delivery Health" icon={<CheckCircle2 className="h-4 w-4 text-status-completed" />}>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card className="p-3 md:p-4 space-y-2">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Project Status
          </div>
          <div className="flex items-center gap-4 text-sm font-medium">
            <div className="flex items-center gap-1 text-status-completed">
              <StatusDot tone="good" /> {d.on_track} On Track
            </div>
            <div className="flex items-center gap-1 text-priority-medium">
              <StatusDot tone="warn" /> {d.at_risk} At Risk
            </div>
            <div className="flex items-center gap-1 text-priority-high">
              <StatusDot tone="bad" /> {d.delayed} Delayed
            </div>
          </div>
        </Card>
        <Card className="p-3 md:p-4 md:col-span-2 space-y-2">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Projects ({d.projects.length})
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-32 overflow-y-auto">
            {d.projects.slice(0, 10).map((p) => {
              const tone = p.status === "on" ? "good" : p.status === "risk" ? "warn" : "bad";
              return (
                <div
                  key={p.id}
                  className="flex items-center justify-between text-xs p-2 rounded bg-accent/40"
                >
                  <div className="flex items-center gap-2 truncate">
                    <StatusDot tone={tone} />
                    <span className="font-medium truncate">{p.name}</span>
                  </div>
                  <div className="text-muted-foreground shrink-0 text-[11px]">
                    {p.overdue > 0 && <span className="text-priority-high font-medium mr-1">{p.overdue} overdue</span>}
                    <span>({p.total} total)</span>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </Section>
  );
}

/* ---------------- 3. Risk Center ---------------- */

function RiskCenter({ s }: { s: ExecSummary }) {
  const r = s.risk;
  return (
    <Section title="Risk Center" icon={<AlertOctagon className="h-4 w-4 text-priority-high" />}>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi
          label="Blocked Tasks"
          value={r.blocked}
          sub="Requires unblocking"
          tone={r.blocked > 0 ? "bad" : "good"}
          to="/blockers"
        />
        <Kpi
          label="High Priority Open"
          value={r.high}
          sub="Urgent workload"
          tone={r.high > 5 ? "warn" : "neutral"}
          to="/tasks"
        />
        <Kpi
          label="SLA Breaches"
          value={r.sla_breaches}
          sub="Overdue SLA"
          tone={r.sla_breaches > 0 ? "bad" : "good"}
        />
        <Kpi
          label="Approvals Pending"
          value={r.approvals_pending}
          sub="Manager review"
          tone={r.approvals_pending > 0 ? "warn" : "neutral"}
          to="/manager"
        />
      </div>
    </Section>
  );
}

/* ---------------- 4. Workload Balance ---------------- */

function WorkloadBalance({ s }: { s: ExecSummary }) {
  const w = s.workload;
  return (
    <Section title="Workload Balance" icon={<Users className="h-4 w-4 text-primary" />}>
      <Card className="p-3 md:p-4 space-y-3">
        <div className="text-xs text-muted-foreground">Team Capacity Utilization</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {w.rows.slice(0, 9).map((u) => {
            const pct = Math.round(u.pct);
            const tone = pct > 100 ? "bad" : pct > 85 ? "warn" : "good";
            return (
              <div key={u.user_id} className="space-y-1 p-2 rounded bg-accent/30 text-xs">
                <div className="flex justify-between font-medium">
                  <span className="truncate">{u.name || "Member"}</span>
                  <span className={tone === "bad" ? "text-priority-high" : tone === "warn" ? "text-priority-medium" : ""}>
                    {pct}% ({u.planned}h)
                  </span>
                </div>
                <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      tone === "bad"
                        ? "bg-priority-high"
                        : tone === "warn"
                          ? "bg-priority-medium"
                          : "bg-status-completed"
                    }`}
                    style={{ width: `${Math.min(pct, 100)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </Section>
  );
}

/* ---------------- 5. Execution Discipline ---------------- */

function ExecutionDiscipline({ s }: { s: ExecSummary }) {
  const d = s.discipline;
  return (
    <Section title="Execution Discipline" icon={<ClipboardCheck className="h-4 w-4 text-primary" />}>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi
          label="Carry Forwards Today"
          value={d.cf_today}
          sub={`${d.cf_hot} repeated 3x+`}
          tone={d.cf_today > 3 ? "warn" : "neutral"}
        />
        <Kpi
          label="EOD Submitted"
          value={`${d.eod_today}/${d.eod_total_members}`}
          sub="Today's check-ins"
          tone={d.eod_today === d.eod_total_members ? "good" : "warn"}
          to="/eod"
        />
        <Kpi
          label="Blocked > 3 Days"
          value={d.blocked_3d}
          sub="Stagnant blockers"
          tone={d.blocked_3d > 0 ? "bad" : "good"}
          to="/blockers"
        />
        <Kpi
          label="EOD Active Users"
          value={d.eod_users_range}
          sub="In selected range"
          tone="neutral"
        />
      </div>
    </Section>
  );
}

/* ---------------- 6. Automation ROI ---------------- */

function AutomationROI({ s }: { s: ExecSummary }) {
  const a = s.automation;
  return (
    <Section title="Automation & Operations" icon={<Bot className="h-4 w-4 text-primary" />}>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi
          label="Runs Today"
          value={a.today_runs}
          sub={`${a.total_runs} total runs`}
          tone="neutral"
        />
        <Kpi
          label="Success Rate"
          value={a.success_rate !== null ? `${Math.round(a.success_rate)}%` : "—"}
          sub={`${a.failed_24h} failures (24h)`}
          tone={a.success_rate && a.success_rate > 95 ? "good" : "warn"}
        />
        <Kpi
          label="Active Rules"
          value={a.active_rules}
          sub={`${a.auto_disabled_rules} disabled`}
          tone="neutral"
        />
        <Kpi
          label="Auto Approvals"
          value={a.approvals_auto}
          sub={`${a.escalations} escalations`}
          tone="neutral"
        />
      </div>
    </Section>
  );
}

/* ---------------- 7. Adoption Metrics ---------------- */

function AdoptionMetrics({ s }: { s: ExecSummary }) {
  const a = s.adoption;
  return (
    <Section title="Platform Adoption" icon={<Activity className="h-4 w-4 text-primary" />}>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi
          label="Daily Active Users"
          value={`${a.dau}/${a.total_members}`}
          sub={`${Math.round((a.dau / (a.total_members || 1)) * 100)}% DAU`}
          tone="neutral"
        />
        <Kpi
          label="Weekly Active Users"
          value={`${a.wau}/${a.total_members}`}
          sub={`${Math.round((a.wau / (a.total_members || 1)) * 100)}% WAU`}
          tone="neutral"
        />
        <Kpi
          label="EOD Active Users"
          value={a.eod_users}
          sub="Submitting check-ins"
          tone="neutral"
        />
        <Kpi
          label="Status Active Users"
          value={a.status_users}
          sub="Updating tasks"
          tone="neutral"
        />
      </div>
    </Section>
  );
}

/* ---------------- 8. Team Health ---------------- */

function TeamHealthSection({ s }: { s: ExecSummary }) {
  if (!s.team_health || s.team_health.length === 0) return null;
  return (
    <Section title="Team Health Scores" icon={<ShieldAlert className="h-4 w-4 text-primary" />}>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        {s.team_health.map((t, idx) => (
          <Card key={idx} className="p-3 space-y-1.5">
            <div className="flex justify-between items-center text-xs font-semibold">
              <span>{t.team}</span>
              <Badge variant={t.score >= 80 ? "secondary" : "outline"} className="text-[11px]">
                Score: {t.score}%
              </Badge>
            </div>
            <div className="text-[11px] text-muted-foreground">Manager: {t.manager}</div>
          </Card>
        ))}
      </div>
    </Section>
  );
}

/* ---------------- 9. Manager Effectiveness ---------------- */

function ManagerEffectivenessSection({ s }: { s: ExecSummary }) {
  if (!s.manager_effectiveness || s.manager_effectiveness.length === 0) return null;
  return (
    <Section title="Manager Effectiveness" icon={<Users className="h-4 w-4 text-primary" />}>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        {s.manager_effectiveness.map((m, idx) => (
          <Card key={idx} className="p-3 space-y-1 text-xs">
            <div className="font-semibold text-foreground">{m.manager}</div>
            <Row label="Completion Rate" value={`${Math.round(m.completion)}%`} tone={m.completion < 70 ? "warn" : undefined} />
            <Row label="Overdue Tasks" value={m.overdue} tone={m.overdue > 3 ? "bad" : undefined} />
            <Row label="Pending Approvals" value={m.appr} tone={m.appr > 2 ? "warn" : undefined} />
          </Card>
        ))}
      </div>
    </Section>
  );
}

/* ---------------- 10. AI Executive Insights ---------------- */

function ExecutiveInsights({ s }: { s: ExecSummary }) {
  const i = s.insights_inputs;
  const cfDiff = i.cf_last_7d - i.cf_prev_7d;
  return (
    <Section title="Executive Summary & Insights" icon={<Sparkles className="h-4 w-4 text-amber-500" />}>
      <Card className="p-4 space-y-3 bg-accent/20 border-accent">
        <div className="text-xs text-muted-foreground leading-relaxed space-y-1.5">
          <p>
            • Carry-forward volume changed by{" "}
            <span className={cfDiff > 0 ? "font-semibold text-priority-high" : "font-semibold text-status-completed"}>
              {cfDiff > 0 ? `+${cfDiff}` : cfDiff}
            </span>{" "}
            compared to previous period.
          </p>
          {i.approvals_pending_now > 0 && (
            <p>
              • <span className="font-semibold text-priority-medium">{i.approvals_pending_now} task approval(s)</span> are currently waiting for manager action.
            </p>
          )}
          {i.team_overload.length > 0 && (
            <p>
              • High workload detected for:{" "}
              {i.team_overload.map((o) => `${o.name} (${o.pct}%)`).join(", ")}.
            </p>
          )}
        </div>
      </Card>
    </Section>
  );
}
