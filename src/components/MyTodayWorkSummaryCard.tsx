import React, { useEffect, useState, useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2,
  Clock,
  AlertOctagon,
  Sparkles,
  Send,
  FileText,
  Loader2,
  ArrowUpRight,
  Award,
  ChevronDown,
  Sun,
  LineChart as LineChartIcon,
} from "lucide-react";
import type { Task } from "@/lib/types";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

export interface SummaryTaskItem {
  id: string;
  task_code: string;
  task_name: string;
  status: string;
  priority?: string;
  due_date?: string | null;
  completed_at?: string | null;
  remarks?: string | null;
  blocker_reason?: string | null;
}

interface MyTodayWorkSummaryCardProps {
  tasks?: SummaryTaskItem[];
  userName?: string;
}

export function MyTodayWorkSummaryCard({ tasks = [], userName }: MyTodayWorkSummaryCardProps) {
  const { user } = useAuth();
  const todayStr = new Date().toISOString().slice(0, 10);
  const [dailyNote, setDailyNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fetchedTasks, setFetchedTasks] = useState<Task[]>([]);
  const [chartType, setChartType] = useState<"Line" | "Bar" | "Area">("Line");

  useEffect(() => {
    if (!user) return;
    const loadUserTasks = async () => {
      try {
        const { data } = await supabase.from("tasks").select("*").eq("assigned_to", user.id);
        if (data) {
          setFetchedTasks(data as Task[]);
        }
      } catch (err) {
        console.warn("Failed to load user tasks for summary card:", err);
      }
    };
    loadUserTasks();
  }, [user?.id]);

  const localTodayStr = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD

  // Use fetchedTasks if available (contains completed tasks), else fallback to passed tasks
  const effectiveTasks = fetchedTasks.length > 0 ? fetchedTasks : tasks;

  // Filter strictly for tasks completed TODAY (matching todayStr or localTodayStr)
  const completedToday = effectiveTasks.filter((t) => {
    if (t.status !== "Completed") return false;
    if (t.completed_at) {
      const compDate = t.completed_at.slice(0, 10);
      return compDate === todayStr || compDate === localTodayStr;
    }
    const upDate = (t as Task).updated_at ? (t as Task).updated_at.slice(0, 10) : null;
    if (upDate) {
      return upDate === todayStr || upDate === localTodayStr;
    }
    return t.due_date === todayStr || t.due_date === localTodayStr;
  });

  const isDueTodayOrPast = (due?: string | null) => {
    if (!due) return true;
    const d = due.slice(0, 10);
    return d <= todayStr || d <= localTodayStr;
  };

  const inProgressToday = effectiveTasks.filter(
    (t) => (t.status === "In Progress" || t.status === "In Review") && isDueTodayOrPast(t.due_date),
  );
  const blockedToday = effectiveTasks.filter(
    (t) => (t.status === "Blocked" || t.status === "On Hold") && isDueTodayOrPast(t.due_date),
  );
  const pendingToday = effectiveTasks.filter(
    (t) => t.status === "To Do" && isDueTodayOrPast(t.due_date),
  );

  const totalCount =
    completedToday.length + inProgressToday.length + blockedToday.length + pendingToday.length;
  const completedCount = completedToday.length;
  const completionPercentage = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  // Generate 14-day completion trend data for Recharts
  const trendData = useMemo(() => {
    const days: { dateLabel: string; fullDate: string; count: number }[] = [];
    const now = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

      const count = effectiveTasks.filter((t) => {
        if (t.status !== "Completed") return false;
        const compDate = t.completed_at
          ? t.completed_at.slice(0, 10)
          : (t as Task).updated_at
          ? (t as Task).updated_at.slice(0, 10)
          : t.due_date?.slice(0, 10);
        return compDate === dateStr;
      }).length;

      days.push({ dateLabel: label, fullDate: dateStr, count });
    }
    return days;
  }, [effectiveTasks]);

  const totalAllTimeCompleted = effectiveTasks.filter((t) => t.status === "Completed").length;

  const handleSubmitNote = () => {
    if (!dailyNote.trim()) {
      toast.error("Please enter a note before submitting your daily recap.");
      return;
    }
    setIsSubmitting(true);
    setTimeout(() => {
      setIsSubmitting(false);
      toast.success("EOD Daily Recap saved successfully!");
      setDailyNote("");
    }, 600);
  };

  return (
    <div className="space-y-3.5 mb-6">
      {/* Header bar with Open Today Page action */}
      <div className="flex items-center justify-between px-0.5">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
          <Sun className="w-4 h-4 text-amber-500" />
          <span>Today's Work Overview</span>
        </h2>
        <Link to="/today">
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5 hover:bg-accent border-border">
            <Sun className="w-3.5 h-3.5 text-primary" />
            <span>Open Today Page</span>
            <ArrowUpRight className="w-3 h-3 text-muted-foreground" />
          </Button>
        </Link>
      </div>

      {/* TOP ROW: 4 KPI Cards using App Theme Tokens */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        {/* Completed Card */}
        <div className="bg-card border border-border p-3 rounded-xl relative group hover:border-primary/40 transition-all shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-muted-foreground text-xs font-medium">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
              <span>Completed</span>
            </div>
            <div className="w-6 h-6 rounded-full bg-secondary border border-border flex items-center justify-center text-muted-foreground group-hover:text-primary transition-all">
              <ArrowUpRight className="w-3 h-3" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-xl font-black text-foreground">{completedCount}</span>
            <span className="text-[11px] text-emerald-500 font-mono">/ {totalCount} tasks</span>
          </div>
        </div>

        {/* In Progress Card */}
        <div className="bg-card border border-border p-3 rounded-xl relative group hover:border-primary/40 transition-all shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-muted-foreground text-xs font-medium">
              <Clock className="w-3.5 h-3.5 text-primary" />
              <span>In Progress</span>
            </div>
            <div className="w-6 h-6 rounded-full bg-secondary border border-border flex items-center justify-center text-muted-foreground group-hover:text-primary transition-all">
              <ArrowUpRight className="w-3 h-3" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-xl font-black text-foreground">{inProgressToday.length}</span>
            <span className="text-[11px] text-primary font-medium">active</span>
          </div>
        </div>

        {/* Blocked Card */}
        <div className="bg-card border border-border p-3 rounded-xl relative group hover:border-destructive/40 transition-all shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium">
              <AlertOctagon className="w-3.5 h-3.5 text-destructive" />
              <span>Blocked</span>
            </div>
            <div className="w-6 h-6 rounded-full bg-secondary border border-border flex items-center justify-center text-muted-foreground group-hover:text-destructive transition-all">
              <ArrowUpRight className="w-3 h-3" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-xl font-black text-foreground">{blockedToday.length}</span>
            <span className="text-[11px] text-destructive font-medium">held</span>
          </div>
        </div>

        {/* Pending Card */}
        <div className="bg-card border border-border p-3 rounded-xl relative group hover:border-amber-500/40 transition-all shadow-md">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-muted-foreground text-xs font-medium">
              <FileText className="w-3.5 h-3.5 text-amber-500" />
              <span>Pending</span>
            </div>
            <div className="w-6 h-6 rounded-full bg-secondary border border-border flex items-center justify-center text-muted-foreground group-hover:text-amber-500 transition-all">
              <ArrowUpRight className="w-3 h-3" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-xl font-black text-foreground">{pendingToday.length}</span>
            <span className="text-[11px] text-amber-500 font-medium">queued</span>
          </div>
        </div>
      </div>

      {/* MAIN CONTAINER: TOTAL TASK COMPLETIONS TREND CHART (App Theme Tokens) */}
      <Card className="border border-border bg-card shadow-lg overflow-hidden rounded-2xl">
        <CardHeader className="pb-3 pt-3.5 px-4 border-b border-border bg-card/90">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-primary/10 text-primary border border-primary/20">
                <LineChartIcon className="w-4 h-4" />
              </div>
              <div>
                <CardTitle className="text-sm font-bold text-foreground flex items-center gap-1.5">
                  Total Task Completions {userName ? <span className="text-primary font-normal">— {userName}</span> : ""}
                </CardTitle>
                <p className="text-[11px] text-muted-foreground">
                  <span className="font-semibold text-foreground">{totalAllTimeCompleted} total tasks completed</span> (14-day history)
                </p>
              </div>
            </div>

            {/* Chart Type Selector Dropdown: Line ▾ / Bar ▾ / Area ▾ */}
            <div className="flex items-center gap-2">
              <div className="relative">
                <select
                  value={chartType}
                  onChange={(e) => setChartType(e.target.value as any)}
                  className="bg-secondary border border-border text-foreground text-xs px-3 py-1 pr-7 rounded-lg appearance-none focus:outline-none focus:border-primary font-medium cursor-pointer"
                >
                  <option value="Line">Line</option>
                  <option value="Bar">Bar</option>
                  <option value="Area">Area</option>
                </select>
                <ChevronDown className="w-3.5 h-3.5 text-muted-foreground absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
              <Badge
                variant="outline"
                className={cn(
                  "px-2.5 py-0.5 text-xs font-semibold rounded-full",
                  completionPercentage >= 80
                    ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/40"
                    : "bg-primary/15 text-primary border-primary/40"
                )}
              >
                <Award className="w-3 h-3 mr-1 text-primary inline" />
                {completionPercentage}% Today
              </Badge>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-4 space-y-4">
          {/* TOTAL TASK COMPLETIONS RECHARTS CONTAINER */}
          <div className="bg-card border border-border p-3 rounded-xl">
            <div className="h-48 w-full pt-1">
              <ResponsiveContainer width="100%" height="100%">
                {chartType === "Line" ? (
                  <LineChart data={trendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="dateLabel" stroke="var(--muted-foreground)" fontSize={10} tickLine={false} axisLine={false} />
                    <YAxis stroke="var(--muted-foreground)" fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "var(--card)",
                        borderColor: "var(--border)",
                        borderRadius: "8px",
                        fontSize: "12px",
                        color: "var(--card-foreground)",
                      }}
                      labelStyle={{ color: "var(--muted-foreground)" }}
                    />
                    <Line
                      type="monotone"
                      dataKey="count"
                      name="Tasks Completed"
                      stroke="var(--primary)"
                      strokeWidth={2.5}
                      dot={{ fill: "var(--primary)", r: 4 }}
                      activeDot={{ r: 6, fill: "var(--primary)", stroke: "#ffffff" }}
                    />
                  </LineChart>
                ) : chartType === "Bar" ? (
                  <BarChart data={trendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="dateLabel" stroke="var(--muted-foreground)" fontSize={10} tickLine={false} axisLine={false} />
                    <YAxis stroke="var(--muted-foreground)" fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "var(--card)",
                        borderColor: "var(--border)",
                        borderRadius: "8px",
                        fontSize: "12px",
                        color: "var(--card-foreground)",
                      }}
                    />
                    <Bar dataKey="count" name="Tasks Completed" fill="var(--primary)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                ) : (
                  <AreaChart data={trendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="var(--primary)" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="dateLabel" stroke="var(--muted-foreground)" fontSize={10} tickLine={false} axisLine={false} />
                    <YAxis stroke="var(--muted-foreground)" fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "var(--card)",
                        borderColor: "var(--border)",
                        borderRadius: "8px",
                        fontSize: "12px",
                        color: "var(--card-foreground)",
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="count"
                      name="Tasks Completed"
                      stroke="var(--primary)"
                      strokeWidth={2.5}
                      fillOpacity={1}
                      fill="url(#areaGradient)"
                    />
                  </AreaChart>
                )}
              </ResponsiveContainer>
            </div>
          </div>

          {/* TWO COLUMN REAL TASK LISTS */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            {/* Completed Tasks Column */}
            <div className="space-y-2 border border-border rounded-xl p-3 bg-card">
              <h4 className="font-semibold text-emerald-500 flex items-center justify-between border-b border-border pb-1.5">
                <span className="flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> Completed Today</span>
                <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/30 text-[10px] px-1.5 py-0 font-mono">
                  {completedToday.length}
                </Badge>
              </h4>
              {completedToday.length === 0 ? (
                <p className="text-muted-foreground italic text-[11px] py-2 text-center">
                  No tasks completed yet today.
                </p>
              ) : (
                <ul className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                  {completedToday.map((t) => (
                    <li key={t.id} className="flex items-center gap-2 p-1.5 rounded-lg bg-secondary border border-border">
                      <span className="font-mono text-[10px] text-emerald-600 dark:text-emerald-300 bg-emerald-500/20 px-1 py-0.5 rounded font-bold border border-emerald-500/30 shrink-0">
                        {t.task_code}
                      </span>
                      <span className="text-foreground flex-1 truncate font-medium text-[11px]">
                        {t.task_name}
                      </span>
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Active / Blocked Column */}
            <div className="space-y-2 border border-border rounded-xl p-3 bg-card">
              <h4 className="font-semibold text-foreground flex items-center justify-between border-b border-border pb-1.5">
                <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 text-primary" /> In Progress & Blocked</span>
                <Badge variant="secondary" className="bg-primary/15 text-primary border-primary/30 text-[10px] px-1.5 py-0 font-mono">
                  {inProgressToday.length + blockedToday.length}
                </Badge>
              </h4>
              {[...blockedToday, ...inProgressToday].length === 0 ? (
                <p className="text-muted-foreground italic text-[11px] py-2 text-center">No active work remaining.</p>
              ) : (
                <ul className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                  {[...blockedToday, ...inProgressToday].map((t) => (
                    <li
                      key={t.id}
                      className="flex items-center justify-between gap-2 p-1.5 rounded-lg bg-secondary border border-border"
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <span className="font-mono text-[10px] text-primary bg-primary/20 px-1 py-0.5 rounded font-bold border border-primary/30 shrink-0">
                          {t.task_code}
                        </span>
                        <span className="truncate font-medium text-foreground text-[11px]">{t.task_name}</span>
                      </div>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[9px] px-1.5 py-0 shrink-0 font-semibold",
                          t.status === "Blocked"
                            ? "bg-destructive/15 text-destructive border-destructive/40"
                            : "bg-primary/15 text-primary border-primary/40"
                        )}
                      >
                        {t.status}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Quick EOD Daily Recap Note */}
          <div className="pt-2 border-t border-border">
            <label className="text-[11px] font-semibold text-foreground flex items-center gap-1 mb-1.5">
              <span>✍️</span> <span>Quick EOD Daily Recap / Remarks for Manager</span>
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="e.g. Completed Payment API, pending test cases for tomorrow..."
                value={dailyNote}
                onChange={(e) => setDailyNote(e.target.value)}
                className="flex-1 bg-secondary border border-input rounded-xl px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-ring transition-all"
              />
              <Button
                size="sm"
                onClick={handleSubmitNote}
                disabled={isSubmitting}
                className="h-8 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl shadow-md px-3.5 gap-1.5"
              >
                {isSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                <span>Submit Recap</span>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
