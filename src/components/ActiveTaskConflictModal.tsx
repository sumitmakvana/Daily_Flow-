import React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "./StatusBadge";
import { Play, PauseCircle } from "lucide-react";
import type { Task } from "@/lib/types";

interface ActiveTaskConflictModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeTask: Task | null;
  newTask: Task | null;
  onConfirm: () => Promise<void> | void;
  isSubmitting?: boolean;
}

export function ActiveTaskConflictModal({
  open,
  onOpenChange,
  activeTask,
  newTask,
  onConfirm,
  isSubmitting = false,
}: ActiveTaskConflictModalProps) {
  if (!activeTask) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px] bg-card border border-border/80 shadow-2xl rounded-xl p-5">
        <DialogHeader className="space-y-1.5 text-left">
          <DialogTitle className="text-base font-semibold text-foreground flex items-center gap-2">
            <PauseCircle className="h-4 w-4 text-amber-400 shrink-0" />
            Task Already in Progress
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Only one active task can be in progress at a time.
          </DialogDescription>
        </DialogHeader>

        {/* Currently Active Task Highlight Box */}
        <div className="my-3 p-3 bg-muted/40 border border-border/60 rounded-lg space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-mono text-muted-foreground font-semibold">
              {activeTask.task_code || "ACTIVE TASK"}
            </span>
            <StatusBadge status="In Progress" />
          </div>
          <div className="text-xs font-medium text-foreground line-clamp-2">
            {activeTask.task_name}
          </div>
        </div>

        {/* Conflict Question */}
        <p className="text-xs font-semibold text-foreground leading-relaxed my-1">
          You already have a task in progress. Stop the current task and start this new task?
        </p>

        {newTask && (
          <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
            <Play className="h-3 w-3 text-emerald-400 shrink-0" />
            <span>New Task: <strong className="text-foreground">{newTask.task_code ? `[${newTask.task_code}] ` : ""}{newTask.task_name}</strong></span>
          </div>
        )}

        <DialogFooter className="mt-4 flex flex-row justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 px-3 text-xs"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            className="h-8 px-3 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground"
            onClick={async () => {
              await onConfirm();
              onOpenChange(false);
            }}
            disabled={isSubmitting}
          >
            {isSubmitting ? "Switching..." : "Stop & Start New Task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
