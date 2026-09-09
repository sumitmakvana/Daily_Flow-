import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
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
  Clock,
  Download,
  Search,
  Users,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  Filter,
  BarChart2,
  List,
  Briefcase,
  Layers,
  FileSpreadsheet,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import type { Task, Profile, Project } from "@/lib/types";
import { formatHoursMins } from "@/lib/format";
import { TaskHoursBadges } from "@/components/TaskHoursBadges";
import { StatusBadge } from "@/components/StatusBadge";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/time-tracking")({
  component: TimeTrackingPage,
});

function TimeTrackingPage() {
  const { user, isManager } = useAuth();
  const [datePreset, setDatePreset] = useState<"today" | "yesterday" | "week" | "7d" | "month" | "all">("7d");
  const [memberFilter, setMemberFilter] = useState<string>("all");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [search, setSearch] = useState<string>("");
  const [activeViewTab, setActiveViewTab] = useState<"timesheet" | "analytics">("timesheet");

  // 1. Fetch profiles
  const { data: profiles = [] } = useQuery({
    queryKey: ["time-tracking-profiles"],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url");
      return (data ?? []) as Profile[];
    },
    staleTime: 30000,
  });

  // 2. Fetch projects
  const { data: projects = [] } = useQuery({
    queryKey: ["time-tracking-projects"],
    queryFn: async () => {
      const { data } = await supabase.from("projects").select("id, name, client");
      return (data ?? []) as Project[];
    },
    staleTime: 30000,
  });

  // 3. Fetch tasks & task_worklogs
  const { data: { tasks = [], worklogs = [] } = {} } = useQuery({
    queryKey: ["time-tracking-data"],
    queryFn: async () => {
      const [{ data: rawTasks }, { data: worklogsData }] = await Promise.all([
        supabase.from("tasks").select("*").order("created_at", { ascending: false }),
        supabase.from("task_worklogs").select("*").order("work_date", { ascending: false }),
      ]);

      const worklogsByTask = new Map<string, any[]>();
      const todayStr = new Date().toISOString().slice(0, 10);

      for (const w of worklogsData || []) {
        const list = worklogsByTask.get(w.task_id) || [];
        list.push(w);
        worklogsByTask.set(w.task_id, list);
      }

      const enrichedTasks = ((rawTasks ?? []) as Task[]).map((t) => {
        const logs = worklogsByTask.get(t.id) || [];
        const todayLogs = logs.filter((w) => w.work_date === todayStr);
        const todaySys = todayLogs.reduce((sum, w) => sum + Number(w.system_hours || 0), 0);
        return {
          ...t,
          today_system_hours: todaySys,
          worklogs: logs,
        };
      });

      return { tasks: enrichedTasks, worklogs: worklogsData || [] };
    },
    staleTime: 10000,
  });

  const profileById = useMemo(() => {
    const map = new Map<string, Profile>();
    for (const p of profiles) map.set(p.id, p);
    return map;
  }, [profiles]);

  // Filter Date Range Calculation
  const dateBounds = useMemo(() => {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);

    let start = "";
    let end = todayStr;

    if (datePreset === "today") {
      start = todayStr;
    } else if (datePreset === "yesterday") {
      start = yesterdayStr;
      end = yesterdayStr;
    } else if (datePreset === "7d") {
      const d = new Date(now);
      d.setDate(now.getDate() - 6);
      start = d.toISOString().slice(0, 10);
    } else if (datePreset === "week") {
      const d = new Date(now);
      const dayOfWeek = d.getDay();
      const diff = d.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
      d.setDate(diff);
      start = d.toISOString().slice(0, 10);
    } else if (datePreset === "month") {
      const d = new Date(now.getFullYear(), now.getMonth(), 1);
      start = d.toISOString().slice(0, 10);
    }

    return { start, end };
  }, [datePreset]);

  // Filter Tasks & Worklogs
  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (memberFilter !== "all" && t.assigned_to !== memberFilter) return false;
      if (projectFilter !== "all" && t.project_name !== projectFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const code = (t.task_code || "").toLowerCase();
        const name = (t.task_name || "").toLowerCase();
        const proj = (t.project_name || "").toLowerCase();
        const member = profileById.get(t.assigned_to || "")?.display_name.toLowerCase() || "";
        if (!code.includes(q) && !name.includes(q) && !proj.includes(q) && !member.includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [tasks, memberFilter, projectFilter, search, profileById]);

  // Filtered Daily Worklog Rows
  const filteredWorklogRows = useMemo(() => {
    const taskMap = new Map(filteredTasks.map((t) => [t.id, t]));
    return worklogs
      .filter((w) => {
        if (!taskMap.has(w.task_id)) return false;
        if (dateBounds.start && w.work_date < dateBounds.start) return false;
        if (dateBounds.end && w.work_date > dateBounds.end) return false;
        return true;
      })
      .map((w) => {
        const t = taskMap.get(w.task_id)!;
        const profile = profileById.get(w.user_id) || profileById.get(t.assigned_to || "");
        return {
          ...w,
          task_code: t.task_code,
          task_name: t.task_name,
          project_name: t.project_name,
          planned_hours: t.planned_hours,
          status: t.status,
          user_name: profile?.display_name || "Unassigned",
          avatar_url: profile?.avatar_url,
          task: t,
        };
      });
  }, [worklogs, filteredTasks, dateBounds, profileById]);

  // Summary KPI Calculations
  const metrics = useMemo(() => {
    let totalPlanned = 0;
    let totalActual = 0;
    let totalAuto = 0;
    let overrunCount = 0;
    let gapCount = 0;

    for (const t of filteredTasks) {
      const plan = Number(t.planned_hours ?? 0);
      const logged = Number(t.actual_hours ?? 0);
      const baseSys = Number(t.system_hours ?? 0);
      const runningSys = t.started_at
        ? Math.min(8.0, Math.max(0, (Date.now() - new Date(t.started_at).getTime()) / 3600000))
        : 0;
      const sysHrs = baseSys + runningSys;

      totalPlanned += plan;
      totalActual += logged;
      totalAuto += sysHrs;

      if ((t.status === "In Progress" && sysHrs >= 8.0) || (plan > 0 && sysHrs > plan)) {
        overrunCount++;
      }
      if (
        (t.status === "Completed" && logged === 0 && sysHrs >= 1.0) ||
        (logged > 0 && sysHrs > 0 && Math.abs(sysHrs - logged) >= 1.5)
      ) {
        gapCount++;
      }
    }

    return { totalPlanned, totalActual, totalAuto, overrunCount, gapCount };
  }, [filteredTasks]);

  // Recharts Daily Distribution Data
  const dailyChartData = useMemo(() => {
    const map = new Map<string, { date: string; autoHours: number; loggedHours: number }>();
    for (const row of filteredWorklogRows) {
      const existing = map.get(row.work_date) || { date: row.work_date, autoHours: 0, loggedHours: 0 };
      existing.autoHours += Number(row.system_hours || 0);
      existing.loggedHours += Number(row.logged_hours || 0);
      map.set(row.work_date, existing);
    }
    return Array.from(map.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-14);
  }, [filteredWorklogRows]);

  // CSV Export Function
  const handleExportCSV = () => {
    const headers = ["Work Date", "Task Code", "Task Name", "Team Member", "Project", "Auto Timer (h)", "Logged (h)", "Planned (h)", "Status"];
    const rows = filteredWorklogRows.map((r) => [
      r.work_date,
      r.task_code || "",
      `"${(r.task_name || "").replace(/"/g, '""')}"`,
      `"${r.user_name}"`,
      `"${r.project_name || ""}"`,
      Number(r.system_hours || 0).toFixed(2),
      Number(r.logged_hours || 0).toFixed(2),
      Number(r.planned_hours || 0).toFixed(2),
      r.status || "",
    ]);

    const csvContent = [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `time-tracking-worklogs-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-[1600px] mx-auto min-h-screen text-foreground">
      {/* Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border/60 pb-4">
        <div>
          <h1 className="text-lg font-bold tracking-tight text-foreground flex items-center gap-2">
            <Clock className="h-5 w-5 text-amber-400" /> Time Tracking & Worklogs
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Operational auto-timer metrics, daily worklog breakdowns, and plan vs actual insights.
          </p>
        </div>

        {/* Filter Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <Select value={datePreset} onValueChange={(v: any) => setDatePreset(v)}>
            <SelectTrigger className="h-8 text-xs bg-card border-border/80 w-36">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground mr-1.5" />
              <SelectValue placeholder="Date Range" />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="yesterday">Yesterday</SelectItem>
              <SelectItem value="7d">Last 7 Days</SelectItem>
              <SelectItem value="week">This Week</SelectItem>
              <SelectItem value="month">This Month</SelectItem>
              <SelectItem value="all">All Time</SelectItem>
            </SelectContent>
          </Select>

          {isManager && (
            <Select value={memberFilter} onValueChange={setMemberFilter}>
              <SelectTrigger className="h-8 text-xs bg-card border-border/80 w-40">
                <Users className="h-3.5 w-3.5 text-muted-foreground mr-1.5" />
                <SelectValue placeholder="All Members" />
              </SelectTrigger>
              <SelectContent className="bg-popover border-border max-h-64">
                <SelectItem value="all">All Team Members</SelectItem>
                {profiles.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.display_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Select value={projectFilter} onValueChange={setProjectFilter}>
            <SelectTrigger className="h-8 text-xs bg-card border-border/80 w-40">
              <Briefcase className="h-3.5 w-3.5 text-muted-foreground mr-1.5" />
              <SelectValue placeholder="All Projects" />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border max-h-64">
              <SelectItem value="all">All Projects</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.name}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCSV}
            className="h-8 text-xs gap-1.5 border-border bg-card hover:bg-accent text-foreground"
          >
            <Download className="h-3.5 w-3.5 text-amber-400" /> Export CSV
          </Button>
        </div>
      </div>

      {/* Top 4 KPI Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <Card className="p-3.5 bg-card border-border/60 space-y-1 shadow-sm">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="font-medium">Auto-Tracked Timer</span>
            <Clock className="h-4 w-4 text-amber-400" />
          </div>
          <div className="text-xl font-bold font-mono text-foreground tracking-tight">
            {formatHoursMins(metrics.totalAuto)}
          </div>
          <div className="text-[11px] text-muted-foreground/80">Total system timer for filtered tasks</div>
        </Card>

        <Card className="p-3.5 bg-card border-border/60 space-y-1 shadow-sm">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="font-medium">User Logged Hours</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="text-xl font-bold font-mono text-emerald-400 tracking-tight">
            {formatHoursMins(metrics.totalActual)}
          </div>
          <div className="text-[11px] text-muted-foreground/80">User submitted EOD & actual hours</div>
        </Card>

        <Card className="p-3.5 bg-card border-border/60 space-y-1 shadow-sm">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="font-medium">Planned Target Hours</span>
            <Layers className="h-4 w-4 text-indigo-400" />
          </div>
          <div className="text-xl font-bold font-mono text-indigo-400 tracking-tight">
            {formatHoursMins(metrics.totalPlanned)}
          </div>
          <div className="text-[11px] text-muted-foreground/80">Target estimated workload plan</div>
        </Card>

        <Card className="p-3.5 bg-card border-border/60 space-y-1 shadow-sm">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="font-medium">Overrun & Gap Alerts</span>
            <AlertTriangle className="h-4 w-4 text-rose-400" />
          </div>
          <div className="text-xl font-bold font-mono text-rose-400 tracking-tight">
            {metrics.overrunCount + metrics.gapCount} <span className="text-xs font-normal text-muted-foreground">tasks</span>
          </div>
          <div className="text-[11px] text-muted-foreground/80">
            {metrics.overrunCount} overruns • {metrics.gapCount} timer gaps
          </div>
        </Card>
      </div>

      {/* Main Content Area: View Toggle & Search */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-card p-2 rounded-lg border border-border/60">
          <div className="flex items-center gap-1 bg-muted/40 p-1 rounded-md border border-border/40">
            <button
              type="button"
              onClick={() => setActiveViewTab("timesheet")}
              className={cn(
                "px-3 py-1 text-xs font-medium rounded transition-colors flex items-center gap-1.5 cursor-pointer",
                activeViewTab === "timesheet"
                  ? "bg-background text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <List className="h-3.5 w-3.5" /> Detailed Timesheet ({filteredWorklogRows.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveViewTab("analytics")}
              className={cn(
                "px-3 py-1 text-xs font-medium rounded transition-colors flex items-center gap-1.5 cursor-pointer",
                activeViewTab === "analytics"
                  ? "bg-background text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <BarChart2 className="h-3.5 w-3.5" /> Daily Analytics Chart
            </button>
          </div>

          {/* Search Bar */}
          <div className="relative w-full sm:w-72">
            <Search className="h-3.5 w-3.5 text-muted-foreground absolute left-2.5 top-2.5" />
            <Input
              type="text"
              placeholder="Search code, task, member..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 text-xs pl-8 bg-background border-border text-foreground placeholder:text-muted-foreground/60 focus-visible:ring-1 focus-visible:ring-primary"
            />
          </div>
        </div>

        {/* Tab 1: Detailed Timesheet Table (Jira-Style) */}
        {activeViewTab === "timesheet" && (
          <Card className="bg-card border-border/60 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-border/60 bg-muted/30 text-muted-foreground font-semibold text-[11px]">
                    <th className="p-3">Work Date</th>
                    <th className="p-3">Task Details</th>
                    <th className="p-3">Team Member</th>
                    <th className="p-3">Project</th>
                    <th className="p-3 text-right">Auto Timer</th>
                    <th className="p-3 text-right">Logged</th>
                    <th className="p-3 text-right">Plan Target</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Timer Badges</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {filteredWorklogRows.map((row) => (
                    <tr key={row.id} className="hover:bg-accent/20 transition-colors">
                      <td className="p-3 font-mono text-[11px] text-muted-foreground whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <Calendar className="h-3 w-3 text-amber-400/80" />
                          <span>{row.work_date}</span>
                        </div>
                      </td>
                      <td className="p-3 max-w-xs truncate">
                        <div className="flex items-center gap-1.5">
                          {row.task_code && (
                            <span className="font-mono text-[10px] font-bold text-primary shrink-0">
                              {row.task_code}
                            </span>
                          )}
                          <span className="font-medium text-foreground truncate" title={row.task_name}>
                            {row.task_name}
                          </span>
                        </div>
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <Avatar className="h-5 w-5 border border-border/40">
                            <AvatarImage src={row.avatar_url} />
                            <AvatarFallback className="bg-muted text-[8px]">
                              {row.user_name.slice(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <span className="text-foreground font-medium">{row.user_name}</span>
                        </div>
                      </td>
                      <td className="p-3 text-muted-foreground font-mono text-[11px] whitespace-nowrap">
                        {row.project_name || "—"}
                      </td>
                      <td className="p-3 text-right font-mono font-semibold text-amber-400 whitespace-nowrap">
                        {formatHoursMins(Number(row.system_hours || 0))}
                      </td>
                      <td className="p-3 text-right font-mono font-semibold text-emerald-400 whitespace-nowrap">
                        {formatHoursMins(Number(row.logged_hours || 0))}
                      </td>
                      <td className="p-3 text-right font-mono text-muted-foreground whitespace-nowrap">
                        {formatHoursMins(Number(row.planned_hours || 0))}
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        <StatusBadge status={row.status} />
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        <TaskHoursBadges task={row.task} className="text-[10px]" />
                      </td>
                    </tr>
                  ))}
                  {filteredWorklogRows.length === 0 && (
                    <tr>
                      <td colSpan={9} className="p-8 text-center text-muted-foreground text-xs italic">
                        No worklog records found for the selected date range and filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* Tab 2: Recharts Visual Daily Analytics */}
        {activeViewTab === "analytics" && (
          <Card className="p-4 bg-card border-border/60 space-y-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-foreground flex items-center gap-2">
                <BarChart2 className="h-4 w-4 text-amber-400" /> Daily Worklog Time Distribution
              </h3>
              <span className="text-[11px] text-muted-foreground font-mono">Last 14 Active Days</span>
            </div>

            <div className="h-80 w-full pt-2">
              {dailyChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dailyChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                    <XAxis dataKey="date" stroke="#888" fontSize={11} />
                    <YAxis stroke="#888" fontSize={11} unit="h" />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "oklch(0.21 0.014 264)",
                        borderColor: "rgba(255,255,255,0.15)",
                        borderRadius: "8px",
                        fontSize: "12px",
                        color: "#fff",
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: "11px" }} />
                    <Bar dataKey="autoHours" name="Auto-Tracked Timer (h)" fill="#fbbf24" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="loggedHours" name="User Logged Hours (h)" fill="#34d399" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-xs text-muted-foreground italic">
                  No chart data available for selected filter options.
                </div>
              )}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
