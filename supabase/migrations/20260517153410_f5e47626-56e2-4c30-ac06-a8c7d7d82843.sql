
-- ============ Enterprise tables ============
CREATE TABLE public.teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  parent_team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL,
  manager_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
CREATE POLICY teams_read_all ON public.teams FOR SELECT TO authenticated USING (true);
CREATE POLICY teams_write_mgr ON public.teams FOR ALL TO authenticated
  USING (public.is_manager_or_admin(auth.uid()))
  WITH CHECK (public.is_manager_or_admin(auth.uid()));

CREATE TABLE public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  client text,
  team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL,
  sla_days int NOT NULL DEFAULT 3,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY projects_read_all ON public.projects FOR SELECT TO authenticated USING (true);
CREATE POLICY projects_write_mgr ON public.projects FOR ALL TO authenticated
  USING (public.is_manager_or_admin(auth.uid()))
  WITH CHECK (public.is_manager_or_admin(auth.uid()));

CREATE TABLE public.holiday_calendar (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_date date NOT NULL UNIQUE,
  label text NOT NULL
);
ALTER TABLE public.holiday_calendar ENABLE ROW LEVEL SECURITY;
CREATE POLICY hc_read_all ON public.holiday_calendar FOR SELECT TO authenticated USING (true);
CREATE POLICY hc_write_mgr ON public.holiday_calendar FOR ALL TO authenticated
  USING (public.is_manager_or_admin(auth.uid()))
  WITH CHECK (public.is_manager_or_admin(auth.uid()));

CREATE TABLE public.work_settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  workdays int[] NOT NULL DEFAULT ARRAY[1,2,3,4,5],
  daily_capacity_hours numeric NOT NULL DEFAULT 8,
  sla_default_days int NOT NULL DEFAULT 3,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.work_settings (id) VALUES (1);
ALTER TABLE public.work_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_read_all ON public.work_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY ws_update_mgr ON public.work_settings FOR UPDATE TO authenticated
  USING (public.is_manager_or_admin(auth.uid()))
  WITH CHECK (public.is_manager_or_admin(auth.uid()));

-- ============ Tasks / profiles extensions ============
ALTER TABLE public.tasks
  ADD COLUMN team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL,
  ADD COLUMN project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  ADD COLUMN sla_due_at timestamptz;

ALTER TABLE public.profiles
  ADD COLUMN team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL,
  ADD COLUMN manager_id uuid;

CREATE OR REPLACE FUNCTION public.compute_task_sla()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  d int;
BEGIN
  IF NEW.project_id IS NOT NULL THEN
    SELECT sla_days INTO d FROM public.projects WHERE id = NEW.project_id;
    IF d IS NOT NULL THEN
      NEW.sla_due_at := COALESCE(NEW.created_at, now()) + (d || ' days')::interval;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_compute_task_sla
BEFORE INSERT OR UPDATE OF project_id ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.compute_task_sla();

-- ============ Risk engine ============
CREATE TABLE public.risk_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  entity_type text NOT NULL CHECK (entity_type IN ('task','user','project')),
  entity_id uuid NOT NULL,
  summary text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid,
  detection_date date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  UNIQUE (kind, entity_type, entity_id, detection_date)
);
CREATE INDEX risk_events_open_idx ON public.risk_events (entity_type, entity_id) WHERE resolved_at IS NULL;
ALTER TABLE public.risk_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY risk_read_all ON public.risk_events FOR SELECT TO authenticated USING (true);
CREATE POLICY risk_write_mgr ON public.risk_events FOR INSERT TO authenticated
  WITH CHECK (public.is_manager_or_admin(auth.uid()));
CREATE POLICY risk_update_mgr ON public.risk_events FOR UPDATE TO authenticated
  USING (public.is_manager_or_admin(auth.uid()))
  WITH CHECK (public.is_manager_or_admin(auth.uid()));

