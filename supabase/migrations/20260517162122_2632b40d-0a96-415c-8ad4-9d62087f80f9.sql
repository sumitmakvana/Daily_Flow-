
-- =============== PLANNING SUGGESTIONS ===============
CREATE TABLE IF NOT EXISTS public.planning_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('reassign','priority','due_date','rebalance','reviewer')),
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  target_date date NOT NULL DEFAULT ((now() AT TIME ZONE 'utc')::date),
  task_id uuid,
  from_user_id uuid,
  to_user_id uuid,
  reason text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','accepted','dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid
);

CREATE UNIQUE INDEX IF NOT EXISTS planning_suggestions_dedupe
  ON public.planning_suggestions (kind, COALESCE(task_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(to_user_id, '00000000-0000-0000-0000-000000000000'::uuid), target_date)
  WHERE status = 'open';

ALTER TABLE public.planning_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY ps_read_all ON public.planning_suggestions FOR SELECT TO authenticated USING (true);
CREATE POLICY ps_write_mgr ON public.planning_suggestions FOR INSERT TO authenticated WITH CHECK (public.is_manager_or_admin(auth.uid()));
CREATE POLICY ps_update_mgr ON public.planning_suggestions FOR UPDATE TO authenticated USING (public.is_manager_or_admin(auth.uid())) WITH CHECK (public.is_manager_or_admin(auth.uid()));

-- =============== NUDGES ===============
CREATE TABLE IF NOT EXISTS public.nudges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  kind text NOT NULL,
  title text NOT NULL,
  body text,
  severity text NOT NULL DEFAULT 'low' CHECK (severity IN ('low','medium','high','critical')),
  cooldown_until timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  dismissed_at timestamptz
);
CREATE INDEX IF NOT EXISTS nudges_user_kind_cd ON public.nudges (user_id, kind, cooldown_until DESC);
CREATE INDEX IF NOT EXISTS nudges_user_open ON public.nudges (user_id, dismissed_at);

ALTER TABLE public.nudges ENABLE ROW LEVEL SECURITY;
CREATE POLICY nudges_read_self_or_mgr ON public.nudges FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_manager_or_admin(auth.uid()));
CREATE POLICY nudges_update_self ON public.nudges FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
-- Writes happen via SECURITY DEFINER function only; no direct insert policy.

-- =============== ADOPTION DAILY ===============
CREATE TABLE IF NOT EXISTS public.adoption_daily (
  user_id uuid NOT NULL,
  rollup_date date NOT NULL,
  status_updates_count int NOT NULL DEFAULT 0,
  eod_submitted boolean NOT NULL DEFAULT false,
  blocker_usage boolean NOT NULL DEFAULT false,
  planning_views int NOT NULL DEFAULT 0,
  notif_interactions int NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, rollup_date)
);

ALTER TABLE public.adoption_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY ad_read_self_or_mgr ON public.adoption_daily FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_manager_or_admin(auth.uid()));

-- =============== AUDIT EXPORTS ===============
CREATE TABLE IF NOT EXISTS public.audit_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  kind text NOT NULL,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  row_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.audit_exports ENABLE ROW LEVEL SECURITY;
CREATE POLICY ae_read_mgr ON public.audit_exports FOR SELECT TO authenticated USING (public.is_manager_or_admin(auth.uid()));
CREATE POLICY ae_write_mgr ON public.audit_exports FOR INSERT TO authenticated WITH CHECK (public.is_manager_or_admin(auth.uid()) AND user_id = auth.uid());

-- =============== INDEXES ===============
CREATE INDEX IF NOT EXISTS tasks_cf_count ON public.tasks (carry_forward_count);
CREATE INDEX IF NOT EXISTS risk_events_date_resolved ON public.risk_events (detection_date, resolved_at);
CREATE INDEX IF NOT EXISTS task_history_task_created ON public.task_history (task_id, created_at DESC);

-- =============== FUNCTIONS ===============

-- Generate planning suggestions (idempotent per day)
CREATE OR REPLACE FUNCTION public.generate_planning_suggestions(_for_date date DEFAULT ((now() AT TIME ZONE 'utc')::date + 1))
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cap numeric;
  inserted int := 0;
