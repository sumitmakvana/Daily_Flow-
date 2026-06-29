
-- P1-5: soft disable users
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
CREATE INDEX IF NOT EXISTS idx_profiles_is_active ON public.profiles(is_active);

-- P1-2: idempotent daily digests (one row per user/type/UTC day)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_notifications_daily_digest
  ON public.notifications (user_id, type, ((created_at AT TIME ZONE 'utc')::date))
  WHERE type IN ('sod_digest','sod_team_digest','eod_digest','eod_team_digest');

-- P0-1: atomic carry forward (update tasks THEN insert event in one tx)
CREATE OR REPLACE FUNCTION public.carry_task_forward(
  _task_id uuid,
  _to_date date,
  _reason text DEFAULT 'manager',
  _expected_version int DEFAULT NULL
) RETURNS public.tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  t public.tasks;
  is_mgr boolean := public.is_manager_or_admin(caller);
BEGIN
  SELECT * INTO t FROM public.tasks WHERE id = _task_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'task not found'; END IF;
  IF caller IS NOT NULL AND NOT is_mgr AND t.assigned_to IS DISTINCT FROM caller THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  IF _expected_version IS NOT NULL AND t.version <> _expected_version THEN
    RAISE EXCEPTION 'version conflict' USING ERRCODE = '40001';
  END IF;

  UPDATE public.tasks
     SET due_date = _to_date,
         updated_by = COALESCE(caller, t.updated_by)
   WHERE id = _task_id
   RETURNING * INTO t;

  INSERT INTO public.carry_forward_events(task_id, from_date, to_date, reason, created_by)
  VALUES (_task_id, COALESCE(t.due_date, CURRENT_DATE), _to_date, _reason, caller);

  RETURN t;
END;
$$;

GRANT EXECUTE ON FUNCTION public.carry_task_forward(uuid, date, text, int) TO authenticated, service_role;

-- P1-3: members can notify their reviewer when blocking own task (RLS blocks direct insert)
CREATE OR REPLACE FUNCTION public.notify_task_blocked(_task_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  t public.tasks;
BEGIN
  SELECT * INTO t FROM public.tasks WHERE id = _task_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'task not found'; END IF;
  IF caller IS DISTINCT FROM t.assigned_to AND NOT public.is_manager_or_admin(caller) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  IF t.reviewer IS NULL OR t.reviewer = caller THEN RETURN; END IF;
  INSERT INTO public.notifications(user_id, type, title, body, task_id)
  VALUES (t.reviewer, 'task_blocked', t.task_code || ' blocked',
          COALESCE(_reason, 'Task marked as blocked'), _task_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.notify_task_blocked(uuid, text) TO authenticated, service_role;
