import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Briefcase,
  Calendar,
  CheckCircle2,
  Clock,
  Pencil,
  Play,
  Pause,
  AlertOctagon,
  User,
  Copy,
  Check,
  X,
  Maximize2,
  Minimize2,
  PanelRight,
  Share2,
  Sparkles,
  Paperclip,
  Activity,
  MessageSquare,
  ChevronDown,
  Flag,
  Tag,
  Folder,
  Layers,
  ArrowRight,
} from "lucide-react";
import type { Task, Profile, TaskStatus, TaskPriority, Attachment } from "@/lib/types";
import { TASK_STATUSES, TASK_PRIORITIES } from "@/lib/types";
import { TaskHoursBadges } from "./TaskHoursBadges";
import { formatHoursMins, formatDate, isOverdue } from "@/lib/format";
import { formatToDateStr } from "@/lib/task-date-utils";
import { StatusBadge } from "./StatusBadge";
import { PriorityBadge } from "./PriorityBadge";
import { CommentsPanel } from "./CommentsPanel";
import { ActiveTaskConflictModal } from "./ActiveTaskConflictModal";
import { attachmentsService } from "@/services/attachments";
import { tasksService } from "@/services/tasks";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export type DetailViewMode = "modal" | "fullscreen" | "sidebar";

export interface TaskDetailModalProps {
  task: Task | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assignedProfile?: Profile | null;
  profiles?: Profile[];
  onEditTask?: (task: Task) => void;
  onTaskUpdated?: () => void;
}