BEGIN
  SELECT daily_capacity_hours INTO cap FROM public.work_settings WHERE id = 1;
  cap := COALESCE(cap, 8);

  -- 1. REASSIGN: overloaded user -> under-utilized user (pick lowest-priority movable task)
  INSERT INTO public.planning_suggestions (kind, severity, target_date, task_id, from_user_id, to_user_id, reason, payload)
  SELECT 'reassign',
         CASE WHEN ov.load > cap * 1.5 THEN 'high' ELSE 'medium' END,
         _for_date,
         t.id,
         ov.user_id,
         un.user_id,
         format('%s is at %s%% capacity; %s has room (%s%%). Move "%s".',
                COALESCE(pov.display_name,'user'),
                round((ov.load/cap)*100),
                COALESCE(pun.display_name,'user'),
                round((un.load/cap)*100),
                t.task_name),
         jsonb_build_object('from_load', ov.load, 'to_load', un.load, 'capacity', cap)
    FROM (
      SELECT assigned_to AS user_id, SUM(COALESCE(planned_hours,0)) AS load
        FROM public.tasks
       WHERE assigned_to IS NOT NULL AND status NOT IN ('Completed')
         AND (due_date = _for_date OR due_date IS NULL)
       GROUP BY assigned_to
    ) ov
    JOIN (
      SELECT p.id AS user_id, COALESCE(SUM(COALESCE(t2.planned_hours,0)),0) AS load
        FROM public.profiles p
        LEFT JOIN public.tasks t2 ON t2.assigned_to = p.id AND t2.status NOT IN ('Completed')
                                  AND (t2.due_date = _for_date OR t2.due_date IS NULL)
       GROUP BY p.id
    ) un ON un.load < cap * 0.6 AND un.user_id <> ov.user_id
    JOIN LATERAL (
      SELECT id, task_name FROM public.tasks
       WHERE assigned_to = ov.user_id AND status NOT IN ('Completed','In Review')
         AND priority IN ('Low','Medium')
       ORDER BY priority DESC, COALESCE(planned_hours,0) ASC
       LIMIT 1
    ) t ON true
    LEFT JOIN public.profiles pov ON pov.id = ov.user_id
    LEFT JOIN public.profiles pun ON pun.id = un.user_id
   WHERE ov.load > cap * 1.1
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;

  -- 2. PRIORITY bump for stagnant high-pri tasks (suggest review)
  INSERT INTO public.planning_suggestions (kind, severity, target_date, task_id, reason, payload)
  SELECT 'priority', 'high', _for_date, id,
         format('"%s" is High priority but idle since %s. Re-prioritize or unblock.', task_name, updated_at::date),
         jsonb_build_object('idle_since', updated_at)
    FROM public.tasks
   WHERE priority = 'High' AND status NOT IN ('Completed') AND updated_at < now() - interval '3 days'
  ON CONFLICT DO NOTHING;

  -- 3. DUE_DATE shift for repeated carry-forwards
  INSERT INTO public.planning_suggestions (kind, severity, target_date, task_id, reason, payload)
  SELECT 'due_date',
         CASE WHEN carry_forward_count >= 4 THEN 'high' ELSE 'medium' END,
         _for_date, id,
         format('"%s" has been carried forward %s times. Revisit scope or due date.', task_name, carry_forward_count),
         jsonb_build_object('count', carry_forward_count)
    FROM public.tasks
   WHERE carry_forward_count >= 2 AND status NOT IN ('Completed')
  ON CONFLICT DO NOTHING;

  -- 4. REVIEWER rebalance when one reviewer has >5 items
  INSERT INTO public.planning_suggestions (kind, severity, target_date, from_user_id, reason, payload)
  SELECT 'reviewer', 'medium', _for_date, reviewer,
         format('Reviewer queue has %s items. Consider redistributing.', cnt),
         jsonb_build_object('count', cnt)
    FROM (
      SELECT reviewer, COUNT(*) AS cnt FROM public.tasks
       WHERE status = 'In Review' AND reviewer IS NOT NULL GROUP BY reviewer
    ) s WHERE cnt > 5
  ON CONFLICT DO NOTHING;

  RETURN inserted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.generate_planning_suggestions(date) FROM public, anon;

-- Generate nudges with cooldown
CREATE OR REPLACE FUNCTION public.generate_nudges()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted int := 0;
  cap numeric;
