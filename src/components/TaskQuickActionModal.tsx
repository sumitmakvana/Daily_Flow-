import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  Play,
  AlertOctagon,
  Clock,
  Pencil,
  CalendarClock,
  Folder,
  Loader2,
} from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import { PriorityBadge } from "./PriorityBadge";
import { BlockerDialog } from "./BlockerDialog";
import type { Task, TaskStatus } from "@/lib/types";
import { tasksService, TaskConflictError } from "@/services/tasks";
import { toast } from "sonner";

export function TaskQuickActionModal({
  task,
  open,
  onOpenChange,
  userId,
  onChanged,
  onOpenFullEdit,
}: {
  task: Task | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  onChanged: () => void;
  onOpenFullEdit?: () => void;
}) {
  const [blockOpen, setBlockOpen] = useState(false);
  const [hoursInput, setHoursInput] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const [prevOpen, setPrevOpen] = useState(false);
  const [prevTaskId, setPrevTaskId] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (open && task) {
      if (!prevOpen || task.id !== prevTaskId) {
        setHoursInput(task.actual_hours != null ? String(task.actual_hours) : "");
      }
    }
    setPrevOpen(open);
    setPrevTaskId(task?.id);
  }, [open, task]);

  if (!task) return null;

  const handleError = (e: unknown) => {
    if (e instanceof TaskConflictError) {
      toast.error(e.message);
      onChanged();
    } else {
      toast.error((e as Error).message);
    }
  };

  const handleSetStatus = async (status: TaskStatus, extras = {}) => {
    setBusy(true);
    try {
      await tasksService.setStatus(task, status, userId, extras);
      toast.success(`${task.task_code} updated to ${status}`);
      onChanged();
      onOpenChange(false);
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  };

  const handleSaveHours = async () => {
    const hours = Number(hoursInput);
    if (isNaN(hours) || hours < 0 || hours > 24) {
      toast.error("Please enter hours between 0 and 24");
      return;
    }
    setBusy(true);
    try {
      await tasksService.update(task, { actual_hours: hours }, userId);
      toast.success(`Logged ${hours}h for ${task.task_code}`);
      onChanged();
      onOpenChange(false);
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[calc(100vw-24px)] sm:max-w-md p-4 space-y-4 max-h-[85vh] overflow-y-auto rounded-2xl">
          <DialogHeader className="pb-2 border-b border-border/60">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="font-mono text-xs text-muted-foreground font-semibold">
                {task.task_code}
              </span>
              <StatusBadge status={task.status} />
              <PriorityBadge priority={task.priority} />
            </div>
            <DialogTitle className="text-base font-semibold leading-snug">
              {task.task_name}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground pt-1 flex items-center gap-3 flex-wrap">
              {task.project_name && (
                <span className="flex items-center gap-1">
                  <Folder className="h-3 w-3 text-muted-foreground" />
                  {task.project_name}
                </span>
              )}
              {task.due_date && (
                <span className="flex items-center gap-1">
                  <CalendarClock className="h-3 w-3 text-muted-foreground" />
                  {task.due_date}
                </span>
              )}
              <span>Planned: {task.planned_hours || 1}h</span>
            </DialogDescription>
          </DialogHeader>

          {/* Quick Actions Panel */}
          <div className="space-y-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Quick Actions
            </div>

            <div className="grid grid-cols-2 gap-2">
              {/* 1. Mark Complete */}
              <Button
                variant={task.status === "Completed" ? "secondary" : "default"}
                size="sm"
                className="h-10 justify-start text-xs gap-2"
                disabled={busy || task.status === "Completed"}
                onClick={() => handleSetStatus("Completed")}
              >
                <CheckCircle2 className="h-4 w-4 text-status-completed" />
                {task.status === "Completed" ? "Completed" : "Mark Complete"}
              </Button>

              {/* 2. In Progress */}
              <Button
                variant={task.status === "In Progress" ? "secondary" : "outline"}
                size="sm"
                className="h-10 justify-start text-xs gap-2"
                disabled={busy || task.status === "In Progress"}
                onClick={() => handleSetStatus("In Progress")}
              >
                <Play className="h-4 w-4 text-primary" />
                {task.status === "In Progress" ? "In Progress" : "Start Work"}
              </Button>

              {/* 3. Flag Blocker */}
              <Button
                variant={task.status === "Blocked" ? "destructive" : "outline"}
                size="sm"
                className="h-10 justify-start text-xs gap-2"
                disabled={busy}
                onClick={() => setBlockOpen(true)}
              >
                <AlertOctagon className="h-4 w-4 text-priority-high" />
                {task.status === "Blocked" ? "Blocked" : "Flag Blocker"}
              </Button>

              {/* 4. Full Edit */}
              <Button
                variant="ghost"
                size="sm"
                className="h-10 justify-start text-xs gap-2 border border-border/50"
                disabled={busy}
                onClick={() => {
                  onOpenChange(false);
                  onOpenFullEdit?.();
                }}
              >
                <Pencil className="h-4 w-4 text-muted-foreground" />
                Edit Details
              </Button>
            </div>

            {/* Quick Log Hours */}
            <div className="p-2.5 rounded-lg bg-muted/40 border border-border/50 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium flex items-center gap-1.5 text-muted-foreground">
                  <Clock className="h-3.5 w-3.5 text-primary" /> Log Hours Worked
                </span>
                <span className="text-[11px] text-muted-foreground">
                  Logged: {task.actual_hours || 0}h
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  step="0.5"
                  min="0"
                  max="24"
                  value={hoursInput}
                  onChange={(e) => setHoursInput(e.target.value)}
                  placeholder="e.g. 2.5"
                  className="h-8 text-xs flex-1"
                />
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-8 text-xs shrink-0"
                  disabled={busy || !hoursInput}
                  onClick={handleSaveHours}
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save Hours"}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Blocker Dialog */}
      <BlockerDialog
        open={blockOpen}
        onOpenChange={setBlockOpen}
        taskCode={task.task_code}
        onConfirm={(reason) => {
          setBlockOpen(false);
          handleSetStatus("Blocked", { blocker_reason: reason });
        }}
      />
    </>
  );
}
