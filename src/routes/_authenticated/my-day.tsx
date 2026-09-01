import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { getMyDay, type MyDayItem } from "@/lib/my-day.functions";
import {
  AlertOctagon,
  AlertTriangle,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Flame,
  GripVertical,
  Inbox,
  Info,
  ListChecks,
  Plus,
  RotateCcw,
  RotateCw,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { TaskQuickActionModal } from "@/components/TaskQuickActionModal";
import { TaskFormDialog } from "@/components/TaskFormDialog";
import { MyTodayWorkSummaryCard } from "@/components/MyTodayWorkSummaryCard";
import { TaskCard } from "@/components/TaskCard";
import { EodReminder } from "@/components/EodReminder";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Profile, Task } from "@/lib/types";
import { isToday, isOverdue } from "@/lib/format";
import { useRealtimeTasks } from "@/hooks/use-realtime-tasks";
import { getTodayDateStr, isTaskCompletedToday } from "@/lib/task-date-utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/my-day")({
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    taskId?: string;
    tab?: string;
    toast_message?: string;
    openCreateTask?: boolean;
  } => ({
    taskId: typeof search.taskId === "string" ? search.taskId : undefined,
    tab: typeof search.tab === "string" ? search.tab : undefined,
    toast_message: typeof search.toast_message === "string" ? search.toast_message : undefined,
    openCreateTask:
      search.openCreateTask === true || search.openCreateTask === "true" ? true : undefined,
  }),
  component: MyDayPage,
});

interface TaskSectionProps {
  title: string;
  items: Task[];
  tone?: string;
  profiles: Profile[];
  userId: string;
  isManager: boolean;
  onChanged: () => void;
}

function TaskSection({
  title,
  items,
  tone,
  profiles,
  userId,
  isManager,
  onChanged,
}: TaskSectionProps) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <span className={tone}>{title}</span>
        <span className="text-muted-foreground/60">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground italic px-1">Nothing here.</p>
      ) : (
        items.map((t) => (
          <TaskCard
            key={t.id}
            task={t}
            assignee={profiles.find((p) => p.id === t.assigned_to)}
            profiles={profiles}
            userId={userId}
            canManage={isManager}
            onChanged={onChanged}
          />
        ))
      )}
    </section>
  );
}

