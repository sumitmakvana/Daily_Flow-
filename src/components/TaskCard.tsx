import { useEffect, useState, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Play,
  Pause,
  PauseCircle,
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
  Paperclip,
  Image as ImageIcon,
  Check,
  Plus,
  Flag,
  X,
  ChevronRight,
  Mail,
  MessageSquare,
  UserCheck,
} from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import { PriorityBadge } from "./PriorityBadge";
import { BlockerDialog } from "./BlockerDialog";
import { OnHoldDialog } from "./OnHoldDialog";
import { BlockerAge } from "./BlockerAge";
import { CarryForwardBadge } from "./CarryForwardBadge";
import { TaskHistorySheet } from "./TaskHistorySheet";
import { WorkItemTypeBadge } from "./WorkItemTypeBadge";
import { TaskFormDialog } from "./TaskFormDialog";
import { TaskDetailModal } from "./TaskDetailModal";
import { ImagePreviewModal } from "./ImagePreviewModal";
import { ActiveTaskConflictModal } from "./ActiveTaskConflictModal";
import { inlineCompleteStore } from "@/services/inline-complete-store";
import { attachmentsService } from "@/services/attachments";
import { TaskHoursBadges } from "./TaskHoursBadges";
import { formatHoursMins, parseHoursOrMins, formatDate, isOverdue, getDefaultStartDate } from "@/lib/format";
import type { Profile, Task, TaskStatus, WorkItemType, Attachment } from "@/lib/types";
import { cn } from "@/lib/utils";
import { tasksService, TaskConflictError } from "@/services/tasks";
import { taskEodService } from "@/services/task-eod";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";

