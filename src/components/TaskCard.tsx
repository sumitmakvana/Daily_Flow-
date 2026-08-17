import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  Trash2,
  Loader2,
  Copy,
  FileText,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import { PriorityBadge } from "./PriorityBadge";
import { BlockerDialog } from "./BlockerDialog";
import { BlockerAge } from "./BlockerAge";
import { CarryForwardBadge } from "./CarryForwardBadge";
import { TaskHistorySheet } from "./TaskHistorySheet";
import { WorkItemTypeBadge } from "./WorkItemTypeBadge";
import { TaskFormDialog } from "./TaskFormDialog";
import { inlineCompleteStore } from "@/services/inline-complete-store";
import { formatHoursMins, parseHoursOrMins, formatDate, isOverdue, getDefaultStartDate } from "@/lib/format";
import type { Profile, Task, TaskStatus, WorkItemType } from "@/lib/types";
import { cn } from "@/lib/utils";
import { tasksService, TaskConflictError } from "@/services/tasks";
import { taskEodService } from "@/services/task-eod";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
  selected = false,
  onSelectToggle,
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
  selected?: boolean;
  onSelectToggle?: () => void;
}) {
  const [blockOpen, setBlockOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [duplicateOpen, setDuplicateOpen] = useState(false);

  const planned = Number(task.planned_hours ?? 0);
  const currentActual = Number(task.actual_hours ?? 0);
  const remaining = Math.max(0, planned - currentActual);
  const defaultFill = remaining > 0 ? remaining : planned > 0 ? planned : 1;

  const [activeInlineId, setActiveInlineId] = useState(() => inlineCompleteStore.get());
  useEffect(() => inlineCompleteStore.subscribe(() => setActiveInlineId(inlineCompleteStore.get())), []);

  const isCompletingInline = activeInlineId === task.id;

  const [inlineHours, setInlineHours] = useState<string>("");
  const [inlineNote, setInlineNote] = useState<string>("");
  const [inlineBusy, setInlineBusy] = useState(false);
  const [expandedRemarks, setExpandedRemarks] = useState(false);

  const overdue = isOverdue(task.due_date, task.status);
  const isOwner = task.assigned_to === userId;
  const canAct = isOwner || canManage;
  const needsSplit = !!task.project_name?.includes("|");

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

  const handleInlineSubmit = async () => {
    setInlineBusy(true);
    try {
      const hrs = parseHoursOrMins(inlineHours) || defaultFill;
      await tasksService.setStatus(task, "Completed", userId);
      if (hrs > 0 || inlineNote.trim()) {
        await taskEodService.submit(task.id, "done", hrs, inlineNote.trim() || null);
      }
      toast.success(`${task.task_code} completed · ${formatHoursMins(hrs)} logged`);
      inlineCompleteStore.close();
      onChanged();
    } catch (e) {
      handleError(e);
    } finally {
      setInlineBusy(false);
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
      <Card className={cn(
        "p-3 bg-card hover:bg-accent/30 transition-colors flex flex-col gap-3 items-stretch",
        overdue && "border-priority-high/40",
        needsSplit && "border-amber-500/80 bg-amber-500/[0.06] ring-1 ring-amber-500/40 shadow-[0_0_12px_rgba(245,158,11,0.15)]"
      )}>
        <div className="flex gap-3 items-start">
          {onSelectToggle && (
            <div className="pt-1.5 shrink-0 flex items-center justify-center">
              <input
                type="checkbox"
                checked={selected}
                onChange={onSelectToggle}
                className="h-4 w-4 rounded border-muted-foreground/30 bg-background text-primary focus:ring-primary cursor-pointer accent-primary shrink-0"
              />
            </div>
          )}
          
          {/* Main Content Area */}
          <div className="min-w-0 flex-1">
            {/* Header Row: Code/Sprint & Title & Dropdown */}
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
                  <span>{task.task_code}</span>
                  {task.sprint_week && <span>· {task.sprint_week}</span>}
                </div>
                <div className="mt-0.5 font-medium leading-tight truncate">{task.task_name}</div>
                {!compact && (task.client || task.project_name) && (
                  <div className="mt-1 text-xs text-muted-foreground flex flex-wrap items-center gap-1">
                    <span>
                      {task.client}{task.client && task.project_name ? " · " : ""}{task.project_name}
                    </span>
                    {task.project_name?.includes("|") && (
                      <TooltipProvider delayDuration={100}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="shrink-0 text-amber-500 cursor-help select-none font-bold text-xs">
                              ⚠️
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="bg-amber-600 text-white border-none text-[10px] font-semibold py-1 px-2 rounded-md shadow-md">
                            Needs Split
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
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
                  <DropdownMenuItem onClick={() => setDuplicateOpen(true)}>
                    <Copy className="mr-2 h-3.5 w-3.5" /> Duplicate task
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setHistoryOpen(true)}>
                    <History className="mr-2 h-3.5 w-3.5" /> History & comments
                  </DropdownMenuItem>
                  {canAct && task.status !== "On Hold" && task.status !== "Completed" && (
                    <DropdownMenuItem onClick={() => setStatus("On Hold")}>
                      <Pause className="mr-2 h-3.5 w-3.5" /> Put on hold
                    </DropdownMenuItem>
                  )}
                  {canAct && (
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
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={async () => {
                          if (confirm("Are you sure you want to delete this task?")) {
                            try {
                              await tasksService.delete(task.id);
                              toast.success("Task deleted successfully");
                              onChanged();
                            } catch (err) {
                              toast.error((err as Error).message);
                            }
                          }
                        }}
                        className="text-destructive focus:text-destructive focus:bg-destructive/10 cursor-pointer"
                      >
                        <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete task
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Badges/Meta row */}
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
                <span className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-xs font-semibold text-indigo-400 bg-indigo-500/10 border-indigo-500/30">
                  🎯 {formatHoursMins(task.actual_hours ?? 0)} / {formatHoursMins(task.planned_hours)}
                </span>
              ) : null}
              {assignee && (
                <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <UserIcon className="h-3 w-3" /> {assignee.display_name}
                </span>
              )}
            </div>

            {/* Blocker reason row */}
            {task.status === "Blocked" && task.blocker_reason && (
              <div className="mt-2 rounded-md border border-status-blocked/30 bg-status-blocked/5 px-2 py-1 text-xs text-status-blocked">
                <strong className="font-medium">Blocked:</strong> {task.blocker_reason}
              </div>
            )}

            {/* Remarks / Description preview with Expand/Collapse */}
            {task.remarks && (
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  setExpandedRemarks((prev) => !prev);
                }}
                className={cn(
                  "mt-2 rounded-lg bg-secondary/50 hover:bg-secondary/70 border border-border/60 px-2.5 py-1.5 text-xs text-muted-foreground transition-all cursor-pointer select-text",
                  expandedRemarks ? "bg-secondary/80 shadow-inner" : ""
                )}
                title={expandedRemarks ? "Click to collapse" : "Click to view full description"}
              >
                <div className="flex items-start gap-1.5">
                  <FileText className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p
                      className={cn(
                        "leading-relaxed whitespace-pre-wrap",
                        expandedRemarks ? "text-foreground font-normal" : "line-clamp-2"
                      )}
                    >
                      {task.remarks}
                    </p>
                  </div>
                  {task.remarks.length > 60 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedRemarks((prev) => !prev);
                      }}
                      className="shrink-0 text-[10px] font-semibold text-primary hover:underline flex items-center gap-0.5 mt-0.5 ml-1 select-none"
                    >
                      {expandedRemarks ? (
                        <>Less <ChevronUp className="h-3 w-3" /></>
                      ) : (
                        <>More <ChevronDown className="h-3 w-3" /></>
                      )}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Action buttons row */}
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
                    className={cn(
                      "h-11 md:h-8 px-3 text-xs flex-1 md:flex-none min-w-[88px] font-medium transition-all",
                      isCompletingInline ? "bg-indigo-600 text-white font-bold" : "bg-indigo-600 hover:bg-indigo-500 text-white"
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      inlineCompleteStore.toggle(task.id);
                    }}
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
          </div>
        </div>

        {/* Inline Task Completion & Hours Log Panel */}
        {isCompletingInline && (
          <div 
            className="pt-3 border-t border-border/80 bg-muted/40 -mx-3 -mb-3 p-3 rounded-b-xl space-y-2.5 animate-in fade-in slide-in-from-top-1 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between text-xs flex-wrap gap-1">
              <span className="font-semibold text-foreground flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-primary" /> Log Hours & Complete Task
              </span>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span>Planned Target: <strong className="text-foreground">{formatHoursMins(planned)}</strong></span>
                <span>·</span>
                <span>Total Logged So Far: <strong className="text-foreground">{formatHoursMins(currentActual)}</strong></span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-2 items-center">
              <div>
                <label className="text-[11px] font-medium text-muted-foreground block mb-0.5">
                  Today's Worked Hours:
                </label>
                <Input
                  type="text"
                  placeholder="e.g. 1.5, 45m, 1h 30m"
                  className="h-8 text-xs font-bold text-primary bg-background border-border text-right focus-visible:ring-1 focus-visible:ring-primary"
                  value={inlineHours}
                  onChange={(e) => setInlineHours(e.target.value)}
                  disabled={inlineBusy}
                />
              </div>

              <div>
                <label className="text-[11px] font-medium text-muted-foreground block mb-0.5">
                  Remarks / Note (Optional):
                </label>
                <Input
                  type="text"
                  placeholder="Optional remarks..."
                  className="h-8 text-xs bg-background border-border"
                  value={inlineNote}
                  onChange={(e) => setInlineNote(e.target.value)}
                  disabled={inlineBusy}
                />
              </div>
            </div>

            <div className="flex items-center justify-end pt-1 flex-wrap gap-2">
              <div className="flex items-center gap-1.5 ml-auto">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={inlineBusy}
                  onClick={() => inlineCompleteStore.close()}
                  className="h-7 text-xs text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={inlineBusy}
                  onClick={handleInlineSubmit}
                  className="h-7 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white gap-1 shadow-sm"
                >
                  {inlineBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                  Save & Complete
                </Button>
              </div>
            </div>
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

      <TaskFormDialog
        open={duplicateOpen}
        onOpenChange={setDuplicateOpen}
        initial={{
          ...task,
          id: undefined,
          task_code: undefined,
          task_name: `${task.task_name} (Copy)`,
          status: "To Do",
          actual_hours: 0,
          done: false,
          completed_at: null,
          start_date: getDefaultStartDate(),
          planned_hours: task.planned_hours !== undefined && task.planned_hours !== null ? task.planned_hours : 4,
        }}
        userId={userId}
        onSaved={onChanged}
      />
    </>
  );
}