export function TaskDetailModal({
  task,
  open,
  onOpenChange,
  assignedProfile,
  profiles = [],
  onEditTask,
  onTaskUpdated,
}: TaskDetailModalProps) {
  const { user, isManager } = useAuth();
  const [viewMode, setViewMode] = useState<DetailViewMode>("modal");
  const [copiedCode, setCopiedCode] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [conflictModalOpen, setConflictModalOpen] = useState(false);
  const [existingActiveTask, setExistingActiveTask] = useState<Task | null>(null);

  const [isEditingRemarks, setIsEditingRemarks] = useState(false);
  const [remarksValue, setRemarksValue] = useState("");

  const [isEditingEstimate, setIsEditingEstimate] = useState(false);
  const [estimateValue, setEstimateValue] = useState("");

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState("");

  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [timerSeconds, setTimerSeconds] = useState(0);

  useEffect(() => {
    if (task) {
      setRemarksValue(task.remarks || "");
      setEstimateValue(task.planned_hours ? String(task.planned_hours) : "");
      setTitleValue(task.task_name || "");
      if (task.id) {
        attachmentsService.list(task.id).then(setAttachments).catch(() => {});
      }
    }
  }, [task]);

  useEffect(() => {
    if (!task?.started_at || task.status !== "In Progress") {
      setTimerSeconds(0);
      return;
    }
    const startMs = new Date(task.started_at).getTime();
    const updateTicker = () => {
      const elapsedSec = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
      setTimerSeconds(elapsedSec);
    };
    updateTicker();
    const interval = setInterval(updateTicker, 1000);
    return () => clearInterval(interval);
  }, [task?.started_at, task?.status]);

  if (!task || !open) return null;

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
      if (newStatus === "In Progress") {
        const currentActive = await tasksService.getActiveTask(user.id);
        if (currentActive && currentActive.id !== task.id) {
          setExistingActiveTask(currentActive);
          setConflictModalOpen(true);
          setIsUpdating(false);
          return;
        }
      }
      await tasksService.setStatus(task, newStatus, user.id);
      toast.success(`${task.task_code || "Task"} marked as ${newStatus}`);
      onTaskUpdated?.();
    } catch (err: any) {
      toast.error(err?.message || "Failed to update status");
    } finally {
      setIsUpdating(false);
    }
  };

  const handlePriorityChange = async (newPriority: TaskPriority) => {
    if (!user) return;
    setIsUpdating(true);
    try {
      await tasksService.setPriority(task, newPriority, user.id);
      toast.success(`Priority set to ${newPriority}`);
      onTaskUpdated?.();
    } catch (err: any) {
      toast.error(err?.message || "Failed to update priority");
    } finally {
      setIsUpdating(false);
    }
  };

  const handleAssigneeChange = async (newAssigneeId: string) => {
    if (!user) return;
    setIsUpdating(true);
    try {
      await tasksService.transfer(task, newAssigneeId, user.id);
      toast.success(`Task reassigned successfully`);
      onTaskUpdated?.();
    } catch (err: any) {
      toast.error(err?.message || "Failed to reassign task");
    } finally {
      setIsUpdating(false);
    }
  };

  const handleSaveTitle = async () => {
    if (!user || !titleValue.trim() || titleValue === task.task_name) {
      setIsEditingTitle(false);
      return;
    }
    setIsUpdating(true);
    try {
      await tasksService.update(task, { task_name: titleValue.trim() }, user.id);
      toast.success("Task title updated");
      setIsEditingTitle(false);
      onTaskUpdated?.();
    } catch (err: any) {
      toast.error(err?.message || "Failed to update title");
    } finally {
      setIsUpdating(false);
    }
  };

  const handleSaveRemarks = async () => {
    if (!user) return;
    setIsUpdating(true);
    try {
      await tasksService.update(task, { remarks: remarksValue }, user.id);
      toast.success("Task remarks updated");
      setIsEditingRemarks(false);
      onTaskUpdated?.();
    } catch (err: any) {
      toast.error(err?.message || "Failed to update remarks");
    } finally {
      setIsUpdating(false);
    }
  };

  const handleSaveEstimate = async () => {
    if (!user) return;
    const hrs = parseFloat(estimateValue);
    if (isNaN(hrs) || hrs < 0) {
      toast.error("Please enter a valid positive number for hours");
      return;
    }
    setIsUpdating(true);
    try {
      await tasksService.update(task, { planned_hours: hrs }, user.id);
      toast.success(`Planned estimate set to ${hrs}h`);
      setIsEditingEstimate(false);
      onTaskUpdated?.();
    } catch (err: any) {
      toast.error(err?.message || "Failed to update estimate");
    } finally {
      setIsUpdating(false);
    }
  };

  const handleToggleTimer = async () => {
    if (!user) return;
    setIsUpdating(true);
    try {
      if (task.status === "In Progress" && task.started_at) {
        await tasksService.pauseTimer(task, user.id);
        toast.success("Timer paused");
      } else {
        const currentActive = await tasksService.getActiveTask(user.id);
        if (currentActive && currentActive.id !== task.id) {
          setExistingActiveTask(currentActive);
          setConflictModalOpen(true);
          setIsUpdating(false);
          return;
        }
        await tasksService.resumeTimer(task, user.id);
        toast.success("Timer started");
      }
      onTaskUpdated?.();
    } catch (err: any) {
      toast.error(err?.message || "Failed to toggle timer");
    } finally {
      setIsUpdating(false);
    }
  };

  const handleConfirmSwitch = async () => {
    if (!existingActiveTask || !user) return;
    setIsUpdating(true);
    try {
      await tasksService.switchActiveTask(existingActiveTask, task, user.id);
      toast.success(`Stopped ${existingActiveTask.task_code || "active task"} · Started ${task.task_code}`);
      onTaskUpdated?.();
    } catch (err: any) {
      toast.error(err?.message || "Failed to switch active task");
    } finally {
      setIsUpdating(false);
    }
  };

  const taskOverdue = isOverdue(task.due_date, task.status);
  const currentAssignedProfile = profiles.find((p) => p.id === task.assigned_to) || assignedProfile;

  const formatTicker = (totalSec: number) => {
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    if (hrs > 0) {
      return `${hrs}h ${String(mins).padStart(2, "0")}m ${String(secs).padStart(2, "0")}s`;
    }
    return `${mins}m ${String(secs).padStart(2, "0")}s`;
  };

  const renderDetailContent = () => (
    <div className="flex flex-col h-full bg-card text-foreground overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-border/80 bg-background/80 backdrop-blur-md shrink-0 flex-wrap sm:flex-nowrap">
        <div className="flex items-center gap-2 text-xs min-w-0 flex-1 flex-wrap">
          <div className="flex items-center gap-1.5 text-muted-foreground font-medium truncate">
            <Folder className="h-3.5 w-3.5 text-primary shrink-0" />
            <span className="truncate">{task.project_name || task.client || "Team Space"}</span>
            <span className="text-border">/</span>
          </div>

          <button
            type="button"
            onClick={handleCopyCode}
            className="font-mono text-xs font-bold text-primary bg-primary/10 hover:bg-primary/20 px-2 py-0.5 rounded border border-primary/30 flex items-center gap-1 transition-colors"
            title="Click to copy task code"
          >
            <span>{task.task_code || "TASK"}</span>
            {copiedCode ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3 opacity-60" />}
          </button>

          {task.created_at && (
            <span className="text-[11px] text-muted-foreground font-mono hidden md:inline-block">
              Created {formatDate(task.created_at)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2.5 text-xs gap-1.5 border border-border/60 bg-muted/30 hover:bg-accent text-foreground rounded-lg"
                title="Switch layout view mode"
              >
                {viewMode === "modal" && <Minimize2 className="h-3.5 w-3.5 text-primary" />}
                {viewMode === "fullscreen" && <Maximize2 className="h-3.5 w-3.5 text-primary" />}
                {viewMode === "sidebar" && <PanelRight className="h-3.5 w-3.5 text-primary" />}
                <span className="capitalize text-xs font-semibold">{viewMode}</span>
                <ChevronDown className="h-3 w-3 opacity-60" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-3 bg-popover border border-border shadow-2xl rounded-xl space-y-2">
              <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                Display View Mode
              </div>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setViewMode("modal")}
                  className={cn(
                    "flex flex-col items-center justify-center p-2 rounded-lg border text-xs font-medium transition-all gap-1.5",
                    viewMode === "modal"
                      ? "bg-primary/15 border-primary text-primary font-bold shadow-xs"
                      : "bg-muted/40 border-border/60 text-muted-foreground hover:text-foreground hover:bg-accent"
                  )}
                >
                  <div className="w-10 h-6 border-2 border-current rounded-sm flex items-center justify-center">
                    <div className="w-6 h-3 bg-current/20 rounded-2xs" />
                  </div>
                  <span>Modal</span>
                </button>

                <button
                  type="button"
                  onClick={() => setViewMode("fullscreen")}
                  className={cn(
                    "flex flex-col items-center justify-center p-2 rounded-lg border text-xs font-medium transition-all gap-1.5",
                    viewMode === "fullscreen"
                      ? "bg-primary/15 border-primary text-primary font-bold shadow-xs"
                      : "bg-muted/40 border-border/60 text-muted-foreground hover:text-foreground hover:bg-accent"
                  )}
                >
                  <div className="w-10 h-6 border-2 border-current rounded-sm flex items-center justify-center">
                    <div className="w-full h-full bg-current/20" />
                  </div>
                  <span>Full screen</span>
                </button>

                <button
                  type="button"
                  onClick={() => setViewMode("sidebar")}
                  className={cn(
                    "flex flex-col items-center justify-center p-2 rounded-lg border text-xs font-medium transition-all gap-1.5",
                    viewMode === "sidebar"
                      ? "bg-primary/15 border-primary text-primary font-bold shadow-xs"
                      : "bg-muted/40 border-border/60 text-muted-foreground hover:text-foreground hover:bg-accent"
                  )}
                >
                  <div className="w-10 h-6 border-2 border-current rounded-sm flex justify-end p-0.5">
                    <div className="w-4 h-full bg-current/40 rounded-2xs" />
                  </div>
                  <span>Sidebar</span>
                </button>
              </div>
            </PopoverContent>
          </Popover>

          {onEditTask && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onEditTask(task)}
              className="h-8 px-2.5 text-xs gap-1 border-border text-foreground hover:bg-accent"
              title="Full Edit Form"
            >
              <Pencil className="h-3.5 w-3.5 text-primary" />
              <span className="hidden sm:inline">Edit</span>
            </Button>
          )}

          <Button
            variant="ghost"
            size="icon"
            onClick={() => onOpenChange(false)}
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-border/80 overflow-hidden">
        <div className="lg:col-span-7 p-5 overflow-y-auto space-y-5 custom-scrollbar">
          <div className="space-y-1">
            {isEditingTitle ? (
              <div className="flex items-center gap-2">
                <Input
                  className="text-base font-bold bg-background border-primary"
                  value={titleValue}
                  onChange={(e) => setTitleValue(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSaveTitle()}
                  autoFocus
                />
                <Button size="sm" onClick={handleSaveTitle} disabled={isUpdating} className="h-9 px-3">
                  Save
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setIsEditingTitle(false)} className="h-9 px-2">
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <h2
                onClick={() => setIsEditingTitle(true)}
                className="text-lg font-bold text-foreground leading-snug cursor-pointer hover:bg-accent/40 p-1.5 -ml-1.5 rounded-lg transition-colors group flex items-start gap-2"
                title="Click to edit title"
              >
                <span className="flex-1">{task.task_name}</span>
                <Pencil className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity mt-1 shrink-0" />
              </h2>
            )}
          </div>
          <div className="p-4 rounded-xl bg-muted/20 border border-border/70 space-y-3">
            <div className="grid grid-cols-[130px_1fr] items-center text-xs gap-2">
              <span className="text-muted-foreground font-medium flex items-center gap-1.5">
                <Activity className="h-3.5 w-3.5 text-primary" /> Status
              </span>
              <div className="flex items-center gap-2 flex-wrap">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      disabled={isUpdating}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all cursor-pointer bg-background hover:bg-accent"
                    >
                      <StatusBadge status={task.status} reason={task.hold_reason} />
                      <ChevronDown className="h-3 w-3 opacity-60 ml-1" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-48">
                    <DropdownMenuLabel className="text-[10px] text-muted-foreground uppercase">Set Task Status</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {TASK_STATUSES.map((st) => (
                      <DropdownMenuItem
                        key={st}
                        onClick={() => handleStatusChange(st)}
                        className={cn("flex items-center justify-between text-xs cursor-pointer", task.status === st && "font-bold bg-accent")}
                      >
                        <StatusBadge status={st} />
                        {task.status === st && <Check className="h-3.5 w-3.5 text-primary" />}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                {task.status === "Completed" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isUpdating}
                    onClick={() => handleStatusChange("To Do")}
                    className="h-7 px-3 text-xs gap-1.5 border-blue-500/40 text-blue-400 hover:bg-blue-500/10 font-semibold rounded-lg"
                  >
                    <Play className="h-3.5 w-3.5 text-blue-400" />
                    Reopen Task
                  </Button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-[130px_1fr] items-center text-xs gap-2">
              <span className="text-muted-foreground font-medium flex items-center gap-1.5">
                <User className="h-3.5 w-3.5 text-primary" /> Assignees
              </span>
              <div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      disabled={isUpdating || profiles.length === 0}
                      className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg text-xs font-medium border border-border/70 bg-background hover:bg-accent transition-all cursor-pointer"
                    >
                      {currentAssignedProfile ? (
                        <>
                          <Avatar className="h-5 w-5 border border-border shrink-0">
                            {currentAssignedProfile.avatar_url ? (
                              <AvatarImage src={currentAssignedProfile.avatar_url} />
                            ) : (
                              <AvatarFallback className="text-[10px] font-bold bg-primary/20 text-primary">
                                {currentAssignedProfile.display_name.slice(0, 2).toUpperCase()}
                              </AvatarFallback>
                            )}
                          </Avatar>
                          <span className="font-semibold text-foreground">{currentAssignedProfile.display_name}</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground italic">Unassigned</span>
                      )}
                      {profiles.length > 0 && <ChevronDown className="h-3 w-3 opacity-60 ml-1" />}
                    </button>
                  </DropdownMenuTrigger>
                  {profiles.length > 0 && (
                    <DropdownMenuContent align="start" className="w-56 max-h-64 overflow-y-auto">
                      <DropdownMenuLabel className="text-[10px] text-muted-foreground uppercase">Reassign Task</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {profiles.map((p) => (
                        <DropdownMenuItem
                          key={p.id}
                          onClick={() => handleAssigneeChange(p.id)}
                          className={cn("flex items-center gap-2 text-xs cursor-pointer", task.assigned_to === p.id && "bg-accent font-bold")}
                        >
                          <Avatar className="h-5 w-5 border border-border">
                            {p.avatar_url ? (
                              <AvatarImage src={p.avatar_url} />
                            ) : (
                              <AvatarFallback className="text-[9px] font-bold bg-primary/20 text-primary">
                                {p.display_name.slice(0, 2).toUpperCase()}
                              </AvatarFallback>
                            )}
                          </Avatar>
                          <span className="truncate flex-1">{p.display_name}</span>
                          {task.assigned_to === p.id && <Check className="h-3.5 w-3.5 text-primary" />}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  )}
                </DropdownMenu>
              </div>
            </div>

            <div className="grid grid-cols-[130px_1fr] items-center text-xs gap-2">
              <span className="text-muted-foreground font-medium flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5 text-primary" /> Dates
              </span>
              <div className="flex items-center gap-2 font-mono text-[11px] flex-wrap">
                <span className="px-2 py-0.5 rounded bg-muted/40 border border-border/60 text-foreground">
                  Start: {task.start_date ? formatToDateStr(task.start_date) : "Today"}
                </span>
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
                <span
                  className={cn(
                    "px-2 py-0.5 rounded border font-semibold flex items-center gap-1",
                    taskOverdue
                      ? "bg-rose-500/15 text-rose-400 border-rose-500/30"
                      : "bg-muted/40 border-border/60 text-foreground"
                  )}
                >
                  Due: {task.due_date ? formatToDateStr(task.due_date) : "Not set"}
                  {taskOverdue && <span className="text-[9px] uppercase bg-rose-500/20 px-1 rounded">Overdue</span>}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-[130px_1fr] items-center text-xs gap-2">
              <span className="text-muted-foreground font-medium flex items-center gap-1.5">
                <Flag className="h-3.5 w-3.5 text-primary" /> Priority
              </span>
              <div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      disabled={isUpdating}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all cursor-pointer bg-background hover:bg-accent"
                    >
                      <PriorityBadge priority={task.priority} />
                      <ChevronDown className="h-3 w-3 opacity-60 ml-1" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-40">
                    {TASK_PRIORITIES.map((pr) => (
                      <DropdownMenuItem key={pr} onClick={() => handlePriorityChange(pr)} className="cursor-pointer">
                        <PriorityBadge priority={pr} />
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            <div className="grid grid-cols-[130px_1fr] items-center text-xs gap-2">
              <span className="text-muted-foreground font-medium flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-primary" /> Time Estimate
              </span>
              <div>
                {isEditingEstimate ? (
                  <div className="flex items-center gap-1.5 max-w-[160px]">
                    <Input
                      type="number"
                      step="0.5"
                      className="h-7 text-xs font-mono bg-background"
                      value={estimateValue}
                      onChange={(e) => setEstimateValue(e.target.value)}
                      placeholder="Hours..."
                    />
                    <Button size="sm" className="h-7 px-2 text-xs" onClick={handleSaveEstimate}>
                      Save
                    </Button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsEditingEstimate(true)}
                    className="font-mono text-xs font-semibold px-2 py-0.5 rounded border border-border/60 bg-background hover:bg-accent text-foreground transition-colors"
                  >
                    {task.planned_hours ? `${task.planned_hours} hours` : "Empty (Click to set)"}
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-[130px_1fr] items-center text-xs gap-2">
              <span className="text-muted-foreground font-medium flex items-center gap-1.5">
                <Play className="h-3.5 w-3.5 text-primary" /> Track Time
              </span>
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  size="sm"
                  variant={task.status === "In Progress" && task.started_at ? "destructive" : "outline"}
                  onClick={handleToggleTimer}
                  disabled={isUpdating}
                  className="h-7 px-3 text-xs font-semibold gap-1.5 rounded-lg shadow-xs"
                >
                  {task.status === "In Progress" && task.started_at ? (
                    <>
                      <Pause className="h-3.5 w-3.5" /> Pause Timer
                    </>
                  ) : (
                    <>
                      <Play className="h-3.5 w-3.5 text-emerald-400" /> Start Timer
                    </>
                  )}
                </Button>

                {task.started_at && task.status === "In Progress" && (
                  <span className="font-mono text-xs font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/30 animate-pulse">
                    ⏱ {formatTicker(timerSeconds)}
                  </span>
                )}

                <TaskHoursBadges task={task} variant="badges" />
              </div>
            </div>
          </div>

          {task.status === "Blocked" && task.blocker_reason && (
            <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 space-y-1 text-xs">
              <div className="font-bold flex items-center gap-1.5">
                <AlertOctagon className="h-4 w-4" /> Active Blocker Reason:
              </div>
              <p className="leading-relaxed pl-5">{task.blocker_reason}</p>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5 text-primary" /> Description & Remarks
              </span>
              {!isEditingRemarks && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsEditingRemarks(true)}
                  className="h-7 text-xs text-primary hover:underline"
                >
                  Edit description
                </Button>
              )}
            </div>

            {isEditingRemarks ? (
              <div className="space-y-2">
                <Textarea
                  className="min-h-[120px] text-xs bg-background border-border focus-visible:ring-primary"
                  placeholder="Add detailed task notes, instructions, or scope..."
                  value={remarksValue}
                  onChange={(e) => setRemarksValue(e.target.value)}
                />
                <div className="flex items-center justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setIsEditingRemarks(false)}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleSaveRemarks} disabled={isUpdating}>
                    Save Remarks
                  </Button>
                </div>
              </div>
            ) : (
              <div
                onClick={() => setIsEditingRemarks(true)}
                className="p-3.5 rounded-xl bg-muted/20 border border-border/70 text-xs leading-relaxed text-foreground min-h-[90px] cursor-pointer hover:bg-muted/40 transition-colors whitespace-pre-wrap"
              >
                {task.remarks && task.remarks.trim() ? (
                  task.remarks
                ) : (
                  <span className="text-muted-foreground italic">
                    No detailed description provided yet. Click to add notes...
                  </span>
                )}
              </div>
            )}
          </div>

          {attachments.length > 0 && (
            <div className="space-y-2">
              <span className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Paperclip className="h-3.5 w-3.5 text-primary" /> Attachments ({attachments.length})
              </span>
              <div className="flex items-center gap-2 flex-wrap">
                {attachments.map((att) => (
                  <button
                    key={att.id}
                    type="button"
                    onClick={async () => {
                      try {
                        const url = await attachmentsService.download(att);
                        window.open(url, "_blank", "noopener");
                      } catch (err: any) {
                        toast.error(err?.message || "Failed to open attachment");
                      }
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border/80 bg-muted/30 hover:bg-accent text-xs font-medium text-foreground transition-all"
                  >
                    <Paperclip className="h-3 w-3 text-muted-foreground" />
                    <span className="truncate max-w-[160px]">{att.file_name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="lg:col-span-5 p-5 bg-muted/10 flex flex-col h-full overflow-hidden">
          <div className="flex items-center justify-between pb-3 border-b border-border/80 shrink-0">
            <span className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-1.5">
              <MessageSquare className="h-3.5 w-3.5 text-primary" /> Activity & Discussion
            </span>
          </div>

          <div className="flex-1 min-h-0 pt-3 overflow-y-auto custom-scrollbar">
            {user && (
              <CommentsPanel
                workItemId={task.id}
                userId={user.id}
                profiles={profiles}
                canModerate={isManager}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );

  if (viewMode === "fullscreen") {
    return (
      <>
        <div className="fixed inset-0 z-50 bg-background text-foreground flex flex-col animate-in fade-in duration-150">
          {renderDetailContent()}
        </div>
        <ActiveTaskConflictModal
          open={conflictModalOpen}
          onOpenChange={setConflictModalOpen}
          activeTask={existingActiveTask}
          newTask={task}
          onConfirm={handleConfirmSwitch}
          isSubmitting={isUpdating}
        />
      </>
    );
  }

  if (viewMode === "sidebar") {
    return (
      <>
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={() => onOpenChange(false)}
        />
        <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-[680px] max-w-[95vw] bg-card border-l border-border shadow-2xl animate-in slide-in-from-right duration-200">
          {renderDetailContent()}
        </div>
        <ActiveTaskConflictModal
          open={conflictModalOpen}
          onOpenChange={setConflictModalOpen}
          activeTask={existingActiveTask}
          newTask={task}
          onConfirm={handleConfirmSwitch}
          isSubmitting={isUpdating}
        />
      </>
    );
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent hideCloseButton className="max-w-5xl w-[95vw] h-[88vh] bg-card border border-border/80 shadow-2xl rounded-2xl p-0 overflow-hidden text-popover-foreground flex flex-col">
          <DialogTitle className="sr-only">{task.task_name}</DialogTitle>
          {renderDetailContent()}
        </DialogContent>
      </Dialog>

      <ActiveTaskConflictModal
        open={conflictModalOpen}
        onOpenChange={setConflictModalOpen}
        activeTask={existingActiveTask}
        newTask={task}
        onConfirm={handleConfirmSwitch}
        isSubmitting={isUpdating}
      />
    </>
  );
}
