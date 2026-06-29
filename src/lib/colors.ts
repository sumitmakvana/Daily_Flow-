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