BEGIN
  SELECT daily_capacity_hours INTO cap FROM public.work_settings WHERE id = 1;
  cap := COALESCE(cap, 8);

  -- Helper insert respecting cooldown
  -- 1. Members: untouched tasks (>24h since update, status in progress)
  INSERT INTO public.nudges (user_id, kind, title, body, severity, cooldown_until)
  SELECT t.assigned_to, 'untouched_tasks',
         'Some tasks need an update',
         format('%s task%s haven''t been updated in 24h.', cnt, CASE WHEN cnt=1 THEN '' ELSE 's' END),
         'low', now() + interval '12 hours'
    FROM (
      SELECT assigned_to, COUNT(*) AS cnt FROM public.tasks
       WHERE status IN ('To Do','In Progress','Blocked') AND assigned_to IS NOT NULL
         AND updated_at < now() - interval '24 hours'
       GROUP BY assigned_to
    ) x
    JOIN public.tasks t ON t.assigned_to = x.assigned_to
   WHERE NOT EXISTS (
      SELECT 1 FROM public.nudges n
       WHERE n.user_id = x.assigned_to AND n.kind = 'untouched_tasks' AND n.cooldown_until > now()
   )
   GROUP BY t.assigned_to, cnt;
  GET DIAGNOSTICS inserted = ROW_COUNT;

  -- 2. Members: long blocker
  INSERT INTO public.nudges (user_id, kind, title, body, severity, cooldown_until)
  SELECT DISTINCT assigned_to, 'long_blocker_self',
         'A task has been blocked too long',
         format('"%s" has been blocked since %s.', task_name, blocked_at::date),
         'medium', now() + interval '24 hours'
    FROM public.tasks
   WHERE status = 'Blocked' AND assigned_to IS NOT NULL AND blocked_at < now() - interval '2 days'
     AND NOT EXISTS (
       SELECT 1 FROM public.nudges n
        WHERE n.user_id = tasks.assigned_to AND n.kind = 'long_blocker_self' AND n.cooldown_until > now()
     );

  -- 3. Members: heavy tomorrow load
  INSERT INTO public.nudges (user_id, kind, title, body, severity, cooldown_until)
  SELECT s.assigned_to, 'heavy_tomorrow',
         'Tomorrow looks heavy',
         format('You have %sh of planned work for tomorrow vs %sh capacity.', round(s.load,1), cap),
         CASE WHEN s.load > cap * 1.25 THEN 'high' ELSE 'medium' END,
         now() + interval '20 hours'
    FROM (
      SELECT assigned_to, SUM(COALESCE(planned_hours,0)) AS load FROM public.tasks
       WHERE assigned_to IS NOT NULL AND status NOT IN ('Completed')
         AND due_date = ((now() AT TIME ZONE 'utc')::date + 1)
       GROUP BY assigned_to
    ) s
   WHERE s.load > cap * 1.1
     AND NOT EXISTS (
       SELECT 1 FROM public.nudges n
        WHERE n.user_id = s.assigned_to AND n.kind = 'heavy_tomorrow' AND n.cooldown_until > now()
     );

  -- 4. Managers: rising carry-forward
  INSERT INTO public.nudges (user_id, kind, title, body, severity, cooldown_until)
  SELECT ur.user_id, 'carry_forward_trend',
         'Carry-forward trend is rising',
         format('%s tasks have been carried forward 3+ times.', cnt),
         'medium', now() + interval '24 hours'
    FROM public.user_roles ur
    CROSS JOIN (SELECT COUNT(*) AS cnt FROM public.tasks WHERE carry_forward_count >= 3 AND status <> 'Completed') c
   WHERE ur.role IN ('manager','admin') AND c.cnt > 0
     AND NOT EXISTS (
       SELECT 1 FROM public.nudges n WHERE n.user_id = ur.user_id AND n.kind = 'carry_forward_trend' AND n.cooldown_until > now()
     );

  -- 5. Managers: reviewer backlog
  INSERT INTO public.nudges (user_id, kind, title, body, severity, cooldown_until)
  SELECT ur.user_id, 'reviewer_backlog',
         'Reviewer queue is backing up',
         format('%s tasks waiting in In Review.', cnt),
         CASE WHEN cnt > 15 THEN 'high' ELSE 'medium' END,
         now() + interval '12 hours'
    FROM public.user_roles ur
    CROSS JOIN (SELECT COUNT(*) AS cnt FROM public.tasks WHERE status = 'In Review') c
   WHERE ur.role IN ('manager','admin') AND c.cnt > 10
     AND NOT EXISTS (
       SELECT 1 FROM public.nudges n WHERE n.user_id = ur.user_id AND n.kind = 'reviewer_backlog' AND n.cooldown_until > now()
     );

  -- 6. Managers: high-priority delay risk
  INSERT INTO public.nudges (user_id, kind, title, body, severity, cooldown_until)
  SELECT ur.user_id, 'hp_delay_risk',
         'High-priority tasks likely to slip',
         format('%s High-priority tasks are at risk of delay.', cnt),
         'high', now() + interval '12 hours'
    FROM public.user_roles ur
    CROSS JOIN (
      SELECT COUNT(*) AS cnt FROM public.tasks
       WHERE priority = 'High' AND status NOT IN ('Completed')
         AND (due_date <= ((now() AT TIME ZONE 'utc')::date + 1))
    ) c
   WHERE ur.role IN ('manager','admin') AND c.cnt >= 3
     AND NOT EXISTS (
       SELECT 1 FROM public.nudges n WHERE n.user_id = ur.user_id AND n.kind = 'hp_delay_risk' AND n.cooldown_until > now()
     );

  RETURN inserted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.generate_nudges() FROM public, anon;

