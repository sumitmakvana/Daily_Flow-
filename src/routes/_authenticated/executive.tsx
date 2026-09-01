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
  CalendarDays,
  ListFilter,
  BarChart2,
  Hourglass,
  ArrowLeft,
  Table,
  Grid,
  X,
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
import { TaskDetailModal } from "@/components/TaskDetailModal";
import { TaskHoursBadges } from "@/components/TaskHoursBadges";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatDate, formatHoursMins } from "@/lib/format";

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
  const [range, setRange] = useState<RangeKey>("1");
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

  // Dynamic Projects list for Project select (Combining Projects DB + Tasks table, splitting merged names and strictly deduplicating)
  const availableProjects = useMemo(() => {
    const map = new Map<string, string>();
    const addProjectName = (rawName: string) => {
      const parts = rawName.split("|").map((s) => s.trim()).filter(Boolean);
      parts.forEach((pName) => {
        const key = pName.toLowerCase();
        if (!map.has(key)) {
          map.set(key, pName);
        }
      });
    };

    (summary?.filters.projects ?? []).forEach((p) => addProjectName(p.name));
    projectsList.forEach((p) => addProjectName(p.name));
    eodTasks.forEach((t) => {
      if (t.project_name?.trim()) {
        addProjectName(t.project_name.trim());
      }
    });

    const sortedNames = Array.from(map.values()).sort((a, b) => a.localeCompare(b));
    return sortedNames.map((name) => [name, name] as [string, string]);
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
    const inReviewTasks = eodTasks.filter((t) => t.status === "In Review").length;
    const todoTasks = eodTasks.filter((t) => t.status === "To Do").length;
    const blockedTasks = eodTasks.filter((t) => t.status === "Blocked" || t.status === "On Hold").length;
    const pendingTasks = eodTasks.filter((t) => t.status !== "Completed" && t.status !== "In Progress" && t.status !== "In Review" && t.status !== "Blocked" && t.status !== "On Hold").length + todoTasks;
    const totalTasks = eodTasks.length;
    const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    const today = new Date().toISOString().slice(0, 10);
    const overdueTotal = eodTasks.filter((t) => t.status !== "Completed" && t.due_date && t.due_date.slice(0, 10) < today).length;

    const memberSummaries = eodProfiles.map((p) => {
      const pTasks = eodTasks.filter((t) => t.assigned_to === p.id);
      const cCount = pTasks.filter((t) => t.status === "Completed").length;
      const ipCount = pTasks.filter((t) => t.status === "In Progress").length;
      const irCount = pTasks.filter((t) => t.status === "In Review").length;
      const tdCount = pTasks.filter((t) => t.status === "To Do").length;
      const bCount = pTasks.filter((t) => t.status === "Blocked" || t.status === "On Hold").length;
      const pCount = pTasks.filter((t) => t.status !== "Completed" && t.status !== "In Progress" && t.status !== "In Review" && t.status !== "Blocked" && t.status !== "On Hold").length + tdCount;
      const overdueTasks = pTasks.filter((t) => t.status !== "Completed" && t.due_date && t.due_date.slice(0, 10) < today);
      const overdueDates = Array.from(new Set(overdueTasks.map((t) => formatDate(t.due_date)).filter(Boolean))).join(", ");

      return {
        name: p.display_name,
        completedCount: cCount,
        inProgressCount: ipCount,
        inReviewCount: irCount,
        todoCount: tdCount,
        blockedCount: bCount,
        pendingCount: pCount,
        overdueCount: overdueTasks.length,
        overdueDates: overdueDates || undefined,
        totalCount: pTasks.length,
        tasks: pTasks.map((t) => ({ code: t.task_code, name: t.task_name, status: t.status, dueDate: t.due_date, remarks: t.remarks })),
      };
    });

    const blockedAlerts = eodTasks
      .filter((t) => (t.status === "Blocked" || t.status === "On Hold") && t.blocker_reason)
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
      inReviewTasks,
      todoTasks,
      blockedTasks,
      pendingTasks,
      overdueTasks: overdueTotal,
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

  // Scope-filtered profiles for top Member multi-select
  const scopedProfiles = useMemo(() => {
    if (!scope || scope.kind === "org") return eodProfiles;
    if (scope.kind === "team") {
      return eodProfiles.filter((p) => (p as any).team_id === scope.id);
    }
    if (scope.kind === "manager") {
      const managerIds = new Set<string>([scope.id]);
      let added = true;
      while (added) {
        added = false;
        eodProfiles.forEach((p) => {
          if (p.manager_id && managerIds.has(p.manager_id) && !managerIds.has(p.id)) {
            managerIds.add(p.id);
            added = true;
          }
        });
      }
      return eodProfiles.filter((p) => managerIds.has(p.id));
    }
    return eodProfiles;
  }, [eodProfiles, scope]);

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
            options={scopedProfiles.map((p) => ({ id: p.id, label: p.display_name }))}
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
            variant="outline"
            onClick={handleExportGlobalReport}
            className="h-8 border-border bg-card/80 hover:bg-accent text-foreground text-xs font-medium gap-1.5"
          >
            <Download className="h-3.5 w-3.5 text-muted-foreground" /> Export EOD Report
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
  const [showOnlyActiveMembers, setShowOnlyActiveMembers] = useState(false);
  const [selectedStatusDetails, setSelectedStatusDetails] = useState<"Completed" | "In Progress" | "In Review" | "Blocked" | "Pending" | null>(null);
  const [selectedAgingBucket, setSelectedAgingBucket] = useState<"0-3d" | "4-7d" | "8-14d" | "15d+" | null>(null);

  // 1. Dynamic Filtering for Profiles by Scope & Member Filter
  const filteredProfiles = useMemo(() => {
    let result = profiles;

    if (scope && scope.kind === "team") {
      result = result.filter((p) => (p as any).team_id === scope.id);
    } else if (scope && scope.kind === "manager") {
      const managerIds = new Set<string>([scope.id]);
      let added = true;
      while (added) {
        added = false;
        profiles.forEach((p) => {
          if (p.manager_id && managerIds.has(p.manager_id) && !managerIds.has(p.id)) {
            managerIds.add(p.id);
            added = true;
          }
        });
      }
      result = result.filter((p) => managerIds.has(p.id));
    }

    if (selectedMembers && selectedMembers.length > 0) {
      result = result.filter((p) => selectedMembers.includes(p.id));
    }

    return result;
  }, [profiles, scope, selectedMembers]);

  // 2. Dynamic Filtering for Tasks by Scope, Project, Member, Type & Range
  const filteredTasks = useMemo(() => {
    let result = tasks;

    // Member / Scope filter
    if (selectedMembers && selectedMembers.length > 0) {
      result = result.filter((t) => t.assigned_to && selectedMembers.includes(t.assigned_to));
    } else if (scope && scope.kind === "team") {
      const teamMemberIds = new Set(profiles.filter((p) => (p as any).team_id === scope.id).map((p) => p.id));
      result = result.filter(
        (t) => (t.assigned_to && teamMemberIds.has(t.assigned_to)) || t.team_id === scope.id,
      );
    } else if (scope && scope.kind === "manager") {
      const managerIds = new Set<string>([scope.id]);
      let added = true;
      while (added) {
        added = false;
        profiles.forEach((p) => {
          if (p.manager_id && managerIds.has(p.manager_id) && !managerIds.has(p.id)) {
            managerIds.add(p.id);
            added = true;
          }
        });
      }
      result = result.filter((t) => t.assigned_to && managerIds.has(t.assigned_to));
    }

    // Project filter (multi-select)
    if (selectedProjects && selectedProjects.length > 0) {
      result = result.filter((t) => {
        return selectedProjects.some((sp) => {
          if (t.project_id === sp) return true;
          if (t.project_name) {
            const parts = t.project_name.split("|").map((s) => s.trim().toLowerCase());
            if (parts.includes(sp.trim().toLowerCase())) return true;
          }
          const projObj = projects.find((p) => p.id === sp || p.name.trim().toLowerCase() === sp.trim().toLowerCase());
          return projObj && t.project_name && t.project_name.split("|").some((part) => part.trim().toLowerCase() === projObj.name.trim().toLowerCase());
        });
      });
    }

    // Type filter (multi-select)
    if (selectedTypes && selectedTypes.length > 0) {
      result = result.filter((t) => t.type_id && selectedTypes.includes(t.type_id));
    }

    // Range / Timeframe filter
    const today = new Date().toISOString().slice(0, 10);
    const days = Number(range) || 7;
    if (range === "1") {
      result = result.filter((t) => {
        const createdDay = t.created_at ? t.created_at.slice(0, 10) : "";
        const completedDay = t.completed_at ? t.completed_at.slice(0, 10) : "";
        const dueDay = t.due_date ? t.due_date.slice(0, 10) : "";
        const isActiveToday = t.status !== "Completed" && t.status !== "On Hold";
        return completedDay === today || createdDay === today || dueDay === today || isActiveToday;
      });
    } else {
      const cutoff = Date.now() - days * 86400000;
      result = result.filter((t) => {
        const createdTime = new Date(t.created_at).getTime();
        const completedTime = t.completed_at ? new Date(t.completed_at).getTime() : 0;
        const isActive = t.status !== "Completed" && t.status !== "On Hold";
        return createdTime >= cutoff || completedTime >= cutoff || isActive;
      });
    }

    return result;
  }, [tasks, scope, selectedProjects, selectedMembers, selectedTypes, range, profiles, projects]);

  // 3. Dynamic Metrics derived from filteredTasks
  const metrics = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const completed = range === "1"
      ? filteredTasks.filter((t) => t.status === "Completed" && t.completed_at && t.completed_at.slice(0, 10) === today).length
      : filteredTasks.filter((t) => t.status === "Completed").length;
    const completedToday = filteredTasks.filter(
      (t) => t.status === "Completed" && t.completed_at && t.completed_at.slice(0, 10) === today,
    ).length;
    const inProgress = filteredTasks.filter((t) => t.status === "In Progress").length;
    const inReview = filteredTasks.filter((t) => t.status === "In Review").length;
    const pending = filteredTasks.filter(
      (t) => t.status === "To Do" || t.status === "Pending" || (t.status !== "Completed" && t.status !== "In Progress" && t.status !== "In Review" && t.status !== "Blocked" && t.status !== "On Hold"),
    ).length;
    const blocked = filteredTasks.filter((t) => t.status === "Blocked" || t.status === "On Hold").length;
    const overdue = filteredTasks.filter(
      (t) => t.status !== "Completed" && t.due_date && t.due_date.slice(0, 10) < today,
    ).length;
    const total = filteredTasks.length;
    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

    return { completed, completedToday, inProgress, inReview, pending, blocked, overdue, total, completionRate };
  }, [filteredTasks, range]);

  // 4. Team Workload List
  const memberWorkloadList = useMemo(() => {
    const targetProfiles = filteredProfiles;
    const today = new Date().toISOString().slice(0, 10);
    const list = targetProfiles.map((p) => {
      const pTasks = filteredTasks.filter((t) => t.assigned_to === p.id);
      const completed = range === "1"
        ? pTasks.filter((t) => t.status === "Completed" && t.completed_at && t.completed_at.slice(0, 10) === today).length
        : pTasks.filter((t) => t.status === "Completed").length;
      const inProgress = pTasks.filter((t) => t.status === "In Progress").length;
      const inReview = pTasks.filter((t) => t.status === "In Review").length;
      const pending = pTasks.filter(
        (t) => t.status === "To Do" || t.status === "Pending" || (t.status !== "Completed" && t.status !== "In Progress" && t.status !== "In Review" && t.status !== "Blocked" && t.status !== "On Hold"),
      ).length;
      const blocked = pTasks.filter((t) => t.status === "Blocked" || t.status === "On Hold").length;
      const overdue = pTasks.filter(
        (t) => t.status !== "Completed" && t.due_date && t.due_date.slice(0, 10) < today,
      ).length;
      const total = pTasks.length;
      const plannedHours = pTasks.reduce((s, t) => s + Number(t.planned_hours ?? 0), 0);
      const actualHours = pTasks.reduce((s, t) => s + Number(t.actual_hours ?? 0), 0);

      const cleanName = p.display_name.includes("@")
        ? p.display_name.split("@")[0].toLowerCase()
        : p.display_name.toLowerCase().replace(/\s+/g, ".");

      const userProjects =
        Array.from(new Set(pTasks.map((t) => t.project_name).filter(Boolean))).join(", ") ||
        "General Workspace";

      return {
        id: p.id,
        name: cleanName,
        displayName: p.display_name,
        avatar: p.avatar_url,
        completed,
        inProgress,
        inReview,
        pending,
        blocked,
        overdue,
        total,
        plannedHours,
        actualHours,
        userProjects,
      };
    });

    let filtered = list;
    if (showOnlyActiveMembers) {
      filtered = filtered.filter((m) => m.total > 0 || m.inProgress > 0 || m.inReview > 0);
    }
    if (memberSearch.trim()) {
      const q = memberSearch.toLowerCase();
      filtered = filtered.filter(
        (m) =>
          m.name.includes(q) ||
          m.displayName.toLowerCase().includes(q) ||
          m.userProjects.toLowerCase().includes(q),
      );
    }
    return filtered;
  }, [filteredProfiles, filteredTasks, showOnlyActiveMembers, memberSearch, range]);

  // 5. Memberwise Bar Chart Data
  const memberBarChartData = useMemo(() => {
    const targetProfiles = filteredProfiles;
    const today = new Date().toISOString().slice(0, 10);
    const list = targetProfiles.map((p) => {
      const pTasks = filteredTasks.filter((t) => t.assigned_to === p.id);
      const completed = range === "1"
        ? pTasks.filter((t) => t.status === "Completed" && t.completed_at && t.completed_at.slice(0, 10) === today).length
        : pTasks.filter((t) => t.status === "Completed").length;
      const inProgress = pTasks.filter((t) => t.status === "In Progress").length;
      const inReview = pTasks.filter((t) => t.status === "In Review").length;
      const pending = pTasks.filter(
        (t) => t.status === "To Do" || t.status === "Pending" || (t.status !== "Completed" && t.status !== "In Progress" && t.status !== "In Review" && t.status !== "Blocked" && t.status !== "On Hold"),
      ).length;
      const blocked = pTasks.filter((t) => t.status === "Blocked" || t.status === "On Hold").length;
      const overdue = pTasks.filter(
        (t) => t.status !== "Completed" && t.due_date && t.due_date.slice(0, 10) < today,
      ).length;

      const cleanName = p.display_name.includes("@")
        ? p.display_name.split("@")[0]
        : p.display_name.split(" ")[0];

      return {
        id: p.id,
        name: cleanName,
        fullName: p.display_name,
        Completed: completed,
        InProgress: inProgress,
        InReview: inReview,
        Pending: pending,
        Blocked: blocked,
        overdue: overdue,
        total: pTasks.length,
      };
    });

    if (showOnlyActiveMembers) {
      return list.filter((m) => m.total > 0);
    }
    return list;
  }, [filteredProfiles, filteredTasks, showOnlyActiveMembers, range]);

  // 6. Planned vs Actual vs Auto Hours BarChart Data
  const planVsActualData = useMemo(() => {
    const targetProfiles = filteredProfiles;
    const list = targetProfiles.map((p) => {
      const pTasks = filteredTasks.filter((t) => t.assigned_to === p.id);
      const planned = pTasks.reduce((s, t) => s + Number(t.planned_hours ?? 0), 0);
      const actual = pTasks.reduce((s, t) => s + Number(t.actual_hours ?? 0), 0);
      const auto = pTasks.reduce((s, t) => {
        const sys = (t as any).started_at 
          ? Math.min(8.0, Math.max(0, Math.round(((Date.now() - new Date((t as any).started_at).getTime()) / 3600000) * 10) / 10))
          : Number((t as any).system_hours ?? 0);
        return s + sys;
      }, 0);
      return {
        id: p.id,
        name: p.display_name.includes("@") ? p.display_name.split("@")[0] : p.display_name.split(" ")[0],
        fullName: p.display_name,
        planned,
        actual,
        auto,
      };
    });
    if (showOnlyActiveMembers) {
      return list.filter((m) => m.planned > 0 || m.actual > 0 || m.auto > 0);
    }
    return list;
  }, [filteredProfiles, filteredTasks, showOnlyActiveMembers]);

  // 7. Task Aging Data
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

  // 8. Dynamic Team Completion Velocity Line Chart
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

  // 9. Workload Donut Chart Data
  const donutData = useMemo(() => {
    const list = [
      { name: "Completed", value: metrics.completed, color: "#10b981" },
      { name: "In Progress", value: metrics.inProgress, color: "#3b82f6" },
      { name: "In Review", value: metrics.inReview, color: "#a855f7" },
      { name: "Pending", value: metrics.pending, color: "#f59e0b" },
      { name: "Blocked", value: metrics.blocked, color: "#f43f5e" },
    ].filter((item) => item.value > 0);

    return list.length > 0
      ? list
      : [
          { name: "Completed", value: 1, color: "#10b981" },
          { name: "In Progress", value: 0, color: "#3b82f6" },
        ];
  }, [metrics]);

  return (
    <div className="space-y-6">
      {/* 1. Top Metrics KPI Summary (Clean, Simple & Minimal 6 Cards) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* Total */}
        <div
          onClick={() => setSelectedStatusDetails("Completed")}
          className="bg-card border border-border/70 rounded-xl p-4 space-y-2 hover:border-border transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <ListFilter className="h-3.5 w-3.5 text-muted-foreground" />
            <span>Total</span>
          </div>
          <div className="text-2xl md:text-3xl font-bold font-mono text-foreground tracking-tight">
            {metrics.total}
          </div>
        </div>

        {/* Completed / Done */}
        <div
          onClick={() => setSelectedStatusDetails("Completed")}
          className="bg-card border border-border/70 rounded-xl p-4 space-y-2 hover:border-border transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
            <span>{range === "1" ? "Done today" : "Completed"}</span>
          </div>
          <div className="text-2xl md:text-3xl font-bold font-mono text-foreground tracking-tight">
            {range === "1" ? metrics.completedToday : metrics.completed}
          </div>
        </div>

        {/* In Progress */}
        <div
          onClick={() => setSelectedStatusDetails("In Progress")}
          className="bg-card border border-border/70 rounded-xl p-4 space-y-2 hover:border-border transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
            <span>In Progress</span>
          </div>
          <div className="text-2xl md:text-3xl font-bold font-mono text-foreground tracking-tight">
            {metrics.inProgress}
          </div>
        </div>

        {/* In Review */}
        <div
          onClick={() => setSelectedStatusDetails("In Review")}
          className="bg-card border border-border/70 rounded-xl p-4 space-y-2 hover:border-border transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            <span>In Review</span>
          </div>
          <div className="text-2xl md:text-3xl font-bold font-mono text-foreground tracking-tight">
            {metrics.inReview}
          </div>
        </div>

        {/* Pending */}
        <div
          onClick={() => setSelectedStatusDetails("Pending")}
          className="bg-card border border-border/70 rounded-xl p-4 space-y-2 hover:border-border transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Users className="h-3.5 w-3.5 text-muted-foreground" />
            <span>Pending</span>
          </div>
          <div className="text-2xl md:text-3xl font-bold font-mono text-foreground tracking-tight">
            {metrics.pending}
          </div>
        </div>

        {/* Blocked */}
        <div
          onClick={() => setSelectedStatusDetails("Blocked")}
          className="bg-card border border-border/70 rounded-xl p-4 space-y-2 hover:border-border transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <AlertOctagon className="h-3.5 w-3.5 text-muted-foreground" />
            <span>Blocked</span>
          </div>
          <div className={`text-2xl md:text-3xl font-bold font-mono tracking-tight ${metrics.blocked > 0 ? "text-rose-400" : "text-foreground"}`}>
            {metrics.blocked}
          </div>
        </div>
      </div>

      {/* 2. Team Workload Section (Clean Table with exact Status columns and Capacity Progress) */}
      <div className="bg-card border border-border/70 rounded-xl p-4 md:p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-foreground tracking-tight">Team workload</h3>
            <p className="text-xs text-muted-foreground">Real task allocation, status breakdown, and capacity per team member</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 bg-background border border-border p-0.5 rounded-lg">
              <Button
                size="sm"
                variant={!showOnlyActiveMembers ? "default" : "ghost"}
                onClick={() => setShowOnlyActiveMembers(false)}
                className={`h-7 text-xs px-2.5 ${!showOnlyActiveMembers ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground hover:text-foreground"}`}
              >
                All
              </Button>
              <Button
                size="sm"
                variant={showOnlyActiveMembers ? "default" : "ghost"}
                onClick={() => setShowOnlyActiveMembers(true)}
                className={`h-7 text-xs px-2.5 ${showOnlyActiveMembers ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground hover:text-foreground"}`}
              >
                Active
              </Button>
            </div>
            <Input
              placeholder="Filter member..."
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
              className="h-8 w-44 md:w-52 text-xs bg-input/40 border-border text-foreground placeholder:text-muted-foreground/60"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-border/70 text-muted-foreground text-[11px] font-semibold uppercase tracking-wider">
                <th className="py-2.5 px-3 font-semibold">Member</th>
                <th className="py-2.5 px-3 font-semibold text-center">Completed</th>
                <th className="py-2.5 px-3 font-semibold text-center">In Progress</th>
                <th className="py-2.5 px-3 font-semibold text-center">In Review</th>
                <th className="py-2.5 px-3 font-semibold text-center">Pending</th>
                <th className="py-2.5 px-3 font-semibold text-center">Blocked</th>
                <th className="py-2.5 px-3 font-semibold text-center">Total</th>
                <th className="py-2.5 px-3 font-semibold min-w-[200px]">Capacity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40 font-medium">
              {memberWorkloadList.map((m) => {
                const targetCap = range === "1" ? 8 : 40;
                const plannedOrCap = m.plannedHours > 0 ? m.plannedHours : targetCap;
                const pct = Math.min(100, Math.round((m.actualHours / (plannedOrCap || 1)) * 100));
                const isOverloaded = m.actualHours > plannedOrCap;

                return (
                  <tr
                    key={m.id}
                    onClick={() => onSelectMember(m.id)}
                    className="hover:bg-accent/30 transition-colors cursor-pointer group"
                  >
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar className="h-7 w-7 border border-border shrink-0">
                          {m.avatar ? (
                            <AvatarImage src={m.avatar} alt={m.displayName} />
                          ) : (
                            <AvatarFallback className="bg-muted text-foreground text-[10px] font-bold">
                              {m.displayName.slice(0, 2).toUpperCase()}
                            </AvatarFallback>
                          )}
                        </Avatar>
                        <div className="min-w-0">
                          <div className="font-medium text-foreground group-hover:text-primary transition-colors truncate">
                            {m.name}
                          </div>
                          <div className="text-[10px] text-muted-foreground truncate max-w-[170px]">{m.userProjects}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-3 text-center font-mono font-medium text-foreground">
                      {m.completed}
                    </td>
                    <td className="py-3 px-3 text-center font-mono font-medium text-foreground">
                      {m.inProgress}
                    </td>
                    <td className="py-3 px-3 text-center font-mono font-medium text-foreground">
                      {m.inReview}
                    </td>
                    <td className="py-3 px-3 text-center font-mono font-medium text-foreground">
                      {m.pending}
                    </td>
                    <td className="py-3 px-3 text-center font-mono font-medium">
                      <span className={m.blocked > 0 ? "text-rose-400 font-bold" : "text-muted-foreground"}>
                        {m.blocked}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-center font-mono font-bold text-foreground">
                      {m.total}
                    </td>
                    <td className="py-3 px-3">
                      <div className="space-y-1.5 max-w-[220px]">
                        <div className="flex items-center justify-between text-[11px] font-mono">
                          <span className="text-foreground/90 font-medium">
                            {m.actualHours.toFixed(1)}h <span className="text-muted-foreground font-normal">/ {plannedOrCap.toFixed(1)}h</span>
                          </span>
                          <span className="text-[10px] text-muted-foreground">{pct}%</span>
                        </div>
                        <div className="h-1.5 w-full bg-muted/50 rounded-full overflow-hidden flex">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${
                              isOverloaded ? "bg-rose-500" : "bg-blue-500"
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {memberWorkloadList.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-xs text-muted-foreground">
                    No team members match your search query
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 3. Analytics & Charts Section (Clean, consistent, placed below table) */}
      <div className="space-y-4 pt-1">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-foreground tracking-tight">Execution Analytics</h3>
            <p className="text-xs text-muted-foreground">Task status allocation, velocity, aging and hour breakdown</p>
          </div>
        </div>

        {/* Row 1: Memberwise Task Status & Team Velocity */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Memberwise Task Breakdown Stacked Bar Chart */}
          <div className="lg:col-span-7 bg-card border border-border/70 rounded-xl p-4 md:p-5 shadow-sm space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="text-sm font-bold text-foreground tracking-tight">Memberwise Task Status</h4>
                <p className="text-xs text-muted-foreground">Real task allocation per team member</p>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="flex items-center gap-1 text-emerald-400 font-medium">
                  <span className="h-2 w-2 rounded-sm bg-[#10b981]" /> Done
                </span>
                <span className="flex items-center gap-1 text-blue-400 font-medium">
                  <span className="h-2 w-2 rounded-sm bg-[#3b82f6]" /> In Prog
                </span>
                <span className="flex items-center gap-1 text-purple-400 font-medium">
                  <span className="h-2 w-2 rounded-sm bg-[#a855f7]" /> Review
                </span>
                <span className="flex items-center gap-1 text-amber-400 font-medium">
                  <span className="h-2 w-2 rounded-sm bg-[#f59e0b]" /> Pending
                </span>
                <span className="flex items-center gap-1 text-rose-400 font-medium">
                  <span className="h-2 w-2 rounded-sm bg-[#f43f5e]" /> Blocked
                </span>
              </div>
            </div>

            <div className="h-[250px] w-full pt-1">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={memberBarChartData} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
                  <XAxis
                    dataKey="name"
                    stroke="#64748b"
                    fontSize={10}
                    tickLine={false}
                    axisLine={{ stroke: "#25273e" }}
                    interval={0}
                    angle={-20}
                    textAnchor="end"
                    height={40}
                  />
                  <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (active && payload && payload.length) {
                        const full = payload[0]?.payload?.fullName || label;
                        const tot = payload[0]?.payload?.total || 0;
                        const overdueCount = payload[0]?.payload?.overdue || 0;
                        return (
                          <div className="bg-popover border border-border rounded-xl p-3 shadow-2xl text-xs space-y-1.5 min-w-[160px]">
                            <div className="font-bold text-foreground border-b border-border pb-1.5 flex items-center justify-between">
                              <span>{full}</span>
                              <span className="text-[10px] text-muted-foreground font-normal">({tot} tasks)</span>
                            </div>
                            {payload.map((entry: any, i: number) => (
                              <div key={i} className="flex items-center justify-between gap-3">
                                <span style={{ color: entry.color }} className="font-medium">{entry.name}:</span>
                                <span className="font-mono font-bold text-foreground">{entry.value}</span>
                              </div>
                            ))}
                            {overdueCount > 0 && (
                              <div className="flex items-center justify-between gap-3 pt-1 border-t border-border/60 text-rose-400 font-medium">
                                <span>Overdue:</span>
                                <span className="font-mono font-bold">{overdueCount}</span>
                              </div>
                            )}
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Bar dataKey="Completed" fill="#10b981" stackId="a" radius={[0, 0, 0, 0]} barSize={18} />
                  <Bar dataKey="InProgress" fill="#3b82f6" stackId="a" radius={[0, 0, 0, 0]} barSize={18} />
                  <Bar dataKey="InReview" fill="#a855f7" stackId="a" radius={[0, 0, 0, 0]} barSize={18} />
                  <Bar dataKey="Pending" fill="#f59e0b" stackId="a" radius={[0, 0, 0, 0]} barSize={18} />
                  <Bar dataKey="Blocked" fill="#f43f5e" stackId="a" radius={[2, 2, 0, 0]} barSize={18} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Team Completion Velocity Line Chart */}
          <div className="lg:col-span-5 bg-card border border-border/70 rounded-xl p-4 md:p-5 shadow-sm space-y-3">
            <div>
              <h4 className="text-sm font-bold text-foreground tracking-tight">Team Completion Velocity</h4>
              <p className="text-xs text-muted-foreground">Daily task completions over {RANGE_LABEL[range as RangeKey]}</p>
            </div>

            <div className="h-[250px] w-full pt-1">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={completionTrendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <XAxis dataKey="date" stroke="#64748b" fontSize={11} tickLine={false} axisLine={{ stroke: "#25273e" }} />
                  <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (active && payload && payload.length) {
                        return (
                          <div className="bg-popover border border-border rounded-lg p-2.5 shadow-xl text-xs space-y-1">
                            <div className="font-bold text-foreground border-b border-border pb-1">{label}</div>
                            <div className="flex items-center justify-between gap-4 font-semibold text-emerald-400">
                              <span>Completed:</span>
                              <span className="font-mono font-bold">{payload[0]?.value}</span>
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
                    strokeWidth={2.5}
                    dot={{ r: 3, fill: "#10b981" }}
                    activeDot={{ r: 5, strokeWidth: 2, stroke: "#161726" }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Row 2: Planned vs Actual Hours & Task Aging & Workload Distribution */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Planned vs Actual Hours BarChart */}
          <div className="lg:col-span-5 bg-card border border-border/70 rounded-xl p-4 md:p-5 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold text-foreground tracking-tight flex items-center gap-1.5">
                  <BarChart2 className="h-3.5 w-3.5 text-primary" /> Hours Breakdown per Member
                </h4>
                <p className="text-xs text-muted-foreground">User logged vs auto-tracked vs planned hours</p>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="flex items-center gap-1 text-indigo-400 font-medium">
                  <span className="h-2 w-2 rounded-sm bg-[#6366f1]" /> Plan
                </span>
                <span className="flex items-center gap-1 text-emerald-400 font-medium">
                  <span className="h-2 w-2 rounded-sm bg-[#10b981]" /> User
                </span>
                <span className="flex items-center gap-1 text-amber-400 font-medium">
                  <span className="h-2 w-2 rounded-sm bg-[#f59e0b]" /> Auto
                </span>
              </div>
            </div>

            <div className="h-[220px] w-full pt-1">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={planVsActualData} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
                  <XAxis dataKey="name" stroke="#64748b" fontSize={10} tickLine={false} axisLine={{ stroke: "#25273e" }} interval={0} angle={-20} textAnchor="end" />
                  <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (active && payload && payload.length) {
                        const full = payload[0]?.payload?.fullName || label;
                        return (
                          <div className="bg-popover border border-border rounded-xl p-2.5 shadow-xl text-xs space-y-1 min-w-[150px]">
                            <div className="font-bold text-foreground border-b border-border pb-1">{full}</div>
                            {payload.map((entry: any, i: number) => (
                              <div key={i} className="flex items-center justify-between gap-3">
                                <span style={{ color: entry.color }} className="font-medium">{entry.name}:</span>
                                <span className="font-mono font-bold text-foreground">{entry.value}h</span>
                              </div>
                            ))}
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Bar
                    dataKey="planned"
                    name="Plan"
                    fill="#6366f1"
                    radius={[2, 2, 0, 0]}
                    barSize={10}
                    className="cursor-pointer hover:opacity-80 transition-opacity"
                    onClick={(entry: any) => {
                      if (entry && entry.id) onSelectMember(entry.id);
                    }}
                  />
                  <Bar
                    dataKey="actual"
                    name="User Act"
                    fill="#10b981"
                    radius={[2, 2, 0, 0]}
                    barSize={10}
                    className="cursor-pointer hover:opacity-80 transition-opacity"
                    onClick={(entry: any) => {
                      if (entry && entry.id) onSelectMember(entry.id);
                    }}
                  />
                  <Bar
                    dataKey="auto"
                    name="Auto Tracked"
                    fill="#f59e0b"
                    radius={[2, 2, 0, 0]}
                    barSize={10}
                    className="cursor-pointer hover:opacity-80 transition-opacity"
                    onClick={(entry: any) => {
                      if (entry && entry.id) onSelectMember(entry.id);
                    }}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Task Aging BarChart */}
          <div className="lg:col-span-4 bg-card border border-border/70 rounded-xl p-4 md:p-5 shadow-sm space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h4 className="text-sm font-bold text-foreground tracking-tight flex items-center gap-1.5">
                  <Hourglass className="h-3.5 w-3.5 text-amber-400" /> Task Aging
                </h4>
                <p className="text-xs text-muted-foreground">Open tasks age distribution</p>
              </div>
              <span className="text-[10px] font-medium text-amber-400/90 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                Click bar
              </span>
            </div>

            <div className="h-[220px] w-full pt-1">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={taskAgingData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <XAxis dataKey="bucket" stroke="#64748b" fontSize={11} tickLine={false} axisLine={{ stroke: "#25273e" }} />
                  <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (active && payload && payload.length) {
                        return (
                          <div className="bg-popover border border-border rounded-lg p-2.5 shadow-xl text-xs space-y-1">
                            <div className="font-bold text-amber-400 border-b border-border pb-1">Bucket: {label}</div>
                            <div className="flex items-center justify-between gap-4 font-semibold text-foreground">
                              <span>Open Tasks:</span>
                              <span className="font-mono font-bold text-amber-400">{payload[0]?.value}</span>
                            </div>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Bar
                    dataKey="count"
                    radius={[3, 3, 0, 0]}
                    barSize={24}
                    className="cursor-pointer"
                    onClick={(data: any) => {
                      if (data && data.bucket) {
                        setSelectedAgingBucket(data.bucket as any);
                      }
                    }}
                  >
                    {taskAgingData.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={selectedAgingBucket === entry.bucket ? "#fbbf24" : "#f59e0b"}
                        className="cursor-pointer hover:opacity-80 transition-all"
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Workload Distribution Donut */}
          <div className="lg:col-span-3 bg-card border border-border/70 rounded-xl p-4 md:p-5 shadow-sm flex flex-col justify-between space-y-3">
            <div>
              <h4 className="text-sm font-bold text-foreground tracking-tight">Workload Mix</h4>
              <p className="text-xs text-muted-foreground">Status proportion</p>
            </div>

            <div className="relative h-[160px] w-full flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={donutData}
                    cx="50%"
                    cy="50%"
                    innerRadius={48}
                    outerRadius={68}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {donutData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} stroke="#161726" strokeWidth={2} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center">
                <span className="text-xl font-black text-foreground font-mono">{metrics.total}</span>
                <span className="text-[10px] font-medium text-muted-foreground">Total</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-1.5 text-[11px] pt-1">
              {donutData.map((item, idx) => (
                <div key={idx} className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-sm shrink-0" style={{ backgroundColor: item.color }} />
                  <span className="text-muted-foreground font-medium truncate">{item.name}: <span className="font-mono text-foreground font-bold">{item.value}</span></span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>


      {/* Status Details Full Page View Modal */}
      <StatusDetailSheet
        status={selectedStatusDetails}
        onClose={() => setSelectedStatusDetails(null)}
        profiles={profiles}
        tasks={filteredTasks}
        allTasks={tasks}
        projects={projects}
        range={range}
        onSelectMember={onSelectMember}
      />

      {/* Task Aging Bucket Details Full Page View Modal */}
      <TaskAgingDetailSheet
        bucket={selectedAgingBucket}
        onClose={() => setSelectedAgingBucket(null)}
        profiles={profiles}
        tasks={filteredTasks}
        projects={projects}
        onSelectMember={onSelectMember}
      />
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

  const pluralLabel = label.toLowerCase().endsWith("s") ? `${label}es` : `${label}s`;

  const displayText =
    selectedValues.length === 0
      ? `All ${pluralLabel}`
      : selectedValues.length === options.length
      ? `All ${pluralLabel}`
      : `${selectedValues.length} ${label}${selectedValues.length > 1 ? (label.toLowerCase().endsWith("s") ? "es" : "s") : ""}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 px-2.5 text-xs bg-card border-border text-foreground hover:bg-accent justify-between gap-1.5 font-normal"
        >
          <span className="truncate max-w-[120px]">{displayText}</span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-60 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-56 p-2 bg-popover border-border text-popover-foreground shadow-2xl z-[9999]"
        align="start"
      >
        <div className="flex items-center justify-between border-b border-border pb-1.5 mb-1.5 px-1">
          <span className="text-[11px] font-bold text-muted-foreground uppercase">{pluralLabel}</span>
          {selectedValues.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="text-[10px] text-primary hover:underline cursor-pointer font-medium"
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
                className="flex items-center space-x-2 px-2 py-1.5 hover:bg-accent rounded-md cursor-pointer text-xs"
              >
                <Checkbox checked={checked} className="border-border data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground" />
                <span className="flex-1 truncate text-foreground">{opt.label}</span>
              </div>
            );
          })}
          {options.length === 0 && (
            <div className="text-[11px] text-muted-foreground italic p-2 text-center">No options available</div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* -------------------------------------------------------------------------- */
/*            INTERACTIVE MEMBER DRILLDOWN SHEET / MODAL COMPONENT           */
/* -------------------------------------------------------------------------- */

export const ExecutiveMemberInspectionDrawer = MemberDetailSheet;

export function MemberDetailSheet({
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
  const [statusFilterTab, setStatusFilterTab] = useState<string>("all");
  const [drawerRange, setDrawerRange] = useState("all");
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [dateSortOrder, setDateSortOrder] = useState<"desc" | "asc">("desc");
  const [inspectedTask, setInspectedTask] = useState<Task | null>(null);

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
    const addName = (rawName: string) => {
      rawName.split("|").forEach((part) => {
        const name = part.trim();
        if (name) {
          const key = name.toLowerCase();
          if (!map.has(key)) {
            map.set(key, { id: name, label: name });
          }
        }
      });
    };

    memberTasks.forEach((t) => {
      if (t.project_name?.trim()) addName(t.project_name.trim());
    });

    projects.forEach((p) => {
      if (p.name?.trim()) addName(p.name.trim());
    });

    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [memberTasks, projects]);

  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const inProgressTasks = useMemo(
    () => memberTasks.filter((t) => t.status === "In Progress"),
    [memberTasks],
  );

  const toDoTasks = useMemo(
    () => memberTasks.filter((t) => t.status === "To Do" || (t.status as string) === "Pending"),
    [memberTasks],
  );

  const completedTasks = useMemo(
    () => memberTasks.filter((t) => t.status === "Completed"),
    [memberTasks],
  );

  const blockedTasks = useMemo(
    () => memberTasks.filter((t) => t.status === "Blocked"),
    [memberTasks],
  );

  const overdueTasks = useMemo(
    () => memberTasks.filter((t) => t.status !== "Completed" && t.due_date && t.due_date.slice(0, 10) < todayStr),
    [memberTasks, todayStr],
  );

  const filteredTasks = useMemo(() => {
    const list = memberTasks.filter((t) => {
      // 1. Search text filter
      const matchSearch =
        !taskSearch.trim() ||
        t.task_name.toLowerCase().includes(taskSearch.toLowerCase()) ||
        t.task_code.toLowerCase().includes(taskSearch.toLowerCase()) ||
        (t.project_name && t.project_name.toLowerCase().includes(taskSearch.toLowerCase())) ||
        (t.remarks && t.remarks.toLowerCase().includes(taskSearch.toLowerCase()));

      // 2. Status filter tab
      let matchStatus = true;
      if (statusFilterTab === "In Progress") {
        matchStatus = t.status === "In Progress";
      } else if (statusFilterTab === "To Do") {
        matchStatus = t.status === "To Do" || (t.status as string) === "Pending";
      } else if (statusFilterTab === "Completed") {
        matchStatus = t.status === "Completed";
      } else if (statusFilterTab === "Blocked") {
        matchStatus = t.status === "Blocked";
      } else if (statusFilterTab === "Overdue") {
        matchStatus = t.status !== "Completed" && !!t.due_date && t.due_date.slice(0, 10) < todayStr;
      }

      // 3. Multi-select Project filter
      const matchProject =
        selectedProjects.length === 0 ||
        (t.project_name && selectedProjects.some((sp) => t.project_name?.split("|").some((part) => part.trim().toLowerCase() === sp.toLowerCase()))) ||
        (t.project_id && selectedProjects.includes(t.project_id));

      // 4. Range filter
      let matchRange = true;
      if (drawerRange === "1") {
        const today = new Date().toISOString().slice(0, 10);
        const createdDay = t.created_at ? t.created_at.slice(0, 10) : "";
        const completedDay = t.completed_at ? t.completed_at.slice(0, 10) : "";
        const dueDay = t.due_date ? t.due_date.slice(0, 10) : "";
        const isActiveToday = t.status !== "Completed" && t.status !== "On Hold";
        matchRange = createdDay === today || completedDay === today || dueDay === today || isActiveToday;
      } else if (drawerRange !== "all") {
        const days = Number(drawerRange) || 7;
        const cutoff = Date.now() - days * 86400000;
        const createdTime = new Date(t.created_at).getTime();
        const completedTime = t.completed_at ? new Date(t.completed_at).getTime() : 0;
        const isActive = t.status !== "Completed" && t.status !== "On Hold";
        matchRange = createdTime >= cutoff || completedTime >= cutoff || isActive;
      }

      return matchSearch && matchStatus && matchProject && matchRange;
    });

    return list.sort((a, b) => {
      const timeA = new Date(a.due_date || a.completed_at || a.created_at || 0).getTime();
      const timeB = new Date(b.due_date || b.completed_at || b.created_at || 0).getTime();
      return dateSortOrder === "desc" ? timeB - timeA : timeA - timeB;
    });
  }, [memberTasks, taskSearch, statusFilterTab, selectedProjects, drawerRange, dateSortOrder, todayStr]);

  const memberCheckins = useMemo(() => {
    if (!memberId) return [];
    return checkins.filter((c) => c.user_id === memberId);
  }, [checkins, memberId]);

  const stats = useMemo(() => {
    const total = memberTasks.length;
    const completed = completedTasks.length;
    const inProgress = inProgressTasks.length;
    const blocked = blockedTasks.length;
    const overdue = overdueTasks.length;
    const plannedHours = memberTasks.reduce((s, t) => s + (t.planned_hours ?? 0), 0);
    const actualHours = memberTasks.reduce((s, t) => s + (t.actual_hours ?? 0), 0);
    const systemHours = memberTasks.reduce((s, t) => {
      const sys = (t as any).started_at 
        ? Math.max(0, Math.round(((Date.now() - new Date((t as any).started_at).getTime()) / 3600000) * 10) / 10)
        : Number((t as any).system_hours ?? 0);
      return s + sys;
    }, 0);
    const completionPct = total > 0 ? Math.round((completed / total) * 100) : 0;

    return { total, completed, inProgress, blocked, overdue, plannedHours, actualHours, systemHours, completionPct };
  }, [memberTasks, completedTasks, inProgressTasks, blockedTasks, overdueTasks]);

  const memberProjects = useMemo(() => {
    const set = new Set<string>();
    memberTasks.forEach((t) => {
      if (t.project_name) set.add(t.project_name);
    });
    return Array.from(set);
  }, [memberTasks]);

  if (!memberId || !member) return null;

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 animate-in fade-in duration-150">
      <div className="w-full max-w-4xl max-h-[92vh] bg-card border border-border shadow-2xl rounded-2xl flex flex-col overflow-hidden text-foreground">
        {/* 1. TOP HEADER */}
        <div className="flex items-center justify-between px-4 sm:px-5 py-3.5 border-b border-border bg-muted/40 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <Avatar className="h-10 w-10 border border-border bg-muted shrink-0">
              {member.avatar_url ? (
                <AvatarImage src={member.avatar_url} alt={member.display_name} />
              ) : (
                <AvatarFallback className="bg-primary/20 text-foreground text-sm font-bold">
                  {member.display_name.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              )}
            </Avatar>
            <div className="min-w-0 space-y-0.5">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-bold text-foreground truncate">
                  {member.display_name}
                </h2>
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-primary/30 text-primary bg-primary/10 font-medium">
                  Member Inspection
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground truncate flex items-center gap-1.5">
                <Mail className="h-3 w-3 text-muted-foreground" />
                <span>{member.email || "No email"}</span>
              </p>
            </div>
          </div>

          <Button
            size="sm"
            variant="ghost"
            onClick={onClose}
            className="h-8 w-8 p-0 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* SCROLLABLE BODY */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {/* 2. STATS KPI GRID */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-4 sm:p-5 border-b border-border bg-muted/20 shrink-0">
            <div
              onClick={() => setStatusFilterTab("all")}
              className={cn(
                "p-3 rounded-xl space-y-1 cursor-pointer transition-all border",
                statusFilterTab === "all" ? "bg-primary/10 border-primary/40 ring-1 ring-primary/40" : "bg-muted/40 border-border/80 hover:bg-muted/70"
              )}
            >
              <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Total Tasks</div>
              <div className="text-lg font-bold text-foreground font-mono">{stats.total}</div>
            </div>

            <div
              onClick={() => setStatusFilterTab("Completed")}
              className={cn(
                "p-3 rounded-xl space-y-1 cursor-pointer transition-all border",
                statusFilterTab === "Completed" ? "bg-emerald-500/20 border-emerald-500/50 ring-1 ring-emerald-500/50" : "bg-muted/40 border-border/80 hover:bg-muted/70"
              )}
            >
              <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Completed</div>
              <div className="text-lg font-bold text-emerald-400 font-mono">
                {stats.completed} <span className="text-xs font-normal text-muted-foreground">({stats.completionPct}%)</span>
              </div>
            </div>

            <div className="bg-muted/40 border border-border/80 p-3 rounded-xl space-y-1">
              <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Work Hours (User / Auto / Plan)</div>
              <div className="text-xs font-bold text-foreground font-mono flex items-center gap-1.5 flex-wrap pt-0.5">
                <span className="text-emerald-400" title="User Logged">User: {formatHoursMins(stats.actualHours)}</span>
                <span className="text-muted-foreground">|</span>
                <span className="text-amber-400" title="System Auto-Tracked">Auto: {formatHoursMins(stats.systemHours)}</span>
                <span className="text-muted-foreground">|</span>
                <span className="text-indigo-400" title="Planned Target">Plan: {formatHoursMins(stats.plannedHours)}</span>
              </div>
            </div>

            <div
              onClick={() => setStatusFilterTab("Overdue")}
              className={cn(
                "border p-3 rounded-xl space-y-1 cursor-pointer transition-all",
                statusFilterTab === "Overdue"
                  ? "bg-rose-500/20 border-rose-500/50 ring-1 ring-rose-500/50"
                  : stats.overdue > 0
                  ? "bg-rose-500/10 border-rose-500/30 hover:bg-rose-500/15"
                  : "bg-muted/40 border-border/80 hover:bg-muted/70"
              )}
              title="Click to filter overdue tasks"
            >
              <div className={cn("text-[11px] font-medium uppercase tracking-wider", stats.overdue > 0 ? "text-rose-400" : "text-muted-foreground")}>
                Overdue
              </div>
              <div className={cn("text-lg font-bold font-mono", stats.overdue > 0 ? "text-rose-400" : "text-foreground")}>
                {stats.overdue}
              </div>
            </div>

            <div
              onClick={() => setStatusFilterTab("Blocked")}
              className={cn(
                "border p-3 rounded-xl space-y-1 cursor-pointer transition-all",
                statusFilterTab === "Blocked"
                  ? "bg-rose-500/20 border-rose-500/50 ring-1 ring-rose-500/50"
                  : stats.blocked > 0
                  ? "bg-amber-500/10 border-amber-500/30 hover:bg-amber-500/15"
                  : "bg-muted/40 border-border/80 hover:bg-muted/70"
              )}
              title="Click to filter blocked tasks"
            >
              <div className={cn("text-[11px] font-medium uppercase tracking-wider", stats.blocked > 0 ? "text-amber-400" : "text-muted-foreground")}>
                Blockers
              </div>
              <div className={cn("text-lg font-bold font-mono", stats.blocked > 0 ? "text-amber-400" : "text-foreground")}>
                {stats.blocked}
              </div>
            </div>
          </div>

          {/* 3. CURRENT ACTIVE WORK (WHAT THEY ARE DOING RIGHT NOW) */}
          {inProgressTasks.length > 0 ? (
            <div className="p-3.5 rounded-xl bg-blue-500/10 border border-blue-500/30 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-bold text-blue-400">
                  <span className="h-2 w-2 rounded-full bg-blue-400 animate-pulse" />
                  Currently Working On Right Now ({inProgressTasks.length})
                </div>
                <Badge variant="outline" className="text-[10px] font-mono border-blue-500/30 text-blue-400 bg-blue-500/20">
                  Click to inspect task
                </Badge>
              </div>

              <div className="space-y-1.5">
                {inProgressTasks.map((t) => (
                  <div
                    key={t.id}
                    onClick={() => setInspectedTask(t)}
                    className="p-2.5 rounded-lg bg-card/80 hover:bg-card border border-blue-500/20 hover:border-primary/50 flex items-center justify-between gap-3 text-xs cursor-pointer transition-all hover:scale-[1.01] group/activeTask"
                    title="Click to view all task details"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-primary font-bold text-[11px]">{t.task_code}</span>
                        <span className="font-semibold text-foreground truncate group-hover/activeTask:text-primary">{t.task_name}</span>
                      </div>
                      {t.remarks && (
                        <p className="text-[11px] text-muted-foreground truncate">{t.remarks}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {t.project_name && (
                        <Badge variant="secondary" className="text-[9px] bg-muted text-muted-foreground">
                          {t.project_name}
                        </Badge>
                      )}
                      <span className="font-mono text-emerald-400 text-[11px] font-bold">
                        {t.actual_hours || 0}h / {t.planned_hours || 1}h
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="p-2.5 rounded-lg bg-muted/20 border border-border/60 text-xs text-muted-foreground flex items-center justify-between">
              <span>No tasks currently in progress for this member</span>
              <span className="text-[11px] text-emerald-400 font-medium">Available for assignment</span>
            </div>
          )}

          {/* 4. UNIFIED SINGLE FILTER TOOLBAR */}
          <div className="space-y-2 pt-1">
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              {/* Status Tabs Pills */}
              <div className="flex items-center gap-1 bg-muted/40 p-1 rounded-lg border border-border/80 overflow-x-auto text-xs">
                {[
                  { id: "all", label: "All", count: memberTasks.length },
                  { id: "In Progress", label: "In Progress", count: inProgressTasks.length },
                  { id: "To Do", label: "To Do", count: toDoTasks.length },
                  { id: "Overdue", label: "Overdue", count: overdueTasks.length, isOverdue: true },
                  { id: "Completed", label: "Completed", count: completedTasks.length },
                  { id: "Blocked", label: "Blocked", count: blockedTasks.length },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setStatusFilterTab(tab.id)}
                    className={cn(
                      "px-2.5 py-1 rounded-md font-medium transition-all flex items-center gap-1.5 whitespace-nowrap",
                      statusFilterTab === tab.id
                        ? tab.id === "Overdue"
                          ? "bg-rose-600 text-white font-semibold shadow-xs"
                          : "bg-primary text-primary-foreground font-semibold shadow-xs"
                        : tab.id === "Overdue" && tab.count > 0
                        ? "text-rose-400 hover:bg-rose-500/10"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent"
                    )}
                  >
                    <span>{tab.label}</span>
                    <span className={cn(
                      "text-[10px] font-mono px-1 py-0 rounded",
                      statusFilterTab === tab.id
                        ? "bg-black/20 text-white"
                        : tab.id === "Overdue" && tab.count > 0
                        ? "bg-rose-500/20 text-rose-400 font-bold"
                        : "bg-muted text-muted-foreground"
                    )}>
                      {tab.count}
                    </span>
                  </button>
                ))}
              </div>

              {/* Filters Dropdowns */}
              <div className="flex items-center gap-2 flex-wrap">
                <Input
                  placeholder="Search tasks..."
                  value={taskSearch}
                  onChange={(e) => setTaskSearch(e.target.value)}
                  className="h-8 w-40 text-xs bg-input/40 border-border text-foreground placeholder:text-muted-foreground/60 rounded-md"
                />

                <MultiSelectFilterPopover
                  label="Project"
                  options={availableDrawerProjects}
                  selectedValues={selectedProjects}
                  onChange={setSelectedProjects}
                />

                <Select value={dateSortOrder} onValueChange={(v) => setDateSortOrder(v as "desc" | "asc")}>
                  <SelectTrigger className="h-8 w-[130px] text-xs bg-card border-border text-foreground font-medium gap-1.5">
                    <CalendarDays className="h-3.5 w-3.5 text-primary shrink-0" />
                    <span>{dateSortOrder === "desc" ? "Newest" : "Oldest"}</span>
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border text-xs text-popover-foreground z-[9999]">
                    <SelectItem value="desc">Newest Date</SelectItem>
                    <SelectItem value="asc">Oldest Date</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* 5. TASKS LIST */}
            <div className="border border-border rounded-xl overflow-hidden bg-card">
              <div className="max-h-72 overflow-y-auto divide-y divide-border/60">
                {filteredTasks.length > 0 ? (
                  filteredTasks.map((t) => (
                    <div
                      key={t.id}
                      onClick={() => setInspectedTask(t)}
                      className="p-3 hover:bg-muted/60 transition-all space-y-1.5 text-xs cursor-pointer group/taskRow hover:scale-[1.005]"
                      title="Click to view all task details"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 font-medium text-foreground min-w-0">
                          <span className="font-mono text-primary text-[11px] font-bold shrink-0">{t.task_code}</span>
                          <span className="truncate font-semibold group-hover/taskRow:text-primary">{t.task_name}</span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[10px] px-1.5 py-0 font-medium",
                              t.status === "Completed"
                                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                                : t.status === "In Progress"
                                ? "bg-blue-500/10 text-blue-400 border-blue-500/30"
                                : t.status === "Blocked"
                                ? "bg-rose-500/10 text-rose-400 border-rose-500/30"
                                : "bg-muted text-muted-foreground border-border"
                            )}
                          >
                            {t.status}
                          </Badge>
                          <Badge variant="secondary" className="text-[9px] px-1 py-0 bg-muted text-muted-foreground font-mono">
                            {t.priority}
                          </Badge>
                        </div>
                      </div>

                      {t.remarks && (
                        <p className="text-[11px] text-muted-foreground line-clamp-2 pl-0.5">
                          {t.remarks}
                        </p>
                      )}

                      {t.status === "Blocked" && t.blocker_reason && (
                        <div className="text-[11px] text-rose-400 bg-rose-500/10 p-1.5 rounded-md border border-rose-500/20 font-medium">
                          🚨 Blocker: {t.blocker_reason}
                        </div>
                      )}

                      <div className="flex flex-wrap items-center justify-between text-[11px] text-muted-foreground pt-0.5 gap-2 border-t border-border/40">
                        <span className="flex items-center gap-1">
                          <Briefcase className="h-3 w-3 text-muted-foreground" /> {t.project_name || "General"}
                        </span>
                        <div className="flex items-center gap-3">
                          {t.due_date && (
                            <span className="font-mono text-muted-foreground flex items-center gap-1 text-[10px]">
                              <Calendar className="h-3 w-3 text-muted-foreground" />
                              {formatDate(t.due_date)}
                            </span>
                          )}
                          <TaskHoursBadges task={t} />
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-8 text-center text-xs text-muted-foreground italic">
                    No tasks found matching current filter criteria.
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 6. ASSOCIATED PROJECTS & RECENT EOD FOOTER */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
            {/* Associated Projects */}
            <div className="p-3 rounded-xl bg-muted/30 border border-border/80 space-y-1.5 text-xs">
              <span className="font-bold text-foreground flex items-center gap-1.5 text-[11px] uppercase tracking-wider">
                <Briefcase className="h-3.5 w-3.5 text-primary" /> Associated Projects ({memberProjects.length})
              </span>
              <div className="flex flex-wrap gap-1.5">
                {memberProjects.length > 0 ? (
                  memberProjects.map((pName, i) => (
                    <Badge key={i} variant="secondary" className="bg-card text-foreground border border-border text-[10px] px-2 py-0.5">
                      {pName}
                    </Badge>
                  ))
                ) : (
                  <span className="text-muted-foreground italic text-[11px]">No active projects assigned</span>
                )}
              </div>
            </div>

            {/* Recent EOD Check-ins */}
            <div className="p-3 rounded-xl bg-muted/30 border border-border/80 space-y-1.5 text-xs">
              <span className="font-bold text-foreground flex items-center gap-1.5 text-[11px] uppercase tracking-wider">
                <Clock className="h-3.5 w-3.5 text-primary" /> Recent EOD Activity ({memberCheckins.length})
              </span>
              <div className="space-y-1">
                {memberCheckins.slice(0, 2).map((c) => (
                  <div key={c.id} className="flex items-center justify-between text-[11px] bg-card p-1.5 rounded border border-border/60">
                    <span className="text-foreground">{(c.checkin_date as any) instanceof Date ? (c.checkin_date as any).toISOString().slice(0, 10) : String(c.checkin_date)}</span>
                    <span className="text-emerald-400 font-mono font-medium">{c.completed_count} tasks completed</span>
                  </div>
                ))}
                {memberCheckins.length === 0 && (
                  <span className="text-muted-foreground italic text-[11px]">No recent EOD check-ins</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* FOOTER */}
        <div className="px-5 py-3 border-t border-border bg-muted/30 flex items-center justify-between">
          <span className="text-xs text-muted-foreground font-mono">
            Showing {filteredTasks.length} of {memberTasks.length} tasks
          </span>
          <Button
            size="sm"
            onClick={onClose}
            className="h-8 text-xs px-4 bg-primary text-primary-foreground hover:bg-primary/90 font-medium"
          >
            Close Inspection
          </Button>
        </div>
      </div>

      {/* Task Full Details Modal */}
      {inspectedTask && (
        <TaskDetailModal
          task={inspectedTask}
          open={!!inspectedTask}
          onOpenChange={(open) => {
            if (!open) setInspectedTask(null);
          }}
          assignedProfile={member}
        />
      )}
    </div>
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
      <SelectTrigger className="h-8 w-[190px] text-xs bg-input/40 border-border text-foreground">
        <SelectValue placeholder="Scope" />
      </SelectTrigger>
      <SelectContent className="bg-popover border-border text-xs text-popover-foreground z-[9999]">
        {canSeeOrg && (
          <SelectGroup>
            <SelectLabel className="text-[10px] uppercase tracking-wide text-primary">Scope</SelectLabel>
            <SelectItem value="org" className="text-xs">
              Organization
            </SelectItem>
          </SelectGroup>
        )}
        {teams.length > 0 && (
          <SelectGroup>
            <SelectLabel className="text-[10px] uppercase tracking-wide text-primary">Teams</SelectLabel>
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
            <SelectLabel className="text-[10px] uppercase tracking-wide text-primary">Managers</SelectLabel>
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
      <SelectTrigger className="h-8 w-[130px] text-xs bg-input/40 border-border text-foreground">
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent className="bg-popover border-border text-xs text-popover-foreground z-[9999]">
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

/* -------------------------------------------------------------------------- */
/*            STATUS DETAIL FULL PAGE VIEW COMPONENT                          */
/* -------------------------------------------------------------------------- */

function StatusDetailSheet({
  status,
  onClose,
  profiles,
  tasks,
  allTasks,
  projects,
  range = "7",
  onSelectMember,
}: {
  status: "Completed" | "In Progress" | "In Review" | "Blocked" | "Pending" | null;
  onClose: () => void;
  profiles: Profile[];
  tasks: Task[];
  allTasks: Task[];
  projects: Project[];
  range?: string;
  onSelectMember: (memberId: string) => void;
}) {
  const [useAllTime, setUseAllTime] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedProjectFilter, setSelectedProjectFilter] = useState<string | null>(null);
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"table" | "grid">("table");
  const [inspectedTask, setInspectedTask] = useState<Task | null>(null);

  const activeSourceTasks = useAllTime ? allTasks : tasks;

  const profilesMap = useMemo(() => {
    const map = new Map<string, Profile>();
    profiles.forEach((p) => map.set(p.id, p));
    return map;
  }, [profiles]);

  const statusTasks = useMemo(() => {
    if (!status) return [];
    if (status === "Pending") {
      return activeSourceTasks.filter(
        (t) => t.status === "To Do" || t.status === "Pending" || (t.status !== "Completed" && t.status !== "In Progress" && t.status !== "In Review" && t.status !== "Blocked" && t.status !== "On Hold"),
      );
    }
    if (status === "Blocked") {
      return activeSourceTasks.filter((t) => t.status === "Blocked" || t.status === "On Hold");
    }
    return activeSourceTasks.filter((t) => t.status === status);
  }, [activeSourceTasks, status]);

  const availableProjectsInStatus = useMemo(() => {
    const set = new Set<string>();
    statusTasks.forEach((t) => {
      if (t.project_name?.trim()) {
        t.project_name.split("|").forEach((part) => {
          const name = part.trim();
          if (name) set.add(name);
        });
      }
    });
    return Array.from(set).sort();
  }, [statusTasks]);

  const filteredTasks = useMemo(() => {
    return statusTasks.filter((t) => {
      const assigned = t.assigned_to ? profilesMap.get(t.assigned_to)?.display_name ?? "" : "";
      const matchSearch =
        !search.trim() ||
        t.task_name.toLowerCase().includes(search.toLowerCase()) ||
        t.task_code.toLowerCase().includes(search.toLowerCase()) ||
        (t.project_name && t.project_name.toLowerCase().includes(search.toLowerCase())) ||
        assigned.toLowerCase().includes(search.toLowerCase()) ||
        (t.blocker_reason && t.blocker_reason.toLowerCase().includes(search.toLowerCase()));

      const matchProject =
        !selectedProjectFilter ||
        (t.project_name &&
          t.project_name
            .split("|")
            .some((part) => part.trim().toLowerCase() === selectedProjectFilter.toLowerCase())) ||
        t.project_id === selectedProjectFilter;

      const matchPriority = priorityFilter === "all" || t.priority === priorityFilter;

      return matchSearch && matchProject && matchPriority;
    });
  }, [statusTasks, search, selectedProjectFilter, priorityFilter, profilesMap]);

  const summary = useMemo(() => {
    const total = filteredTasks.length;
    const plannedHours = filteredTasks.reduce((s, t) => s + Number(t.planned_hours ?? 0), 0);
    const actualHours = filteredTasks.reduce((s, t) => s + Number(t.actual_hours ?? 0), 0);
    const uniqueMembers = new Set(filteredTasks.map((t) => t.assigned_to).filter(Boolean)).size;
    const uniqueProjects = new Set(filteredTasks.map((t) => t.project_name).filter(Boolean)).size;
    const highPriorityCount = filteredTasks.filter((t) => t.priority === "High").length;

    return { total, plannedHours, actualHours, uniqueMembers, uniqueProjects, highPriorityCount };
  }, [filteredTasks]);

  if (!status) return null;

  const headerConfig = {
    Completed: {
      title: "Completed Tasks — Details & Audit",
      badge: "Completed",
      badgeCls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
      icon: CheckCircle2,
      iconCls: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
    },
    "In Progress": {
      title: "In Progress Tasks — Active Tracking",
      badge: "Active Work",
      badgeCls: "bg-blue-500/10 text-blue-400 border-blue-500/30",
      icon: Clock,
      iconCls: "text-blue-400 bg-blue-500/10 border-blue-500/30",
    },
    "In Review": {
      title: "In Review Tasks — QA & Approvals",
      badge: "In Review",
      badgeCls: "bg-purple-500/10 text-purple-400 border-purple-500/30",
      icon: Clock,
      iconCls: "text-purple-400 bg-purple-500/10 border-purple-500/30",
    },
    Blocked: {
      title: "Blocked Tasks & Risk Analysis",
      badge: "Risk Alert",
      badgeCls: "bg-rose-500/10 text-rose-400 border-rose-500/30",
      icon: AlertOctagon,
      iconCls: "text-rose-400 bg-rose-500/10 border-rose-500/30",
    },
    Pending: {
      title: "Pending Queue — Work Backlog",
      badge: "To Do",
      badgeCls: "bg-amber-500/10 text-amber-400 border-amber-500/30",
      icon: Users,
      iconCls: "text-amber-400 bg-amber-500/10 border-amber-500/30",
    },
  }[status];

  const IconComp = headerConfig.icon;

  return (
    <div className="fixed inset-0 z-50 w-full h-full bg-background overflow-y-auto text-foreground p-4 md:p-6 space-y-5 flex flex-col">
      {/* Top Page Header Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-3 shrink-0">
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            variant="outline"
            onClick={onClose}
            className="gap-2 text-xs font-semibold px-3 py-1.5"
          >
            <ArrowLeft className="h-4 w-4" /> Back to Dashboard
          </Button>
          <div className="h-5 w-[1px] bg-border" />
          <div className="flex items-center gap-2.5">
            <div className={cn("h-8 w-8 rounded-lg border flex items-center justify-center shrink-0", headerConfig.iconCls)}>
              <IconComp className="h-4 w-4" />
            </div>
            <div>
              <h1 className="text-base md:text-lg font-bold text-foreground flex items-center gap-2">
                {headerConfig.title}
                <Badge variant="outline" className={cn("text-[10px]", headerConfig.badgeCls)}>
                  {headerConfig.badge}
                </Badge>
              </h1>
              <p className="text-xs text-muted-foreground">
                Showing {filteredTasks.length} tasks under {status} status (Click any task for details)
              </p>
            </div>
          </div>
        </div>

        <Button
          size="sm"
          variant="ghost"
          onClick={onClose}
          className="h-8 w-8 p-0 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* KPI Cards Row (Full Page Width) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 shrink-0">
        <div className="bg-card border border-border rounded-xl p-3.5 space-y-1 shadow-xs">
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Total Tasks</div>
          <div className="text-xl font-bold font-mono text-foreground">{summary.total}</div>
          <div className="text-[10px] text-muted-foreground">Filtered items count</div>
        </div>
        <div className="bg-card border border-border rounded-xl p-3.5 space-y-1 shadow-xs">
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Work Hours</div>
          <div className="text-xl font-bold font-mono text-primary">
            {summary.actualHours}h <span className="text-xs text-muted-foreground font-normal">/ {summary.plannedHours}h</span>
          </div>
          <div className="text-[10px] text-muted-foreground">Actual vs Planned logged</div>
        </div>
        <div className="bg-card border border-border rounded-xl p-3.5 space-y-1 shadow-xs">
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Assigned Team</div>
          <div className="text-xl font-bold font-mono text-emerald-400">{summary.uniqueMembers}</div>
          <div className="text-[10px] text-muted-foreground">Active team members</div>
        </div>
        <div className="bg-card border border-border rounded-xl p-3.5 space-y-1 shadow-xs">
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Projects</div>
          <div className="text-xl font-bold font-mono text-purple-400">{summary.uniqueProjects}</div>
          <div className="text-[10px] text-muted-foreground">Active projects</div>
        </div>
        <div className="bg-card border border-border rounded-xl p-3.5 space-y-1 shadow-xs">
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">High Priority</div>
          <div className="text-xl font-bold font-mono text-rose-400">{summary.highPriorityCount}</div>
          <div className="text-[10px] text-muted-foreground">High urgency items</div>
        </div>
      </div>

      {/* Advanced Filters & View Mode Switcher Toolbar */}
      <div className="bg-card border border-border rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 shadow-xs shrink-0">
        <div className="flex flex-wrap items-center gap-2.5 flex-1">
          <div className="relative min-w-[240px] flex-1">
            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search by code, title, member, project or blocker..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 pl-8 text-xs bg-input/40 border-border text-foreground placeholder:text-muted-foreground/60 rounded-md"
            />
          </div>

          <Select value={selectedProjectFilter || "all"} onValueChange={(v) => setSelectedProjectFilter(v === "all" ? null : v)}>
            <SelectTrigger className="h-8 w-44 text-xs bg-input/40 border-border text-foreground rounded-md">
              <SelectValue placeholder="All Projects" />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border text-xs text-popover-foreground z-[9999]">
              <SelectItem value="all">All Projects</SelectItem>
              {availableProjectsInStatus.map((p) => (
                <SelectItem key={p} value={p}>{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="h-8 w-36 text-xs bg-input/40 border-border text-foreground rounded-md">
              <SelectValue placeholder="Priority" />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border text-xs text-popover-foreground z-[9999]">
              <SelectItem value="all">All Priorities</SelectItem>
              <SelectItem value="High">High Priority</SelectItem>
              <SelectItem value="Medium">Medium Priority</SelectItem>
              <SelectItem value="Low">Low Priority</SelectItem>
            </SelectContent>
          </Select>

          {(search || selectedProjectFilter || priorityFilter !== "all") && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setSearch("");
                setSelectedProjectFilter(null);
                setPriorityFilter("all");
              }}
              className="h-8 text-xs text-primary hover:bg-primary/10"
            >
              Reset Filters
            </Button>
          )}
        </div>

        {/* View Mode Toggle & Scope Mode Toggle */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 bg-muted/40 border border-border p-0.5 rounded-lg">
            <Button
              size="sm"
              variant={!useAllTime ? "default" : "ghost"}
              onClick={() => setUseAllTime(false)}
              className={cn("h-7 text-xs px-2.5 rounded-md", !useAllTime ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground")}
            >
              Active Dashboard Scope ({tasks.length})
            </Button>
            <Button
              size="sm"
              variant={useAllTime ? "default" : "ghost"}
              onClick={() => setUseAllTime(true)}
              className={cn("h-7 text-xs px-2.5 rounded-md", useAllTime ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground")}
            >
              All Time ({allTasks.length})
            </Button>
          </div>

          <div className="flex items-center gap-1 bg-muted/40 border border-border p-0.5 rounded-lg">
            <Button
              size="sm"
              variant={viewMode === "table" ? "default" : "ghost"}
              onClick={() => setViewMode("table")}
              className={cn("h-7 text-xs px-2.5 gap-1.5 rounded-md", viewMode === "table" ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground")}
            >
              <Table className="h-3.5 w-3.5" /> Table
            </Button>
            <Button
              size="sm"
              variant={viewMode === "grid" ? "default" : "ghost"}
              onClick={() => setViewMode("grid")}
              className={cn("h-7 text-xs px-2.5 gap-1.5 rounded-md", viewMode === "grid" ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground")}
            >
              <Grid className="h-3.5 w-3.5" /> Grid
            </Button>
          </div>
        </div>
      </div>

      {/* Main Full Page Task Details Content */}
      {viewMode === "table" ? (
        <div className="bg-card border border-border rounded-xl overflow-hidden shadow-xs flex-1 mb-6">
          <div className="max-h-[62vh] overflow-y-auto overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur-xs z-10">
                <tr className="border-b border-border text-muted-foreground uppercase tracking-wider text-[11px]">
                  <th className="py-3 px-3.5 font-semibold">Code</th>
                  <th className="py-3 px-3.5 font-semibold">Task Name & Details</th>
                  <th className="py-3 px-3.5 font-semibold">Assigned Member</th>
                  <th className="py-3 px-3.5 font-semibold">Project</th>
                  <th className="py-3 px-3.5 font-semibold">Priority</th>
                  <th className="py-3 px-3.5 font-semibold">Logged / Plan</th>
                  <th className="py-3 px-3.5 font-semibold">Due Date</th>
                  <th className="py-3 px-3.5 font-semibold">Blocker / Remarks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredTasks.map((t) => {
                  const profile = t.assigned_to ? profilesMap.get(t.assigned_to) : null;
                  return (
                    <tr
                      key={t.id}
                      onClick={() => setInspectedTask(t)}
                      className="hover:bg-muted/40 transition-colors cursor-pointer group/row"
                      title="Click to inspect task details"
                    >
                      <td className="py-3 px-3.5 font-mono font-bold text-primary">
                        {t.task_code}
                      </td>
                      <td className="py-3 px-3.5 font-medium text-foreground max-w-xs">
                        <div className="font-semibold text-foreground group-hover/row:text-primary transition-colors">{t.task_name}</div>
                        {t.remarks && <div className="text-[11px] text-muted-foreground truncate mt-0.5">{t.remarks}</div>}
                      </td>
                      <td className="py-3 px-3.5">
                        {profile ? (
                          <div
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectMember(profile.id);
                            }}
                            className="flex items-center gap-2 cursor-pointer group/m hover:text-primary transition-colors"
                          >
                            <Avatar className="h-6 w-6 border border-border">
                              {profile.avatar_url ? (
                                <AvatarImage src={profile.avatar_url} alt={profile.display_name} />
                              ) : (
                                <AvatarFallback className="bg-primary/20 text-foreground text-[10px] font-bold">
                                  {profile.display_name.slice(0, 2).toUpperCase()}
                                </AvatarFallback>
                              )}
                            </Avatar>
                            <span className="font-medium text-foreground group-hover/m:underline">
                              {profile.display_name}
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground italic">Unassigned</span>
                        )}
                      </td>
                      <td className="py-3 px-3.5 text-muted-foreground">
                        {t.project_name || "General Workspace"}
                      </td>
                      <td className="py-3 px-3.5">
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px] px-1.5 py-0 font-medium",
                            t.priority === "High"
                              ? "bg-rose-500/10 text-rose-400 border-rose-500/30"
                              : t.priority === "Medium"
                              ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                              : "bg-muted text-muted-foreground border-border"
                          )}
                        >
                          {t.priority}
                        </Badge>
                      </td>
                      <td className="py-3 px-3.5 font-mono text-[11px]">
                        <span className="text-emerald-400 font-bold">{t.actual_hours ?? 0}h</span>
                        <span className="text-muted-foreground"> / {t.planned_hours ?? 0}h</span>
                      </td>
                      <td className="py-3 px-3.5 text-muted-foreground font-mono text-[11px]">
                        {t.due_date ? new Date(t.due_date).toLocaleDateString() : "—"}
                      </td>
                      <td className="py-3 px-3.5 max-w-xs">
                        {t.status === "Blocked" && t.blocker_reason ? (
                          <span className="bg-rose-500/10 text-rose-400 border border-rose-500/30 px-2 py-0.5 rounded text-[11px] font-medium block">
                            🚨 {t.blocker_reason}
                          </span>
                        ) : (
                          <span className="text-muted-foreground truncate block">{t.remarks || "—"}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {filteredTasks.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-muted-foreground text-xs italic">
                      No tasks found matching your search or filters under {status} status.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 flex-1 mb-6">
          {filteredTasks.map((t) => {
            const profile = t.assigned_to ? profilesMap.get(t.assigned_to) : null;
            return (
              <div
                key={t.id}
                onClick={() => setInspectedTask(t)}
                className="bg-card border border-border hover:border-primary/50 rounded-xl p-4 space-y-3 shadow-xs hover:shadow-md transition-all flex flex-col justify-between cursor-pointer group/card"
              >
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-primary font-bold text-xs px-2 py-0.5 bg-primary/10 rounded-md border border-primary/20">
                      {t.task_code}
                    </span>
                    <Badge
                      className={cn(
                        "text-[10px] px-2 py-0.5 font-semibold",
                        t.status === "Completed"
                          ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/40"
                          : t.status === "Blocked"
                          ? "bg-rose-500/20 text-rose-400 border-rose-500/40"
                          : t.status === "In Progress"
                          ? "bg-blue-500/20 text-blue-400 border-blue-500/40"
                          : "bg-amber-500/20 text-amber-400 border-amber-500/40"
                      )}
                    >
                      {t.status}
                    </Badge>
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm text-foreground group-hover/card:text-primary transition-colors">{t.task_name}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">{t.project_name || "General Workspace"}</p>
                  </div>
                  {t.status === "Blocked" && t.blocker_reason && (
                    <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg p-2.5 text-xs text-rose-400 space-y-0.5">
                      <div className="font-bold flex items-center gap-1.5">
                        <AlertOctagon className="h-3.5 w-3.5 shrink-0" /> Blocker Reason:
                      </div>
                      <p>{t.blocker_reason}</p>
                    </div>
                  )}
                </div>

                <div className="pt-2.5 border-t border-border flex items-center justify-between text-xs">
                  {profile ? (
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectMember(profile.id);
                      }}
                      className="flex items-center gap-2 cursor-pointer group/m hover:text-primary"
                    >
                      <Avatar className="h-6 w-6 border border-border">
                        {profile.avatar_url ? (
                          <AvatarImage src={profile.avatar_url} alt={profile.display_name} />
                        ) : (
                          <AvatarFallback className="bg-primary/20 text-foreground text-[10px] font-bold">
                            {profile.display_name.slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        )}
                      </Avatar>
                      <span className="font-medium text-foreground group-hover/m:underline">
                        {profile.display_name}
                      </span>
                    </div>
                  ) : (
                    <span className="text-muted-foreground italic">Unassigned</span>
                  )}
                  {(() => {
                    const sysHrs = (t as any).started_at 
                      ? Math.max(0, Math.round(((Date.now() - new Date((t as any).started_at).getTime()) / 3600000) * 10) / 10)
                      : Number((t as any).system_hours ?? 0);
                    return (
                      <div className="text-right font-mono text-[11px]">
                        <div className="font-bold flex items-center gap-1 justify-end">
                          <span className="text-emerald-400">User: {t.actual_hours ?? 0}h</span>
                          <span className="text-slate-600">|</span>
                          <span className="text-amber-400">Auto: {sysHrs}h</span>
                          <span className="text-slate-600">|</span>
                          <span className="text-indigo-400">Plan: {t.planned_hours ?? 0}h</span>
                        </div>
                        <div className="text-[10px] text-muted-foreground">User / Auto / Plan</div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            );
          })}
          {filteredTasks.length === 0 && (
            <div className="col-span-full py-12 text-center text-muted-foreground text-xs italic">
              No tasks found matching your search or filters under {status} status.
            </div>
          )}
        </div>
      )}

      {/* Task Detail Modal */}
      {inspectedTask && (
        <TaskDetailModal
          task={inspectedTask}
          open={!!inspectedTask}
          onOpenChange={(open) => {
            if (!open) setInspectedTask(null);
          }}
          assignedProfile={inspectedTask.assigned_to ? profilesMap.get(inspectedTask.assigned_to) : null}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*            TASK AGING BUCKET DETAILS INSPECTION MODAL                      */
/* -------------------------------------------------------------------------- */

function TaskAgingDetailSheet({
  bucket,
  onClose,
  profiles,
  tasks,
  projects,
  onSelectMember,
}: {
  bucket: "0-3d" | "4-7d" | "8-14d" | "15d+" | null;
  onClose: () => void;
  profiles: Profile[];
  tasks: Task[];
  projects: Project[];
  onSelectMember: (memberId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [selectedProjectFilter, setSelectedProjectFilter] = useState<string | null>(null);
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"table" | "grid">("table");
  const [inspectedTask, setInspectedTask] = useState<Task | null>(null);

  const profilesMap = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);

  // Filter tasks belonging to the selected age bucket
  const bucketTasks = useMemo(() => {
    if (!bucket) return [];
    const now = Date.now();
    return tasks.filter((t) => {
      if (t.status === "Completed") return false;
      const createdTime = new Date(t.created_at).getTime();
      const age = Math.floor((now - createdTime) / 86400000);
      if (bucket === "0-3d") return age <= 3;
      if (bucket === "4-7d") return age > 3 && age <= 7;
      if (bucket === "8-14d") return age > 7 && age <= 14;
      if (bucket === "15d+") return age > 14;
      return false;
    });
  }, [tasks, bucket]);

  // Extract projects available in this bucket
  const availableProjects = useMemo(() => {
    const set = new Set<string>();
    bucketTasks.forEach((t) => {
      if (t.project_name?.trim()) {
        t.project_name.split("|").forEach((part) => {
          const name = part.trim();
          if (name) set.add(name);
        });
      }
    });
    return Array.from(set).sort();
  }, [bucketTasks]);

  // Apply sub-filters inside modal
  const filteredTasks = useMemo(() => {
    return bucketTasks.filter((t) => {
      const assigned = t.assigned_to ? profilesMap.get(t.assigned_to)?.display_name ?? "" : "";
      const matchSearch =
        !search.trim() ||
        t.task_name.toLowerCase().includes(search.toLowerCase()) ||
        t.task_code.toLowerCase().includes(search.toLowerCase()) ||
        (t.project_name && t.project_name.toLowerCase().includes(search.toLowerCase())) ||
        assigned.toLowerCase().includes(search.toLowerCase()) ||
        (t.blocker_reason && t.blocker_reason.toLowerCase().includes(search.toLowerCase()));

      const matchProject =
        !selectedProjectFilter ||
        (t.project_name &&
          t.project_name
            .split("|")
            .some((part) => part.trim().toLowerCase() === selectedProjectFilter.toLowerCase())) ||
        t.project_id === selectedProjectFilter;

      const matchPriority = priorityFilter === "all" || t.priority === priorityFilter;
      const matchStatus = statusFilter === "all" || t.status === statusFilter;

      return matchSearch && matchProject && matchPriority && matchStatus;
    });
  }, [bucketTasks, search, selectedProjectFilter, priorityFilter, statusFilter, profilesMap]);

  const summary = useMemo(() => {
    const total = filteredTasks.length;
    const plannedHours = filteredTasks.reduce((s, t) => s + Number(t.planned_hours ?? 0), 0);
    const actualHours = filteredTasks.reduce((s, t) => s + Number(t.actual_hours ?? 0), 0);
    const uniqueMembers = new Set(filteredTasks.map((t) => t.assigned_to).filter(Boolean)).size;
    const highPriorityCount = filteredTasks.filter((t) => t.priority === "High").length;
    const blockedCount = filteredTasks.filter((t) => t.status === "Blocked").length;

    return { total, plannedHours, actualHours, uniqueMembers, highPriorityCount, blockedCount };
  }, [filteredTasks]);

  if (!bucket) return null;

  const bucketConfig = {
    "0-3d": {
      title: "Fresh Open Tasks (0–3 Days Old)",
      subtitle: "Recent incomplete tasks created within the last 3 days",
      badge: "0-3 Days",
      badgeCls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
    },
    "4-7d": {
      title: "Aging Open Tasks (4–7 Days Old)",
      subtitle: "Active incomplete tasks in queue for 4 to 7 days",
      badge: "4-7 Days",
      badgeCls: "bg-blue-500/10 text-blue-400 border-blue-500/30",
    },
    "8-14d": {
      title: "Delayed Tasks (8–14 Days Old)",
      subtitle: "Older incomplete tasks requiring follow up and management review",
      badge: "8-14 Days",
      badgeCls: "bg-amber-500/10 text-amber-400 border-amber-500/30",
    },
    "15d+": {
      title: "Critical Aged Tasks (15+ Days Old)",
      subtitle: "Long outstanding incomplete tasks requiring immediate escalation",
      badge: "15+ Days (Critical)",
      badgeCls: "bg-rose-500/10 text-rose-400 border-rose-500/30",
    },
  }[bucket];

  return (
    <div className="fixed inset-0 z-50 w-full h-full bg-background overflow-y-auto text-foreground p-4 md:p-6 space-y-5 flex flex-col">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-3 shrink-0">
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            variant="outline"
            onClick={onClose}
            className="gap-2 text-xs font-semibold px-3 py-1.5"
          >
            <ArrowLeft className="h-4 w-4" /> Back to Dashboard
          </Button>
          <div className="h-5 w-[1px] bg-border" />
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg border border-primary/30 bg-primary/10 flex items-center justify-center shrink-0 text-primary">
              <Hourglass className="h-4 w-4" />
            </div>
            <div>
              <h1 className="text-base md:text-lg font-bold text-foreground flex items-center gap-2">
                {bucketConfig.title}
                <Badge variant="outline" className={cn("text-[10px] font-semibold", bucketConfig.badgeCls)}>
                  {bucketConfig.badge}
                </Badge>
              </h1>
              <p className="text-xs text-muted-foreground">
                {bucketConfig.subtitle} — showing {filteredTasks.length} tasks (Click any task for details)
              </p>
            </div>
          </div>
        </div>

        <Button
          size="sm"
          variant="ghost"
          onClick={onClose}
          className="h-8 w-8 p-0 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 shrink-0">
        <div className="bg-card border border-border rounded-xl p-3.5 space-y-1 shadow-xs">
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Open Tasks</div>
          <div className="text-xl font-bold font-mono text-primary">{summary.total}</div>
          <div className="text-[10px] text-muted-foreground">In bucket {bucket}</div>
        </div>
        <div className="bg-card border border-border rounded-xl p-3.5 space-y-1 shadow-xs">
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Logged / Plan</div>
          <div className="text-xl font-bold font-mono text-foreground">
            {summary.actualHours}h <span className="text-xs text-muted-foreground font-normal">/ {summary.plannedHours}h</span>
          </div>
          <div className="text-[10px] text-muted-foreground">Actual vs planned hours</div>
        </div>
        <div className="bg-card border border-border rounded-xl p-3.5 space-y-1 shadow-xs">
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Assigned Members</div>
          <div className="text-xl font-bold font-mono text-emerald-400">{summary.uniqueMembers}</div>
          <div className="text-[10px] text-muted-foreground">Team members assigned</div>
        </div>
        <div className="bg-card border border-border rounded-xl p-3.5 space-y-1 shadow-xs">
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">High Priority</div>
          <div className="text-xl font-bold font-mono text-rose-400">{summary.highPriorityCount}</div>
          <div className="text-[10px] text-muted-foreground">High priority tasks</div>
        </div>
        <div className="bg-card border border-border rounded-xl p-3.5 space-y-1 shadow-xs">
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Blocked Tasks</div>
          <div className="text-xl font-bold font-mono text-amber-400">{summary.blockedCount}</div>
          <div className="text-[10px] text-muted-foreground">Tasks with blocker</div>
        </div>
      </div>

      {/* Filters & View Toggle Bar */}
      <div className="bg-card border border-border rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 shadow-xs shrink-0">
        <div className="flex flex-wrap items-center gap-2.5 flex-1">
          <div className="relative min-w-[240px] flex-1">
            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search by code, title, member, project or blocker..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 pl-8 text-xs bg-input/40 border-border text-foreground placeholder:text-muted-foreground/60 rounded-md"
            />
          </div>

          <Select value={selectedProjectFilter || "all"} onValueChange={(v) => setSelectedProjectFilter(v === "all" ? null : v)}>
            <SelectTrigger className="h-8 w-44 text-xs bg-input/40 border-border text-foreground rounded-md">
              <SelectValue placeholder="All Projects" />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border text-xs text-popover-foreground z-[9999]">
              <SelectItem value="all">All Projects</SelectItem>
              {availableProjects.map((p) => (
                <SelectItem key={p} value={p}>{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 w-36 text-xs bg-input/40 border-border text-foreground rounded-md">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border text-xs text-popover-foreground z-[9999]">
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="In Progress">In Progress</SelectItem>
              <SelectItem value="Blocked">Blocked</SelectItem>
              <SelectItem value="Pending">Pending</SelectItem>
            </SelectContent>
          </Select>

          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="h-8 w-36 text-xs bg-input/40 border-border text-foreground rounded-md">
              <SelectValue placeholder="Priority" />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border text-xs text-popover-foreground z-[9999]">
              <SelectItem value="all">All Priorities</SelectItem>
              <SelectItem value="High">High Priority</SelectItem>
              <SelectItem value="Medium">Medium Priority</SelectItem>
              <SelectItem value="Low">Low Priority</SelectItem>
            </SelectContent>
          </Select>

          {(search || selectedProjectFilter || priorityFilter !== "all" || statusFilter !== "all") && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setSearch("");
                setSelectedProjectFilter(null);
                setPriorityFilter("all");
                setStatusFilter("all");
              }}
              className="h-8 text-xs text-primary hover:bg-primary/10"
            >
              Reset Filters
            </Button>
          )}
        </div>

        <div className="flex items-center gap-1 bg-muted/40 border border-border p-0.5 rounded-lg">
          <Button
            size="sm"
            variant={viewMode === "table" ? "default" : "ghost"}
            onClick={() => setViewMode("table")}
            className={cn("h-7 text-xs px-2.5 gap-1.5 rounded-md", viewMode === "table" ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground")}
          >
            <Table className="h-3.5 w-3.5" /> Table
          </Button>
          <Button
            size="sm"
            variant={viewMode === "grid" ? "default" : "ghost"}
            onClick={() => setViewMode("grid")}
            className={cn("h-7 text-xs px-2.5 gap-1.5 rounded-md", viewMode === "grid" ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground")}
          >
            <Grid className="h-3.5 w-3.5" /> Grid
          </Button>
        </div>
      </div>

      {/* Main Content Area */}
      {viewMode === "table" ? (
        <div className="bg-card border border-border rounded-xl overflow-hidden shadow-xs mb-6 flex-1">
          <div className="max-h-[62vh] overflow-y-auto overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur-xs z-10">
                <tr className="border-b border-border text-muted-foreground uppercase tracking-wider text-[11px]">
                  <th className="py-3 px-3.5 font-semibold">Code</th>
                  <th className="py-3 px-3.5 font-semibold">Task Name & Details</th>
                  <th className="py-3 px-3.5 font-semibold">Age</th>
                  <th className="py-3 px-3.5 font-semibold">Status</th>
                  <th className="py-3 px-3.5 font-semibold">Assigned Member</th>
                  <th className="py-3 px-3.5 font-semibold">Project</th>
                  <th className="py-3 px-3.5 font-semibold">Priority</th>
                  <th className="py-3 px-3.5 font-semibold">Logged / Plan</th>
                  <th className="py-3 px-3.5 font-semibold">Due Date</th>
                  <th className="py-3 px-3.5 font-semibold">Blocker / Remarks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredTasks.map((t) => {
                  const profile = t.assigned_to ? profilesMap.get(t.assigned_to) : null;
                  const ageDays = Math.floor((Date.now() - new Date(t.created_at).getTime()) / 86400000);
                  return (
                    <tr
                      key={t.id}
                      onClick={() => setInspectedTask(t)}
                      className="hover:bg-muted/40 transition-colors cursor-pointer group/row"
                      title="Click to inspect task details"
                    >
                      <td className="py-3 px-3.5 font-mono font-bold text-primary">
                        {t.task_code}
                      </td>
                      <td className="py-3 px-3.5 font-medium text-foreground max-w-xs">
                        <div className="font-semibold text-foreground group-hover/row:text-primary transition-colors">{t.task_name}</div>
                        {t.remarks && <div className="text-[11px] text-muted-foreground truncate mt-0.5">{t.remarks}</div>}
                      </td>
                      <td className="py-3 px-3.5">
                        <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30 text-[10px] font-mono font-bold">
                          {ageDays}d old
                        </Badge>
                      </td>
                      <td className="py-3 px-3.5">
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px] px-1.5 py-0 font-medium",
                            t.status === "Blocked"
                              ? "bg-rose-500/10 text-rose-400 border-rose-500/30"
                              : t.status === "In Progress"
                              ? "bg-blue-500/10 text-blue-400 border-blue-500/30"
                              : "bg-amber-500/10 text-amber-400 border-amber-500/30"
                          )}
                        >
                          {t.status}
                        </Badge>
                      </td>
                      <td className="py-3 px-3.5">
                        {profile ? (
                          <div
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectMember(profile.id);
                            }}
                            className="flex items-center gap-2 cursor-pointer group/m hover:text-primary transition-colors"
                          >
                            <Avatar className="h-6 w-6 border border-border">
                              {profile.avatar_url ? (
                                <AvatarImage src={profile.avatar_url} alt={profile.display_name} />
                              ) : (
                                <AvatarFallback className="bg-primary/20 text-foreground text-[10px] font-bold">
                                  {profile.display_name.slice(0, 2).toUpperCase()}
                                </AvatarFallback>
                              )}
                            </Avatar>
                            <span className="font-medium text-foreground group-hover/m:underline">
                              {profile.display_name}
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground italic">Unassigned</span>
                        )}
                      </td>
                      <td className="py-3 px-3.5 text-muted-foreground">
                        {t.project_name || "General Workspace"}
                      </td>
                      <td className="py-3 px-3.5">
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px] px-1.5 py-0 font-medium",
                            t.priority === "High"
                              ? "bg-rose-500/10 text-rose-400 border-rose-500/30"
                              : t.priority === "Medium"
                              ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                              : "bg-muted text-muted-foreground border-border"
                          )}
                        >
                          {t.priority}
                        </Badge>
                      </td>
                      <td className="py-3 px-3.5 font-mono text-[11px]">
                        <span className="text-emerald-400 font-bold">{t.actual_hours ?? 0}h</span>
                        <span className="text-muted-foreground"> / {t.planned_hours ?? 0}h</span>
                      </td>
                      <td className="py-3 px-3.5 text-muted-foreground font-mono text-[11px]">
                        {t.due_date ? new Date(t.due_date).toLocaleDateString() : "—"}
                      </td>
                      <td className="py-3 px-3.5 max-w-xs">
                        {t.status === "Blocked" && t.blocker_reason ? (
                          <span className="bg-rose-500/10 text-rose-400 border border-rose-500/30 px-2 py-0.5 rounded text-[11px] font-medium block">
                            🚨 {t.blocker_reason}
                          </span>
                        ) : (
                          <span className="text-muted-foreground truncate block">{t.remarks || "—"}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {filteredTasks.length === 0 && (
                  <tr>
                    <td colSpan={10} className="py-12 text-center text-muted-foreground text-xs italic">
                      No open tasks found matching your search or filters in age bucket {bucket}.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 mb-6 flex-1">
          {filteredTasks.map((t) => {
            const profile = t.assigned_to ? profilesMap.get(t.assigned_to) : null;
            const ageDays = Math.floor((Date.now() - new Date(t.created_at).getTime()) / 86400000);
            return (
              <div
                key={t.id}
                onClick={() => setInspectedTask(t)}
                className="bg-card border border-border hover:border-primary/50 rounded-xl p-4 space-y-3 shadow-xs hover:shadow-md transition-all flex flex-col justify-between cursor-pointer group/card"
              >
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-primary font-bold text-xs px-2 py-0.5 bg-primary/10 rounded-md border border-primary/20">
                      {t.task_code}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30 text-[10px] font-mono font-bold">
                        {ageDays}d old
                      </Badge>
                      <Badge
                        className={cn(
                          "text-[10px] px-2 py-0.5 font-semibold",
                          t.status === "Blocked"
                            ? "bg-rose-500/20 text-rose-400 border-rose-500/40"
                            : t.status === "In Progress"
                            ? "bg-blue-500/20 text-blue-400 border-blue-500/40"
                            : "bg-amber-500/20 text-amber-400 border-amber-500/40"
                        )}
                      >
                        {t.status}
                      </Badge>
                    </div>
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm text-foreground group-hover/card:text-primary transition-colors">{t.task_name}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">{t.project_name || "General Workspace"}</p>
                  </div>
                  {t.status === "Blocked" && t.blocker_reason && (
                    <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg p-2.5 text-xs text-rose-400 space-y-0.5">
                      <div className="font-bold flex items-center gap-1.5">
                        <AlertOctagon className="h-3.5 w-3.5 shrink-0" /> Blocker Reason:
                      </div>
                      <p>{t.blocker_reason}</p>
                    </div>
                  )}
                </div>

                <div className="pt-2.5 border-t border-border flex items-center justify-between text-xs">
                  {profile ? (
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectMember(profile.id);
                      }}
                      className="flex items-center gap-2 cursor-pointer group/m hover:text-primary"
                    >
                      <Avatar className="h-6 w-6 border border-border">
                        {profile.avatar_url ? (
                          <AvatarImage src={profile.avatar_url} alt={profile.display_name} />
                        ) : (
                          <AvatarFallback className="bg-primary/20 text-foreground text-[10px] font-bold">
                            {profile.display_name.slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        )}
                      </Avatar>
                      <span className="font-medium text-foreground group-hover/m:underline">
                        {profile.display_name}
                      </span>
                    </div>
                  ) : (
                    <span className="text-muted-foreground italic">Unassigned</span>
                  )}
                  <div className="text-right font-mono text-[11px]">
                    <div className="font-bold text-foreground">{t.actual_hours ?? 0}h / {t.planned_hours ?? 0}h</div>
                    <div className="text-[10px] text-muted-foreground">Logged / Plan</div>
                  </div>
                </div>
              </div>
            );
          })}
          {filteredTasks.length === 0 && (
            <div className="col-span-full py-12 text-center text-muted-foreground text-xs italic">
              No open tasks found matching your search or filters under age bucket {bucket}.
            </div>
          )}
        </div>
      )}

      {/* Task Detail Modal */}
      {inspectedTask && (
        <TaskDetailModal
          task={inspectedTask}
          open={!!inspectedTask}
          onOpenChange={(open) => {
            if (!open) setInspectedTask(null);
          }}
          assignedProfile={inspectedTask.assigned_to ? profilesMap.get(inspectedTask.assigned_to) : null}
        />
      )}
    </div>
  );
}
