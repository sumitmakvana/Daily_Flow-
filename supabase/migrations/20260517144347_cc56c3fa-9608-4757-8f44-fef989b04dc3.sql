
-- 1. EOD check-ins
CREATE TABLE public.eod_checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  checkin_date date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  pending_count int NOT NULL DEFAULT 0,
  blocker_count int NOT NULL DEFAULT 0,
  completed_count int NOT NULL DEFAULT 0,
  remaining_hours numeric NOT NULL DEFAULT 0,
  tomorrow_priority_task_id uuid,
  note text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, checkin_date)
);
ALTER TABLE public.eod_checkins ENABLE ROW LEVEL SECURITY;
CREATE POLICY eod_read_self_or_mgr ON public.eod_checkins FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_manager_or_admin(auth.uid()));
CREATE POLICY eod_insert_self ON public.eod_checkins FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY eod_update_self ON public.eod_checkins FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- 2. Daily workload snapshot
CREATE TABLE public.daily_workload_snapshot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  snapshot_date date NOT NULL,
  planned_hours numeric NOT NULL DEFAULT 0,
  actual_hours numeric NOT NULL DEFAULT 0,
  active_count int NOT NULL DEFAULT 0,
  delayed_count int NOT NULL DEFAULT 0,
  blocked_count int NOT NULL DEFAULT 0,
  completed_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, snapshot_date)
);
ALTER TABLE public.daily_workload_snapshot ENABLE ROW LEVEL SECURITY;
CREATE POLICY wls_read_all ON public.daily_workload_snapshot FOR SELECT TO authenticated USING (true);
CREATE POLICY wls_write_mgr ON public.daily_workload_snapshot FOR INSERT TO authenticated
  WITH CHECK (public.is_manager_or_admin(auth.uid()));
CREATE POLICY wls_update_mgr ON public.daily_workload_snapshot FOR UPDATE TO authenticated
  USING (public.is_manager_or_admin(auth.uid()));

-- 3. Tasks: carry-forward columns
ALTER TABLE public.tasks
  ADD COLUMN carry_forward_count int NOT NULL DEFAULT 0,
  ADD COLUMN last_carry_forward_at timestamptz,
  ADD COLUMN original_due_date date;

-- 4. Carry-forward events
CREATE TABLE public.carry_forward_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL,
  from_date date NOT NULL,
  to_date date NOT NULL,
  reason text NOT NULL DEFAULT 'auto',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cfe_task_idx ON public.carry_forward_events(task_id);
ALTER TABLE public.carry_forward_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY cfe_read_all ON public.carry_forward_events FOR SELECT TO authenticated USING (true);
CREATE POLICY cfe_insert_self_or_mgr ON public.carry_forward_events FOR INSERT TO authenticated
  WITH CHECK (
    public.is_manager_or_admin(auth.uid())
    OR EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id AND t.assigned_to = auth.uid())
  );

CREATE OR REPLACE FUNCTION public.on_carry_forward_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.tasks
     SET carry_forward_count = carry_forward_count + 1,
         last_carry_forward_at = now(),
         original_due_date = COALESCE(original_due_date, NEW.from_date)
   WHERE id = NEW.task_id;

  INSERT INTO public.task_history(task_id, old_status, new_status, updated_by, comment)
  SELECT NEW.task_id, t.status, t.status, COALESCE(NEW.created_by, auth.uid()),
         format('carried forward %s → %s (%s)', NEW.from_date, NEW.to_date, NEW.reason)
    FROM public.tasks t WHERE t.id = NEW.task_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_carry_forward_event
AFTER INSERT ON public.carry_forward_events
FOR EACH ROW EXECUTE FUNCTION public.on_carry_forward_event();

-- 5. Notification preferences
CREATE TABLE public.notification_prefs (
  user_id uuid PRIMARY KEY,
  digest_enabled boolean NOT NULL DEFAULT true,
  eod_reminder_hour int NOT NULL DEFAULT 16,
  notify_assignment boolean NOT NULL DEFAULT true,
  notify_priority_change boolean NOT NULL DEFAULT true,
  notify_blocker_resolved boolean NOT NULL DEFAULT true,
  notify_manager_overload boolean NOT NULL DEFAULT true,
  notify_manager_delays boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.notification_prefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY np_read_self ON public.notification_prefs FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_manager_or_admin(auth.uid()));
CREATE POLICY np_upsert_self ON public.notification_prefs FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY np_update_self ON public.notification_prefs FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- 6. Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.eod_checkins;
ALTER PUBLICATION supabase_realtime ADD TABLE public.carry_forward_events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.daily_workload_snapshot;
