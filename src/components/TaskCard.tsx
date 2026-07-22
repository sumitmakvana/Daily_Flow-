import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
} from "@/components/ui/dropdown-menu";
import {
  Play,
  Pause,
  CheckCircle2,
  AlertOctagon,
  MoreHorizontal,
  Clock,
  User as UserIcon,
  Send,
  History,
  Pencil,
} from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import { PriorityBadge } from "./PriorityBadge";
import { BlockerDialog } from "./BlockerDialog";
import { BlockerAge } from "./BlockerAge";
import { CarryForwardBadge } from "./CarryForwardBadge";
import { TaskHistorySheet } from "./TaskHistorySheet";
import { WorkItemTypeBadge } from "./WorkItemTypeBadge";
import { TaskFormDialog } from "./TaskFormDialog";
import type { Profile, Task, TaskStatus, WorkItemType } from "@/lib/types";
import { formatDate, isOverdue } from "@/lib/format";
import { cn } from "@/lib/utils";
import { tasksService, TaskConflictError } from "@/services/tasks";
import { toast } from "sonner";

export function TaskCard({
  task,
  assignee,
  userId,
  profiles,
  workItemTypes = [],
  canManage = false,
  onChanged,
  compact,
}: {
  task: Task;
  assignee?: Profile;
  userId: string;
  profiles: Profile[];
  workItemTypes?: WorkItemType[];
  /** Set true for managers/admins to expose reassign + hold actions. */
  canManage?: boolean;
  onChanged: () => void;
  compact?: boolean;
}) {
  const [blockOpen, setBlockOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const overdue = isOverdue(task.due_date, task.status);
  const isOwner = task.assigned_to === userId;
  const canAct = isOwner || canManage;

  const handleError = (e: unknown) => {
    if (e instanceof TaskConflictError) {
      toast.error(e.message);
      onChanged();
    } else {
      toast.error((e as Error).message);
    }
  };

  const setStatus = async (s: TaskStatus, extras = {}) => {
    try {
      await tasksService.setStatus(task, s, userId, extras);
      toast.success(`${task.task_code} → ${s}`);
      onChanged();
    } catch (e) {
      handleError(e);
    }
  };

  const transfer = async (newUserId: string) => {
    try {
      await tasksService.transfer(task, newUserId, userId);
      toast.success("Transferred");
      onChanged();
    } catch (e) {
      handleError(e);
    }
  };

  return (
    <>
      <Card className={cn("p-3 bg-card hover:bg-accent/30 transition-colors", overdue && "border-priority-high/40")}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
              <span>{task.task_code}</span>
              {task.sprint_week && <span>· {task.sprint_week}</span>}
            </div>
            <div className="mt-0.5 font-medium leading-tight truncate">{task.task_name}</div>
            {!compact && (task.client || task.project_name) && (
              <div className="mt-1 text-xs text-muted-foreground truncate">
                {task.client}{task.client && task.project_name ? " · " : ""}{task.project_name}
              </div>
            )}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="h-11 w-11 md:h-9 md:w-9 shrink-0">
                <MoreHorizontal className="h-5 w-5 md:h-4 md:w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52 max-h-64 overflow-y-auto">
              {canAct && (
                <DropdownMenuItem onClick={() => setFormOpen(true)}>
                  <Pencil className="mr-2 h-3.5 w-3.5" /> Edit task
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => setHistoryOpen(true)}>
                <History className="mr-2 h-3.5 w-3.5" /> History & comments
              </DropdownMenuItem>
              {canAct && task.status !== "On Hold" && task.status !== "Completed" && (
                <DropdownMenuItem onClick={() => setStatus("On Hold")}>
                  <Pause className="mr-2 h-3.5 w-3.5" /> Put on hold
                </DropdownMenuItem>
              )}
              {canManage && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <Send className="mr-2 h-3.5 w-3.5" /> Transfer to
                    </DropdownMenuSubTrigger>
                    <DropdownMenuPortal>
                      <DropdownMenuSubContent className="max-h-64 overflow-y-auto">
                        {profiles
                          .filter((p) => p.id !== task.assigned_to)
                          .map((p) => (
                            <DropdownMenuItem key={p.id} onClick={() => transfer(p.id)}>
                              <Send className="mr-2 h-3.5 w-3.5" /> {p.display_name}
                            </DropdownMenuItem>
                          ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuPortal>
                  </DropdownMenuSub>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <WorkItemTypeBadge type={workItemTypes.find((t) => t.id === task.type_id)} compact />
          <StatusBadge status={task.status} />
          <PriorityBadge priority={task.priority} />
          {task.status === "Blocked" && <BlockerAge blockedAt={task.blocked_at} />}
          <CarryForwardBadge count={task.carry_forward_count ?? 0} />
          {task.due_date && (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs",
                overdue
                  ? "border-priority-high/40 text-priority-high bg-priority-high/10"
                  : "border-border text-muted-foreground",
              )}
            >
              <Clock className="h-3 w-3" />
              {formatDate(task.due_date)}
            </span>
          )}
          {task.planned_hours ? (
            <span className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-xs text-muted-foreground">
              {task.actual_hours ?? 0}h / {task.planned_hours}h
            </span>
          ) : null}
          {assignee && (
            <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
              <UserIcon className="h-3 w-3" /> {assignee.display_name}
            </span>
          )}
        </div>

        {task.status === "Blocked" && task.blocker_reason && (
          <div className="mt-2 rounded-md border border-status-blocked/30 bg-status-blocked/5 px-2 py-1 text-xs text-status-blocked">
            <strong className="font-medium">Blocked:</strong> {task.blocker_reason}
          </div>
        )}

        {canAct && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {task.status !== "In Progress" && task.status !== "Completed" && (
              <Button
                size="sm"
                variant="secondary"
                className="h-11 md:h-8 px-3 text-xs flex-1 md:flex-none min-w-[88px]"
                onClick={() => setStatus("In Progress")}
              >
                <Play className="mr-1 h-3.5 w-3.5" /> Start
              </Button>
            )}
            {task.status === "In Progress" && (
              <Button
                size="sm"
                variant="secondary"
                className="h-11 md:h-8 px-3 text-xs flex-1 md:flex-none"
                onClick={() => setStatus("In Review")}
              >
                Send to review
              </Button>
            )}
            {task.status !== "Completed" && (
              <Button
                size="sm"
                className="h-11 md:h-8 px-3 text-xs flex-1 md:flex-none min-w-[88px]"
                onClick={() => setStatus("Completed")}
              >
                <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Complete
              </Button>
            )}
            {task.status !== "Blocked" && task.status !== "Completed" && (
              <Button
                size="sm"
                variant="outline"
                className="h-11 md:h-8 px-3 text-xs flex-1 md:flex-none min-w-[88px] border-status-blocked/40 text-status-blocked hover:bg-status-blocked/10"
                onClick={() => setBlockOpen(true)}
              >
                <AlertOctagon className="mr-1 h-3.5 w-3.5" /> Block
              </Button>
            )}
            {task.status === "Completed" && (
              <Button
                size="sm"
                variant="ghost"
                className="h-11 md:h-8 px-3 text-xs"
                onClick={() => setStatus("To Do")}
              >
                Reopen
              </Button>
            )}
          </div>
        )}
      </Card>

      <BlockerDialog
        open={blockOpen}
        onOpenChange={setBlockOpen}
        taskCode={task.task_code}
        onConfirm={(reason) => {
          setBlockOpen(false);
          setStatus("Blocked", { blocker_reason: reason });
        }}
      />

      <TaskHistorySheet
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        task={task}
        profiles={profiles}
        userId={userId}
        canModerate={canManage}
      />

      <TaskFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        initial={task}
        userId={userId}
        onSaved={onChanged}
      />
    </>
  );
}
