import React, { useMemo, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  CheckCircle2,
  Clock,
  AlertOctagon,
  TrendingUp,
  Users,
  Calendar,
  AlertTriangle,
  Download,
  ListFilter,
  User,
  Filter,
  UserCheck,
} from "lucide-react";
import type { Task, Profile } from "@/lib/types";
import { generateEodHtmlReport } from "@/services/pdf-report.generator";
import { toast } from "sonner";

interface EodTeamTrendWidgetProps {
  tasks: Task[];
  profiles: Profile[];
}

const CustomBarTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    const completed = payload.find((p: any) => p.dataKey === "Completed")?.value || 0;
    const inProgress = payload.find((p: any) => p.dataKey === "InProgress")?.value || 0;
    const blocked = payload.find((p: any) => p.dataKey === "Blocked")?.value || 0;
    const pending = payload.find((p: any) => p.dataKey === "Pending")?.value || 0;
    const total = completed + inProgress + blocked + pending;

    return (
      <div className="bg-slate-900/95 border border-slate-700/80 rounded-xl p-3 text-xs shadow-2xl text-white backdrop-blur-md space-y-2 min-w-[170px]">
        <div className="font-bold text-sm text-indigo-300 flex items-center gap-1.5 border-b border-slate-700/60 pb-1.5">
          <User className="w-3.5 h-3.5 text-indigo-400" /> {label}
        </div>
        <div className="space-y-1 font-medium">
          <div className="flex items-center justify-between text-emerald-400">
            <span>✅ Completed:</span> <span className="font-bold">{completed}</span>
          </div>
          <div className="flex items-center justify-between text-blue-400">
            <span>⏳ In Progress:</span> <span className="font-bold">{inProgress}</span>
          </div>
          <div className="flex items-center justify-between text-rose-400">
            <span>🚨 Blocked:</span> <span className="font-bold">{blocked}</span>
          </div>
          <div className="flex items-center justify-between text-amber-400">
            <span>📌 Pending:</span> <span className="font-bold">{pending}</span>
          </div>
        </div>
        <div className="border-t border-slate-700/60 pt-1.5 flex items-center justify-between text-[11px] text-slate-300 font-semibold">
          <span>Total Assigned:</span> <span className="text-white font-bold">{total}</span>
        </div>
      </div>
    );
  }
  return null;
};

const CustomLineTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    const val = payload[0]?.value || 0;
    return (
      <div className="bg-slate-900/95 border border-emerald-500/40 rounded-xl p-3 text-xs shadow-2xl text-white backdrop-blur-md space-y-1.5 min-w-[150px]">
        <div className="font-bold text-slate-300 border-b border-slate-700/60 pb-1 flex items-center gap-1.5">
          <Calendar className="w-3.5 h-3.5 text-emerald-400" /> {label}
        </div>
        <div className="flex items-center justify-between gap-3 text-emerald-400 font-bold pt-0.5">
          <span>Tasks Completed:</span> <span className="text-sm font-extrabold">{val}</span>
        </div>
      </div>
    );
  }
  return null;
};

