-- Remove the automation engine completely (worker, cron hooks and admin UI are already gone).
--
-- Dependencies checked before dropping (see supabase/migrations/20260617*):
--   * automation_* and approval_outbox_events only reference each other, work_item_types and auth.users
--     (outgoing FKs); no other table, view or function references them except the objects handled below.
--   * exec_summary() read them for its "automation" block: recreated below without it. Its ACL and the
--     work_mem setting are preserved (CREATE OR REPLACE keeps grants).
--   * the four delete/deactivation guards only counted active automation rules.
-- Tables are dropped without CASCADE so an unexpected dependent makes this migration fail instead of
-- silently dropping it. Run order: write-path triggers, guards, exec_summary, functions, tables.

-- 1. Write path: events enqueued on every task / comment / EOD / risk / approval change.
DROP TRIGGER IF EXISTS trg_auto_task_insert ON public.tasks;
DROP TRIGGER IF EXISTS trg_auto_task_update ON public.tasks;
DROP TRIGGER IF EXISTS trg_auto_comment_insert ON public.comments;
DROP TRIGGER IF EXISTS trg_auto_eod_insert ON public.eod_checkins;
DROP TRIGGER IF EXISTS trg_auto_risk_insert ON public.risk_events;
DROP TRIGGER IF EXISTS trg_approval_outbox_after ON public.approval_decisions;
DROP TRIGGER IF EXISTS trg_automation_queue_stats ON public.automation_events;

-- 2. Delete / deactivation guards that queried automation_rules.
DROP TRIGGER IF EXISTS trg_guard_type_deactivation ON public.work_item_types;
DROP TRIGGER IF EXISTS trg_guard_type_delete ON public.work_item_types;
DROP TRIGGER IF EXISTS trg_guard_status_delete ON public.work_item_statuses;
DROP TRIGGER IF EXISTS trg_guard_field_def_delete ON public.work_item_field_defs;
DROP FUNCTION IF EXISTS public.guard_type_deactivation();
DROP FUNCTION IF EXISTS public.guard_type_referenced();
DROP FUNCTION IF EXISTS public.guard_status_referenced();
DROP FUNCTION IF EXISTS public.guard_field_def_referenced();

