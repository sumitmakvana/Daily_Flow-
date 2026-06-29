export type AppRole = "admin" | "manager" | "member";

export type TaskStatus =
  | "To Do"
  | "In Progress"
  | "In Review"
  | "Blocked"
  | "On Hold"
  | "Completed";

export type TaskPriority = "High" | "Medium" | "Low";

export const TASK_STATUSES: TaskStatus[] = [
  "To Do",
  "In Progress",
  "In Review",
  "Blocked",
  "On Hold",
  "Completed",
];

export const TASK_PRIORITIES: TaskPriority[] = ["High", "Medium", "Low"];

export interface Profile {
  id: string;
  display_name: string;
  email?: string;
  avatar_url: string | null;
}

export interface WorkItemType {
  id: string;
  key: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  active: boolean;
  sort_order: number;
  id_prefix?: string | null;
  id_seq?: number;
}

export interface Attachment {
  id: string;
  work_item_id: string;
  file_name: string;
  file_size: number;
  file_type: string;
  storage_path: string;
  uploaded_by: string | null;
  uploaded_at: string;
}

export interface Comment {
  id: string;
  work_item_id: string;
  parent_comment_id: string | null;
  user_id: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
}

export interface CommentMention {
  comment_id: string;
  mentioned_user_id: string;
  created_at: string;
}

export interface Task {
  id: string;
  task_code: string;
  task_name: string;
  assigned_to: string | null;
  client: string | null;
  project_name: string | null;
  priority: TaskPriority;
  reviewer: string | null;
  status: TaskStatus;
  due_date: string | null;
  done: boolean;
  remarks: string | null;
  planned_hours: number | null;
  actual_hours: number | null;
  blocker_reason: string | null;
  blocked_at: string | null;
  sprint_week: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  version: number;
  carry_forward_count: number;
  last_carry_forward_at: string | null;
  original_due_date: string | null;
  team_id: string | null;
  project_id: string | null;
  sla_due_at: string | null;
  type_id: string | null;
  status_id: string | null;
  custom_fields: Record<string, unknown>;
}

export interface TaskHistory {
  id: string;
  task_id: string;
  old_status: TaskStatus | null;
  new_status: TaskStatus | null;
  updated_by: string | null;
  comment: string | null;
  created_at: string;
}

export interface AppNotification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  task_id: string | null;
  read_at: string | null;
  created_at: string;
}

export interface EodCheckin {
  id: string;
  user_id: string;
  checkin_date: string;
  pending_count: number;
  blocker_count: number;
  completed_count: number;
  remaining_hours: number;
  tomorrow_priority_task_id: string | null;
  note: string | null;
  submitted_at: string;
}

export interface WorkloadSnapshot {
  id: string;
  user_id: string;
  snapshot_date: string;
  planned_hours: number;
  actual_hours: number;
  active_count: number;
  delayed_count: number;
  blocked_count: number;
  completed_count: number;
}

export interface CarryForwardEvent {
  id: string;
  task_id: string;
  from_date: string;
  to_date: string;
  reason: string;
  created_by: string | null;
  created_at: string;
}

export type RiskSeverity = "low" | "medium" | "high" | "critical";
export type RiskKind =
  | "task_repeated_delay"
  | "long_blocker"
  | "user_overload"
  | "high_priority_stagnation"
  | "reviewer_bottleneck"
  | "workload_spike";

export interface RiskEvent {
  id: string;
  kind: RiskKind;
  severity: RiskSeverity;
  entity_type: "task" | "user" | "project";
  entity_id: string;
  summary: string;
  payload: Record<string, unknown>;
  detected_at: string;
  resolved_at: string | null;
  detection_date: string;
}

export interface Team {
  id: string;
  name: string;
  parent_team_id: string | null;
  manager_id: string | null;
}

export interface Project {
  id: string;
  name: string;
  client: string | null;
  team_id: string | null;
  sla_days: number;
  status: string;
}

export interface WorkSettings {
  id: number;
  workdays: number[];
  daily_capacity_hours: number;
  sla_default_days: number;
}

export interface UserStreak {
  user_id: string;
  current_streak: number;
  longest_streak: number;
  last_update_date: string | null;
}

export interface HolidayCalendar {
  id: string;
  calendar_date: string;
  label: string;
}

export type SuggestionKind = "reassign" | "priority" | "due_date" | "rebalance" | "reviewer";
export type SuggestionStatus = "open" | "accepted" | "dismissed";

export interface PlanningSuggestion {
  id: string;
  kind: SuggestionKind;
  severity: RiskSeverity;
  target_date: string;
  task_id: string | null;
  from_user_id: string | null;
  to_user_id: string | null;
  reason: string;
  payload: Record<string, unknown>;
  status: SuggestionStatus;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

export interface Nudge {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  body: string | null;
  severity: RiskSeverity;
  cooldown_until: string;
  created_at: string;
  read_at: string | null;
  dismissed_at: string | null;
}

export interface AdoptionDaily {
  user_id: string;
  rollup_date: string;
  status_updates_count: number;
  eod_submitted: boolean;
  blocker_usage: boolean;
  planning_views: number;
  notif_interactions: number;
}

export interface PredictedRisk {
  task_id: string;
  risk_score: number;
  reasons: string[];
}

export interface NotificationPrefs {
  user_id: string;
  digest_enabled: boolean;
  eod_reminder_hour: number;
  notify_assignment: boolean;
  notify_priority_change: boolean;
  notify_blocker_resolved: boolean;
  notify_manager_overload: boolean;
  notify_manager_delays: boolean;
}
