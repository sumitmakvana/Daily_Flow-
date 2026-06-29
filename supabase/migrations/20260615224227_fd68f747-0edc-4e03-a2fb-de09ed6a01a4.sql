
-- =========================================================
-- Phase F: operations_failures
-- =========================================================
CREATE TABLE IF NOT EXISTS public.operations_failures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  entity_type text,
  entity_id uuid,
  error_code text,
  error_message text NOT NULL,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.operations_failures TO authenticated;
GRANT ALL ON public.operations_failures TO service_role;
ALTER TABLE public.operations_failures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ops_failures_admin_read ON public.operations_failures;
CREATE POLICY ops_failures_admin_read ON public.operations_failures
  FOR SELECT TO authenticated
  USING (public.is_manager_or_admin(auth.uid()));
CREATE INDEX IF NOT EXISTS ops_failures_created_at_idx
  ON public.operations_failures (created_at DESC);
CREATE INDEX IF NOT EXISTS ops_failures_source_idx
  ON public.operations_failures (source, created_at DESC);

-- =========================================================
-- Phase B: cron_invocations (replay protection + rate limit)
-- =========================================================
CREATE TABLE IF NOT EXISTS public.cron_invocations (
  nonce text PRIMARY KEY,
  route text NOT NULL,
  ts timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.cron_invocations TO service_role;
ALTER TABLE public.cron_invocations ENABLE ROW LEVEL SECURITY;
-- No policies = locked. Only service_role (cron) writes/reads.
CREATE INDEX IF NOT EXISTS cron_invocations_route_ts_idx
  ON public.cron_invocations (route, ts DESC);

-- =========================================================
-- Phase C: notification dedupe_key
-- =========================================================
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS dedupe_key text;
-- Drop the older partial digest index if it exists (superseded by dedupe_key).
DROP INDEX IF EXISTS public.notifications_digest_uniq;
DROP INDEX IF EXISTS public.notifications_digest_daily_uniq;
CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe_key_uniq
  ON public.notifications (dedupe_key)
  WHERE dedupe_key IS NOT NULL;

-- =========================================================
-- Phase G: FK manager_id ON DELETE SET NULL
-- =========================================================
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c
    FROM pg_constraint
   WHERE conrelid = 'public.profiles'::regclass
     AND contype = 'f'
     AND conname LIKE '%manager_id%';
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.profiles DROP CONSTRAINT %I', c);
  END IF;
END $$;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_manager_id_fkey
  FOREIGN KEY (manager_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- =========================================================
-- Phase G: REPLICA IDENTITY FULL for realtime UPDATE payloads
-- =========================================================
ALTER TABLE public.tasks REPLICA IDENTITY FULL;
ALTER TABLE public.notifications REPLICA IDENTITY FULL;

-- =========================================================
-- Phase G: snapshot uniqueness
-- =========================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid='public.daily_workload_snapshot'::regclass
       AND conname='daily_workload_snapshot_user_date_uniq'
  ) THEN
    ALTER TABLE public.daily_workload_snapshot
      ADD CONSTRAINT daily_workload_snapshot_user_date_uniq
      UNIQUE (user_id, snapshot_date);
  END IF;
END $$;

-- =========================================================
-- Phase G: holiday-aware next working day
-- =========================================================
CREATE OR REPLACE FUNCTION public.next_working_day(_from date DEFAULT (now() AT TIME ZONE 'utc')::date)
RETURNS date
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  d date := _from + 1;
  i int := 0;
BEGIN
  WHILE i < 30 LOOP
    IF EXTRACT(DOW FROM d) NOT IN (0,6)
       AND NOT EXISTS (SELECT 1 FROM public.holiday_calendar h WHERE h.holiday_date = d) THEN
      RETURN d;
    END IF;
    d := d + 1;
    i := i + 1;
  END LOOP;
  RETURN d;
END;
$$;
GRANT EXECUTE ON FUNCTION public.next_working_day(date) TO authenticated, service_role;

-- =========================================================
-- Phase G: record_export RPC (any user can audit own; reads stay manager/admin)
-- =========================================================
CREATE OR REPLACE FUNCTION public.record_export(_kind text, _filters jsonb, _row_count int)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE new_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  INSERT INTO public.audit_exports(exported_by, kind, filters, row_count)
  VALUES (auth.uid(), _kind, COALESCE(_filters,'{}'::jsonb), COALESCE(_row_count,0))
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.record_export(text, jsonb, int) TO authenticated;

-- =========================================================
-- Phase C: notify_task_blocked sets dedupe key
-- =========================================================
CREATE OR REPLACE FUNCTION public.notify_task_blocked(_task_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  t public.tasks;
  k text;
BEGIN
  SELECT * INTO t FROM public.tasks WHERE id = _task_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'task not found'; END IF;
  IF caller IS DISTINCT FROM t.assigned_to AND NOT public.is_manager_or_admin(caller) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  IF t.reviewer IS NULL OR t.reviewer = caller THEN RETURN; END IF;
  k := 'BLOCKED_' || _task_id::text || '_' || (now() AT TIME ZONE 'utc')::date::text;
  INSERT INTO public.notifications(user_id, type, title, body, task_id, dedupe_key)
  VALUES (t.reviewer, 'task_blocked', t.task_code || ' blocked',
          COALESCE(_reason, 'Task marked as blocked'), _task_id, k)
  ON CONFLICT (dedupe_key) DO NOTHING;
END;
$$;

-- =========================================================
-- Phase E: is_active gating in SQL functions
-- =========================================================
CREATE OR REPLACE FUNCTION public.detect_risks()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE inserted int := 0; cap numeric;
BEGIN
  SELECT daily_capacity_hours INTO cap FROM public.work_settings WHERE id = 1;
  cap := COALESCE(cap, 8);

  INSERT INTO public.risk_events (kind, severity, entity_type, entity_id, summary, payload)
  SELECT 'task_repeated_delay',
         CASE WHEN t.carry_forward_count >= 5 THEN 'critical'
              WHEN t.carry_forward_count >= 4 THEN 'high' ELSE 'medium' END,
         'task', t.id,
         format('%s carried forward %s times', t.task_code, t.carry_forward_count),
         jsonb_build_object('count', t.carry_forward_count)
    FROM public.tasks t
    LEFT JOIN public.profiles p ON p.id = t.assigned_to
   WHERE t.carry_forward_count >= 3 AND t.status <> 'Completed'
     AND (p.id IS NULL OR p.is_active)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;

  INSERT INTO public.risk_events (kind, severity, entity_type, entity_id, summary, payload)
  SELECT 'long_blocker',
         CASE WHEN now() - t.blocked_at > interval '5 days' THEN 'critical'
              WHEN now() - t.blocked_at > interval '3 days' THEN 'high' ELSE 'medium' END,
         'task', t.id,
         format('%s blocked for %s days', t.task_code, EXTRACT(DAY FROM now() - t.blocked_at)::int),
         jsonb_build_object('blocked_at', t.blocked_at)
    FROM public.tasks t
    LEFT JOIN public.profiles p ON p.id = t.assigned_to
   WHERE t.status = 'Blocked' AND t.blocked_at < now() - interval '2 days'
     AND (p.id IS NULL OR p.is_active)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.risk_events (kind, severity, entity_type, entity_id, summary, payload)
  SELECT 'high_priority_stagnation', 'high', 'task', t.id,
         format('%s (High) idle since %s', t.task_code, t.updated_at::date),
         jsonb_build_object('updated_at', t.updated_at)
    FROM public.tasks t
    LEFT JOIN public.profiles p ON p.id = t.assigned_to
   WHERE t.priority = 'High' AND t.status NOT IN ('Completed')
     AND t.updated_at < now() - interval '2 days'
     AND (p.id IS NULL OR p.is_active)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.risk_events (kind, severity, entity_type, entity_id, summary, payload)
  SELECT 'user_overload',
         CASE WHEN load > cap * 1.5 THEN 'critical' WHEN load > cap * 1.25 THEN 'high' ELSE 'medium' END,
         'user', user_id,
         format('Planned %sh today vs %sh capacity', round(load,1), cap),
         jsonb_build_object('planned_hours', load, 'capacity', cap)
    FROM (
      SELECT t.assigned_to AS user_id, SUM(COALESCE(t.planned_hours,0)) AS load
        FROM public.tasks t
        JOIN public.profiles p ON p.id = t.assigned_to AND p.is_active
       WHERE t.status NOT IN ('Completed')
         AND (t.due_date = (now() AT TIME ZONE 'utc')::date OR t.due_date IS NULL)
       GROUP BY t.assigned_to
    ) s WHERE s.load > cap * 1.1
  ON CONFLICT DO NOTHING;

  INSERT INTO public.risk_events (kind, severity, entity_type, entity_id, summary, payload)
  SELECT 'reviewer_bottleneck', 'medium', 'user', reviewer,
         format('%s tasks waiting review', cnt),
         jsonb_build_object('count', cnt)
    FROM (
      SELECT t.reviewer, COUNT(*) AS cnt FROM public.tasks t
        JOIN public.profiles p ON p.id = t.reviewer AND p.is_active
       WHERE t.status = 'In Review' AND t.reviewer IS NOT NULL
       GROUP BY t.reviewer
    ) s WHERE cnt > 5
  ON CONFLICT DO NOTHING;

  UPDATE public.risk_events SET resolved_at = now()
   WHERE resolved_at IS NULL
     AND detection_date < (now() AT TIME ZONE 'utc')::date
     AND NOT EXISTS (
       SELECT 1 FROM public.risk_events r2
        WHERE r2.kind = risk_events.kind
          AND r2.entity_id = risk_events.entity_id
          AND r2.detection_date = (now() AT TIME ZONE 'utc')::date
          AND r2.resolved_at IS NULL);
  RETURN inserted;
END;
$function$;

CREATE OR REPLACE FUNCTION public.predict_tomorrow_risks()
 RETURNS TABLE(task_id uuid, risk_score integer, reasons text[])
 LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
  WITH cap_load AS (
    SELECT t.assigned_to, SUM(COALESCE(t.planned_hours,0)) AS load
      FROM public.tasks t
      JOIN public.profiles p ON p.id = t.assigned_to AND p.is_active
     WHERE t.status NOT IN ('Completed')
       AND t.due_date = ((now() AT TIME ZONE 'utc')::date + 1)
     GROUP BY t.assigned_to
  ),
  cap AS (SELECT COALESCE((SELECT daily_capacity_hours FROM public.work_settings WHERE id=1),8) AS h)
  SELECT t.id,
         (CASE WHEN t.carry_forward_count >= 2 THEN 30 ELSE 0 END
          + CASE WHEN t.status = 'Blocked' THEN 25 ELSE 0 END
          + CASE WHEN t.priority = 'High' THEN 15 ELSE 0 END
          + CASE WHEN t.updated_at < now() - interval '2 days' THEN 10 ELSE 0 END
          + CASE WHEN cl.load > (SELECT h FROM cap) * 1.1 THEN 20 ELSE 0 END)::int,
         ARRAY_REMOVE(ARRAY[
           CASE WHEN t.carry_forward_count >= 2 THEN format('carried forward %sx', t.carry_forward_count) END,
           CASE WHEN t.status = 'Blocked' THEN 'currently blocked' END,
           CASE WHEN t.priority = 'High' THEN 'high priority' END,
           CASE WHEN t.updated_at < now() - interval '2 days' THEN 'stale' END,
           CASE WHEN cl.load > (SELECT h FROM cap) * 1.1 THEN 'assignee overloaded tomorrow' END
         ], NULL)
    FROM public.tasks t
    LEFT JOIN public.profiles p ON p.id = t.assigned_to
    LEFT JOIN cap_load cl ON cl.assigned_to = t.assigned_to
   WHERE t.status NOT IN ('Completed')
     AND (p.id IS NULL OR p.is_active)
     AND (t.due_date <= ((now() AT TIME ZONE 'utc')::date + 1) OR t.due_date IS NULL);
$function$;
