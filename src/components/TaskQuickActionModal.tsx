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
import { taskEodService } from "@/services/task-eod";
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
              <StatusBadge status={task.status} />
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
              <Badge variant="outline" className="bg-indigo-500/10 text-indigo-400 border-indigo-500/30 text-[10px] font-bold">
                🎯 Planned: {formatHoursMins(planned)}
              </Badge>
              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-[10px] font-bold">
                ⏱️ Logged: {formatHoursMins(actual)}
              </Badge>
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
                size="sm"
                className="h-10 justify-start text-xs gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium"
                disabled={busy || task.status === "Completed"}
                onClick={() => handleSetStatus("Completed")}
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

              {/* 4. Full Edit */}
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

            {/* Quick Log Hours */}
            <div className="p-3 rounded-xl bg-muted/30 border border-border/60 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-foreground flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-primary" /> Log Hours & Minutes
                </span>
                <span className="text-[11px] text-muted-foreground font-mono">
                  Logged: <strong>{formatHoursMins(actual)}</strong> / Planned: <strong>{formatHoursMins(planned)}</strong>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="text"
                  value={hoursInput}
                  onChange={(e) => setHoursInput(e.target.value)}
                  placeholder="e.g. 1.5, 45m, 1h 30m"
                  className="h-8 text-xs font-bold text-primary bg-background border-border text-right"
                />
                <Button
                  size="sm"
                  className="h-8 text-xs shrink-0 bg-indigo-600 hover:bg-indigo-500 text-white font-medium"
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
