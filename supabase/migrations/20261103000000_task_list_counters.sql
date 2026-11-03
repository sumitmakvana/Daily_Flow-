-- Tasks page: one call for every counter a manager/admin sees (sidebar status + priority of the active
-- tab, and the KPI strip), instead of ~12 separate head-count requests.
--
-- SECURITY INVOKER: the caller's row-level security applies, so the counts cover exactly the rows the
-- caller may read, same as the PostgREST head counts this replaces.
-- Tab rules match applyTab() in src/lib/task-list-query.ts:
--   my_tasks   : assigned_to = p_user
--   team_tasks : assigned_to IS NULL OR assigned_to <> p_user
--   all_tasks  : no restriction
-- Overdue matches fetchHeaderCounts(): not Completed and (due_date < today, or no due_date and start_date < today).
--
-- Rollback: supabase/rollbacks/20261103000000_task_list_counters.down.sql

CREATE OR REPLACE FUNCTION public.task_list_counters(p_tab text, p_user uuid, p_today date)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH t AS (
    SELECT status::text AS status, priority::text AS priority, assigned_to, due_date, start_date
      FROM public.tasks
  ),
  tab AS (
    SELECT * FROM t
     WHERE CASE p_tab
             WHEN 'my_tasks'   THEN assigned_to = p_user
             WHEN 'team_tasks' THEN assigned_to IS NULL OR assigned_to <> p_user
             ELSE true
           END
  )
  SELECT jsonb_build_object(
    'status',   COALESCE((SELECT jsonb_object_agg(status, n)   FROM (SELECT status,   count(*) AS n FROM tab GROUP BY status)   s), '{}'::jsonb),
    'priority', COALESCE((SELECT jsonb_object_agg(priority, n) FROM (SELECT priority, count(*) AS n FROM tab GROUP BY priority) s), '{}'::jsonb),
    'total',    (SELECT count(*) FROM t),
    'mine',     (SELECT count(*) FROM t WHERE assigned_to = p_user),
    'overdue',  (SELECT count(*) FROM t
                  WHERE status <> 'Completed'
                    AND (due_date < p_today OR (due_date IS NULL AND start_date < p_today)))
  );
$$;

GRANT EXECUTE ON FUNCTION public.task_list_counters(text, uuid, date) TO authenticated;
NOTIFY pgrst, 'reload schema';
