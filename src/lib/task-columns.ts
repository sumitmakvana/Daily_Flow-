// Column lists for pages that read the whole tasks table to compute numbers.
// Those pages need every row (their totals cover historical tasks too), but not every column:
// `select=*` on ~1,200 tasks is ~1.2 MB, these lists are a fraction of that. Row sets, filters
// and counts are unchanged; only the columns the page actually reads are fetched.

/** What computeToday / per-member workload maths read: assignee, status, overdue check, hours. */
export const TASK_WORKLOAD_COLS = "id,assigned_to,status,due_date,planned_hours,actual_hours";

/** EOD board: workload columns + completed_at for the "completed today" counts. */
export const TASK_EOD_COLS = `${TASK_WORKLOAD_COLS},completed_at`;

/** Command Center: workload columns + the SLA-risk KPI. */
export const TASK_COMMAND_COLS = `${TASK_WORKLOAD_COLS},sla_due_at`;

/** Manager dashboard, every row: the tiles and the per-member table. */
export const TASK_DASHBOARD_COLS = `${TASK_WORKLOAD_COLS},priority,completed_at`;

/** Manager dashboard, only the rows its "High-priority delays" / "Active blockers" lists show. */
export const TASK_DASHBOARD_DETAIL_COLS = "id,task_code,task_name,blocked_at,blocker_reason";