export function EodTeamTrendWidget({ tasks, profiles }: EodTeamTrendWidgetProps) {
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [statusFilter, setStatusFilter] = useState<
    "all" | "Completed" | "In Progress" | "Blocked" | "Pending"
  >("all");
  const [memberFilter, setMemberFilter] = useState<string>("all");

  const profileMap = useMemo(
    () => new Map(profiles.map((p) => [p.id, p.display_name || "Unassigned"])),
    [profiles],
  );

  // 1. Calculate KPI Metrics
  const todayTasks = useMemo(() => {
    return tasks.filter((t) => {
      const isCompletedToday = t.completed_at && t.completed_at.slice(0, 10) === todayStr;
      const isDueTodayOrPast = !t.due_date || t.due_date.slice(0, 10) <= todayStr;
      return isCompletedToday || (t.status !== "Completed" && isDueTodayOrPast);
    });
  }, [tasks, todayStr]);

  const completedToday = useMemo(
    () => todayTasks.filter((t) => t.status === "Completed"),
    [todayTasks],
  );
  const inProgressToday = useMemo(
    () => todayTasks.filter((t) => t.status === "In Progress" || t.status === "In Review"),
    [todayTasks],
  );
  const blockedToday = useMemo(
    () => todayTasks.filter((t) => t.status === "Blocked" || t.status === "On Hold"),
    [todayTasks],
  );
  const pendingToday = useMemo(() => todayTasks.filter((t) => t.status === "To Do"), [todayTasks]);

  const totalToday = todayTasks.length;
  const completionPct = totalToday > 0 ? Math.round((completedToday.length / totalToday) * 100) : 0;

  // 2. Member-wise Stacked Bar Data
  const { memberChartData, memberDetailedList } = useMemo(() => {
    const countsMap = new Map<
      string,
      {
        userId: string;
        fullName: string;
        name: string;
        Completed: number;
        InProgress: number;
        Blocked: number;
        Pending: number;
        Total: number;
      }
    >();

    for (const t of todayTasks) {
      const uId = t.assigned_to || "unassigned";
      const uName = profileMap.get(uId) || (uId === "unassigned" ? "Unassigned" : "Team Member");

      const entry = countsMap.get(uId) || {
        userId: uId,
        fullName: uName,
        name: uName.split(" ")[0],
        Completed: 0,
        InProgress: 0,
        Blocked: 0,
        Pending: 0,
        Total: 0,
      };

      if (t.status === "Completed") entry.Completed += 1;
      else if (t.status === "In Progress" || t.status === "In Review") entry.InProgress += 1;
      else if (t.status === "Blocked" || t.status === "On Hold") entry.Blocked += 1;
      else entry.Pending += 1;

      entry.Total += 1;
      countsMap.set(uId, entry);
    }

    const list = Array.from(countsMap.values()).sort((a, b) => b.Total - a.Total);
    return { memberChartData: list, memberDetailedList: list };
  }, [todayTasks, profileMap]);

  // Filtered task inspection list (combining status filter & member filter)
  const filteredTasks = useMemo(() => {
    return todayTasks.filter((t) => {
      const matchesMember =
        memberFilter === "all" || (t.assigned_to || "unassigned") === memberFilter;

      let matchesStatus = true;
      if (statusFilter === "Completed") matchesStatus = t.status === "Completed";
      else if (statusFilter === "In Progress")
        matchesStatus = t.status === "In Progress" || t.status === "In Review";
      else if (statusFilter === "Blocked")
        matchesStatus = t.status === "Blocked" || t.status === "On Hold";
      else if (statusFilter === "Pending") matchesStatus = t.status === "To Do";

      return matchesMember && matchesStatus;
    });
  }, [todayTasks, statusFilter, memberFilter]);

  // 3. 7-Day Velocity Line Chart Data
  const velocityData = useMemo(() => {
    const days: { date: string; label: string; completed: number }[] = [];
    const now = new Date();

    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString(undefined, { weekday: "short" });

      const count = tasks.filter(
        (t) =>
          t.status === "Completed" && t.completed_at && t.completed_at.slice(0, 10) === dateStr,
      ).length;

      days.push({ date: dateStr, label, completed: count });
    }
    return days;
  }, [tasks]);

  // Handle PDF/HTML Download for Manager
  const handleDownloadPdf = () => {
    const memberSummaries = memberDetailedList.map((m) => ({
      name: m.fullName,
      completedCount: m.Completed,
      inProgressCount: m.InProgress,
      blockedCount: m.Blocked,
      pendingCount: m.Pending,
      tasks: [],
    }));

    const blockedAlerts = blockedToday.map((t) => ({
      code: t.task_code,
      name: t.task_name,
      memberName: profileMap.get(t.assigned_to || "") || "Unassigned",
      reason: t.blocker_reason || t.remarks || "No details provided",
    }));

    const htmlContent = generateEodHtmlReport({
      dateStr: todayStr,
      totalTasks: totalToday,
      completedTasks: completedToday.length,
      inProgressTasks: inProgressToday.length,
      blockedTasks: blockedToday.length,
      pendingTasks: pendingToday.length,
      completionRate: completionPct,
      memberSummaries,
      blockedAlerts,
    });

    const blob = new Blob([htmlContent], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Team_EOD_Report_${todayStr}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("EOD Team Status Report downloaded!");
  };

  return (
    <div className="space-y-4">
      {/* Header Banner */}
      <div className="flex items-center justify-between flex-wrap gap-3 p-4 rounded-xl bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white shadow-lg border border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <Badge className="bg-indigo-500/30 text-indigo-200 border-indigo-400/30 px-2.5 py-0.5 text-xs font-semibold">
              EOD Executive Analytics
            </Badge>
            <span className="text-xs text-slate-300">
              {new Date().toLocaleDateString(undefined, {
                weekday: "long",
                month: "short",
                day: "numeric",
              })}
            </span>
          </div>
          <h2 className="text-xl font-bold mt-1">Today's Team Status & Performance Trends</h2>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="text-right">
            <div className="text-2xl font-black text-emerald-400">{completionPct}%</div>
            <div className="text-[11px] text-slate-300 font-medium">Team Completion Rate</div>
          </div>
          <Button
            size="sm"
            onClick={handleDownloadPdf}
            className="bg-indigo-600 hover:bg-indigo-700 text-white gap-1.5 shadow-sm text-xs font-semibold"
          >
            <Download className="w-4 h-4" /> Download PDF/HTML Report
          </Button>
        </div>
      </div>

      {/* KPI Scorecard */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card
          onClick={() => setStatusFilter("Completed")}
          className="p-3.5 border-emerald-500/30 bg-emerald-500/5 cursor-pointer hover:border-emerald-500/60 transition-all shadow-xs"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">Completed Today</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">
            {completedToday.length}
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5 font-medium">
            {totalToday > 0 ? Math.round((completedToday.length / totalToday) * 100) : 0}% of
            planned tasks
          </p>
        </Card>

        <Card
          onClick={() => setStatusFilter("In Progress")}
          className="p-3.5 border-blue-500/30 bg-blue-500/5 cursor-pointer hover:border-blue-500/60 transition-all shadow-xs"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">In Progress</span>
            <Clock className="w-4 h-4 text-blue-500" />
          </div>
          <div className="text-2xl font-black text-blue-600 dark:text-blue-400 mt-1">
            {inProgressToday.length}
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5 font-medium">Active work items</p>
        </Card>

        <Card
          onClick={() => setStatusFilter("Blocked")}
          className="p-3.5 border-rose-500/30 bg-rose-500/5 cursor-pointer hover:border-rose-500/60 transition-all shadow-xs"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">Blocked / Stuck</span>
            <AlertOctagon className="w-4 h-4 text-rose-500" />
          </div>
          <div className="text-2xl font-black text-rose-600 dark:text-rose-400 mt-1">
            {blockedToday.length}
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5 font-medium">
            Requires manager help
          </p>
        </Card>

        <Card
          onClick={() => setStatusFilter("Pending")}
          className="p-3.5 border-amber-500/30 bg-amber-500/5 cursor-pointer hover:border-amber-500/60 transition-all shadow-xs"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">Pending Tasks</span>
            <Calendar className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-black text-amber-600 dark:text-amber-400 mt-1">
            {pendingToday.length}
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5 font-medium">Not started yet</p>
        </Card>
      </div>

      {/* Recharts Graphs Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Member Breakdown Stacked Bar Chart */}
        <Card className="p-4 border-slate-800/60 shadow-sm">
          <CardHeader className="p-0 pb-3">
            <CardTitle className="text-sm font-bold flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Users className="w-4 h-4 text-indigo-500" /> Member-wise Task Status
              </span>
              <span className="text-[11px] text-muted-foreground font-normal">
                Hover bars to inspect
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 h-64">
            {memberChartData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                No active task data for today
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={memberChartData}
                  margin={{ top: 10, right: 10, left: -20, bottom: 20 }}
                >
                  <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 10, fill: "#94a3b8" }}
                    interval={0}
                    angle={-15}
                    textAnchor="end"
                  />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "#94a3b8" }} />
                  <Tooltip
                    wrapperStyle={{ outline: "none" }}
                    content={<CustomBarTooltip />}
                    cursor={{ fill: "rgba(255,255,255,0.05)" }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: "10px" }} />
                  <Bar dataKey="Completed" stackId="a" fill="#10b981" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="InProgress" stackId="a" fill="#3b82f6" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="Blocked" stackId="a" fill="#f43f5e" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="Pending" stackId="a" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* 7-Day Velocity Line Chart */}
        <Card className="p-4 border-slate-800/60 shadow-sm">
          <CardHeader className="p-0 pb-3">
            <CardTitle className="text-sm font-bold flex items-center justify-between">
              <span className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-500" /> 7-Day Team Completion Trend
              </span>
              <span className="text-[11px] text-muted-foreground font-normal">Daily velocity</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={velocityData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#94a3b8" }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#94a3b8" }} />
                <Tooltip
                  wrapperStyle={{ outline: "none" }}
                  content={<CustomLineTooltip />}
                  cursor={{ stroke: "rgba(255,255,255,0.1)", strokeWidth: 1 }}
                />
                <Line
                  type="monotone"
                  dataKey="completed"
                  name="Tasks Completed"
                  stroke="#10b981"
                  strokeWidth={3}
                  dot={{ r: 4, fill: "#10b981", strokeWidth: 2, stroke: "#0f172a" }}
                  activeDot={{ r: 7, fill: "#34d399" }}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Member-wise Summary Table Card */}
      <Card className="p-4 space-y-3 border-indigo-500/20 bg-indigo-500/5 shadow-sm">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="text-sm font-bold flex items-center gap-2 text-foreground">
            <UserCheck className="w-4 h-4 text-indigo-500" /> Member-wise Performance Breakdown (
            {memberDetailedList.length} Members)
          </div>
          {memberFilter !== "all" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setMemberFilter("all")}
              className="text-xs h-7 border-indigo-500/40 text-indigo-400 hover:bg-indigo-500/10"
            >
              Clear Member Filter
            </Button>
          )}
        </div>

        <div className="border border-border/60 rounded-xl overflow-hidden bg-background/80 shadow-xs">
          <table className="w-full text-xs text-left">
            <thead className="bg-muted/70 text-muted-foreground uppercase text-[10px] font-extrabold border-b border-border/50">
              <tr>
                <th className="p-3">Team Member</th>
                <th className="p-3 text-center text-emerald-600 dark:text-emerald-400">
                  Completed
                </th>
                <th className="p-3 text-center text-blue-600 dark:text-blue-400">In Progress</th>
                <th className="p-3 text-center text-rose-600 dark:text-rose-400">Blocked</th>
                <th className="p-3 text-center text-amber-600 dark:text-amber-400">Pending</th>
                <th className="p-3 text-center font-bold">Total Work</th>
                <th className="p-3 text-right">Inspect Tasks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {memberDetailedList.map((m) => {
                const isSelected = memberFilter === m.userId;
                const memberPct = m.Total > 0 ? Math.round((m.Completed / m.Total) * 100) : 0;

                return (
                  <tr
                    key={m.userId}
                    className={`hover:bg-accent/40 transition-colors ${
                      isSelected ? "bg-indigo-500/15 font-semibold" : ""
                    }`}
                  >
                    <td className="p-3 font-medium">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold text-[11px] shrink-0 border border-indigo-500/30">
                          {m.fullName.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div className="font-semibold text-foreground">{m.fullName}</div>
                          <div className="w-20 bg-muted/60 h-1 rounded-full overflow-hidden mt-1">
                            <div
                              className="bg-emerald-500 h-full rounded-full"
                              style={{ width: `${memberPct}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="p-3 text-center">
                      <span
                        className={`px-2 py-0.5 rounded font-extrabold ${m.Completed > 0 ? "bg-emerald-500/20 text-emerald-500" : "text-muted-foreground/60"}`}
                      >
                        {m.Completed}
                      </span>
                    </td>
                    <td className="p-3 text-center">
                      <span
                        className={`px-2 py-0.5 rounded font-extrabold ${m.InProgress > 0 ? "bg-blue-500/20 text-blue-500" : "text-muted-foreground/60"}`}
                      >
                        {m.InProgress}
                      </span>
                    </td>
                    <td className="p-3 text-center">
                      <span
                        className={`px-2 py-0.5 rounded font-extrabold ${m.Blocked > 0 ? "bg-rose-500/20 text-rose-500" : "text-muted-foreground/60"}`}
                      >
                        {m.Blocked}
                      </span>
                    </td>
                    <td className="p-3 text-center">
                      <span
                        className={`px-2 py-0.5 rounded font-extrabold ${m.Pending > 0 ? "bg-amber-500/20 text-amber-500" : "text-muted-foreground/60"}`}
                      >
                        {m.Pending}
                      </span>
                    </td>
                    <td className="p-3 text-center font-black text-foreground">{m.Total}</td>
                    <td className="p-3 text-right">
                      <Button
                        size="sm"
                        variant={isSelected ? "default" : "outline"}
                        onClick={() => setMemberFilter(isSelected ? "all" : m.userId)}
                        className={`h-7 text-xs px-2.5 gap-1 font-semibold ${
                          isSelected
                            ? "bg-indigo-600 text-white"
                            : "border-border text-foreground hover:bg-accent"
                        }`}
                      >
                        <Filter className="w-3.5 h-3.5" /> {isSelected ? "Selected" : "Inspect"}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Executive Live Task Breakdown Cards Grid on Page UI */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Today's Completed Tasks */}
        <Card className="p-4 border-emerald-500/25 bg-emerald-500/5 space-y-3 shadow-xs">
          <div className="flex items-center justify-between font-bold text-sm text-emerald-600 dark:text-emerald-400">
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" /> Tasks Completed Today ({completedToday.length})
            </span>
            <Badge
              variant="outline"
              className="border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold"
            >
              Today
            </Badge>
          </div>
          <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1 text-xs">
            {completedToday.length === 0 ? (
              <div className="text-muted-foreground italic py-4 text-center">
                No completed tasks recorded yet today.
              </div>
            ) : (
              completedToday.map((t) => (
                <div
                  key={t.id}
                  className="p-2.5 rounded-lg bg-background border border-emerald-500/20 flex items-center justify-between gap-2 shadow-xs hover:border-emerald-500/40 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono font-bold text-emerald-600 bg-emerald-500/10 px-1.5 py-0.5 rounded text-[10px] shrink-0">
                      {t.task_code}
                    </span>
                    <span className="font-semibold text-foreground truncate">{t.task_name}</span>
                  </div>
                  <span className="text-muted-foreground shrink-0 text-[11px] font-medium flex items-center gap-1 bg-muted/60 px-2 py-0.5 rounded">
                    <User className="w-3 h-3 text-emerald-500" />{" "}
                    {profileMap.get(t.assigned_to || "") || "Unassigned"}
                  </span>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* Today's Active In Progress Work */}
        <Card className="p-4 border-blue-500/25 bg-blue-500/5 space-y-3 shadow-xs">
          <div className="flex items-center justify-between font-bold text-sm text-blue-600 dark:text-blue-400">
            <span className="flex items-center gap-1.5">
              <Clock className="w-4 h-4" /> Active In-Progress Tasks ({inProgressToday.length})
            </span>
            <Badge
              variant="outline"
              className="border-blue-500/30 text-blue-600 dark:text-blue-400 text-[10px] font-bold"
            >
              Active Work
            </Badge>
          </div>
          <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1 text-xs">
            {inProgressToday.length === 0 ? (
              <div className="text-muted-foreground italic py-4 text-center">
                No active in-progress tasks today.
              </div>
            ) : (
              inProgressToday.map((t) => (
                <div
                  key={t.id}
                  className="p-2.5 rounded-lg bg-background border border-blue-500/20 flex items-center justify-between gap-2 shadow-xs hover:border-blue-500/40 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono font-bold text-blue-600 bg-blue-500/10 px-1.5 py-0.5 rounded text-[10px] shrink-0">
                      {t.task_code}
                    </span>
                    <span className="font-semibold text-foreground truncate">{t.task_name}</span>
                  </div>
                  <span className="text-muted-foreground shrink-0 text-[11px] font-medium flex items-center gap-1 bg-muted/60 px-2 py-0.5 rounded">
                    <User className="w-3 h-3 text-blue-500" />{" "}
                    {profileMap.get(t.assigned_to || "") || "Unassigned"}
                  </span>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      {/* Interactive Task Inspection Drawer with Filter Tabs */}
      <Card className="p-4 space-y-3 border-slate-800 shadow-sm">
        <div className="flex items-center justify-between flex-wrap gap-2 pb-3 border-b border-border/50">
          <div className="text-sm font-bold flex items-center gap-2 text-foreground">
            <ListFilter className="w-4 h-4 text-indigo-500" /> Interactive Task Inspection List (
            {filteredTasks.length})
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Member Select Filter */}
            <select
              value={memberFilter}
              onChange={(e) => setMemberFilter(e.target.value)}
              className="bg-background border border-indigo-500/40 text-foreground text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-semibold"
            >
              <option value="all">👥 All Team Members ({memberDetailedList.length})</option>
              {memberDetailedList.map((m) => (
                <option key={m.userId} value={m.userId}>
                  👤 {m.fullName} ({m.Total} tasks)
                </option>
              ))}
            </select>

            {/* Status Filter Buttons */}
            <div className="flex items-center gap-1 flex-wrap">
              <Button
                size="sm"
                variant={statusFilter === "all" ? "default" : "outline"}
                onClick={() => setStatusFilter("all")}
                className="text-xs h-7 px-2.5 font-semibold"
              >
                All ({todayTasks.length})
              </Button>
              <Button
                size="sm"
                variant={statusFilter === "Completed" ? "default" : "outline"}
                onClick={() => setStatusFilter("Completed")}
                className="text-xs h-7 px-2.5 text-emerald-600 dark:text-emerald-400 font-semibold"
              >
                Completed ({completedToday.length})
              </Button>
              <Button
                size="sm"
                variant={statusFilter === "In Progress" ? "default" : "outline"}
                onClick={() => setStatusFilter("In Progress")}
                className="text-xs h-7 px-2.5 text-blue-600 dark:text-blue-400 font-semibold"
              >
                In Progress ({inProgressToday.length})
              </Button>
              <Button
                size="sm"
                variant={statusFilter === "Blocked" ? "default" : "outline"}
                onClick={() => setStatusFilter("Blocked")}
                className="text-xs h-7 px-2.5 text-rose-600 dark:text-rose-400 font-semibold"
              >
                Blocked ({blockedToday.length})
              </Button>
              <Button
                size="sm"
                variant={statusFilter === "Pending" ? "default" : "outline"}
                onClick={() => setStatusFilter("Pending")}
                className="text-xs h-7 px-2.5 text-amber-600 dark:text-amber-400 font-semibold"
              >
                Pending ({pendingToday.length})
              </Button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 max-h-96 overflow-y-auto pr-1">
          {filteredTasks.length === 0 ? (
            <div className="col-span-2 text-center py-8 text-xs text-muted-foreground italic">
              No tasks found matching the selected member and status filter.
            </div>
          ) : (
            filteredTasks.map((t) => {
              const uName = profileMap.get(t.assigned_to || "") || "Unassigned";
              const isBlocked = t.status === "Blocked" || t.status === "On Hold";
              const isDone = t.status === "Completed";
              const isInProgress = t.status === "In Progress" || t.status === "In Review";

              return (
                <div
                  key={t.id}
                  className={`p-3 rounded-xl border text-xs flex flex-col justify-between space-y-2 transition-all ${
                    isBlocked
                      ? "bg-rose-500/10 border-rose-500/40"
                      : isDone
                        ? "bg-emerald-500/10 border-emerald-500/40"
                        : isInProgress
                          ? "bg-blue-500/10 border-blue-500/40"
                          : "bg-background border-border hover:border-border/80"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-mono font-bold px-1.5 py-0.5 rounded text-[10px] bg-muted shrink-0">
                        {t.task_code}
                      </span>
                      <span className="font-bold text-foreground truncate">{t.task_name}</span>
                    </div>
                    <Badge
                      variant={isDone ? "default" : isBlocked ? "destructive" : "secondary"}
                      className="text-[10px] h-5 px-2 shrink-0 font-bold"
                    >
                      {t.status}
                    </Badge>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1 border-t border-border/30">
                    <span className="flex items-center gap-1 font-semibold text-foreground">
                      <User className="w-3 h-3 text-indigo-400" /> {uName}
                    </span>
                    {isBlocked && (
                      <span className="text-rose-500 font-bold truncate max-w-[220px]">
                        ⚠️ {t.blocker_reason || t.remarks || "Stuck"}
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </Card>

      {/* Blocked / Stuck Alert Banner */}
      {blockedToday.length > 0 && (
        <Card className="p-4 border-rose-500/40 bg-rose-500/10 shadow-sm">
          <div className="flex items-center gap-2 font-bold text-rose-600 dark:text-rose-400 text-sm">
            <AlertTriangle className="w-4 h-4" /> Blocked Tasks Requiring Manager Attention (
            {blockedToday.length})
          </div>
          <div className="mt-2.5 space-y-2 text-xs">
            {blockedToday.map((t) => {
              const uName = profileMap.get(t.assigned_to || "") || "Unassigned";
              return (
                <div
                  key={t.id}
                  className="flex items-center justify-between p-2.5 rounded-lg bg-background border border-rose-500/30 shadow-xs"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono font-bold text-rose-600 bg-rose-500/10 px-1.5 py-0.5 rounded text-[10px]">
                      {t.task_code}
                    </span>
                    <span className="font-semibold truncate text-foreground">{t.task_name}</span>
                    <span className="text-muted-foreground font-medium">({uName})</span>
                  </div>
                  <div className="text-rose-500 font-bold truncate ml-2 text-[11px]">
                    ⚠️ {t.blocker_reason || t.remarks || "No blocker details provided"}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