-- 3. exec_summary without the automation block (and its three automation CTEs / queries).
CREATE OR REPLACE FUNCTION public.exec_summary(
  _days integer DEFAULT 7,
  _team uuid DEFAULT NULL,
  _project uuid DEFAULT NULL,
  _type uuid DEFAULT NULL,
  _manager uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET work_mem TO '32MB'
AS $function$
DECLARE
  uid uuid := auth.uid();
  is_admin boolean := public.has_role(uid, 'admin');
  is_mgr boolean := public.has_role(uid, 'manager') OR is_admin;
  today date := (now() AT TIME ZONE 'utc')::date;
  since_ts timestamptz := now() - (_days || ' days')::interval;
  range_start date := today - GREATEST(_days, 1) + 1;
  visible uuid[];
  result jsonb;
  cap numeric;
BEGIN
  IF uid IS NULL OR NOT is_mgr THEN
    RAISE EXCEPTION 'manager or admin required' USING ERRCODE = '42501';
  END IF;

  visible := ARRAY(SELECT public.manager_visible_team_ids(uid));
  SELECT COALESCE(daily_capacity_hours, 8) INTO cap FROM public.work_settings WHERE id = 1;
  cap := COALESCE(cap, 8);

  IF _manager IS NOT NULL AND NOT is_admin THEN
    visible := ARRAY(
      SELECT t FROM unnest(visible) t
      INTERSECT
      SELECT public.manager_visible_team_ids(_manager)
    );
  ELSIF _manager IS NOT NULL THEN
    visible := ARRAY(SELECT public.manager_visible_team_ids(_manager));
  END IF;

  WITH base_tasks AS (
    SELECT t.* FROM public.tasks t
     WHERE (t.team_id IS NULL OR t.team_id = ANY(visible))
       AND (_team IS NULL OR t.team_id = _team)
       AND (_project IS NULL OR t.project_id = _project)
       AND (_type IS NULL OR t.type_id = _type)
  ),
  base_users AS (SELECT DISTINCT assigned_to AS user_id FROM base_tasks WHERE assigned_to IS NOT NULL),
  exec_kpi AS (
    SELECT
      (SELECT COUNT(*) FROM base_tasks WHERE due_date = today) AS planned_today,
      (SELECT COUNT(*) FROM base_tasks WHERE completed_at::date = today) AS completed_today,
      (SELECT COUNT(*) FROM base_tasks WHERE due_date BETWEEN today - 6 AND today) AS week_due,
      (SELECT COUNT(*) FROM base_tasks WHERE completed_at::date BETWEEN today - 6 AND today) AS week_done,
      (SELECT COUNT(*) FROM base_tasks WHERE due_date BETWEEN today - 13 AND today - 7) AS prev_week_due,
      (SELECT COUNT(*) FROM base_tasks WHERE completed_at::date BETWEEN today - 13 AND today - 7) AS prev_week_done
  ),
  proj_rollup AS (
    SELECT p.id, p.name,
      COUNT(t.*) AS total,
      COUNT(*) FILTER (WHERE t.status NOT IN ('Completed') AND t.due_date < today) AS overdue,
      COUNT(*) FILTER (WHERE t.status = 'Blocked') AS blocked,
      COUNT(*) FILTER (WHERE t.carry_forward_count >= 3) AS carry
      FROM public.projects p
      LEFT JOIN base_tasks t ON t.project_id = p.id
     WHERE p.id IN (SELECT DISTINCT project_id FROM base_tasks WHERE project_id IS NOT NULL)
        OR (_project IS NULL AND _team IS NULL AND p.team_id = ANY(visible))
     GROUP BY p.id, p.name
  ),
  proj_class AS (
    SELECT id, name, total, overdue, blocked,
      CASE
        WHEN overdue > 0 AND overdue >= GREATEST(1, FLOOR(total * 0.2)) THEN 'late'
        WHEN (overdue + blocked + carry) > 0 THEN 'risk'
        ELSE 'on'
      END AS status
      FROM proj_rollup
  ),
  open_risks AS (
    SELECT r.* FROM public.risk_events r
     WHERE r.resolved_at IS NULL
       AND (r.entity_type <> 'task' OR EXISTS (SELECT 1 FROM base_tasks bt WHERE bt.id = r.entity_id))
       AND (r.entity_type <> 'project' OR EXISTS (SELECT 1 FROM proj_rollup pr WHERE pr.id = r.entity_id))
       AND (r.entity_type <> 'user' OR EXISTS (SELECT 1 FROM base_users bu WHERE bu.user_id = r.entity_id))
  ),
  approvals_scope AS (
    SELECT a.* FROM public.approval_requests a
     WHERE EXISTS (SELECT 1 FROM base_tasks bt WHERE bt.id = a.work_item_id)
  ),
  workload_rows AS (
    SELECT bu.user_id, p.display_name, COALESCE(SUM(bt.planned_hours), 0) AS planned
      FROM base_users bu
      LEFT JOIN public.profiles p ON p.id = bu.user_id
      LEFT JOIN base_tasks bt
        ON bt.assigned_to = bu.user_id
       AND bt.status NOT IN ('Completed')
       AND (bt.due_date = today OR bt.due_date IS NULL)
     GROUP BY bu.user_id, p.display_name
  ),
  carry_in_range AS (
    SELECT c.* FROM public.carry_forward_events c
     WHERE c.created_at >= since_ts
       AND EXISTS (SELECT 1 FROM base_tasks bt WHERE bt.id = c.task_id)
  ),
  cf_trend AS (
    SELECT d::date AS day,
      (SELECT COUNT(*) FROM carry_in_range c WHERE c.created_at::date = d::date) AS n
      FROM generate_series(range_start, today, '1 day') d
  ),
  eod_today AS (
    SELECT COUNT(*) AS n FROM public.eod_checkins e
     WHERE e.checkin_date = today AND e.user_id IN (SELECT user_id FROM base_users)
  ),
  eod_users_range AS (
    SELECT COUNT(DISTINCT user_id) AS n FROM public.eod_checkins
     WHERE checkin_date >= range_start AND user_id IN (SELECT user_id FROM base_users)
  ),
  adopt_range AS (
    SELECT * FROM public.adoption_daily
     WHERE rollup_date >= range_start AND user_id IN (SELECT user_id FROM base_users)
  ),
  dau_trend AS (
    SELECT d::date AS day,
      (SELECT COUNT(DISTINCT user_id) FROM adopt_range a
        WHERE a.rollup_date = d::date
          AND (a.status_updates_count > 0 OR a.eod_submitted OR a.notif_interactions > 0)) AS n
      FROM generate_series(range_start, today, '1 day') d
  ),
  team_scores AS (
    SELECT tm.id, tm.name AS team,
      COALESCE(p.display_name, '—') AS manager,
      COUNT(bt.*) AS total,
      COUNT(*) FILTER (WHERE bt.status = 'Completed') AS done,
      COUNT(*) FILTER (WHERE bt.status = 'Blocked') AS blocked,
      COUNT(*) FILTER (WHERE bt.carry_forward_count >= 3) AS cf_hot
      FROM public.teams tm
      LEFT JOIN public.profiles p ON p.id = tm.manager_id
      LEFT JOIN base_tasks bt ON bt.team_id = tm.id
     WHERE tm.id = ANY(visible)
     GROUP BY tm.id, tm.name, p.display_name
  ),
  team_scored AS (
    SELECT id, team, manager,
      ROUND(
        (CASE WHEN total > 0 THEN done::numeric/total ELSE 0 END) * 30 +
        (CASE WHEN total > 0 THEN GREATEST(0, 1 - blocked::numeric/total) ELSE 1 END) * 20 +
        (CASE WHEN total > 0 THEN GREATEST(0, 1 - cf_hot::numeric/total) ELSE 1 END) * 20 +
        15 + 15
      )::int AS score
      FROM team_scores
  ),
  mgr_eff AS (
    SELECT tm.manager_id,
      COALESCE(p.display_name, 'Manager') AS manager,
      COUNT(bt.*) AS total,
      COUNT(*) FILTER (WHERE bt.status = 'Completed') AS done,
      COUNT(*) FILTER (WHERE bt.status NOT IN ('Completed') AND bt.due_date < today) AS overdue,
      AVG(
        CASE WHEN ar.completed_at IS NOT NULL
             THEN EXTRACT(EPOCH FROM (ar.completed_at - ar.requested_at))/3600.0
             ELSE NULL END
      ) AS appr_hours
      FROM public.teams tm
      JOIN public.profiles p ON p.id = tm.manager_id
      LEFT JOIN base_tasks bt ON bt.team_id = tm.id
      LEFT JOIN approvals_scope ar ON ar.work_item_id = bt.id AND ar.completed_at IS NOT NULL
     WHERE tm.id = ANY(visible) AND tm.manager_id IS NOT NULL
     GROUP BY tm.manager_id, p.display_name
  ),
  team_overload AS (
    SELECT tm.id, tm.name,
      COALESCE(SUM(w.planned), 0) AS planned,
      GREATEST(COUNT(DISTINCT bu.user_id), 1) AS members
      FROM public.teams tm
      LEFT JOIN base_tasks bt ON bt.team_id = tm.id
      LEFT JOIN base_users bu ON bu.user_id = bt.assigned_to
      LEFT JOIN workload_rows w ON w.user_id = bu.user_id
     WHERE tm.id = ANY(visible)
     GROUP BY tm.id, tm.name
  ),
  appr_pending AS (
    SELECT
      COUNT(*) FILTER (WHERE status = 'pending') AS now_pending,
      COUNT(*) FILTER (WHERE status = 'pending' AND requested_at < now() - interval '7 days') AS pending_over_7d
      FROM approvals_scope
  ),
  visible_teams AS (
    SELECT id, name, manager_id FROM public.teams WHERE id = ANY(visible) ORDER BY name LIMIT 200
  ),
  visible_managers AS (
    SELECT DISTINCT tm.manager_id AS id, p.display_name AS name
      FROM public.teams tm
      JOIN public.profiles p ON p.id = tm.manager_id
     WHERE tm.id = ANY(visible) AND tm.manager_id IS NOT NULL
     ORDER BY p.display_name LIMIT 200
  ),
  visible_projects AS (
    SELECT id, name FROM public.projects
     WHERE id IN (SELECT DISTINCT project_id FROM base_tasks WHERE project_id IS NOT NULL)
     ORDER BY name LIMIT 200
  ),
  visible_types AS (
    SELECT id, name FROM public.work_item_types
     WHERE id IN (SELECT DISTINCT type_id FROM base_tasks WHERE type_id IS NOT NULL)
     ORDER BY name LIMIT 200
  )
  SELECT jsonb_build_object(
    'meta', jsonb_build_object(
      'days', _days, 'today', today, 'range_start', range_start,
      'is_admin', is_admin, 'visible_team_count', cardinality(visible),
      'capacity', cap, 'generated_at', now()
    ),
    'execution', (SELECT to_jsonb(e) FROM exec_kpi e),
    'delivery', jsonb_build_object(
      'on_track', (SELECT COUNT(*) FROM proj_class WHERE status='on'),
      'at_risk',  (SELECT COUNT(*) FROM proj_class WHERE status='risk'),
      'delayed',  (SELECT COUNT(*) FROM proj_class WHERE status='late'),
      'projects', (SELECT COALESCE(jsonb_agg(p ORDER BY (CASE p->>'status' WHEN 'late' THEN 0 WHEN 'risk' THEN 1 ELSE 2 END)), '[]'::jsonb)
                  FROM (SELECT to_jsonb(pc) AS p FROM proj_class pc LIMIT 12) x)
    ),
    'risk', jsonb_build_object(
      'blocked', (SELECT COUNT(*) FROM base_tasks WHERE status='Blocked'),
      'high', (SELECT COUNT(*) FROM open_risks WHERE severity IN ('high','critical')),
      'sla_breaches', (SELECT COUNT(*) FROM base_tasks WHERE sla_due_at IS NOT NULL AND sla_due_at < now() AND status <> 'Completed'),
      'approvals_pending', (SELECT now_pending FROM appr_pending),
      'critical', (SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.severity DESC), '[]'::jsonb)
                   FROM (SELECT id, severity, summary, entity_type, entity_id FROM open_risks
                          WHERE severity IN ('high','critical') ORDER BY detected_at DESC LIMIT 10) r)
    ),
    'workload', jsonb_build_object(
      'rows', (SELECT COALESCE(jsonb_agg(to_jsonb(w) ORDER BY w.pct DESC), '[]'::jsonb)
               FROM (SELECT user_id, display_name AS name, planned,
                            CASE WHEN cap > 0 THEN ROUND((planned/cap)*100)::int ELSE 0 END AS pct
                       FROM workload_rows ORDER BY planned DESC LIMIT 15) w)
    ),
    'discipline', jsonb_build_object(
      'cf_today', (SELECT COUNT(*) FROM carry_in_range WHERE created_at::date = today),
      'cf_hot', (SELECT COUNT(*) FROM base_tasks WHERE carry_forward_count >= 3),
      'eod_today', (SELECT n FROM eod_today),
      'eod_users_range', (SELECT n FROM eod_users_range),
      'eod_total_members', (SELECT COUNT(*) FROM base_users),
      'blocked_3d', (SELECT COUNT(*) FROM base_tasks WHERE status='Blocked' AND blocked_at IS NOT NULL AND blocked_at < now() - interval '3 days'),
      'cf_trend', (SELECT COALESCE(jsonb_agg(jsonb_build_object('d', day, 'n', n) ORDER BY day), '[]'::jsonb) FROM cf_trend)
    ),
    'adoption', jsonb_build_object(
      'dau', (SELECT COUNT(DISTINCT user_id) FROM adopt_range
               WHERE rollup_date = today AND (status_updates_count > 0 OR eod_submitted OR notif_interactions > 0)),
      'wau', (SELECT COUNT(DISTINCT user_id) FROM adopt_range
               WHERE rollup_date >= today - 6 AND (status_updates_count > 0 OR eod_submitted OR notif_interactions > 0)),
      'eod_users', (SELECT n FROM eod_users_range),
      'status_users', (SELECT COUNT(DISTINCT user_id) FROM adopt_range WHERE status_updates_count > 0),
      'total_members', (SELECT COUNT(*) FROM base_users),
      'dau_trend', (SELECT COALESCE(jsonb_agg(jsonb_build_object('d', day, 'n', n) ORDER BY day), '[]'::jsonb) FROM dau_trend)
    ),
    'team_health', (SELECT COALESCE(jsonb_agg(jsonb_build_object('team', team, 'manager', manager, 'score', score) ORDER BY score DESC), '[]'::jsonb) FROM team_scored),
    'manager_effectiveness', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'manager', manager,
        'completion', CASE WHEN total > 0 THEN ROUND(100.0*done/total)::int ELSE 0 END,
        'overdue', overdue,
        'appr', COALESCE(appr_hours, 0)
      ) ORDER BY (CASE WHEN total > 0 THEN done::numeric/total ELSE 0 END) DESC), '[]'::jsonb)
      FROM mgr_eff
    ),
    'insights_inputs', jsonb_build_object(
      'cf_last_7d', (SELECT COUNT(*) FROM carry_in_range WHERE created_at >= now() - interval '7 days'),
      'cf_prev_7d', (SELECT COUNT(*) FROM carry_in_range WHERE created_at >= now() - interval '14 days' AND created_at < now() - interval '7 days'),
      'approvals_pending_now', (SELECT now_pending FROM appr_pending),
      'approvals_pending_over_7d', (SELECT pending_over_7d FROM appr_pending),
      'team_overload', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'name', name,
          'pct', CASE WHEN cap*members > 0 THEN ROUND(planned/(cap*members)*100)::int ELSE 0 END
        )) FILTER (WHERE CASE WHEN cap*members > 0 THEN ROUND(planned/(cap*members)*100)::int ELSE 0 END > 120), '[]'::jsonb)
        FROM team_overload
      )
    ),
    'filters', jsonb_build_object(
      'teams', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'name', name)), '[]'::jsonb) FROM visible_teams),
      'managers', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'name', name)), '[]'::jsonb) FROM visible_managers),
      'projects', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'name', name)), '[]'::jsonb) FROM visible_projects),
      'types', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'name', name)), '[]'::jsonb) FROM visible_types)
    )
  ) INTO result;

  RETURN result;
