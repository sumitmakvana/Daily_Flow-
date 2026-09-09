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
import { Play, Pause, Sun, ArrowRight } from "lucide-react";
import type { Task } from "@/lib/types";
import { tasksService } from "@/services/tasks";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";

export function MorningResumePromptModal() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [pausedTask, setPausedTask] = useState<Task | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    const todayStr = new Date().toDateString();
    const lastPromptDate = localStorage.getItem("last_morning_resume_prompt_date");

    // Don't prompt more than once per day
    if (lastPromptDate === todayStr) return;

    let isMounted = true;
    (async () => {
      try {
        // 1. Check if user already has an active running task
        const active = await tasksService.getActiveTask(user.id);
        if (active && active.started_at) {
          // Already running active task, mark prompted for today
          localStorage.setItem("last_morning_resume_prompt_date", todayStr);
          return;
        }

        // 2. Fetch user's candidate paused task from yesterday/recent days
        const candidateRes = await tasksService.queryTasks({
          assignedTo: user.id,
          limit: 10,
        });

        if (!isMounted) return;

        // Find candidate task: status 'To Do' or 'On Hold' with system_hours > 0 or previously started
        const candidate = candidateRes.find(
          (t) =>
            (t.status === "To Do" || t.status === "On Hold") &&
            (Number(t.system_hours ?? 0) > 0 || t.started_at === null),
        );

        if (candidate) {
          setPausedTask(candidate);
          setOpen(true);
        }
      } catch (err) {
        console.warn("[MorningResumePrompt] check failed:", (err as Error).message);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [user]);

  const markPromptedToday = () => {
    localStorage.setItem("last_morning_resume_prompt_date", new Date().toDateString());
  };

  const handleResume = async () => {
    if (!pausedTask || !user) return;
    setBusy(true);
    try {
      await tasksService.setStatus(pausedTask, "In Progress", user.id);
      markPromptedToday();
      toast.success(`🌅 Resumed timer for ${pausedTask.task_code || "task"}`);
      setOpen(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleKeepPaused = () => {
    markPromptedToday();
    setOpen(false);
  };

  const handleChooseOther = () => {
    markPromptedToday();
    setOpen(false);
    navigate({ to: "/my-day" });
  };

  if (!open || !pausedTask) return null;

  const userName = user?.user_metadata?.display_name || user?.email?.split("@")[0] || "there";

  return (
    <Dialog open={open} onOpenChange={(v) => {
      if (!v) handleKeepPaused();
    }}>
      <DialogContent className="sm:max-w-md bg-card border-border text-foreground shadow-2xl rounded-xl p-5">
        <DialogHeader className="space-y-1.5">
          <div className="flex items-center gap-2 text-amber-400 font-semibold text-xs tracking-wider uppercase">
            <Sun className="h-4 w-4 animate-spin-slow" /> Good Morning, {userName}!
          </div>
          <DialogTitle className="text-base font-semibold text-foreground tracking-tight">
            Resume Yesterday's Active Task?
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            You had an active task paused from your previous session. Would you like to resume your timer now?
          </DialogDescription>
        </DialogHeader>

        {/* Task Card Summary */}
        <div className="my-2 p-3 rounded-lg bg-background/80 border border-border/80 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-xs font-bold text-primary">{pausedTask.task_code || "TSK"}</span>
            <TaskHoursBadges task={pausedTask} className="text-[10px]" />
          </div>
          <div className="text-xs font-medium text-foreground line-clamp-2">{pausedTask.task_name}</div>
          {pausedTask.project_name && (
            <div className="text-[10px] text-muted-foreground flex items-center gap-1 font-mono">
              <span>Project:</span> <span className="text-foreground/80 font-semibold">{pausedTask.project_name}</span>
            </div>
          )}
        </div>

        <DialogFooter className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-border/60">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleKeepPaused}
            disabled={busy}
            className="h-8 text-xs gap-1 border-border text-muted-foreground hover:text-foreground"
          >
            <Pause className="h-3 w-3" /> Keep Paused
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleChooseOther}
            disabled={busy}
            className="h-8 text-xs gap-1 text-muted-foreground hover:text-foreground"
          >
            Choose Other <ArrowRight className="h-3 w-3" />
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleResume}
            disabled={busy}
            className="h-8 text-xs font-semibold gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white"
          >
            <Play className="h-3.5 w-3.5 fill-white" /> Resume Timer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