-- Predict tomorrow risks (rule-based)
CREATE OR REPLACE FUNCTION public.predict_tomorrow_risks()
RETURNS TABLE(task_id uuid, risk_score int, reasons text[])
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH cap_load AS (
    SELECT assigned_to, SUM(COALESCE(planned_hours,0)) AS load
      FROM public.tasks
     WHERE assigned_to IS NOT NULL AND status NOT IN ('Completed')
       AND due_date = ((now() AT TIME ZONE 'utc')::date + 1)
     GROUP BY assigned_to
  ),
  cap AS (SELECT COALESCE((SELECT daily_capacity_hours FROM public.work_settings WHERE id=1),8) AS h)
  SELECT t.id AS task_id,
         (CASE WHEN t.carry_forward_count >= 2 THEN 30 ELSE 0 END
          + CASE WHEN t.status = 'Blocked' THEN 25 ELSE 0 END
          + CASE WHEN t.priority = 'High' THEN 15 ELSE 0 END
          + CASE WHEN t.updated_at < now() - interval '2 days' THEN 10 ELSE 0 END
          + CASE WHEN cl.load > (SELECT h FROM cap) * 1.1 THEN 20 ELSE 0 END)::int AS risk_score,
         ARRAY_REMOVE(ARRAY[
           CASE WHEN t.carry_forward_count >= 2 THEN format('carried forward %sx', t.carry_forward_count) END,
           CASE WHEN t.status = 'Blocked' THEN 'currently blocked' END,
           CASE WHEN t.priority = 'High' THEN 'high priority' END,
           CASE WHEN t.updated_at < now() - interval '2 days' THEN 'stale' END,
           CASE WHEN cl.load > (SELECT h FROM cap) * 1.1 THEN 'assignee overloaded tomorrow' END
         ], NULL) AS reasons
    FROM public.tasks t
    LEFT JOIN cap_load cl ON cl.assigned_to = t.assigned_to
   WHERE t.status NOT IN ('Completed')
     AND (t.due_date <= ((now() AT TIME ZONE 'utc')::date + 1) OR t.due_date IS NULL);
$$;

-- Adoption rollup
CREATE OR REPLACE FUNCTION public.adoption_rollup(_for_date date DEFAULT ((now() AT TIME ZONE 'utc')::date))
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE inserted int := 0;
BEGIN
  INSERT INTO public.adoption_daily (user_id, rollup_date, status_updates_count, eod_submitted, blocker_usage, planning_views, notif_interactions)
  SELECT p.id, _for_date,
         COALESCE(h.cnt,0),
         EXISTS(SELECT 1 FROM public.eod_checkins e WHERE e.user_id = p.id AND e.checkin_date = _for_date),
         COALESCE(b.has,false),
         0,
         COALESCE(ni.cnt,0)
    FROM public.profiles p
    LEFT JOIN (
      SELECT updated_by, COUNT(*) AS cnt FROM public.task_history
       WHERE created_at::date = _for_date AND old_status IS DISTINCT FROM new_status
       GROUP BY updated_by
    ) h ON h.updated_by = p.id
    LEFT JOIN (
      SELECT assigned_to, true AS has FROM public.tasks
       WHERE status = 'Blocked' AND blocked_at::date = _for_date GROUP BY assigned_to
    ) b ON b.assigned_to = p.id
    LEFT JOIN (
      SELECT user_id, COUNT(*) AS cnt FROM public.notifications
       WHERE read_at::date = _for_date GROUP BY user_id
    ) ni ON ni.user_id = p.id
  ON CONFLICT (user_id, rollup_date) DO UPDATE
     SET status_updates_count = EXCLUDED.status_updates_count,
         eod_submitted = EXCLUDED.eod_submitted,
         blocker_usage = EXCLUDED.blocker_usage,
         notif_interactions = EXCLUDED.notif_interactions;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN inserted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.adoption_rollup(date) FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.predict_tomorrow_risks() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.predict_tomorrow_risks() TO authenticated;
