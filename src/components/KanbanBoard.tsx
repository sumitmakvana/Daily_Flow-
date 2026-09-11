import React, { useState } from "react";
import { Plus, CheckCircle2, PlayCircle, AlertOctagon, CircleDashed } from "lucide-react";
import { TaskCard } from "./TaskCard";
import type { Profile, Task, TaskStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { isTaskCompletedToday } from "@/lib/task-date-utils";
import { tasksService, TaskConflictError } from "@/services/tasks";
import { completeEodStore } from "@/services/complete-eod-store";
import { ActiveTaskConflictModal } from "./ActiveTaskConflictModal";
import { toast } from "sonner";

interface KanbanBoardProps {
  tasks: Task[];
  profiles: Profile[];
  userId: string;
  isManager: boolean;
  onChanged: () => void;
  onAddTask?: (initialStatus?: TaskStatus) => void;
  completedTodayOnly?: boolean;
}

export function KanbanBoard({
  tasks,
  profiles,
  userId,
  isManager,
  onChanged,
  onAddTask,
  completedTodayOnly = true,
}: KanbanBoardProps) {
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [dropTargetStatus, setDropTargetStatus] = useState<TaskStatus | null>(null);
  const [conflictModalOpen, setConflictModalOpen] = useState(false);
  const [existingActiveTask, setExistingActiveTask] = useState<Task | null>(null);
  const [pendingActiveTask, setPendingActiveTask] = useState<Task | null>(null);
  const [switchBusy, setSwitchBusy] = useState(false);

  // Define visible board columns. In Review is intentionally omitted from My Day kanban.
  const columns: {
    key: TaskStatus;
    label: string;
    icon: React.ReactNode;
    badgeStyle: string;
    addBtnStyle: string;
  }[] = [
    {
      key: "To Do",
      label: "TO DO",
      icon: <CircleDashed className="h-3.5 w-3.5 text-slate-400" />,
      badgeStyle: "bg-[#25262c] text-slate-200 border-[#383a45]",
      addBtnStyle: "text-slate-400 hover:text-slate-200 hover:bg-[#202127]",
    },
    {
      key: "In Progress",
      label: "IN PROGRESS",
      icon: <PlayCircle className="h-3.5 w-3.5 text-blue-400 fill-blue-400/20" />,
      badgeStyle: "bg-[#1d273b] text-blue-400 border-blue-500/40",
      addBtnStyle: "text-blue-400 hover:text-blue-300 hover:bg-[#1a2336]",
    },
    {
      key: "Completed",
      label: "COMPLETE",
      icon: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />,
      badgeStyle: "bg-[#152e25] text-emerald-400 border-emerald-500/40",
      addBtnStyle: "text-emerald-400 hover:text-emerald-300 hover:bg-[#122820]",
    },
    {
      key: "Blocked",
      label: "BLOCKED",
      icon: <AlertOctagon className="h-3.5 w-3.5 text-amber-400" />,
      badgeStyle: "bg-[#332514] text-amber-400 border-amber-500/40",
      addBtnStyle: "text-amber-400 hover:text-amber-300 hover:bg-[#2b1f11]",
    },
  ];

  const finishDrag = () => {
    setDraggingTaskId(null);
    setDropTargetStatus(null);
  };

  const handleDropStatus = async (task: Task, status: TaskStatus) => {
    if (!userId || task.status === status) return;

    if (status === "Completed") {
      completeEodStore.open(task, onChanged);
      return;
    }

    try {
      if (status === "In Progress") {
        const currentActive = await tasksService.getActiveTask(userId);
        if (currentActive && currentActive.id !== task.id) {
          setExistingActiveTask(currentActive);
          setPendingActiveTask(task);
          setConflictModalOpen(true);
          return;
        }
      }

      await tasksService.setStatus(task, status, userId);
      toast.success(`${task.task_code} moved to ${status}`);
      onChanged();
    } catch (error) {
      if (error instanceof TaskConflictError) {
        toast.error(error.message);
        onChanged();
      } else {
        toast.error((error as Error).message || "Failed to update task status");
      }
    }
  };

  const handleConfirmSwitch = async () => {
    if (!existingActiveTask || !pendingActiveTask || !userId) return;

    setSwitchBusy(true);
    try {
      await tasksService.switchActiveTask(existingActiveTask, pendingActiveTask, userId);
      toast.success(
        `Stopped ${existingActiveTask.task_code || "active task"} - Started ${
          pendingActiveTask.task_code || "new task"
        }`,
      );
      setConflictModalOpen(false);
      setExistingActiveTask(null);
      setPendingActiveTask(null);
      onChanged();
    } catch (error) {
      if (error instanceof TaskConflictError) {
        toast.error(error.message);
        onChanged();
      } else {
        toast.error((error as Error).message || "Failed to switch active task");
      }
    } finally {
      setSwitchBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* Dynamic Grid Columns Container (Fits on screen without horizontal scroll) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 w-full pt-1 select-none items-start">
        {columns.map((col) => {
          const colTasks = tasks.filter((t) => {
            if (col.key === "To Do") return t.status === "To Do" || !t.status;
            if (col.key === "In Progress") return t.status === "In Progress" || t.status === "In Review";
            if (col.key === "Completed") {
              return completedTodayOnly ? isTaskCompletedToday(t) : t.status === "Completed";
            }
            if (col.key === "Blocked") return t.status === "Blocked" || t.status === "On Hold";
            return false;
          });

          return (
            <div
              key={col.key}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDropTargetStatus(col.key);
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setDropTargetStatus((current) => (current === col.key ? null : current));
                }
              }}
              onDrop={async (event) => {
                event.preventDefault();
                const taskId = event.dataTransfer.getData("text/plain") || draggingTaskId;
                finishDrag();
                const droppedTask = tasks.find((task) => task.id === taskId);
                if (droppedTask) {
                  await handleDropStatus(droppedTask, col.key);
                }
              }}
              className={cn(
                "flex flex-col bg-[#141518] border border-[#23242a] rounded-2xl p-2.5 min-w-0 w-full shrink-0 shadow-lg space-y-2.5 transition-colors",
                dropTargetStatus === col.key && "border-primary/70 bg-primary/5",
              )}
            >
              {/* Column Header Bar (Screenshot 4) */}
              <div className="flex items-center justify-between gap-2 px-1 pt-0.5">
                <div className="flex items-center gap-2">
                  <div
                    className={cn(
                      "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-bold border shadow-xs",
                      col.badgeStyle
                    )}
                  >
                    {col.icon}
                    <span>{col.label}</span>
                    <span className="ml-1 opacity-80 font-mono">{colTasks.length}</span>
                  </div>
                </div>

                <div className="flex items-center gap-1 text-slate-400">
                  <button
                    type="button"
                    onClick={() => onAddTask?.(col.key)}
                    className="p-1 hover:text-slate-200 rounded hover:bg-[#23242a]"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* Column Cards List */}
              <div className="space-y-2.5 max-h-[calc(100vh-280px)] min-h-24 overflow-y-auto pr-0.5">
                {colTasks.map((t) => (
                  <div
                    key={t.id}
                    draggable={!!userId}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", t.id);
                      setDraggingTaskId(t.id);
                    }}
                    onDragEnd={finishDrag}
                    className={cn(
                      "rounded-xl outline-none focus-visible:ring-1 focus-visible:ring-primary",
                      draggingTaskId === t.id && "opacity-50",
                    )}
                  >
                    <TaskCard
                      task={t}
                      assignee={profiles.find((p) => p.id === t.assigned_to)}
                      profiles={profiles}
                      userId={userId}
                      canManage={isManager}
                      onChanged={onChanged}
                      hideStatusBadge={true}
                    />
                  </div>
                ))}
              </div>

              {/* Column Add Task Button (Screenshot 4) */}
              <button
                type="button"
                onClick={() => onAddTask?.(col.key)}
                className={cn(
                  "w-full flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer text-left",
                  col.addBtnStyle
                )}
              >
                <Plus className="h-4 w-4" /> Add Task
              </button>
            </div>
          );
        })}
      </div>

      <ActiveTaskConflictModal
        open={conflictModalOpen}
        onOpenChange={(open) => {
          setConflictModalOpen(open);
          if (!open) {
            setExistingActiveTask(null);
            setPendingActiveTask(null);
          }
        }}
        activeTask={existingActiveTask}
        newTask={pendingActiveTask}
        onConfirm={handleConfirmSwitch}
        isSubmitting={switchBusy}
      />
    </div>
  );
}