END;
$function$;

-- 4. Functions.
DROP FUNCTION IF EXISTS public.trg_auto_tasks_insert();
DROP FUNCTION IF EXISTS public.trg_auto_tasks_update();
DROP FUNCTION IF EXISTS public.trg_auto_comments_insert();
DROP FUNCTION IF EXISTS public.trg_auto_eod_insert();
DROP FUNCTION IF EXISTS public.trg_auto_risk_insert();
DROP FUNCTION IF EXISTS public.trg_approval_outbox();
DROP FUNCTION IF EXISTS public.automation_queue_stats_bump();
DROP FUNCTION IF EXISTS public.enqueue_automation_event(text, text, uuid, jsonb, uuid, int, timestamptz);
DROP FUNCTION IF EXISTS public.automation_replay_dead_run(uuid);
DROP FUNCTION IF EXISTS public.purge_automation_artifacts(int);
DROP FUNCTION IF EXISTS public.automation_try_lock(bigint);
DROP FUNCTION IF EXISTS public.automation_unlock(bigint);
DROP FUNCTION IF EXISTS public.automation_set_depth(int);
DROP FUNCTION IF EXISTS public._current_automation_depth();

-- 5. Tables, children first. Their policies, indexes and the realtime trg_realtime_* triggers go with them.
DROP TABLE IF EXISTS public.automation_action_log;
DROP TABLE IF EXISTS public.automation_runs;
DROP TABLE IF EXISTS public.automation_events;
DROP TABLE IF EXISTS public.automation_rules;
DROP TABLE IF EXISTS public.automation_queue_stats;
DROP TABLE IF EXISTS public.approval_outbox_events;
