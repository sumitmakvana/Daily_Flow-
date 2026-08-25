import type { TaskPriority, TaskStatus } from "./types";

export const statusColor: Record<TaskStatus, string> = {
  "To Do": "bg-status-todo/15 text-status-todo border-status-todo/30",
  "In Progress": "bg-status-progress/15 text-status-progress border-status-progress/30",
  "In Review": "bg-status-review/15 text-status-review border-status-review/30",
  Blocked: "bg-status-blocked/15 text-status-blocked border-status-blocked/40",
  "On Hold": "bg-status-hold/15 text-status-hold border-status-hold/30",
  Completed: "bg-status-completed/15 text-status-completed border-status-completed/30",
};

export const priorityColor: Record<TaskPriority, string> = {
  High: "bg-priority-high/15 text-priority-high border-priority-high/40",
  Medium: "bg-priority-medium/15 text-priority-medium border-priority-medium/40",
  Low: "bg-priority-low/15 text-priority-low border-priority-low/40",
};

export const priorityDot: Record<TaskPriority, string> = {
  High: "bg-priority-high",
  Medium: "bg-priority-medium",
  Low: "bg-priority-low",
};

export const leaveColor: Record<string, string> = {
  casual: "bg-card text-foreground border-border hover:bg-muted/50",
  sick: "bg-card text-foreground border-border hover:bg-muted/50",
  wfh: "bg-card text-foreground border-border hover:bg-muted/50",
  half_day: "bg-card text-foreground border-border hover:bg-muted/50",
  paid: "bg-card text-foreground border-border hover:bg-muted/50",
};

export const leaveDot: Record<string, string> = {
  casual: "bg-purple-400",
  sick: "bg-amber-400",
  wfh: "bg-sky-400",
  half_day: "bg-emerald-400",
  paid: "bg-blue-400",
};



