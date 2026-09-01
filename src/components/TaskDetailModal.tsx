import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Briefcase,
  Calendar,
  CheckCircle2,
  Clock,
  ExternalLink,
  Layers,
  Pencil,
  Play,
  AlertOctagon,
  User,
  Copy,
  Check,
} from "lucide-react";
import type { Task, Profile, TaskStatus } from "@/lib/types";
import { TaskHoursBadges } from "./TaskHoursBadges";
import { formatHoursMins } from "@/lib/format";
import { formatDate } from "@/lib/format";
import { formatToDateStr } from "@/lib/task-date-utils";
import { StatusBadge } from "./StatusBadge";
import { PriorityBadge } from "./PriorityBadge";
import { tasksService } from "@/services/tasks";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export interface TaskDetailModalProps {
  task: Task | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assignedProfile?: Profile | null;
  onEditTask?: (task: Task) => void;
  onTaskUpdated?: () => void;
}

export function TaskDetailModal({
  task,
  open,
  onOpenChange,
  assignedProfile,
  onEditTask,
  onTaskUpdated,
}: TaskDetailModalProps) {
  const { user } = useAuth();
  const [copiedCode, setCopiedCode] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  if (!task) return null;

  const handleCopyCode = () => {
    if (!task.task_code) return;
    navigator.clipboard.writeText(task.task_code);
    setCopiedCode(true);
    toast.success(`Copied ${task.task_code} to clipboard`);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleStatusChange = async (newStatus: TaskStatus) => {
    if (!user) return;
    setIsUpdating(true);
    try {
      await tasksService.setStatus(task, newStatus, user.id);
      toast.success(`${task.task_code || "Task"} marked as ${newStatus}`);
      onTaskUpdated?.();
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err?.message || "Failed to update status");
    } finally {
      setIsUpdating(false);
    }
  };

  const isOverdue =
    task.status !== "Completed" &&
    task.due_date &&
    task.due_date.slice(0, 10) < new Date().toISOString().slice(0, 10);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-popover border border-border shadow-2xl rounded-2xl p-5 text-popover-foreground space-y-4">
        {/* Header */}
        <DialogHeader className="space-y-2 border-b border-border pb-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCopyCode}
                className="font-mono text-xs font-bold text-primary bg-primary/10 hover:bg-primary/20 px-2 py-0.5 rounded border border-primary/30 flex items-center gap-1 transition-colors"
                title="Click to copy task code"
              >
                <span>{task.task_code || "TASK"}</span>
                {copiedCode ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3 opacity-60" />}
              </button>

              <StatusBadge status={task.status} reason={task.hold_reason} />
              <PriorityBadge priority={task.priority} />
            </div>

            {task.project_name && (
              <Badge variant="secondary" className="text-xs bg-muted text-foreground border border-border flex items-center gap-1">
                <Briefcase className="h-3 w-3 text-primary" />
                {task.project_name}
              </Badge>
            )}
          </div>

          <DialogTitle className="text-base font-bold text-foreground leading-snug text-left pt-0.5">
            {task.task_name}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground text-left">
            Detailed information, status, work remarks, and timeline for this task.
          </DialogDescription>
        </DialogHeader>

        {/* Assigned Member Card */}
        {assignedProfile ? (
          <div className="flex items-center justify-between p-3 rounded-xl bg-muted/40 border border-border text-xs">
            <div className="flex items-center gap-2.5 min-w-0">
              <Avatar className="h-8 w-8 border border-border bg-card shrink-0">
                {assignedProfile.avatar_url ? (
                  <AvatarImage src={assignedProfile.avatar_url} alt="" />
                ) : (
                  <AvatarFallback className="text-foreground text-xs font-semibold bg-primary/20">
                    {assignedProfile.display_name.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                )}
              </Avatar>
              <div className="min-w-0">
                <div className="font-semibold text-foreground truncate">{assignedProfile.display_name}</div>
                <div className="text-[11px] text-muted-foreground truncate">{assignedProfile.email || "Team Member"}</div>
              </div>
            </div>

            <TaskHoursBadges task={task} variant="badges" />
          </div>
        ) : (
          <div className="p-2 rounded-xl bg-muted/20 border border-border/60">
            <TaskHoursBadges task={task} variant="badges" />
          </div>
        )}

        {/* Remarks / Description */}
        <div className="space-y-1.5 text-xs">
          <div className="font-semibold text-foreground flex items-center gap-1.5 text-[11px] uppercase tracking-wider">
            <Layers className="h-3.5 w-3.5 text-primary" />
            Task Remarks & Notes
          </div>
          <div className="p-3 rounded-xl bg-card border border-border text-foreground text-xs leading-relaxed max-h-36 overflow-y-auto whitespace-pre-wrap">
            {task.remarks && task.remarks.trim() ? (
              task.remarks
            ) : (
              <span className="text-muted-foreground italic">No detailed remarks or notes provided.</span>
            )}
          </div>
        </div>

        {/* Blocker Alert if Blocked */}
        {task.status === "Blocked" && task.blocker_reason && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 space-y-1 text-xs">
            <div className="font-bold flex items-center gap-1.5">
              <AlertOctagon className="h-4 w-4" /> Active Blocker Reason:
            </div>
            <p className="text-xs leading-relaxed pl-5">{task.blocker_reason}</p>
          </div>
        )}

        {/* Metadata Details Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
          <div className="p-2.5 rounded-xl bg-muted/30 border border-border space-y-0.5">
            <span className="text-[10px] text-muted-foreground uppercase font-semibold block">Due Date</span>
            <span className={cn("font-mono font-medium flex items-center gap-1 text-[11px]", isOverdue ? "text-rose-400 font-bold" : "text-foreground")}>
              <Calendar className="h-3 w-3" />
              {task.due_date ? formatToDateStr(task.due_date) : "Not set"}
              {isOverdue && <span className="text-[9px] bg-rose-500/20 px-1 py-0 rounded">Overdue</span>}
            </span>
          </div>

          <div className="p-2.5 rounded-xl bg-muted/30 border border-border space-y-0.5">
            <span className="text-[10px] text-muted-foreground uppercase font-semibold block">Created</span>
            <span className="font-mono text-foreground font-medium text-[11px] block">
              {task.created_at ? formatDate(task.created_at) : "Today"}
            </span>
          </div>

          <div className="p-2.5 rounded-xl bg-muted/30 border border-border space-y-0.5 col-span-2 sm:col-span-1">
            <span className="text-[10px] text-muted-foreground uppercase font-semibold block">Client / Team</span>
            <span className="text-foreground font-medium text-[11px] truncate block">
              {task.client || "Internal"}
            </span>
          </div>
        </div>

        {/* Footer Quick Actions */}
        <DialogFooter className="border-t border-border pt-3 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            {task.status !== "Completed" && (
              <Button
                size="sm"
                variant="outline"
                disabled={isUpdating}
                onClick={() => handleStatusChange("Completed")}
                className="h-8 text-xs font-semibold text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
              >
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Mark Done
              </Button>
            )}
            {task.status !== "In Progress" && task.status !== "Completed" && (
              <Button
                size="sm"
                variant="outline"
                disabled={isUpdating}
                onClick={() => handleStatusChange("In Progress")}
                className="h-8 text-xs font-semibold text-blue-400 border-blue-500/30 hover:bg-blue-500/10"
              >
                <Play className="h-3 w-3 mr-1" /> Start Task
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {onEditTask && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  onOpenChange(false);
                  onEditTask(task);
                }}
                className="h-8 text-xs border-border bg-card text-foreground hover:bg-accent"
              >
                <Pencil className="h-3.5 w-3.5 mr-1 text-primary" /> Edit Full Task
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => onOpenChange(false)}
              className="h-8 text-xs bg-primary text-primary-foreground hover:bg-primary/90 font-medium"
            >
              Close
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
