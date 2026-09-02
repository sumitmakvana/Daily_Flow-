import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Play, Pause, Clock, ArrowDown } from "lucide-react";
import { activeTimerStore } from "@/services/active-timer-store";

export function TaskSwitchPromptModal({
  userId,
  onTaskChanged,
}: {
  userId: string;
  onTaskChanged?: () => void;
}) {
  const [storeState, setStoreState] = useState(() => activeTimerStore.getState());
  const [elapsedText, setElapsedText] = useState("00:00:00");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    return activeTimerStore.subscribe(() => {
      setStoreState(activeTimerStore.getState());
    });
  }, []);

  const { currentPrimaryTask, pendingTargetTask, isModalOpen } = storeState;

  // Live timer tick for currently running primary task
  useEffect(() => {
    if (!isModalOpen || !currentPrimaryTask) return;

    const calculateElapsed = () => {
      const startedAtStr = (currentPrimaryTask as any).started_at;
      if (!startedAtStr) {
        setElapsedText("00:00:00");
        return;
      }
      const startMs = new Date(startedAtStr).getTime();
      const nowMs = Date.now();
      const diffSec = Math.max(0, Math.floor((nowMs - startMs) / 1000));

      const hrs = Math.floor(diffSec / 3600);
      const mins = Math.floor((diffSec % 3600) / 60);
      const secs = diffSec % 60;

      const pad = (n: number) => n.toString().padStart(2, "0");
      setElapsedText(`${pad(hrs)}:${pad(mins)}:${pad(secs)}`);
    };

    calculateElapsed();
    const interval = setInterval(calculateElapsed, 1000);
    return () => clearInterval(interval);
  }, [isModalOpen, currentPrimaryTask]);

  if (!isModalOpen || !currentPrimaryTask || !pendingTargetTask) {
    return null;
  }

  const handleConfirmSwitch = async () => {
    setIsSubmitting(true);
    try {
      await activeTimerStore.confirmSwitch(userId, () => {
        if (onTaskChanged) onTaskChanged();
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    activeTimerStore.closeModal();
  };

  return (
    <Dialog open={isModalOpen} onOpenChange={(open) => !open && handleCancel()}>
      <DialogContent className="sm:max-w-[460px] w-[calc(100vw-2rem)] bg-card border border-border/80 shadow-2xl rounded-2xl p-5 space-y-4 overflow-hidden">
        {/* Header */}
        <DialogHeader className="space-y-1 text-left">
          <div className="flex items-center gap-2 text-amber-400">
            <div className="h-8 w-8 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
            </div>
            <DialogTitle className="text-base font-semibold text-foreground tracking-tight">
              Switch Active Task?
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-muted-foreground leading-normal pt-1">
            Only 1 task can run at a time. Starting this task will pause your currently running timer.
          </DialogDescription>
        </DialogHeader>

        {/* Task Compare Cards */}
        <div className="space-y-2 min-w-0 w-full">
          {/* Currently Running Task Card */}
          <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-xl space-y-1.5 min-w-0 w-full overflow-hidden">
            <div className="flex items-center justify-between gap-2 min-w-0">
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/20 text-blue-300 border border-blue-500/40 shrink-0">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
                Currently Running
              </span>
              <div className="flex items-center gap-1 font-mono text-xs font-bold text-blue-300 bg-background/80 px-2 py-0.5 rounded-md border border-blue-500/30 shrink-0 shadow-inner">
                <Clock className="w-3 h-3 text-blue-400" />
                <span>{elapsedText}</span>
              </div>
            </div>
            <div className="min-w-0 pt-0.5">
              <div className="font-mono text-xs font-bold text-blue-400">
                {currentPrimaryTask.task_code}
              </div>
              <p className="text-xs font-medium text-foreground truncate block leading-snug">
                {currentPrimaryTask.task_name}
              </p>
            </div>
          </div>

          {/* Transition Indicator */}
          <div className="flex items-center justify-center my-0.5 text-muted-foreground/60">
            <div className="h-6 w-6 rounded-full bg-muted/60 border border-border/50 flex items-center justify-center">
              <ArrowDown className="w-3.5 h-3.5 text-muted-foreground" />
            </div>
          </div>

          {/* New Task to Start Card */}
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl space-y-1.5 min-w-0 w-full overflow-hidden">
            <div className="flex items-center justify-between gap-2 min-w-0">
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shrink-0">
                <Play className="w-2.5 h-2.5 text-emerald-400" />
                New Task to Start
              </span>
            </div>
            <div className="min-w-0 pt-0.5">
              <div className="font-mono text-xs font-bold text-emerald-400">
                {pendingTargetTask.task_code}
              </div>
              <p className="text-xs font-medium text-foreground truncate block leading-snug">
                {pendingTargetTask.task_name}
              </p>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="pt-2 flex flex-col gap-2 min-w-0 w-full">
          <Button
            size="default"
            disabled={isSubmitting}
            onClick={handleConfirmSwitch}
            className="w-full h-9 px-4 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 shadow-md rounded-lg flex items-center justify-center gap-2 truncate cursor-pointer"
          >
            <Pause className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">
              Pause [{currentPrimaryTask.task_code}] & Start [{pendingTargetTask.task_code}]
            </span>
          </Button>

          <Button
            size="default"
            variant="ghost"
            disabled={isSubmitting}
            onClick={handleCancel}
            className="w-full h-8 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent/40 rounded-lg cursor-pointer"
          >
            Keep [{currentPrimaryTask.task_code}] Running
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}


