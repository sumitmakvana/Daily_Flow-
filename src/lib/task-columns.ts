// Column lists for pages that read the whole tasks table to compute numbers.
// Those pages need every row (their totals cover historical tasks too), but not every column:
// `select=*` on ~1,200 tasks is ~1.2 MB, these lists are a fraction of that. Row sets, filters
// and counts are unchanged; only the columns the page actually reads are fetched.

/** What computeToday / per-member workload maths read: assignee, status, overdue check, hours. */
export const TASK_WORKLOAD_COLS = "id,assigned_to,status,due_date,planned_hours,actual_hours,updated_at";

/** EOD board: workload columns + completed_at for the "completed today" counts. */
export const TASK_EOD_COLS = `${TASK_WORKLOAD_COLS},completed_at`;

/** Command Center: workload columns + the SLA-risk KPI. */
export const TASK_COMMAND_COLS = `${TASK_WORKLOAD_COLS},sla_due_at`;

/** Calendar grid / week / day / list views: places a task by due date and shows its title. Full rows load on demand. */
export const TASK_CALENDAR_COLS = "id,task_code,task_name,assigned_to,status,priority,due_date,updated_at";

/** Manager dashboard, every row: the tiles and the per-member table. */
export const TASK_DASHBOARD_COLS = `${TASK_WORKLOAD_COLS},priority,completed_at`;

/** Manager dashboard, only the rows its "High-priority delays" / "Active blockers" lists show. */
export const TASK_DASHBOARD_DETAIL_COLS = "id,task_code,task_name,blocked_at,blocker_reason";

/** Time Tracking: the timesheet rows, KPIs and TaskHoursBadges (which reads created_at / started_at / hours). */
export const TASK_TIMESHEET_COLS =
  "id,task_code,task_name,project_name,assigned_to,status,planned_hours,actual_hours,system_hours,started_at,created_at";

/** Time Tracking worklogs: what the rows, the daily chart and the history popover read. */
export const WORKLOG_TIMESHEET_COLS = "id,task_id,user_id,work_date,system_hours,logged_hours";

/**
 * Tasks page list: everything filtering, search, sorting, day grouping, the counters and the CSV export read.
 * Full rows (with worklogs) are read only for the page on screen, and for an action that needs them.
 */
export const TASK_LIST_COLS =
  "id,task_code,task_name,client,project_name,remarks,status,priority,assigned_to,reviewer,start_date,due_date,created_at,updated_at,completed_at,planned_hours,actual_hours";

/** Planning board: places a task in a member / priority group and shows its summary line. Actions read the full row. */
export const TASK_PLANNING_COLS =
  "id,task_code,task_name,assigned_to,priority,status,due_date,planned_hours,actual_hours,carry_forward_count,updated_at";
