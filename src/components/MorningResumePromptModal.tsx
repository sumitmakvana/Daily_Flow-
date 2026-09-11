import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { TaskHoursBadges } from "./TaskHoursBadges";
import { PriorityBadge } from "./PriorityBadge";
import {
  Play,
  Sun,
  Moon,
  ArrowRight,
  Sparkles,
  Layers,
  Flag,
  ChevronRight,
  Calendar as CalendarIcon,
  List,
} from "lucide-react";
import type { Task } from "@/lib/types";
import { tasksService } from "@/services/tasks";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export function MorningResumePromptModal() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [focusTask, setFocusTask] = useState<Task | null>(null);
  const [isPausedTask, setIsPausedTask] = useState(false);
  const [totalPending, setTotalPending] = useState(0);
  const [highPriorityCount, setHighPriorityCount] = useState(0);
  const [workedTodayCount, setWorkedTodayCount] = useState(0);
  const [otherTasks, setOtherTasks] = useState<Task[]>([]);
  const [displayName, setDisplayName] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const checkAndOpenDigestModal = async () => {
    if (!user) return;
    const todayStr = new Date().toDateString();
    const lastPromptDate = localStorage.getItem("last_morning_resume_prompt_date");

    // Don't prompt more than once per day
    if (lastPromptDate === todayStr) return;

    try {
      // Fetch dynamic user profile display name from profiles table
      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", user.id)
        .maybeSingle();

      const resolvedName =
        profile?.display_name ||
        user.user_metadata?.display_name ||
        user.user_metadata?.full_name ||
        user.email?.split("@")[0] ||
        "User";
      setDisplayName(resolvedName);

      // 1. Check if user already has an active running task
      const active = await tasksService.getActiveTask(user.id);
      if (active && active.started_at) {
        const startTs = new Date(active.started_at).getTime();
        const midnightTodayTs = new Date().setHours(0, 0, 0, 0);
        if (startTs < midnightTodayTs) {
          // Task timer was left running overnight from yesterday! Auto-pause it so it can be resumed via morning prompt.
          await tasksService.setStatus(active, "To Do", user.id);
        } else {
          // Timer was started TODAY, user is actively working today
          localStorage.setItem("last_morning_resume_prompt_date", todayStr);
          return;
        }
      }

      // 2. Fetch user's candidate tasks
      const allTasks = await tasksService.queryTasks({
        assignedTo: user.id,
        limit: 30,
      });

      const pendingTasks = allTasks.filter((t) => t.status !== "Completed");
      const highCount = pendingTasks.filter((t) => t.priority === "High").length;
      const workedCount = pendingTasks.filter((t) => Number(t.system_hours ?? 0) > 0).length;

      setTotalPending(pendingTasks.length);
      setHighPriorityCount(highCount);
      setWorkedTodayCount(workedCount);

      // Priority 1: Check for yesterday's paused/in-progress candidate task
      const pausedCandidate = pendingTasks.find(
        (t) =>
          (t.status === "To Do" || t.status === "On Hold") &&
          (Number(t.system_hours ?? 0) > 0 || t.started_at !== null),
      );

      let primaryTask: Task | null = null;
      let isPaused = false;

      if (pausedCandidate) {
        primaryTask = pausedCandidate;
        isPaused = true;
      } else {
        // Priority 2: Pick top task from today's Queue
        const unstartedQueue = pendingTasks.filter((t) => t.status === "To Do" || t.status === "On Hold");
        if (unstartedQueue.length > 0) {
          const priorityScore = (p?: string) => (p === "High" ? 3 : p === "Medium" ? 2 : 1);
          unstartedQueue.sort((a, b) => priorityScore(b.priority) - priorityScore(a.priority));
          primaryTask = unstartedQueue[0];
          isPaused = false;
        }
      }

      if (primaryTask) {
        setFocusTask(primaryTask);
        setIsPausedTask(isPaused);

        // Populate other candidate tasks excluding the primary focus task
        const remaining = pendingTasks.filter((t) => t.id !== primaryTask?.id).slice(0, 5);
        setOtherTasks(remaining);

        setOpen(true);
      }
    } catch (err) {
      console.warn("[MorningDigestModal] check failed:", (err as Error).message);
    }
  };

  useEffect(() => {
    checkAndOpenDigestModal();

    if (!user) return;

    // Realtime listener for morning digest notification to trigger modal live if tab is open
    const channel = supabase
      .channel(`morning-digest-modal-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        (payload?: { new?: { type?: string } }) => {
          if (payload?.new?.type === "sod_digest") {
            checkAndOpenDigestModal();
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const markPromptedToday = () => {
    localStorage.setItem("last_morning_resume_prompt_date", new Date().toDateString());
  };

  const handleStartCounterForTask = async (targetTask: Task) => {
    if (!targetTask || !user) return;
    setBusy(true);
    try {
      await tasksService.setStatus(targetTask, "In Progress", user.id);
      markPromptedToday();
      toast.success(`🌅 Counter started for ${targetTask.task_code || "task"}`);
      setOpen(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleStartCounter = () => {
    if (focusTask) {
      handleStartCounterForTask(focusTask);
    }
  };

  const handleDismiss = () => {
    markPromptedToday();
    setOpen(false);
  };

  const handleChooseOther = () => {
    markPromptedToday();
    setOpen(false);
    navigate({ to: "/my-day" });
  };

  if (!open || !focusTask) return null;

  const now = new Date();
  const currentHour = now.getHours();
  let greetingPrefix = "Good Morning";
  if (currentHour >= 12 && currentHour < 17) {
    greetingPrefix = "Good Afternoon";
  } else if (currentHour >= 17) {
    greetingPrefix = "Good Evening";
  }

  const dayName = now.toLocaleDateString("en-US", { weekday: "long" });
  const dateNum = now.getDate();
  const monthYear = now.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) handleDismiss();
      }}
    >
      <DialogContent className="sm:max-w-4xl max-w-[95vw] w-full p-0 overflow-y-auto max-h-[92vh] sm:max-h-[88vh] bg-card border-border/80 text-foreground shadow-2xl rounded-xl sm:rounded-2xl border">
        <div className="grid grid-cols-1 md:grid-cols-12 min-h-0 sm:min-h-[500px]">
          {/* Left Column - Clean Theme Sidebar */}
          <div className="md:col-span-4 bg-background/95 p-4 sm:p-6 text-foreground flex flex-col justify-between border-b md:border-b-0 md:border-r border-border/60 relative overflow-hidden">
            <div className="space-y-4 sm:space-y-5 relative z-10">
              {/* Soft Professional Greeting */}
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  {currentHour >= 17 ? (
                    <Moon className="h-4 sm:h-5 w-4 sm:w-5 text-indigo-300/80" />
                  ) : (
                    <Sun className="h-4 sm:h-5 w-4 sm:w-5 text-amber-300/80" />
                  )}
                  <span className="text-xs font-medium text-muted-foreground">
                    {greetingPrefix},
                  </span>
                </div>
                <h2 className="text-lg sm:text-xl font-bold text-foreground tracking-tight line-clamp-1 font-sans">
                  {displayName}!
                </h2>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Let's make today productive. Here are your top tasks for today.
                </p>
              </div>

              {/* Date Box Widget */}
              <div className="bg-card border border-border/70 rounded-xl sm:rounded-2xl p-3 sm:p-4 text-center shadow-xs space-y-1">
                <div className="text-[10px] sm:text-[11px] font-semibold text-muted-foreground tracking-wide uppercase">
                  {dayName}
                </div>
                <div className="text-3xl sm:text-4xl font-black text-foreground font-sans tracking-tight my-0.5">
                  {dateNum}
                </div>
                <div className="text-xs font-medium text-muted-foreground">{monthYear}</div>

                <div className="pt-2.5 sm:pt-3 mt-2.5 sm:mt-3 border-t border-border/60 text-[10px] sm:text-[11px] text-muted-foreground italic">
                  "Small steps every day lead to big results."
                </div>
              </div>

              {/* Mini Stats Grouped Card Well */}
              <div className="bg-card border border-border/70 rounded-xl sm:rounded-2xl p-2.5 sm:p-3 space-y-1.5 sm:space-y-2">
                <div className="flex items-center justify-between p-1 sm:p-1.5 text-xs">
                  <div className="flex items-center gap-2 sm:gap-2.5 text-foreground/90">
                    <span className="w-6 sm:w-7 h-6 sm:h-7 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20 flex items-center justify-center shadow-xs">
                      <List className="w-3.5 h-3.5" />
                    </span>
                    <span className="font-medium text-xs">Total Tasks</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="font-mono font-bold text-foreground text-xs sm:text-sm">{totalPending}</span>
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/60" />
                  </div>
                </div>

                <div className="flex items-center justify-between p-1 sm:p-1.5 text-xs">
                  <div className="flex items-center gap-2 sm:gap-2.5 text-foreground/90">
                    <span className="w-6 sm:w-7 h-6 sm:h-7 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center shadow-xs">
                      <Play className="w-3.5 h-3.5 fill-emerald-400" />
                    </span>
                    <span className="font-medium text-xs">Work Today</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="font-mono font-bold text-foreground text-xs sm:text-sm">{workedTodayCount}</span>
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/60" />
                  </div>
                </div>

                <div className="flex items-center justify-between p-1 sm:p-1.5 text-xs">
                  <div className="flex items-center gap-2 sm:gap-2.5 text-foreground/90">
                    <span className="w-6 sm:w-7 h-6 sm:h-7 rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/20 flex items-center justify-center shadow-xs">
                      <Flag className="w-3.5 h-3.5" />
                    </span>
                    <span className="font-medium text-xs">High Priority</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="font-mono font-bold text-foreground text-xs sm:text-sm">{highPriorityCount}</span>
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/60" />
                  </div>
                </div>
              </div>
            </div>

            {/* Sidebar Bottom Wavy Graphic Banner */}
            <div className="relative pt-4 sm:pt-6 pb-1 mt-3 sm:mt-4 -mx-4 sm:-mx-6 -mb-4 sm:-mb-6 px-4 sm:px-6 bg-gradient-to-t from-background via-background/80 to-transparent overflow-hidden">
              <svg className="absolute bottom-0 left-0 right-0 w-full h-12 sm:h-14 opacity-15 text-primary fill-current pointer-events-none" viewBox="0 0 1440 320" preserveAspectRatio="none">
                <path d="M0,192L48,197.3C96,203,192,213,288,202.7C384,192,480,160,576,165.3C672,171,768,213,864,224C960,235,1056,213,1152,192C1248,171,1344,149,1392,138.7L1440,128L1440,320L1392,320C1344,320,1248,320,1152,320C1056,320,960,320,864,320C768,320,672,320,576,320C480,320,384,320,288,320C192,320,96,320,48,320L0,320Z"></path>
              </svg>
              <div className="relative z-10 text-center font-serif italic text-muted-foreground text-[11px] sm:text-xs tracking-wider pb-1.5">
                <span className="border-b border-border/80 pb-0.5">Have a great day!</span>
              </div>
            </div>
          </div>

          {/* Right Column - Main Content Panel */}
          <div className="md:col-span-8 p-4 sm:p-6 bg-card text-foreground flex flex-col justify-between space-y-4 sm:space-y-5">
            <div className="space-y-3.5 sm:space-y-4">
              {/* Header Bar */}
              <DialogHeader className="space-y-1 text-left">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 sm:gap-3">
                  <div className="space-y-1">
                    <DialogTitle className="text-foreground font-bold text-base sm:text-lg tracking-tight">
                      Unified Morning Digest
                    </DialogTitle>
                    <DialogDescription className="text-xs text-muted-foreground leading-normal">
                      Here are your top main focus tasks auto-picked for today. Press 1-click start below to fire up your timer and begin!
                    </DialogDescription>
                  </div>

                  {/* Summary Pill */}
                  {totalPending > 0 && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 sm:px-3 sm:py-1 rounded-full text-[10px] sm:text-[11px] font-semibold bg-muted/60 text-muted-foreground border border-border/80 self-start shrink-0">
                      <Layers className="w-3 h-3 text-primary" />
                      <span>
                        Total {totalPending} {totalPending === 1 ? "Task" : "Tasks"}
                        {highPriorityCount > 0 && ` · ${highPriorityCount} High`}
                      </span>
                    </span>
                  )}
                </div>
              </DialogHeader>

              {/* #1 Top Featured Focus Task Card */}
              <div className="p-3.5 sm:p-4 rounded-xl bg-background/90 border border-primary/30 space-y-2.5 sm:space-y-3 shadow-xs relative overflow-hidden transition-all hover:border-primary/50">
                <div className="flex flex-wrap items-center justify-between gap-1.5 sm:gap-2">
                  <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                    <span className="w-5 sm:w-6 h-5 sm:h-6 rounded-full bg-primary text-primary-foreground font-bold text-[10px] sm:text-xs flex items-center justify-center shadow-xs">
                      1
                    </span>
                    <span className="font-mono text-xs font-bold text-primary">
                      {focusTask.task_code || "TSK"}
                    </span>
                    {isPausedTask ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border bg-amber-500/10 text-amber-300/90 border-amber-500/20">
                        Yesterday's Paused
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-blue-500/10 text-blue-400 border-blue-500/30">
                        Selected from Queue
                      </span>
                    )}
                    <PriorityBadge priority={focusTask.priority} className="text-[10px]" />
                  </div>

                  <TaskHoursBadges task={focusTask} className="text-[10px]" />
                </div>

                <div className="space-y-1">
                  <h3 className="text-xs sm:text-sm font-bold text-foreground leading-snug">
                    {focusTask.task_name}
                  </h3>
                  {focusTask.project_name && (
                    <div className="text-[10px] sm:text-[11px] text-muted-foreground font-mono">
                      Project: <span className="text-foreground/90 font-medium">{focusTask.project_name}</span>
                    </div>
                  )}
                </div>

                {/* Card Quick Start Button */}
                <div className="pt-1 flex justify-end">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => handleStartCounterForTask(focusTask)}
                    disabled={busy}
                    className="h-8 px-3.5 text-xs font-bold gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm transition-all active:scale-[0.98] rounded-lg w-full sm:w-auto justify-center"
                  >
                    <Play className="h-3.5 w-3.5 fill-white" /> Start Timer
                    <span className="text-[10px] text-emerald-100 font-normal">
                      {isPausedTask ? "Continue where you left" : "Start now"}
                    </span>
                  </Button>
                </div>
              </div>

              {/* "Other Tasks for Today" Section */}
              {otherTasks.length > 0 && (
                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between text-xs font-semibold text-foreground">
                    <div className="flex items-center gap-1.5">
                      <CalendarIcon className="w-3.5 h-3.5 text-primary" />
                      <span>Other Tasks for Today</span>
                    </div>
                    <Button
                      type="button"
                      variant="link"
                      onClick={handleChooseOther}
                      className="h-auto p-0 text-[11px] text-primary hover:underline font-normal flex items-center gap-0.5"
                    >
                      <span>View All Tasks</span>
                      <ChevronRight className="w-3 h-3" />
                    </Button>
                  </div>

                  <div className="space-y-1.5 max-h-[140px] sm:max-h-[170px] overflow-y-auto pr-1">
                    {otherTasks.map((task, idx) => (
                      <div
                        key={task.id}
                        onClick={() => {
                          setFocusTask(task);
                          setIsPausedTask(Number(task.system_hours ?? 0) > 0 || task.started_at !== null);
                        }}
                        className="p-2 sm:p-2.5 rounded-lg border border-border/60 bg-background/60 hover:bg-accent/40 cursor-pointer flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1.5 sm:gap-3 transition-colors text-xs group"
                      >
                        <div className="flex items-center gap-2 sm:gap-2.5 min-w-0 w-full sm:w-auto">
                          <span className="w-4 sm:w-5 h-4 sm:h-5 rounded-full bg-muted text-muted-foreground font-mono text-[9px] sm:text-[10px] font-bold flex items-center justify-center group-hover:bg-primary/20 group-hover:text-primary transition-colors shrink-0">
                            {idx + 2}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold text-foreground truncate group-hover:text-primary transition-colors">
                              {task.task_name}
                            </div>
                            {task.project_name && (
                              <div className="text-[10px] text-muted-foreground font-mono truncate">
                                Project: {task.project_name}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                          <PriorityBadge priority={task.priority} className="text-[10px]" />
                          {task.planned_hours ? (
                            <span className="text-[10px] font-mono text-muted-foreground">
                              Plan: {task.planned_hours}h
                            </span>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Bottom Action Footer Bar */}
            <div className="pt-3 border-t border-border/60 flex flex-col sm:flex-row items-center justify-between gap-2.5 sm:gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleChooseOther}
                disabled={busy}
                className="h-9 sm:h-10 text-xs font-semibold gap-1.5 text-muted-foreground hover:text-foreground border-border w-full sm:w-auto justify-center"
              >
                Choose Other <ArrowRight className="h-3.5 w-3.5" />
              </Button>

              <div className="flex flex-col items-center sm:items-end w-full sm:w-auto space-y-1">
                <Button
                  type="button"
                  size="default"
                  onClick={handleStartCounter}
                  disabled={busy}
                  className="h-9 sm:h-10 px-4 sm:px-5 text-xs font-bold gap-2 bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg transition-all active:scale-[0.98] rounded-xl w-full sm:w-auto justify-center"
                >
                  <Play className="h-4 w-4 fill-white" /> Start Counter Now
                </Button>
                <span className="text-[9px] sm:text-[10px] text-muted-foreground text-center sm:text-right">
                  This will start your timer and mark the task as In Progress
                </span>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