export function TaskCard({
  task,
  rank,
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
  rank?: number;
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
  const [onHoldOpen, setOnHoldOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [conflictModalOpen, setConflictModalOpen] = useState(false);
  const [existingActiveTask, setExistingActiveTask] = useState<Task | null>(null);
  const [switchBusy, setSwitchBusy] = useState(false);

  const planned = Number(task.planned_hours ?? 0);
  const currentActual = Number(task.actual_hours ?? 0);
  const remaining = Math.max(0, planned - currentActual);
  const defaultFill = remaining > 0 ? remaining : planned > 0 ? planned : 1;

  const [completeModalOpen, setCompleteModalOpen] = useState(false);
  const [inlineHours, setInlineHours] = useState<string>("");
  const [inlineNote, setInlineNote] = useState<string>("");
  const [inlineBusy, setInlineBusy] = useState(false);

  const openCompleteModal = () => {
    const baseSys = Number((task as any).system_hours ?? 0);
    const runningSys = (task as any).started_at
      ? Math.min(8.0, Math.max(0, (Date.now() - new Date((task as any).started_at).getTime()) / 3600000))
      : 0;
    const sysHrs = baseSys + runningSys;
    const fillVal = sysHrs > 0 ? sysHrs : defaultFill;
    setInlineHours(formatHoursMins(fillVal));
    setInlineNote("");
    setCompleteModalOpen(true);
  };
  const [descOpen, setDescOpen] = useState(false);
  const descTimerRef = useRef<NodeJS.Timeout | null>(null);

  const handleDescEnter = () => {
    if (descTimerRef.current) clearTimeout(descTimerRef.current);
    setDescOpen(true);
  };

  const handleDescLeave = () => {
    descTimerRef.current = setTimeout(() => {
      setDescOpen(false);
    }, 150);
  };

  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [expandedRemarks, setExpandedRemarks] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewFileName, setPreviewFileName] = useState<string | null>(null);

  useEffect(() => {
    if (task.id) {
      attachmentsService.list(task.id).then(setAttachments).catch(() => {});
    }
  }, [task.id]);

  const overdue = isOverdue(task.due_date, task.status);
  const isOwner = task.assigned_to === userId;
  const canAct = true;
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
      if (s === "In Progress" && userId) {
        const currentActive = await tasksService.getActiveTask(userId);
        if (currentActive && currentActive.id !== task.id) {
          setExistingActiveTask(currentActive);
          setConflictModalOpen(true);
          return;
        }
      }
      await tasksService.setStatus(task, s, userId, extras);
      toast.success(`${task.task_code} set to ${s}`);
      onChanged();
    } catch (e) {
      handleError(e);
    }
  };

  const handleStartOrResumeWithCheck = async () => {
    if (!userId) return;
    try {
      const currentActive = await tasksService.getActiveTask(userId);
      if (currentActive && currentActive.id !== task.id) {
        setExistingActiveTask(currentActive);
        setConflictModalOpen(true);
        return;
      }
      await tasksService.resumeTimer(task, userId);
      toast.success("Timer started");
      onChanged();
    } catch (e) {
      handleError(e);
    }
  };

  const handleConfirmSwitch = async () => {
    if (!existingActiveTask || !userId) return;
    setSwitchBusy(true);
    try {
      await tasksService.switchActiveTask(existingActiveTask, task, userId);
      toast.success(`Stopped ${existingActiveTask.task_code} · Started ${task.task_code}`);
      setConflictModalOpen(false);
      onChanged();
    } catch (e) {
      handleError(e);
    } finally {
      setSwitchBusy(false);
    }
  };

  const handleInlineSubmit = async () => {
    if (!userId) return;
    setInlineBusy(true);
    try {
      const hrs = parseHoursOrMins(inlineHours) || defaultFill;
      await tasksService.setStatus(task, "Completed", userId);
      if (hrs > 0 || inlineNote.trim()) {
        await taskEodService.submit(task.id, "done", hrs, inlineNote.trim() || null);
      }
      toast.success(`${task.task_code} completed · ${formatHoursMins(hrs)} logged`);
      setCompleteModalOpen(false);
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
      <Card
        className={cn(
          "group relative p-3 bg-[#1e1f23] hover:bg-[#25262c] border border-[#2b2c34] hover:border-[#3e414c] rounded-xl transition-all flex flex-col gap-2.5 items-stretch cursor-pointer shadow-xs",
          overdue && "border-priority-high/40 bg-priority-high/[0.02]",
          needsSplit && "border-amber-500/80 bg-amber-500/[0.06] ring-1 ring-amber-500/40 shadow-[0_0_12px_rgba(245,158,11,0.15)]"
        )}
        onClick={(e) => {
          const target = e.target as HTMLElement;
          if (target.closest('button, input, a, [role="button"], [role="menuitem"], label, [data-radix-popper-content-wrapper]')) {
            return;
          }
          setDetailModalOpen(true);
        }}
      >
        {/* Top-Right Hover Quick Action Bar (Matching Screenshots 1, 4, 5) */}
        <div
          className={cn(
            "absolute right-2 top-2 flex items-center gap-1 bg-[#282930] p-1 rounded-lg border border-[#3b3c46] shadow-md z-20 transition-opacity duration-150",
            completeModalOpen ? "opacity-100 pointer-events-auto" : "opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto"
          )}
        >
          <TooltipProvider delayDuration={100}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (completeModalOpen) {
                      setCompleteModalOpen(false);
                    } else {
                      openCompleteModal();
                    }
                  }}
                  className={cn(
                    "h-6 w-6 grid place-items-center rounded transition-colors cursor-pointer",
                    completeModalOpen
                      ? "bg-emerald-500/20 text-emerald-400"
                      : "hover:bg-[#383a45] text-slate-300 hover:text-emerald-400"
                  )}
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="bg-[#1e1f24] text-slate-100 border border-slate-700 text-[11px] font-medium py-1 px-2 z-50">
                {completeModalOpen ? "Close complete panel" : "Mark complete"}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {/* Start/Resume or Pause Timer Button (replaces + button) */}
          <TooltipProvider delayDuration={100}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (task.status === "In Progress" && task.started_at && userId) {
                      try {
                        await tasksService.pauseTimer(task, userId);
                        toast.success("Timer paused");
                        onChanged();
                      } catch (err: any) {
                        toast.error(err?.message || "Failed to pause timer");
                      }
                    } else {
                      handleStartOrResumeWithCheck();
                    }
                  }}
                  className={cn(
                    "h-6 w-6 grid place-items-center rounded hover:bg-[#383a45] transition-colors",
                    task.started_at ? "text-amber-400 hover:text-amber-300" : "text-blue-400 hover:text-blue-300"
                  )}
                >
                  {task.started_at ? (
                    <Pause className="h-3.5 w-3.5 fill-current" />
                  ) : (
                    <Play className="h-3.5 w-3.5 fill-current" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="bg-[#1e1f24] text-slate-100 border border-slate-700 text-[11px] font-medium py-1 px-2 z-50">
                {task.started_at ? "Pause timer" : "Start timer"}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <TooltipProvider delayDuration={100}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setFormOpen(true);
                  }}
                  className="h-6 w-6 grid place-items-center rounded hover:bg-[#383a45] text-slate-300 hover:text-amber-400 transition-colors"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="bg-[#1e1f24] text-slate-100 border border-slate-700 text-[11px] font-medium py-1 px-2 z-50">
                Rename / Edit
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                onClick={(e) => e.stopPropagation()}
                className="h-6 w-6 grid place-items-center rounded hover:bg-[#383a45] text-slate-300 transition-colors"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="bottom" sideOffset={4} className="w-52 max-h-64 overflow-y-auto z-50">
              <DropdownMenuItem onClick={() => setDetailModalOpen(true)}>
                <FileText className="mr-2 h-3.5 w-3.5 text-[#5C8EFA]" /> View full details
              </DropdownMenuItem>
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
              {canAct && task.status === "In Progress" && task.started_at && (
                <DropdownMenuItem
                  onClick={async () => {
                    if (!userId) return;
                    try {
                      await tasksService.pauseTimer(task, userId);
                      toast.success("Timer paused");
                      onChanged?.();
                    } catch (err: any) {
                      toast.error(err?.message || "Failed to pause timer");
                    }
                  }}
                >
                  <Pause className="mr-2 h-3.5 w-3.5" /> Pause timer
                </DropdownMenuItem>
              )}
              {canAct && task.status === "In Progress" && !task.started_at && (
                <DropdownMenuItem onClick={() => handleStartOrResumeWithCheck()}>
                  <Play className="mr-2 h-3.5 w-3.5" /> Resume timer
                </DropdownMenuItem>
              )}
              {canAct && task.status !== "On Hold" && task.status !== "Completed" && (
                <DropdownMenuItem onClick={() => setOnHoldOpen(true)}>
                  <PauseCircle className="mr-2 h-3.5 w-3.5" /> Put on hold
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

        <div className="flex gap-2.5 items-start">
          {onSelectToggle && (
            <div className="pt-1 shrink-0 flex items-center justify-center">
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
            {/* Header Row: Title */}
            <div className="flex items-start justify-between gap-2 pr-24 transition-all">
              <div className="min-w-0 flex-1 cursor-pointer" onClick={() => setDetailModalOpen(true)}>
                <div className="flex items-start gap-1.5">
                  <div className="min-w-0 flex-1">
                    <div
                      title={task.task_name}
                      className="font-semibold text-slate-100 leading-snug hover:text-[#5C8EFA] transition-colors text-xs md:text-sm line-clamp-2"
                    >
                      {task.task_name}
                    </div>

                    {!compact && (task.client || task.project_name) && (
                      <div className="mt-0.5 text-[11px] text-slate-400 truncate">
                        {task.client}{task.client && task.project_name ? " · " : ""}{task.project_name}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Description lines indicator (ClickUp style ≡) with Rich Popover Preview on Hover & Click */}
            {task.remarks && (
              <div
                className="inline-block"
                onMouseEnter={handleDescEnter}
                onMouseLeave={handleDescLeave}
              >
                <Popover open={descOpen} onOpenChange={setDescOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDescOpen((prev) => !prev);
                      }}
                      className={cn(
                        "mt-1 flex items-center gap-1.5 text-[11px] select-none group/desc cursor-pointer py-0.5 px-1 rounded transition-colors",
                        descOpen ? "bg-[#252730] text-[#5C8EFA]" : "text-slate-400 hover:text-slate-200"
                      )}
                    >
                      <span className="font-bold tracking-tighter text-slate-400 group-hover/desc:text-[#5C8EFA]">≡</span>
                      <span className="text-[10px] text-slate-400/80 line-clamp-1 group-hover/desc:text-slate-200 transition-colors max-w-[200px]">
                        {task.remarks.slice(0, 45)}{task.remarks.length > 45 ? "..." : ""}
                      </span>
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    side="bottom"
                    sideOffset={6}
                    onMouseEnter={handleDescEnter}
                    onMouseLeave={handleDescLeave}
                    onClick={(e) => e.stopPropagation()}
                    className="w-96 max-w-[90vw] p-3.5 bg-[#16171c] border border-[#2b2c34] shadow-2xl rounded-xl text-slate-100 text-xs space-y-3 z-50"
                  >
                    <div className="font-semibold text-slate-200 flex items-center justify-between border-b border-slate-800 pb-2">
                      <span className="flex items-center gap-1.5 text-slate-300 font-semibold text-xs">
                        <FileText className="h-3.5 w-3.5 text-[#5C8EFA]" /> Description
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setDescOpen(false);
                          setDetailModalOpen(true);
                        }}
                        className="text-[11px] text-[#5C8EFA] hover:text-blue-400 hover:underline font-medium cursor-pointer"
                      >
                        Full Details ↗
                      </button>
                    </div>
                    <div className="p-3 rounded-lg bg-[#1c1d23] border border-[#282932] text-slate-200 whitespace-pre-wrap leading-relaxed max-h-72 overflow-y-auto font-sans text-xs select-text tracking-normal">
                      {task.remarks}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            )}

            {/* Bottom Metadata Row (User Profile Popover, Due Date Tooltip, Priority Flag Popover) */}
            <div className="mt-2 flex items-center justify-between gap-1.5 flex-wrap pt-1.5 border-t border-slate-800/60">
              <div className="flex items-center gap-1.5 flex-wrap">
                {/* User Profile Card Popover (Screenshot 1) */}
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      onClick={(e) => e.stopPropagation()}
                      className="relative shrink-0 group/avatar cursor-pointer"
                    >
                      <Avatar className="h-5 w-5 border border-slate-700 bg-slate-800 shrink-0">
                        {assignee?.avatar_url ? (
                          <AvatarImage src={assignee.avatar_url} />
                        ) : (
                          <AvatarFallback className="text-[9px] font-bold text-slate-200 bg-slate-700">
                            {assignee ? assignee.display_name.slice(0, 2).toUpperCase() : "SM"}
                          </AvatarFallback>
                        )}
                      </Avatar>
                      <span className="absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-emerald-500 ring-1 ring-[#1e1f23]" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-64 p-4 bg-[#141518] border border-[#2a2c34] shadow-2xl rounded-2xl space-y-3 z-50 text-slate-100">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="text-xs font-semibold text-slate-400">You</div>
                        <div className="text-sm font-bold text-slate-100">{assignee?.display_name || "SUMIT MAKVANA"}</div>
                      </div>
                      <div className="relative">
                        <Avatar className="h-10 w-10 border-2 border-slate-700 bg-slate-200 text-slate-900 text-sm font-bold flex items-center justify-center">
                          {assignee ? assignee.display_name.slice(0, 2).toUpperCase() : "SM"}
                        </Avatar>
                        <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-[#141518]" />
                      </div>
                    </div>

                    <div className="space-y-1.5 text-xs text-slate-300">
                      <div className="flex items-center gap-2 text-slate-400">
                        <Mail className="h-3.5 w-3.5" />
                        <span className="truncate">{assignee?.email || "sumitmakvana535@gmail.com"}</span>
                      </div>
                      <div className="flex items-center gap-2 text-slate-400 font-mono text-[11px]">
                        <Clock className="h-3.5 w-3.5" />
                        <span>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} local time</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <Button size="sm" variant="outline" className="h-7 text-xs flex-1 bg-[#23252c] border-[#343742] text-slate-200 hover:bg-[#2c2e37]">
                        <MessageSquare className="h-3 w-3 mr-1" /> Chat
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs flex-1 bg-[#23252c] border-[#343742] text-slate-200 hover:bg-[#2c2e37]">
                        <UserIcon className="h-3 w-3 mr-1" /> View profile
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>

                {/* ClickUp Date Picker Popover (Image 1) */}
                <ClickUpDatePickerPopover
                  task={task}
                  userId={userId}
                  overdue={overdue}
                  onChanged={onChanged}
                />

                {/* Interactive Priority Flag Popover (Screenshot 3) */}
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium border bg-[#2b2d35] text-slate-300 border-slate-700/60 hover:bg-[#353842] transition-colors cursor-pointer"
                    >
                      <Flag className={cn(
                        "h-3 w-3",
                        task.priority === "High" ? "text-amber-400 fill-amber-400/20" : task.priority === "Low" ? "text-slate-400" : "text-blue-400 fill-blue-400/20"
                      )} />
                      <span>{task.priority}</span>
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-56 p-2 bg-[#1c1d22] border border-[#2e3038] shadow-2xl rounded-xl space-y-1 z-50">
                    <div className="px-2 py-1 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                      Priority
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        tasksService.setPriority(task, "High", userId);
                        toast.success("Priority set to High");
                        onChanged();
                      }}
                      className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-xs font-medium hover:bg-[#282a32] text-slate-200 cursor-pointer"
                    >
                      <span className="flex items-center gap-2">
                        <Flag className="h-3.5 w-3.5 text-amber-400 fill-amber-400/20" /> High
                      </span>
                      {task.priority === "High" && <Check className="h-3.5 w-3.5 text-slate-200" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        tasksService.setPriority(task, "Medium", userId);
                        toast.success("Priority set to Normal");
                        onChanged();
                      }}
                      className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-xs font-medium hover:bg-[#282a32] text-slate-200 cursor-pointer"
                    >
                      <span className="flex items-center gap-2">
                        <Flag className="h-3.5 w-3.5 text-blue-400 fill-blue-400/20" /> Normal
                      </span>
                      {task.priority === "Medium" && <Check className="h-3.5 w-3.5 text-slate-200" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        tasksService.setPriority(task, "Low", userId);
                        toast.success("Priority set to Low");
                        onChanged();
                      }}
                      className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-xs font-medium hover:bg-[#282a32] text-slate-200 cursor-pointer"
                    >
                      <span className="flex items-center gap-2">
                        <Flag className="h-3.5 w-3.5 text-slate-400" /> Low
                      </span>
                      {task.priority === "Low" && <Check className="h-3.5 w-3.5 text-slate-200" />}
                    </button>
                  </PopoverContent>
                </Popover>


              </div>

              <div className="flex items-center gap-1 ml-auto">
                <TaskHoursBadges task={task} />
              </div>
            </div>
          </div>
        </div>
        {/* Inline Expandable Completion Panel (matching screenshot design) */}
        {completeModalOpen && (
          <div
            className="mt-2.5 p-3 rounded-xl bg-[#141519] border border-slate-500/40 shadow-inner flex flex-col gap-2.5 animate-in fade-in slide-in-from-top-1 duration-150 cursor-default"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header row with title, cancel and Save button */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                <span className="text-xs font-bold text-slate-100 truncate">Log Hours & Complete</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setCompleteModalOpen(false)}
                  className="h-6 w-6 grid place-items-center text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded cursor-pointer transition-colors"
                  title="Cancel"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
                <Button
                  size="sm"
                  disabled={inlineBusy}
                  onClick={handleInlineSubmit}
                  className="h-7 px-3 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white gap-1 rounded-lg shadow-sm cursor-pointer"
                >
                  {inlineBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                  <span>Save ↵</span>
                </Button>
              </div>
            </div>

            {/* Worked Hours & Completion Note Inputs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px] font-semibold text-slate-400">
                  <span>Worked Hours</span>
                  {planned > 0 && <span className="text-[10px] text-slate-500 font-mono">Plan: {planned}h</span>}
                </div>
                <Input
                  type="text"
                  placeholder="e.g. 1.5, 45m"
                  className="h-8 text-xs font-bold text-emerald-400 bg-[#090a0d] border-[#2b2c34] focus-visible:ring-1 focus-visible:ring-emerald-500/50 placeholder:text-slate-600"
                  value={inlineHours}
                  onChange={(e) => setInlineHours(e.target.value)}
                  disabled={inlineBusy}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !inlineBusy) {
                      handleInlineSubmit();
                    }
                  }}
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-400 block">
                  Note <span className="font-normal text-slate-500 text-[10px]">(optional)</span>
                </label>
                <Input
                  type="text"
                  placeholder="What did you finish?"
                  className="h-8 text-xs bg-[#090a0d] border-[#2b2c34] text-slate-200 placeholder:text-slate-600 focus-visible:ring-1 focus-visible:ring-slate-500/50"
                  value={inlineNote}
                  onChange={(e) => setInlineNote(e.target.value)}
                  disabled={inlineBusy}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !inlineBusy) {
                      handleInlineSubmit();
                    }
                  }}
                />
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
          system_hours: 0,
          started_at: null,
          done: false,
          completed_at: null,
          start_date: getDefaultStartDate(),
          planned_hours: task.planned_hours !== undefined && task.planned_hours !== null ? task.planned_hours : 4,
        }}
        userId={userId}
        onSaved={onChanged}
      />

      <OnHoldDialog
        open={onHoldOpen}
        onOpenChange={setOnHoldOpen}
        taskCode={task.task_code}
        taskTitle={task.task_name}
        onConfirm={async (reason) => {
          await setStatus("On Hold", { hold_reason: reason });
        }}
      />

      <ImagePreviewModal
        open={previewModalOpen}
        onOpenChange={setPreviewModalOpen}
        url={previewUrl}
        fileName={previewFileName}
      />

      <ActiveTaskConflictModal
        open={conflictModalOpen}
        onOpenChange={setConflictModalOpen}
        activeTask={existingActiveTask}
        newTask={task}
        onConfirm={handleConfirmSwitch}
        isSubmitting={switchBusy}
      />

      <TaskDetailModal
        open={detailModalOpen}
        onOpenChange={setDetailModalOpen}
        task={task}
        assignedProfile={assignee}
        profiles={profiles}
        onEditTask={() => {
          setDetailModalOpen(false);
          setTimeout(() => setFormOpen(true), 150);
        }}
        onTaskUpdated={onChanged}
      />
    </>
  );
}

function ClickUpDatePickerPopover({
  task,
  userId,
  overdue,
  onChanged,
}: {
  task: Task;
  userId: string;
  overdue: boolean;
  onChanged: () => void;
}) {
  const initialDate = task.due_date ? new Date(task.due_date) : new Date();
  const [viewDate, setViewDate] = useState<Date>(initialDate);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth(); // 0-11
  const monthName = viewDate.toLocaleString("default", { month: "long" });

  const firstDayOfWeek = new Date(year, month, 1).getDay(); // 0 = Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const today = new Date();
  const isCurrentMonthToday =
    today.getFullYear() === year && today.getMonth() === month;
  const todayDay = today.getDate();

  const selectedDate = task.due_date ? new Date(task.due_date) : null;
  const isSelectedMonth =
    selectedDate &&
    selectedDate.getFullYear() === year &&
    selectedDate.getMonth() === month;
  const selectedDay = selectedDate ? selectedDate.getDate() : null;

  const handlePrevMonth = () => {
    setViewDate(new Date(year, month - 1, 1));
  };
  const handleNextMonth = () => {
    setViewDate(new Date(year, month + 1, 1));
  };
  const handleJumpToday = () => {
    setViewDate(new Date());
  };

  const setDueDate = async (dateObj: Date | null, label: string) => {
    const iso = dateObj ? dateObj.toISOString().slice(0, 10) : null;
    await tasksService.update(task, { due_date: iso }, userId);
    toast.success(dateObj ? `Due date set to ${label}` : "Due date cleared");
    onChanged();
  };

  const getPresetDate = (type: string) => {
    const d = new Date();
    if (type === "later") {
      return { date: d, label: "Today" };
    } else if (type === "tomorrow") {
      d.setDate(d.getDate() + 1);
      return { date: d, label: "Tomorrow" };
    } else if (type === "weekend") {
      const day = d.getDay();
      const diff = (6 - day + 7) % 7 || 7;
      d.setDate(d.getDate() + diff);
      return { date: d, label: "This weekend" };
    } else if (type === "nextweek") {
      const day = d.getDay();
      const diff = (1 - day + 7) % 7 || 7;
      d.setDate(d.getDate() + diff);
      return { date: d, label: "Next week" };
    } else if (type === "nextweekend") {
      const day = d.getDay();
      const diff = ((6 - day + 7) % 7 || 7) + 7;
      d.setDate(d.getDate() + diff);
      return { date: d, label: "Next weekend" };
    } else if (type === "2weeks") {
      d.setDate(d.getDate() + 14);
      return { date: d, label: "2 weeks" };
    } else if (type === "4weeks") {
      d.setDate(d.getDate() + 28);
      return { date: d, label: "4 weeks" };
    }
    return { date: d, label: "" };
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium border transition-colors cursor-pointer",
            overdue
              ? "bg-rose-500/15 text-rose-400 border-rose-500/30"
              : "bg-[#2b2d35] text-slate-300 border-slate-700/60 hover:bg-[#353842]"
          )}
        >
          <Clock className="h-3 w-3 opacity-70" />
          <span>{task.due_date ? formatDate(task.due_date) : "Due Date"}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        collisionPadding={16}
        avoidCollisions={true}
        className="w-[450px] p-3 bg-[#18191d] border border-[#2b2d35] shadow-2xl rounded-2xl z-50 text-slate-100 space-y-2.5 max-h-[85vh] overflow-y-auto"
      >
        {/* Top Header Bar Inputs (Image 1) */}
        <div className="flex items-center gap-2 text-xs">
          <div className="flex-1 relative">
            <Input
              placeholder="Start date"
              className="h-7.5 text-xs pl-7 bg-[#222329] border-[#31333d] text-slate-200 placeholder:text-slate-500 rounded-lg focus:border-slate-500"
            />
            <Clock className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          </div>

          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#222329] border-2 border-slate-100 text-xs font-semibold text-slate-100 shadow-xs">
            <Clock className="h-3.5 w-3.5 text-slate-300" />
            <span>{task.due_date ? formatDate(task.due_date) : "Due date"}</span>
            {task.due_date && (
              <button
                type="button"
                onClick={async (e) => {
                  e.stopPropagation();
                  await setDueDate(null, "");
                }}
                className="ml-1 text-slate-400 hover:text-slate-100 p-0.5 rounded-full hover:bg-slate-700/50"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        {/* Split 2-Pane Presets & Calendar Body (Image 1) */}
        <div className="grid grid-cols-12 divide-x divide-[#2b2d35] text-xs pt-0.5">
          {/* Left Pane Presets */}
          <div className="col-span-5 pr-2.5 space-y-0.5">
            {[
              { id: "tomorrow", label: "Tomorrow", hint: "Thu" },
              { id: "weekend", label: "This weekend", hint: "Sat" },
              { id: "nextweek", label: "Next week", hint: "Mon" },
              { id: "nextweekend", label: "Next weekend", hint: "19 Sep" },
              { id: "2weeks", label: "2 weeks", hint: "23 Sep" },
              { id: "4weeks", label: "4 weeks", hint: "7 Oct" },
            ].map((pr) => {
              const { date, label } = getPresetDate(pr.id);
              return (
                <button
                  key={pr.id}
                  type="button"
                  onClick={() => setDueDate(date, label)}
                  className="w-full flex items-center justify-between px-2 py-1 rounded-lg hover:bg-[#25262d] text-slate-300 text-left transition-colors cursor-pointer text-xs"
                >
                  <span className="font-medium">{pr.label}</span>
                  <span className="text-[11px] text-slate-500 font-mono">
                    {pr.hint}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Right Pane Month Calendar (Image 1) */}
          <div className="col-span-7 pl-2.5 space-y-1.5">
            <div className="flex items-center justify-between text-xs font-bold text-slate-200">
              <span>
                {monthName} {year}
              </span>
              <div className="flex items-center gap-1 text-[11px] font-mono text-slate-400">
                <button
                  type="button"
                  onClick={handleJumpToday}
                  className="hover:text-slate-100 cursor-pointer font-medium px-1"
                >
                  Today
                </button>
                <button
                  type="button"
                  onClick={handlePrevMonth}
                  className="p-1 hover:text-slate-100"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={handleNextMonth}
                  className="p-1 hover:text-slate-100"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] font-semibold text-slate-400">
              {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day) => (
                <div key={day} className="py-0.5">
                  {day}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-0.5 text-center text-xs">
              {Array.from({ length: firstDayOfWeek }).map((_, i) => (
                <div key={`empty-${i}`} className="h-6.5 w-6.5" />
              ))}

              {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => {
                const isTodayDate = isCurrentMonthToday && d === todayDay;
                const isSelected = isSelectedMonth && d === selectedDay;

                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => {
                      const target = new Date(year, month, d);
                      setDueDate(target, `${monthName.slice(0, 3)} ${d}`);
                    }}
                    className={cn(
                      "h-6.5 w-6.5 rounded-full flex items-center justify-center font-medium transition-colors mx-auto cursor-pointer text-xs",
                      isSelected
                        ? "bg-slate-100 text-slate-900 font-bold shadow-md rounded-lg"
                        : isTodayDate
                        ? "bg-rose-500 text-white font-bold rounded-full shadow-sm"
                        : "hover:bg-[#282a32] text-slate-300"
                    )}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