function MyDayPage() {
  const { taskId, tab: queryTab, toast_message, openCreateTask } = Route.useSearch();
  const router = useRouter();
  const fetchMyDay = useServerFn(getMyDay);
  const { user, isManager } = useAuth();
  const [profile, setProfile] = useState<{ display_name: string | null } | null>(null);

  // Active Tab state (priority | tasks | summary | risks)
  const [activeTab, setActiveTab] = useState<string>(queryTab || "priority");

  // Raw tasks & profiles for TaskCard list views
  const [tasks, setTasks] = useState<Task[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);

  // Modals state
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [quickModalOpen, setQuickModalOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [completedModalOpen, setCompletedModalOpen] = useState(false);
  const handledTaskIdRef = useRef<string | null>(null);
  const handledToastRef = useRef<string | null>(null);
  const handledCreateTaskRef = useRef<boolean>(false);

  // Handle toast message query param from email / redirect actions
  useEffect(() => {
    if (toast_message && handledToastRef.current !== toast_message) {
      handledToastRef.current = toast_message;
      toast.success(toast_message);
    }
  }, [toast_message]);

  // Handle openCreateTask from email actions
  useEffect(() => {
    if (openCreateTask && !handledCreateTaskRef.current) {
      handledCreateTaskRef.current = true;
      setIsCreatingNew(true);
      setEditingTask(null);
      setFormOpen(true);
    }
  }, [openCreateTask]);

  // Sync activeTab when queryTab changes
  useEffect(() => {
    if (queryTab && ["priority", "tasks", "summary", "risks"].includes(queryTab)) {
      setActiveTab(queryTab);
    }
  }, [queryTab]);

  const handleTabChange = (newTab: string) => {
    setActiveTab(newTab);
    router.navigate({
      to: "/my-day",
      search: (prev) => ({ ...prev, tab: newTab }),
      replace: true,
    });
  };

  const handleTaskClick = async (id: string) => {
    try {
      const { data, error } = await supabase.from("tasks").select("*").eq("id", id).maybeSingle();
      if (error || !data) return;
      setSelectedTask(data as Task);
      setQuickModalOpen(true);
    } catch (err) {
      console.warn("Failed to load task for quick modal:", err);
    }
  };

  useEffect(() => {
    if (taskId && handledTaskIdRef.current !== taskId) {
      handledTaskIdRef.current = taskId;
      handleTaskClick(taskId);
    }
  }, [taskId]);

  useEffect(() => {
    if (!user) return;
    const loadProfile = async () => {
      try {
        const { data } = await supabase
          .from("profiles")
          .select("display_name")
          .eq("id", user.id)
          .maybeSingle();
        if (data) {
          setProfile(data);
        } else {
          setProfile({
            display_name:
              user.user_metadata?.display_name || user.user_metadata?.full_name || null,
          });
        }
      } catch (err) {
        console.warn("Failed to load profile in MyDayPage:", err);
      }
    };
    loadProfile();
  }, [user]);

  // Load raw tasks for the task sections
  const loadTasks = useCallback(async () => {
    if (!user) return;
    const [{ data: t }, { data: p }] = await Promise.all([
      supabase
        .from("tasks")
        .select("*")
        .eq("assigned_to", user.id)
        .order("due_date", { ascending: true, nullsFirst: false }),
      supabase.from("profiles").select("id,display_name,avatar_url"),
    ]);
    setTasks((t ?? []) as Task[]);
    setProfiles((p ?? []) as Profile[]);
  }, [user?.id]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  // Algorithmic MyDay query
  const q = useQuery({
    queryKey: ["my-day"],
    queryFn: () => fetchMyDay(),
    staleTime: 1000,
    refetchOnWindowFocus: true,
    refetchInterval: 5000,
  });

  // Realtime subscription handles both TaskCard raw tasks and priority query
  const handleRealtimeChange = useCallback(() => {
    loadTasks();
    q.refetch();
  }, [loadTasks, q]);

  useRealtimeTasks(
    handleRealtimeChange,
    `my-day-${user?.id ?? "x"}`,
    user?.id ? { kind: "assignee", userId: user.id } : { kind: "all" },
  );

  const todayStr = getTodayDateStr();
  const isCompletedToday = useCallback(
    (t: Task) => isTaskCompletedToday(t, todayStr),
    [todayStr],
  );

  const today = useMemo(
    () =>
      tasks.filter(
        (t) =>
          (isToday(t.due_date) || isOverdue(t.due_date, t.status)) &&
          t.status !== "Completed" &&
          t.status !== "Blocked",
      ),
    [tasks],
  );
  const pending = useMemo(
    () =>
      tasks.filter(
        (t) =>
          !isToday(t.due_date) &&
          !isOverdue(t.due_date, t.status) &&
          t.status !== "Completed" &&
          t.status !== "Blocked",
      ),
    [tasks],
  );
  const blocked = useMemo(() => tasks.filter((t) => t.status === "Blocked"), [tasks]);
  const completedToday = useMemo(
    () => tasks.filter(isCompletedToday),
    [tasks, isCompletedToday],
  );

  if (q.isLoading && tasks.length === 0) {
    return (
      <div className="p-3 md:p-6 max-w-5xl mx-auto space-y-3">
        <div className="h-24 bg-muted/50 animate-pulse rounded-xl" />
        <div className="h-72 bg-muted/50 animate-pulse rounded-xl" />
      </div>
    );
  }

  if (q.error && !q.data) {
    return (
      <div className="p-6 text-sm text-destructive">
        Failed to load My Day.{" "}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            q.refetch();
            loadTasks();
          }}
        >
          Retry
        </Button>
      </div>
    );
  }

  const d = q.data;

  const greeting = (() => {
    const h = new Date().getHours();
    const timeGreeting = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
    if (profile?.display_name) {
      const firstName = profile.display_name.trim().split(" ")[0];
      return `${timeGreeting}, ${firstName}`;
    }
    return timeGreeting;
  })();

  const utilPct = d
    ? Math.min(
        100,
        Math.round((d.workload.planned_hours / Math.max(1, d.workload.capacity_hours)) * 100),
      )
    : 0;

  const totalRisks = d
    ? d.risks.overdue.length +
      d.risks.at_risk.length +
      d.risks.high_severity.length +
      d.risks.approval_waiting.length
    : 0;

  const activeWorkTodayCount = today.length + blocked.length + pending.length;

  return (
    <div className="p-3 md:p-6 max-w-5xl mx-auto space-y-4">
      {/* Header Bar */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl md:text-2xl font-bold tracking-tight">{greeting}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {new Date().toLocaleDateString(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
              year: "numeric",
            })}{" "}
            · {d ? `${d.priorities.length} priorities` : `${activeWorkTodayCount} active tasks`}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            className="h-8 md:h-9 gap-1.5 font-medium shadow-sm"
            onClick={() => {
              setIsCreatingNew(true);
              setEditingTask(null);
              setFormOpen(true);
            }}
          >
            <Plus className="h-4 w-4" /> New Task
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              loadTasks();
              q.refetch();
              router.invalidate();
            }}
            className="h-8 md:h-9 gap-1.5 text-xs border-border"
          >
            <RotateCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>
      </header>

      {/* EOD Reminder Banner (if active tasks or pending submission) */}
      {user && (
        <EodReminder
          tasks={tasks}
          userId={user.id}
          onDone={() => {
            loadTasks();
            q.refetch();
          }}
        />
      )}

      {/* Main Tabbed Navigation prominently at the top */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
        {/* Modern high-visibility segmented tab bar */}
        <TabsList className="w-full grid grid-cols-2 md:grid-cols-4 h-auto p-1.5 bg-muted/80 backdrop-blur border border-border/80 rounded-xl gap-1.5 shadow-sm">
          <TabsTrigger
            value="priority"
            className="flex items-center justify-center gap-2 py-2 px-3 rounded-lg font-medium text-xs sm:text-sm transition-all cursor-pointer data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-md data-[state=active]:border-primary/40 data-[state=active]:border"
          >
            <div className="p-1 rounded-md bg-priority-high/15 text-priority-high shrink-0">
              <Flame className="h-4 w-4" />
            </div>
            <div className="text-left min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="font-semibold truncate">Priority Flow</span>
                {d && d.priorities.length > 0 && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 font-mono font-bold shrink-0">
                    {d.priorities.length}
                  </Badge>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground hidden sm:block truncate">Suggested order</p>
            </div>
          </TabsTrigger>

          <TabsTrigger
            value="tasks"
            className="flex items-center justify-center gap-2 py-2 px-3 rounded-lg font-medium text-xs sm:text-sm transition-all cursor-pointer data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-md data-[state=active]:border-primary/40 data-[state=active]:border"
          >
            <div className="p-1 rounded-md bg-primary/15 text-primary shrink-0">
              <ListChecks className="h-4 w-4" />
            </div>
            <div className="text-left min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="font-semibold truncate">Work Today</span>
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 font-mono font-bold shrink-0">
                  {activeWorkTodayCount}
                </Badge>
              </div>
              <p className="text-[10px] text-muted-foreground hidden sm:block truncate">All task cards</p>
            </div>
          </TabsTrigger>

          <TabsTrigger
            value="summary"
            className="flex items-center justify-center gap-2 py-2 px-3 rounded-lg font-medium text-xs sm:text-sm transition-all cursor-pointer data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-md data-[state=active]:border-amber-500/40 data-[state=active]:border"
          >
            <div className="p-1 rounded-md bg-amber-500/15 text-amber-500 shrink-0">
              <TrendingUp className="h-4 w-4" />
            </div>
            <div className="text-left min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="font-semibold truncate">Progress & Recap</span>
              </div>
              <p className="text-[10px] text-muted-foreground hidden sm:block truncate">Chart & daily note</p>
            </div>
          </TabsTrigger>

          <TabsTrigger
            value="risks"
            className="flex items-center justify-center gap-2 py-2 px-3 rounded-lg font-medium text-xs sm:text-sm transition-all cursor-pointer data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-md data-[state=active]:border-destructive/40 data-[state=active]:border"
          >
            <div className="p-1 rounded-md bg-destructive/15 text-destructive shrink-0">
              <AlertTriangle className="h-4 w-4" />
            </div>
            <div className="text-left min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="font-semibold truncate">Risks & Approvals</span>
                {d && totalRisks + d.approvals_pending.length > 0 && (
                  <Badge
                    variant={
                      d.risks.overdue.length > 0 || d.risks.high_severity.length > 0
                        ? "destructive"
                        : "secondary"
                    }
                    className="text-[10px] px-1.5 py-0 h-4 font-mono font-bold shrink-0"
                  >
                    {totalRisks + d.approvals_pending.length}
                  </Badge>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground hidden sm:block truncate">Blockers & reviews</p>
            </div>
          </TabsTrigger>
        </TabsList>

        {/* Workload + EOD preview metrics (Visible across daily focus) */}
        {d && (
          <TooltipProvider>
            <div className="grid grid-cols-2 gap-3 pt-1">
              {/* Today's Workload Card */}
              <Card className="col-span-2 sm:col-span-1 border-border/80 bg-card shadow-sm hover:border-border transition-all">
                <CardHeader className="pb-2 pt-3 px-4 flex flex-row items-center justify-between space-y-0">
                  <div className="flex items-center gap-1.5">
                    <Clock className="h-4 w-4 text-primary" />
                    <CardTitle className="text-sm font-semibold text-foreground">
                      Today's Workload
                    </CardTitle>
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded cursor-help"
                      >
                        <Info className="h-3.5 w-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs max-w-xs">
                      Total estimated hours for today's tasks vs. your daily capacity ({d.workload.capacity_hours}h standard).
                    </TooltipContent>
                  </Tooltip>
                </CardHeader>
                <CardContent className="px-4 pb-3 pt-0 space-y-2.5">
                  <div className="flex items-baseline justify-between">
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-2xl font-bold tracking-tight text-foreground">
                        {d.workload.planned_hours}h
                      </span>
                      <span className="text-xs text-muted-foreground">planned</span>
                    </div>
                    <span className="text-xs font-mono text-muted-foreground">
                      of {d.workload.capacity_hours}h capacity ({utilPct}%)
                    </span>
                  </div>

                  <Progress value={utilPct} className="h-2 bg-secondary" />

                  <div className="flex items-center justify-between text-xs pt-0.5">
                    <span className="text-muted-foreground">
                      Remaining:{" "}
                      <span className="text-foreground font-semibold">
                        {d.workload.remaining_hours}h
                      </span>
                    </span>

                    {/* Interactive Completed Work Button */}
                    <button
                      type="button"
                      onClick={() => setCompletedModalOpen(true)}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-500 hover:text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 px-2 py-0.5 rounded-md border border-emerald-500/25 transition-all cursor-pointer group"
                      title="Click to view work completed today"
                    >
                      <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                      <span>{completedToday.length} done today</span>
                      <ArrowUpRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                    </button>
                  </div>
                </CardContent>
              </Card>

              {/* End-of-Day Preview Card */}
              <Card className="col-span-2 sm:col-span-1 border-border/80 bg-card shadow-sm hover:border-border transition-all">
                <CardHeader className="pb-2 pt-3 px-4 flex flex-row items-center justify-between space-y-0">
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="h-4 w-4 text-primary" />
                    <CardTitle className="text-sm font-semibold text-foreground">
                      End-of-Day Preview
                    </CardTitle>
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded cursor-help"
                      >
                        <Info className="h-3.5 w-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs max-w-xs">
                      Expected completion rate based on on-track priorities and finished tasks today.
                    </TooltipContent>
                  </Tooltip>
                </CardHeader>
                <CardContent className="px-4 pb-3 pt-0 space-y-2.5">
                  <div className="flex items-baseline justify-between">
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-2xl font-bold tracking-tight text-foreground">
                        {d.eod_preview.expected_completion_pct}%
                      </span>
                      <span className="text-xs text-muted-foreground">expected on-track</span>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px] h-5 px-1.5 font-medium border-border",
                        d.eod_preview.expected_completion_pct >= 80
                          ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/30"
                          : "bg-primary/10 text-primary border-primary/30",
                      )}
                    >
                      {d.eod_preview.expected_completion_pct >= 80 ? "On Track" : "In Progress"}
                    </Badge>
                  </div>

                  <Progress
                    value={d.eod_preview.expected_completion_pct}
                    className="h-2 bg-secondary"
                  />

                  <div className="flex items-center justify-between text-xs text-muted-foreground pt-0.5">
                    <span>
                      {d.eod_preview.expected_done} of {d.eod_preview.open_today} open tasks on track
                    </span>
                    <button
                      type="button"
                      onClick={() => handleTabChange("tasks")}
                      className="text-primary hover:underline font-medium text-[11px] flex items-center gap-0.5 cursor-pointer"
                    >
                      View tasks <ArrowUpRight className="h-3 w-3" />
                    </button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TooltipProvider>
        )}

        {/* TAB 1: PRIORITY FLOW */}
        <TabsContent value="priority" className="space-y-4 focus-visible:outline-none">
          <Card className="border-border shadow-sm">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-1.5">
                <Flame className="h-4 w-4 text-priority-high" /> Today's priorities — suggested
                execution order
              </CardTitle>
              <span className="text-xs text-muted-foreground">
                Click task for fast update & timer
              </span>
            </CardHeader>
            <CardContent className="p-0">
              {!d || d.priorities.length === 0 ? (
                <EmptyRow
                  icon={<CheckCircle2 className="h-5 w-5" />}
                  text="Nothing on your plate. Enjoy the calm."
                />
              ) : (
                <div className="p-3 space-y-2.5">
                  {d.priorities.map((item, idx) => {
                    const rawTask = tasks.find((t) => t.id === item.id);
                    if (rawTask) {
                      return (
                        <TaskCard
                          key={item.id}
                          task={rawTask}
                          rank={idx + 1}
                          assignee={profiles.find((p) => p.id === rawTask.assigned_to)}
                          profiles={profiles}
                          userId={user?.id || ""}
                          canManage={isManager}
                          onChanged={handleRealtimeChange}
                        />
                      );
                    }
                    return (
                      <PriorityRow
                        key={item.id}
                        rank={idx + 1}
                        item={item}
                        onTaskClick={handleTaskClick}
                      />
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Inline mini-risks card if there are overdue items */}
          {d && d.risks.overdue.length > 0 && (
            <Card className="border-destructive/30 bg-destructive/5 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-semibold text-destructive flex items-center gap-1.5">
                  <AlertOctagon className="h-3.5 w-3.5" /> Overdue Tasks Requiring Immediate Action
                  ({d.risks.overdue.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 pb-3">
                <RiskGroup
                  label="Overdue"
                  tone="destructive"
                  items={d.risks.overdue}
                  onTaskClick={handleTaskClick}
                />
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* TAB 2: ALL WORK TODAY (FULL TASK CARDS) */}
        <TabsContent value="tasks" className="space-y-6 focus-visible:outline-none">
          {user && (
            <>
              <TaskSection
                title="Today & overdue"
                items={today}
                tone="text-destructive font-semibold"
                profiles={profiles}
                userId={user.id}
                isManager={isManager}
                onChanged={handleRealtimeChange}
              />
              <TaskSection
                title="Blocked"
                items={blocked}
                tone="text-amber-500 font-semibold"
                profiles={profiles}
                userId={user.id}
                isManager={isManager}
                onChanged={handleRealtimeChange}
              />
              <TaskSection
                title="Pending"
                items={pending}
                profiles={profiles}
                userId={user.id}
                isManager={isManager}
                onChanged={handleRealtimeChange}
              />
              <TaskSection
                title="Completed today"
                items={completedToday}
                tone="text-emerald-500 font-semibold"
                profiles={profiles}
                userId={user.id}
                isManager={isManager}
                onChanged={handleRealtimeChange}
              />
            </>
          )}
        </TabsContent>

        {/* TAB 3: PROGRESS & RECAP */}
        <TabsContent value="summary" className="space-y-4 focus-visible:outline-none">
          <MyTodayWorkSummaryCard
            tasks={d?.priorities || []}
            userName={profile?.display_name || undefined}
          />
        </TabsContent>

        {/* TAB 4: RISKS & APPROVALS */}
        <TabsContent value="risks" className="space-y-4 focus-visible:outline-none">
          {d && (
            <>
              {/* Risks */}
              <Card className="border-border shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-1.5">
                    <AlertTriangle className="h-4 w-4 text-priority-high" /> Identified Risks
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <RiskGroup
                    label="Overdue"
                    tone="destructive"
                    items={d.risks.overdue}
                    onTaskClick={handleTaskClick}
                  />
                  <RiskGroup
                    label="At risk"
                    tone="warn"
                    items={d.risks.at_risk}
                    onTaskClick={handleTaskClick}
                  />
                  <RiskGroup
                    label="High severity"
                    tone="destructive"
                    items={d.risks.high_severity}
                    onTaskClick={handleTaskClick}
                  />
                  <RiskGroup
                    label="Awaiting approval"
                    tone="info"
                    items={d.risks.approval_waiting}
                    onTaskClick={handleTaskClick}
                  />
                  {totalRisks === 0 && (
                    <EmptyRow
                      icon={<CheckCircle2 className="h-5 w-5" />}
                      text="No risks identified right now."
                    />
                  )}
                </CardContent>
              </Card>

              {/* Approvals */}
              <Card className="border-border shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-1.5">
                    <ClipboardCheck className="h-4 w-4 text-primary" /> Pending approvals (
                    {d.approvals_pending.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {d.approvals_pending.length === 0 ? (
                    <EmptyRow
                      icon={<Inbox className="h-5 w-5" />}
                      text="No approvals waiting on you."
                    />
                  ) : (
                    <ul className="divide-y divide-border">
                      {d.approvals_pending.map((a) => (
                        <li key={a.request_id}>
                          <Link
                            to="/tasks"
                            search={{ highlightId: a.work_item_id }}
                            className="flex items-center gap-2 px-3 py-2.5 min-h-12 hover:bg-accent/30 active:bg-accent/50 transition-colors w-full text-left"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-medium truncate">
                                {a.work_item_code} · {a.work_item_name}
                              </div>
                              <div className="text-[11px] text-muted-foreground truncate">
                                Step: {a.step_name}
                              </div>
                            </div>
                            <Badge variant="outline" className="shrink-0 text-[10px]">
                              Review
                            </Badge>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>

              {/* Carry-forward */}
              <Card className="border-border shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-1.5">
                    <RotateCcw className="h-4 w-4 text-primary" /> Carry-forward History
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <CarrySection
                    label="Carried into today"
                    items={d.carry_forward.today}
                    onTaskClick={handleTaskClick}
                  />
                  <CarrySection
                    label="Repeated (3+ times)"
                    items={d.carry_forward.repeated}
                    accent
                    onTaskClick={handleTaskClick}
                  />
                  {d.carry_forward.today.length + d.carry_forward.repeated.length === 0 && (
                    <EmptyRow
                      icon={<CheckCircle2 className="h-5 w-5" />}
                      text="Nothing carried over."
                    />
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>
      </Tabs>

      {d && (
        <p className="text-[10px] text-muted-foreground text-center pt-2 pb-4">
          Generated {new Date(d.meta.generated_at).toLocaleTimeString()} · Score considers
          priority, due date, risk, carry-forward, approvals.
        </p>
      )}

      {/* In-Place Quick Action Mini Modal */}
      <TaskQuickActionModal
        task={selectedTask}
        open={quickModalOpen}
        onOpenChange={(open) => {
          setQuickModalOpen(open);
          if (!open && !formOpen) {
            setSelectedTask(null);
            if (taskId) {
              handledTaskIdRef.current = null;
              router.navigate({
                to: "/my-day",
                search: (prev) => ({ ...prev, taskId: undefined }),
                replace: true,
              });
            }
          }
        }}
        userId={user?.id ?? ""}
        onChanged={handleRealtimeChange}
        onOpenFullEdit={(taskToEdit) => {
          setEditingTask(taskToEdit);
          setIsCreatingNew(false);
          setQuickModalOpen(false);
          setFormOpen(true);
        }}
      />

      {/* Task Form Dialog (New Task or Edit Details) */}
      <TaskFormDialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) {
            setEditingTask(null);
            setSelectedTask(null);
            setIsCreatingNew(false);
          }
        }}
        initial={isCreatingNew ? null : editingTask || selectedTask}
        userId={user?.id ?? ""}
        onSaved={() => {
          handleRealtimeChange();
          const targetId = editingTask?.id || selectedTask?.id;
          if (targetId && !isCreatingNew) {
            handleTaskClick(targetId);
          }
        }}
      />

      {/* Completed Tasks Today Modal */}
      <Dialog open={completedModalOpen} onOpenChange={setCompletedModalOpen}>
        <DialogContent className="max-w-md p-5 bg-card border-border">
          <DialogHeader className="pb-2 border-b border-border/80 text-left">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                <CheckCircle2 className="h-4 w-4" />
              </div>
              <div>
                <DialogTitle className="text-base font-bold text-foreground">
                  Work Completed Today ({completedToday.length})
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                  Tasks you have marked complete today. Click any task to inspect details.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="py-2 space-y-2 max-h-[60vh] overflow-y-auto">
            {completedToday.length === 0 ? (
              <div className="text-center py-6 text-xs text-muted-foreground italic">
                No tasks completed yet today.
              </div>
            ) : (
              <ul className="space-y-1.5">
                {completedToday.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setCompletedModalOpen(false);
                        handleTaskClick(t.id);
                      }}
                      className="w-full flex items-center justify-between gap-2 p-2.5 rounded-lg bg-secondary/60 hover:bg-secondary border border-border/70 text-left transition-colors cursor-pointer group"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="font-mono text-[10px] text-emerald-500 bg-emerald-500/15 px-1 py-0.2 rounded font-semibold border border-emerald-500/20">
                            {t.task_code}
                          </span>
                          {t.project_name && (
                            <span className="text-[10px] text-muted-foreground truncate">
                              {t.project_name}
                            </span>
                          )}
                        </div>
                        <div className="text-xs font-medium text-foreground truncate group-hover:text-primary transition-colors">
                          {t.task_name}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant="outline" className="text-[9px] h-4 px-1 text-emerald-500 border-emerald-500/30">
                          Done
                        </Badge>
                        <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="pt-2 border-t border-border flex justify-between items-center text-xs">
            <button
              type="button"
              onClick={() => {
                setCompletedModalOpen(false);
                handleTabChange("tasks");
              }}
              className="text-primary hover:underline font-medium text-xs flex items-center gap-1 cursor-pointer"
            >
              Open Full Tasks Tab <ArrowUpRight className="h-3 w-3" />
            </button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setCompletedModalOpen(false)}
              className="h-7 text-xs border-border"
            >
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PriorityRow({
  rank,
  item,
  onTaskClick,
}: {
  rank: number;
  item: MyDayItem;
  onTaskClick?: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onTaskClick?.(item.id)}
      className="w-full text-left flex items-stretch gap-2 px-3 py-2.5 min-h-14 active:bg-accent/50 hover:bg-accent/30 transition-colors"
    >
      <div className="flex flex-col items-center justify-center w-7 shrink-0">
        <div
          className={cn(
            "h-7 w-7 grid place-items-center rounded-full text-xs font-bold",
            rank <= 3 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
          )}
        >
          {rank}
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] font-mono text-muted-foreground">{item.task_code}</span>
          {item.is_overdue && (
            <Badge variant="destructive" className="text-[9px] h-4 px-1">
              Overdue
            </Badge>
          )}
          {item.has_pending_approval && (
            <Badge variant="outline" className="text-[9px] h-4 px-1">
              Approval
            </Badge>
          )}
          {item.risk_severity && (
            <Badge variant="outline" className="text-[9px] h-4 px-1 capitalize">
              {item.risk_severity}
            </Badge>
          )}
          {item.is_blocked && (
            <Badge variant="secondary" className="text-[9px] h-4 px-1">
              Blocked
            </Badge>
          )}
          {item.carry_forward_count > 0 && (
            <Badge variant="outline" className="text-[9px] h-4 px-1">
              CF×{item.carry_forward_count}
            </Badge>
          )}
        </div>
        <div className="text-sm font-medium truncate mt-0.5">{item.task_name}</div>
        <div className="text-[11px] text-muted-foreground truncate flex items-center gap-1.5">
          {item.project_name && <span className="truncate">{item.project_name}</span>}
          {item.due_date && (
            <span className="flex items-center gap-0.5">
              <CalendarClock className="h-3 w-3" />
              {item.due_date}
            </span>
          )}
          <span>· {item.planned_hours || 1}h</span>
          <span
            className={cn(
              "ml-auto font-semibold",
              item.priority === "High"
                ? "text-priority-high"
                : item.priority === "Low"
                  ? "text-muted-foreground"
                  : "text-foreground",
            )}
          >
            {item.priority}
          </span>
        </div>
      </div>
      <GripVertical className="h-4 w-4 text-muted-foreground self-center shrink-0 opacity-40" />
    </button>
  );
}

function RiskGroup({
  label,
  items,
  tone,
  onTaskClick,
}: {
  label: string;
  items: MyDayItem[];
  tone: "destructive" | "warn" | "info";
  onTaskClick?: (id: string) => void;
}) {
  if (items.length === 0) return null;
  const toneCls =
    tone === "destructive"
      ? "text-priority-high"
      : tone === "warn"
        ? "text-priority-medium"
        : "text-primary";
  return (
    <div>
      <div
        className={cn(
          "text-[11px] uppercase tracking-wide font-semibold mb-1.5 flex items-center gap-1",
          toneCls,
        )}
      >
        <AlertOctagon className="h-3 w-3" /> {label} ({items.length})
      </div>
      <ul className="space-y-1">
        {items.map((i) => (
          <li key={i.id}>
            <button
              type="button"
              onClick={() => onTaskClick?.(i.id)}
              className="flex items-center gap-2 text-xs min-h-9 px-2 py-1 rounded-md bg-muted/30 hover:bg-accent/30 active:bg-accent/50 transition-colors w-full text-left"
            >
              <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                {i.task_code}
              </span>
              <span className="truncate flex-1">{i.task_name}</span>
              {i.due_date && (
                <span className="text-[10px] text-muted-foreground shrink-0">{i.due_date}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CarrySection({
  label,
  items,
  accent,
  onTaskClick,
}: {
  label: string;
  items: MyDayItem[];
  accent?: boolean;
  onTaskClick?: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <div
        className={cn(
          "text-[11px] uppercase tracking-wide font-semibold mb-1.5",
          accent ? "text-priority-high" : "text-muted-foreground",
        )}
      >
        {label} ({items.length})
      </div>
      <ul className="space-y-1">
        {items.map((i) => (
          <li key={i.id}>
            <button
              type="button"
              onClick={() => onTaskClick?.(i.id)}
              className="flex items-center gap-2 text-xs min-h-9 px-2 py-1 rounded-md bg-muted/30 hover:bg-accent/30 active:bg-accent/50 transition-colors w-full text-left"
            >
              <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                {i.task_code}
              </span>
              <span className="truncate flex-1">{i.task_name}</span>
              <Badge
                variant={accent ? "destructive" : "outline"}
                className="text-[9px] h-4 px-1 shrink-0"
              >
                CF×{i.carry_forward_count}
              </Badge>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EmptyRow({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground justify-center">
      <span className="text-status-completed">{icon}</span> {text}
    </div>
  );
}
