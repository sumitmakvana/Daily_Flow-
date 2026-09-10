import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { TaskHoursBadges } from "./TaskHoursBadges";
import { PriorityBadge } from "./PriorityBadge";
import { Play, Sun, ArrowRight, Sparkles, Layers } from "lucide-react";
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
  const [busy, setBusy] = useState(false);

  const checkAndOpenDigestModal = async () => {
    if (!user) return;
    const todayStr = new Date().toDateString();
    const lastPromptDate = localStorage.getItem("last_morning_resume_prompt_date");

    // Don't prompt more than once per day
    if (lastPromptDate === todayStr) return;

    try {
      // 1. Check if user already has an active running task
      const active = await tasksService.getActiveTask(user.id);
      if (active && active.started_at) {
        // Already running active task, mark prompted for today
        localStorage.setItem("last_morning_resume_prompt_date", todayStr);
        return;
      }

      // 2. Fetch user's candidate tasks
      const allTasks = await tasksService.queryTasks({
        assignedTo: user.id,
        limit: 30,
      });

      const pendingTasks = allTasks.filter((t) => t.status !== "Completed");
      const highCount = pendingTasks.filter((t) => t.priority === "High").length;
      setTotalPending(pendingTasks.length);
      setHighPriorityCount(highCount);

      // Priority 1: Check for yesterday's paused/in-progress candidate task
      const pausedCandidate = pendingTasks.find(
        (t) =>
          (t.status === "To Do" || t.status === "On Hold") &&
          (Number(t.system_hours ?? 0) > 0 || t.started_at !== null),
      );

      if (pausedCandidate) {
        setFocusTask(pausedCandidate);
        setIsPausedTask(true);
        setOpen(true);
        return;
      }

      // Priority 2: Pick top task from today's Queue (High priority first, or earliest due date)
      const unstartedQueue = pendingTasks.filter((t) => t.status === "To Do" || t.status === "On Hold");

      if (unstartedQueue.length > 0) {
        // Sort by priority (High -> Medium -> Low)
        const priorityScore = (p?: string) => (p === "High" ? 3 : p === "Medium" ? 2 : 1);
        unstartedQueue.sort((a, b) => priorityScore(b.priority) - priorityScore(a.priority));

        setFocusTask(unstartedQueue[0]);
        setIsPausedTask(false);
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

  const handleStartCounter = async () => {
    if (!focusTask || !user) return;
    setBusy(true);
    try {
      await tasksService.setStatus(focusTask, "In Progress", user.id);
      markPromptedToday();
      toast.success(`🌅 Counter started for ${focusTask.task_code || "task"}`);
      setOpen(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
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

  const userName = user?.user_metadata?.display_name || user?.email?.split("@")[0] || "there";

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) handleDismiss();
      }}
    >
      <DialogContent className="sm:max-w-md bg-card border-border text-foreground shadow-2xl rounded-xl p-5 space-y-4">
        <DialogHeader className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-amber-400 font-semibold text-xs tracking-wider uppercase">
              <Sun className="h-4 w-4 animate-spin-slow text-amber-400" />
              <span>Good Morning, {userName}!</span>
            </div>

            {/* Plate Summary Badge */}
            {totalPending > 0 && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium border bg-muted/60 text-muted-foreground border-border/80">
                <Layers className="w-3 h-3 text-primary" />
                <span>
                  Total {totalPending} {totalPending === 1 ? "Task" : "Tasks"}
                  {highPriorityCount > 0 && ` · ${highPriorityCount} High`}
                </span>
              </span>
            )}
          </div>

          <DialogTitle className="text-base font-semibold text-foreground tracking-tight flex items-center gap-2">
            <span>Unified Morning Digest</span>
            <Sparkles className="w-4 h-4 text-amber-400 fill-amber-400/20" />
          </DialogTitle>

          <DialogDescription className="text-xs text-muted-foreground">
            Here is your top main focus task auto-picked for today. Press 1-click start below to fire up your timer and begin!
          </DialogDescription>
        </DialogHeader>

        {/* Clean Main Focus Task Card */}
        <div className="p-3.5 rounded-xl bg-background/90 border border-border/80 space-y-2.5 shadow-xs">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-bold text-primary">
                {focusTask.task_code || "TSK"}
              </span>
              {/* Task Tag */}
              {isPausedTask ? (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-amber-500/10 text-amber-400 border-amber-500/30">
                  Yesterday's Paused
                </span>
              ) : (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-blue-500/10 text-blue-400 border-blue-500/30">
                  Selected from Queue
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <PriorityBadge priority={focusTask.priority} className="text-[10px]" />
              <TaskHoursBadges task={focusTask} className="text-[10px]" />
            </div>
          </div>

          <div className="text-xs font-semibold text-foreground line-clamp-2 leading-relaxed">
            {focusTask.task_name}
          </div>

          {focusTask.project_name && (
            <div className="text-[11px] text-muted-foreground flex items-center gap-1 font-mono pt-0.5">
              <span>Project:</span>{" "}
              <span className="text-foreground/90 font-medium">{focusTask.project_name}</span>
            </div>
          )}
        </div>

        {/* 1-Click Action Footer */}
        <DialogFooter className="flex flex-row items-center justify-between gap-2 pt-2 border-t border-border/60">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleChooseOther}
            disabled={busy}
            className="h-9 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
          >
            Choose Other <ArrowRight className="h-3.5 w-3.5" />
          </Button>

          <Button
            type="button"
            size="sm"
            onClick={handleStartCounter}
            disabled={busy}
            className="h-9 px-4 text-xs font-semibold gap-2 bg-emerald-600 hover:bg-emerald-500 text-white shadow-md transition-all active:scale-[0.98]"
          >
            <Play className="h-4 w-4 fill-white" /> Start Counter Now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

