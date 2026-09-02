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
  Pause,
  AlertOctagon,
  Clock,
  Pencil,
  CalendarClock,
  Folder,
  Loader2,
  FileText,
  PauseCircle,
} from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import { PriorityBadge } from "./PriorityBadge";
import { BlockerDialog } from "./BlockerDialog";
import { OnHoldDialog } from "./OnHoldDialog";
import type { Task, TaskStatus } from "@/lib/types";
import { tasksService, TaskConflictError } from "@/services/tasks";
import { taskEodService } from "@/services/task-eod";
import { completeEodStore } from "@/services/complete-eod-store";
import { TaskHoursBadges } from "./TaskHoursBadges";
import { formatHoursMins, parseHoursOrMins } from "@/lib/format";
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
  onOpenFullEdit?: (task: Task) => void;
}) {
  const [blockOpen, setBlockOpen] = useState(false);
  const [onHoldOpen, setOnHoldOpen] = useState(false);
  const [hoursInput, setHoursInput] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const [prevOpen, setPrevOpen] = useState(false);
  const [prevTaskId, setPrevTaskId] = useState<string | undefined>(undefined);

  const planned = Number(task?.planned_hours ?? 1);
  const actual = Number(task?.actual_hours ?? 0);

  useEffect(() => {
    if (open && task) {
      if (!prevOpen || task.id !== prevTaskId) {
        const fill = task.actual_hours != null && Number(task.actual_hours) > 0 
          ? String(task.actual_hours) 
          : "";
        setHoursInput(fill);
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
      const hoursToSave = parseHoursOrMins(hoursInput) || planned;
      
      // Update task status and actual_hours
      await tasksService.setStatus(task, status, userId, { 
        ...extras,
        ...(hoursToSave > 0 ? { actual_hours: hoursToSave } : {}) 
      });

      // Register EOD submission if status is Completed & hours > 0
      if (status === "Completed" && hoursToSave > 0) {
        await taskEodService.submit(task.id, "done", hoursToSave, null);
      }

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
    const hours = parseHoursOrMins(hoursInput);
    if (isNaN(hours) || hours < 0 || hours > 24) {
      toast.error("Please enter valid hours or minutes (e.g. 1.5, 45m, 1h 30m)");
      return;
    }
    setBusy(true);
    try {
      await tasksService.update(task, { actual_hours: hours }, userId);
      toast.success(`Logged ${formatHoursMins(hours)} for ${task.task_code}`);
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
        <DialogContent className="w-[calc(100vw-24px)] sm:max-w-md p-4 space-y-4 max-h-[85vh] overflow-y-auto rounded-2xl bg-card border-border text-card-foreground">
          <DialogHeader className="pb-2 border-b border-border/60">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="font-mono text-xs text-primary font-bold">
                {task.task_code}
              </span>
              <StatusBadge status={task.status} reason={task.hold_reason} />
              <PriorityBadge priority={task.priority} />
            </div>
            <DialogTitle className="text-base font-semibold leading-snug">
              {task.task_name}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground pt-1 flex items-center gap-2 flex-wrap">
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
              <TaskHoursBadges task={task} variant="badges" />
            </DialogDescription>
          </DialogHeader>

          {/* Description / Remarks Section */}
          {task.remarks ? (
            <div className="p-3.5 rounded-xl bg-muted/40 border border-border/80 space-y-1.5 shadow-sm">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <FileText className="h-3.5 w-3.5 text-primary" />
                <span>Description / Remarks</span>
              </div>
              <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed select-text font-normal max-h-48 overflow-y-auto">
                {task.remarks}
              </p>
            </div>
          ) : (
            <div className="p-2.5 rounded-xl bg-muted/20 border border-dashed border-border/60 text-[11px] text-muted-foreground/70 flex items-center gap-1.5 italic">
              <FileText className="h-3.5 w-3.5 opacity-50 shrink-0" />
              <span>No description or remarks provided.</span>
            </div>
          )}

          {/* Quick Actions Panel */}
          <div className="space-y-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Quick Actions
            </div>

            <div className="grid grid-cols-2 gap-2">
              {/* 1. Mark Complete */}
              <Button
                size="sm"
                className="h-10 justify-start text-xs gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium cursor-pointer"
                disabled={busy || task.status === "Completed"}
                onClick={() => {
                  onOpenChange(false);
                  completeEodStore.open(task);
                }}
              >
                <CheckCircle2 className="h-4 w-4 text-white" />
                {task.status === "Completed" ? "Completed" : "Mark Complete"}
              </Button>

              {/* 2. In Progress */}
              <Button
                variant={task.status === "In Progress" ? "secondary" : "outline"}
                size="sm"
                className="h-10 justify-start text-xs gap-2 border-border"
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
                className="h-10 justify-start text-xs gap-2 border-status-blocked/40 text-status-blocked hover:bg-status-blocked/10"
                disabled={busy}
                onClick={() => setBlockOpen(true)}
              >
                <AlertOctagon className="h-4 w-4 text-status-blocked" />
                {task.status === "Blocked" ? "Blocked" : "Flag Blocker"}
              </Button>

              {/* 4. Pause / Resume Timer (Direct 1-Click Action) */}
              {task.status === "In Progress" && task.started_at && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-10 justify-start text-xs gap-2 border-amber-500/40 text-amber-400 hover:bg-amber-500/10 cursor-pointer font-semibold"
                  disabled={busy}
                  onClick={async () => {
                    if (!userId) return;
                    try {
                      setBusy(true);
                      await tasksService.pauseTimer(task, userId);
                      toast.success("Timer paused");
                      onChanged?.();
                      onOpenChange(false);
                    } catch (err: any) {
                      toast.error(err?.message || "Failed to pause timer");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <Pause className="h-4 w-4 text-amber-400" />
                  Pause Timer
                </Button>
              )}
              {task.status === "In Progress" && !task.started_at && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-10 justify-start text-xs gap-2 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 cursor-pointer font-semibold"
                  disabled={busy}
                  onClick={async () => {
                    if (!userId) return;
                    try {
                      setBusy(true);
                      await tasksService.resumeTimer(task, userId);
                      toast.success("Timer resumed");
                      onChanged?.();
                      onOpenChange(false);
                    } catch (err: any) {
                      toast.error(err?.message || "Failed to resume timer");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <Play className="h-4 w-4 text-emerald-400" />
                  Resume Timer
                </Button>
              )}

              {/* 5. Put On Hold (Status Action) */}
              <Button
                variant={task.status === "On Hold" ? "secondary" : "outline"}
                size="sm"
                className="h-10 justify-start text-xs gap-2 border-border/70 text-muted-foreground hover:text-foreground hover:bg-accent/40 cursor-pointer"
                disabled={busy}
                onClick={() => setOnHoldOpen(true)}
              >
                <PauseCircle className="h-4 w-4 text-amber-400/80" />
                {task.status === "On Hold" ? "On Hold" : "Put On Hold"}
              </Button>

              {/* 5. Full Edit */}
              <Button
                variant="ghost"
                size="sm"
                className="h-10 justify-start text-xs gap-2 border border-border/50 text-muted-foreground hover:text-foreground"
                disabled={busy}
                onClick={() => {
                  if (task && onOpenFullEdit) {
                    onOpenFullEdit(task);
                  } else {
                    onOpenChange(false);
                  }
                }}
              >
                <Pencil className="h-4 w-4 text-muted-foreground" />
                Edit Details
              </Button>
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

      {/* On Hold Dialog */}
      <OnHoldDialog
        open={onHoldOpen}
        onOpenChange={setOnHoldOpen}
        taskCode={task.task_code}
        taskTitle={task.task_name}
        onConfirm={(reason) => {
          setOnHoldOpen(false);
          handleSetStatus("On Hold", { hold_reason: reason });
        }}
      />
    </>
  );
}