CREATE TABLE public.risk_rules_config (
  kind text PRIMARY KEY,
  threshold_days int,
  threshold_count int,
  threshold_pct numeric,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.risk_rules_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY rrc_read_all ON public.risk_rules_config FOR SELECT TO authenticated USING (true);
CREATE POLICY rrc_write_mgr ON public.risk_rules_config FOR ALL TO authenticated
  USING (public.is_manager_or_admin(auth.uid()))
  WITH CHECK (public.is_manager_or_admin(auth.uid()));

INSERT INTO public.risk_rules_config (kind, threshold_days, threshold_count, threshold_pct) VALUES
  ('task_repeated_delay', NULL, 3, NULL),
  ('long_blocker', 2, NULL, NULL),
  ('user_overload', NULL, NULL, 1.1),
  ('high_priority_stagnation', 2, NULL, NULL),
  ('reviewer_bottleneck', NULL, 5, NULL),
  ('workload_spike', NULL, NULL, 1.5);

-- detect_risks: idempotent per (kind, entity, day)
CREATE OR REPLACE FUNCTION public.detect_risks()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  inserted int := 0;
  cap numeric;
BEGIN
  SELECT daily_capacity_hours INTO cap FROM public.work_settings WHERE id = 1;
  cap := COALESCE(cap, 8);

  -- repeated delay
  INSERT INTO public.risk_events (kind, severity, entity_type, entity_id, summary, payload)
  SELECT 'task_repeated_delay',
         CASE WHEN carry_forward_count >= 5 THEN 'critical'
              WHEN carry_forward_count >= 4 THEN 'high'
              ELSE 'medium' END,
         'task', id,
         format('%s carried forward %s times', task_code, carry_forward_count),
         jsonb_build_object('count', carry_forward_count)
    FROM public.tasks
   WHERE carry_forward_count >= 3 AND status <> 'Completed'
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;

  -- long blocker
  INSERT INTO public.risk_events (kind, severity, entity_type, entity_id, summary, payload)
  SELECT 'long_blocker',
         CASE WHEN now() - blocked_at > interval '5 days' THEN 'critical'
              WHEN now() - blocked_at > interval '3 days' THEN 'high'
              ELSE 'medium' END,
         'task', id,
         format('%s blocked for %s days', task_code,
                EXTRACT(DAY FROM now() - blocked_at)::int),
         jsonb_build_object('blocked_at', blocked_at)
    FROM public.tasks
   WHERE status = 'Blocked' AND blocked_at < now() - interval '2 days'
  ON CONFLICT DO NOTHING;

  -- high-priority stagnation
  INSERT INTO public.risk_events (kind, severity, entity_type, entity_id, summary, payload)
  SELECT 'high_priority_stagnation', 'high', 'task', id,
         format('%s (High) idle since %s', task_code, updated_at::date),
         jsonb_build_object('updated_at', updated_at)
    FROM public.tasks
   WHERE priority = 'High'
     AND status NOT IN ('Completed')
     AND updated_at < now() - interval '2 days'
  ON CONFLICT DO NOTHING;

  -- user overload (today)
  INSERT INTO public.risk_events (kind, severity, entity_type, entity_id, summary, payload)
  SELECT 'user_overload',
         CASE WHEN load > cap * 1.5 THEN 'critical' WHEN load > cap * 1.25 THEN 'high' ELSE 'medium' END,
         'user', assigned_to,
         format('Planned %sh today vs %sh capacity', round(load,1), cap),
         jsonb_build_object('planned_hours', load, 'capacity', cap)
    FROM (
      SELECT assigned_to, SUM(COALESCE(planned_hours,0)) AS load
        FROM public.tasks
       WHERE assigned_to IS NOT NULL
         AND status NOT IN ('Completed')
         AND (due_date = (now() AT TIME ZONE 'utc')::date OR due_date IS NULL)
       GROUP BY assigned_to
    ) s WHERE s.load > cap * 1.1
  ON CONFLICT DO NOTHING;

  -- reviewer bottleneck
  INSERT INTO public.risk_events (kind, severity, entity_type, entity_id, summary, payload)
  SELECT 'reviewer_bottleneck', 'medium', 'user', reviewer,
         format('%s tasks waiting review', cnt),
         jsonb_build_object('count', cnt)
    FROM (
      SELECT reviewer, COUNT(*) AS cnt
        FROM public.tasks
       WHERE status = 'In Review' AND reviewer IS NOT NULL
       GROUP BY reviewer
    ) s WHERE cnt > 5
  ON CONFLICT DO NOTHING;

  -- auto-resolve risks whose underlying condition is gone (any kind older than today)
  UPDATE public.risk_events
     SET resolved_at = now()
   WHERE resolved_at IS NULL
     AND detection_date < (now() AT TIME ZONE 'utc')::date
     AND NOT EXISTS (
       SELECT 1 FROM public.risk_events r2
        WHERE r2.kind = risk_events.kind
          AND r2.entity_id = risk_events.entity_id
          AND r2.detection_date = (now() AT TIME ZONE 'utc')::date
          AND r2.resolved_at IS NULL
     );

  RETURN inserted;
END;
$$;

-- ============ Adoption ============
CREATE TABLE public.user_streaks (
  user_id uuid PRIMARY KEY,
  current_streak int NOT NULL DEFAULT 0,
  longest_streak int NOT NULL DEFAULT 0,
  last_update_date date,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.user_streaks ENABLE ROW LEVEL SECURITY;
CREATE POLICY us_read_self_or_mgr ON public.user_streaks FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_manager_or_admin(auth.uid()));
-- System updates via SECURITY DEFINER triggers; no direct member writes.

CREATE OR REPLACE FUNCTION public.bump_user_streak(_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  today date := (now() AT TIME ZONE 'utc')::date;
  last_dt date;
  cur int;
  best int;
BEGIN
  SELECT last_update_date, current_streak, longest_streak
    INTO last_dt, cur, best FROM public.user_streaks WHERE user_id = _user_id;
  IF NOT FOUND THEN
    INSERT INTO public.user_streaks (user_id, current_streak, longest_streak, last_update_date)
    VALUES (_user_id, 1, 1, today);
    RETURN;
  END IF;
  IF last_dt = today THEN RETURN; END IF;
  IF last_dt = today - 1 THEN
    cur := cur + 1;
  ELSE
    cur := 1;
  END IF;
  best := GREATEST(best, cur);
  UPDATE public.user_streaks
     SET current_streak = cur, longest_streak = best,
         last_update_date = today, updated_at = now()
   WHERE user_id = _user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.on_task_completed_streak()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'Completed' AND (OLD.status IS DISTINCT FROM NEW.status) AND NEW.assigned_to IS NOT NULL THEN
    PERFORM public.bump_user_streak(NEW.assigned_to);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_task_completed_streak
AFTER UPDATE OF status ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.on_task_completed_streak();

CREATE OR REPLACE FUNCTION public.on_eod_streak()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.bump_user_streak(NEW.user_id);
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_eod_streak
AFTER INSERT ON public.eod_checkins
FOR EACH ROW EXECUTE FUNCTION public.on_eod_streak();

-- ============ Indexes ============
CREATE INDEX IF NOT EXISTS tasks_assigned_status_idx ON public.tasks (assigned_to, status, due_date);
CREATE INDEX IF NOT EXISTS tasks_project_idx ON public.tasks (project_id, status);
CREATE INDEX IF NOT EXISTS task_history_task_idx ON public.task_history (task_id, created_at DESC);

-- ============ Realtime ============
ALTER PUBLICATION supabase_realtime ADD TABLE public.risk_events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.user_streaks;
