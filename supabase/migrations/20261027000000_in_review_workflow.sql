-- In Review workflow: review cycles, atomic submit/decide functions, transition + field locks.
--
-- Flow: In Progress --submit_task_for_review--> In Review
--         --decide_task_review('approved')-->           Completed
--         --decide_task_review('changes_requested')--> In Progress  (feedback mandatory)
--
-- Every submission opens a cycle in task_reviews; every decision closes it with the
-- assigned reviewer (reviewer_id), the person who actually decided (decided_by) and a
-- timestamp. Writes happen only through the SECURITY DEFINER functions below.
--
-- Timer and hours: sending for review banks any running timer (task_worklogs for the
-- assignee + tasks.system_hours) exactly once inside the database; the assignee enters or
-- confirms today's manual EOD logged hours (task_eod_submissions + tasks.actual_hours, earlier
-- days preserved); approval is blocked until the task has logged hours and never adds hours.
--
-- This migration only ADDS objects, except that it replaces one function
-- (enforce_task_field_perms) to add a bypass line; the DO block below refuses to
-- replace it if the live definition differs from the one this file was written against.
-- It never updates or deletes existing rows.

-- 0) Safety: only replace enforce_task_field_perms if it is the definition we expect
--    (the one from 20260925120000), or already carries the review bypass (re-run).
DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_functiondef('public.enforce_task_field_perms()'::regprocedure) INTO def;
  IF def NOT LIKE '%app.review_bypass%' AND (
       def NOT LIKE '%Task code is immutable%'
    OR def NOT LIKE '%created by or assigned to you%'
    OR def LIKE '%Only managers can%'
  ) THEN
    RAISE EXCEPTION
      'public.enforce_task_field_perms() differs from the definition in 20260925120000; reconcile it before applying this migration';
  END IF;
END $$;

-- 1) Latest submission time, so every task query can show "in review for X".
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS review_submitted_at timestamptz;

-- 2) Review cycles
CREATE TABLE IF NOT EXISTS public.task_reviews (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id       uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  cycle_no      integer NOT NULL,
  submitted_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  submitted_at  timestamptz NOT NULL DEFAULT now(),
  reviewer_id   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  decision      text NOT NULL DEFAULT 'pending'
                CHECK (decision IN ('pending','approved','changes_requested','withdrawn')),
  decided_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  decided_at    timestamptz,
  feedback      text,
  -- Hours the assignee confirmed when sending for review (snapshots, for the reviewer)
  logged_hours_confirmed_at timestamptz,
  logged_hours_today        numeric,
  logged_hours_total        numeric,
  system_hours_total        numeric,
  UNIQUE (task_id, cycle_no)
);

-- Databases that already ran an earlier draft of this migration have task_reviews without the
-- hours snapshot columns (CREATE TABLE IF NOT EXISTS skips them), so add them explicitly.
ALTER TABLE public.task_reviews
  ADD COLUMN IF NOT EXISTS logged_hours_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS logged_hours_today        numeric,
  ADD COLUMN IF NOT EXISTS logged_hours_total        numeric,
  ADD COLUMN IF NOT EXISTS system_hours_total        numeric;

-- At most one open cycle per task.
CREATE UNIQUE INDEX IF NOT EXISTS task_reviews_one_pending
  ON public.task_reviews (task_id) WHERE decision = 'pending';
CREATE INDEX IF NOT EXISTS task_reviews_reviewer_pending
  ON public.task_reviews (reviewer_id) WHERE decision = 'pending';

ALTER TABLE public.task_reviews ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.task_reviews TO authenticated;
GRANT ALL ON public.task_reviews TO service_role;
-- Same visibility as tasks (tasks_read_all). No INSERT/UPDATE/DELETE policy on purpose:
-- only the functions below may write.
DROP POLICY IF EXISTS task_reviews_read ON public.task_reviews;
CREATE POLICY task_reviews_read ON public.task_reviews
  FOR SELECT TO authenticated USING (true);

-- 3) Let the review functions through the per-role field trigger.
--    The bypass is bound to ONE task: the functions set app.review_bypass to that task's id
--    (set_config(..., is_local => true)) and clear it right after the UPDATE, so a trigger
--    that touches some other task in the same transaction is still fully checked.
CREATE OR REPLACE FUNCTION public.enforce_task_field_perms()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid uuid := auth.uid();
  is_mgr boolean := public.is_manager_or_admin(auth.uid());
BEGIN
  IF uid IS NULL THEN
    RETURN NEW; -- service-role / migrations
  END IF;
  IF COALESCE(current_setting('app.review_bypass', true), '') = NEW.id::text THEN
    RETURN NEW; -- submit_task_for_review / decide_task_review for this task only
  END IF;
  IF is_mgr THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  -- UPDATE: members can update tasks assigned to them or created by them
  IF OLD.assigned_to IS DISTINCT FROM uid AND OLD.created_by IS DISTINCT FROM uid THEN
    RAISE EXCEPTION 'You can only update tasks created by or assigned to you';
  END IF;

  IF NEW.task_code IS DISTINCT FROM OLD.task_code THEN
    RAISE EXCEPTION 'Task code is immutable';
  END IF;

  RETURN NEW;
END;
$$;

-- 4) Review guard. One BEFORE UPDATE trigger (no column list) that compares the FINAL
--    OLD/NEW row. It is named to sort after trg_tasks_sync_status, which copies status_id
--    into status, so changing status_id (or type_id) can not slip a task into or out of
--    review. While a review is pending it also:
--      * locks reviewer, assignee and the task's planning fields for non-managers,
--      * stops anyone starting the timer.
--    Service-role paths (auth.uid() IS NULL) and the review functions (for their own task)
--    are exempt.
CREATE OR REPLACE FUNCTION public.enforce_review_locks()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid uuid := auth.uid();
  locked text[] := ARRAY[]::text[];
  cols text[] := ARRAY['reviewer','assigned_to','task_name','priority','due_date','start_date',
                       'planned_hours','project_id','project_name','client','type_id','status_id',
                       'custom_fields','done','completed_at'];
  labels text[] := ARRAY['reviewer','assignee','task name','priority','due date','start date',
                         'planned hours','project','project','client','type','status',
                         'custom fields','done','completion time'];
  n jsonb;
  o jsonb;
  i integer;
BEGIN
  IF uid IS NULL OR COALESCE(current_setting('app.review_bypass', true), '') = NEW.id::text THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'In Review' THEN
      RAISE EXCEPTION 'Use "Send for review" to move a task into review';
    END IF;
    IF OLD.status = 'In Review' THEN
      RAISE EXCEPTION 'A task in review must be approved or have changes requested by its reviewer';
    END IF;
  END IF;

  IF OLD.status <> 'In Review' THEN
    RETURN NEW;
  END IF;

  -- Task is In Review (status can not have changed here, checked above).
  IF NEW.started_at IS NOT NULL AND NEW.started_at IS DISTINCT FROM OLD.started_at THEN
    RAISE EXCEPTION 'The timer can not be started while the task is in review';
  END IF;

  IF NOT public.is_manager_or_admin(uid) THEN
    -- Compared by column name through jsonb so this keeps working whether or not an
    -- optional column (e.g. start_date) exists in a given environment.
    n := to_jsonb(NEW);
    o := to_jsonb(OLD);
    FOR i IN 1 .. array_length(cols, 1) LOOP
      IF n -> cols[i] IS DISTINCT FROM o -> cols[i] THEN
        locked := array_append(locked, labels[i]);
      END IF;
    END LOOP;
    IF array_length(locked, 1) IS NOT NULL THEN
      RAISE EXCEPTION 'Only a manager can change % while the task is in review',
        array_to_string(ARRAY(SELECT DISTINCT x FROM unnest(locked) x), ', ');
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- An earlier draft used a narrower guard (and an 'on' bypass flag). Remove it, or it would
-- reject the review functions' own updates.
DROP TRIGGER IF EXISTS trg_enforce_review_transitions ON public.tasks;
DROP FUNCTION IF EXISTS public.enforce_review_transitions();

DROP TRIGGER IF EXISTS trg_zz_enforce_review_locks ON public.tasks;
CREATE TRIGGER trg_zz_enforce_review_locks
BEFORE UPDATE ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.enforce_review_locks();

-- 5) Internal helpers. Not callable by users; only the SECURITY DEFINER functions below use them.

-- 5a) Bank a running timer. The caller holds the task row lock and passes the task's
--     started_at; this writes the finished session to task_worklogs (credited to the
--     ASSIGNEE, split per day if it crossed midnight) and returns the hours to add to
--     tasks.system_hours. It does NOT touch tasks: the caller adds the returned hours to
--     system_hours and clears started_at in its own single UPDATE, so the session is
--     counted exactly once. Same rules as the app's bankTimer: capped at 8h, 2 decimals.
CREATE OR REPLACE FUNCTION public.bank_task_timer(_task_id uuid, _started_at timestamptz, _user_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  ts_now timestamptz := clock_timestamp();
  elapsed numeric;
  raw numeric := 0;
  used numeric := 0;
  part numeric;
  seg record;
  days date[] := ARRAY[]::date[];
  secs numeric[] := ARRAY[]::numeric[];
  live integer := 0;
  seen integer := 0;
  i integer;
BEGIN
  IF _started_at IS NULL THEN RETURN 0; END IF;
  elapsed := LEAST(8.0, GREATEST(0, ROUND(EXTRACT(EPOCH FROM (ts_now - _started_at)) / 3600.0, 2)));
  IF elapsed <= 0 THEN RETURN 0; END IF;
  IF _user_id IS NULL THEN RETURN elapsed; END IF; -- nobody to credit a worklog to; hours still count

  FOR seg IN
    SELECT d::date AS work_date,
           GREATEST(EXTRACT(EPOCH FROM (LEAST(ts_now, d + interval '1 day') - GREATEST(_started_at, d))), 0) AS secs
      FROM generate_series(date_trunc('day', _started_at), date_trunc('day', ts_now), interval '1 day') d
     ORDER BY d
  LOOP
    IF seg.secs > 0 THEN
      days := array_append(days, seg.work_date);
      secs := array_append(secs, seg.secs::numeric);
      raw := raw + seg.secs;
      live := live + 1;
    END IF;
  END LOOP;

  IF live = 0 THEN
    days := ARRAY[CURRENT_DATE];
    secs := ARRAY[1::numeric];
    raw := 1;
    live := 1;
  END IF;

  FOR i IN 1 .. live LOOP
    seen := seen + 1;
    IF seen = live THEN
      part := ROUND(elapsed - used, 2);   -- last part absorbs rounding so the parts sum to elapsed
    ELSE
      part := ROUND(elapsed * secs[i] / raw, 2);
    END IF;
    used := used + part;
    IF part > 0 THEN
      INSERT INTO public.task_worklogs (task_id, user_id, work_date, system_hours, started_at, ended_at)
      VALUES (_task_id, _user_id, days[i], part, _started_at, ts_now);
    END IF;
  END LOOP;

  RETURN elapsed;
END;
$$;

-- 5b) Record the employee's manual EOD logged hours for today on this task, exactly like
--     the EOD check-in does (task_eod_submissions, one row per task/user/day) while keeping
--     tasks.actual_hours consistent WITHOUT recomputing it: only today's contribution is
--     replaced, so hours from earlier days (or entered by hand on the task) are preserved
--     and re-confirming the same day never adds twice. 0 never lowers an existing figure,
--     matching the EOD check-in.
CREATE OR REPLACE FUNCTION public.apply_task_eod_hours(_task_id uuid, _user_id uuid, _hours numeric, _note text)
RETURNS TABLE (eod_today numeric, eod_total numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  today date := (now() AT TIME ZONE 'UTC')::date;
  old_today numeric := 0;
  new_today numeric;
  total numeric;
  had_row boolean;
BEGIN
  SELECT actual_hours INTO old_today
    FROM public.task_eod_submissions
   WHERE task_id = _task_id AND user_id = _user_id AND submission_date = today;
  had_row := FOUND;
  IF NOT had_row THEN old_today := 0; END IF;

  new_today := CASE WHEN had_row AND _hours <= 0 THEN old_today ELSE _hours END;

  IF had_row OR new_today > 0 THEN
    INSERT INTO public.task_eod_submissions (task_id, user_id, submission_date, progress_status, actual_hours, note)
    VALUES (_task_id, _user_id, today, 'in_progress', new_today, _note)
    ON CONFLICT (task_id, user_id, submission_date) DO UPDATE
      SET actual_hours = EXCLUDED.actual_hours,
          note = COALESCE(EXCLUDED.note, task_eod_submissions.note),
          submitted_at = now();
  END IF;

  UPDATE public.tasks
     SET actual_hours = GREATEST(0, COALESCE(actual_hours, 0) - old_today + new_today)
   WHERE id = _task_id
  RETURNING actual_hours INTO total;

  RETURN QUERY SELECT new_today, total;
END;
$$;

-- 5c) Make sure a review cycle is open for a task that is In Review (tasks that were
--     already In Review before this workflow existed have none).
CREATE OR REPLACE FUNCTION public.ensure_pending_review(_t public.tasks)
RETURNS public.task_reviews
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE r public.task_reviews;
BEGIN
  SELECT * INTO r FROM public.task_reviews
   WHERE task_id = _t.id AND decision = 'pending' FOR UPDATE;
  IF FOUND THEN RETURN r; END IF;
  INSERT INTO public.task_reviews (task_id, cycle_no, submitted_by, submitted_at, reviewer_id)
  VALUES (_t.id,
          (SELECT COALESCE(MAX(cycle_no), 0) + 1 FROM public.task_reviews WHERE task_id = _t.id),
          COALESCE(_t.assigned_to, _t.updated_by), COALESCE(_t.review_submitted_at, _t.updated_at), _t.reviewer)
  RETURNING * INTO r;
  RETURN r;
END;
$$;

-- 6) Send for review.
--    _logged_hours: the assignee's manual EOD logged hours for today (enter or confirm).
--    NULL means "don't touch hours" (e.g. a manager sending on someone's behalf, or a direct
--    RPC call); approval is still blocked until the task has logged hours.
DROP FUNCTION IF EXISTS public.submit_task_for_review(uuid);
CREATE OR REPLACE FUNCTION public.submit_task_for_review(
  _task_id uuid, _logged_hours numeric DEFAULT NULL, _note text DEFAULT NULL)
RETURNS public.task_reviews
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid uuid := auth.uid();
  t public.tasks;
  r public.task_reviews;
  n integer;
  actor_name text;
  elapsed numeric := 0;
  sys_total numeric;
  hours_today numeric;
  hours_total numeric;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO t FROM public.tasks WHERE id = _task_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Task not found'; END IF;

  IF t.assigned_to IS DISTINCT FROM uid AND NOT public.is_manager_or_admin(uid) THEN
    RAISE EXCEPTION 'Only the assignee or a manager can send this task for review';
  END IF;
  IF t.status <> 'In Progress' THEN
    RAISE EXCEPTION 'Only In Progress tasks can be sent for review';
  END IF;
  IF t.reviewer IS NULL THEN
    RAISE EXCEPTION 'Assign a reviewer before sending this task for review';
  END IF;
  IF t.assigned_to IS NULL THEN
    RAISE EXCEPTION 'Assign this task to someone before sending it for review';
  END IF;
  IF t.reviewer = t.assigned_to THEN
    RAISE EXCEPTION 'The reviewer cannot be the assignee';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = t.reviewer AND COALESCE(is_active, true)) THEN
    RAISE EXCEPTION 'The assigned reviewer is inactive; choose another reviewer';
  END IF;
  IF _logged_hours IS NOT NULL THEN
    IF t.assigned_to IS DISTINCT FROM uid THEN
      RAISE EXCEPTION 'Only the assignee can enter logged hours for this task';
    END IF;
    IF _logged_hours < 0 OR _logged_hours > 24 THEN
      RAISE EXCEPTION 'Logged hours must be between 0 and 24';
    END IF;
  END IF;

  -- Manual EOD logged hours (enter or confirm) before the task leaves the assignee's hands.
  IF _logged_hours IS NOT NULL THEN
    SELECT h.eod_today, h.eod_total INTO hours_today, hours_total
      FROM public.apply_task_eod_hours(_task_id, uid, _logged_hours, _note) h;
    IF COALESCE(hours_total, 0) <= 0 THEN
      RAISE EXCEPTION 'Enter the hours you worked before sending this task for review';
    END IF;
  ELSE
    hours_total := t.actual_hours;
  END IF;

  -- Final timer segment: banked here, in the database, so every caller (app or direct RPC)
  -- gets it, credited to the assignee, exactly once.
  elapsed := public.bank_task_timer(_task_id, t.started_at, COALESCE(t.assigned_to, uid));
  sys_total := COALESCE(t.system_hours, 0) + elapsed;

  -- Close any cycle left open by an earlier out-of-band status change (this task only).
  UPDATE public.task_reviews
     SET decision = 'withdrawn', decided_at = now()
   WHERE task_id = _task_id AND decision = 'pending';

  PERFORM set_config('app.review_bypass', _task_id::text, true);
  UPDATE public.tasks
     SET status = 'In Review', review_submitted_at = now(), started_at = NULL,
         system_hours = sys_total, updated_by = uid
   WHERE id = _task_id;
  PERFORM set_config('app.review_bypass', '', true);

  SELECT COALESCE(MAX(cycle_no), 0) + 1 INTO n FROM public.task_reviews WHERE task_id = _task_id;
  INSERT INTO public.task_reviews
    (task_id, cycle_no, submitted_by, reviewer_id,
     logged_hours_confirmed_at, logged_hours_today, logged_hours_total, system_hours_total)
  VALUES
    (_task_id, n, uid, t.reviewer,
     CASE WHEN _logged_hours IS NOT NULL THEN now() END, hours_today, hours_total, sys_total)
  RETURNING * INTO r;

  SELECT COALESCE(NULLIF(btrim(display_name), ''), 'Someone') INTO actor_name
    FROM public.profiles WHERE id = uid;

  INSERT INTO public.task_history (task_id, old_status, new_status, updated_by, comment)
  VALUES (_task_id, 'In Review', 'In Review', uid,
          format('Review cycle %s requested', n)
          || CASE WHEN _logged_hours IS NOT NULL
                  THEN format(' (logged %sh today, %sh total)', hours_today, hours_total) ELSE '' END);

  INSERT INTO public.notifications (user_id, type, title, body, task_id, dedupe_key)
  VALUES (t.reviewer, 'review_requested',
          COALESCE(t.task_code, 'Task') || ' — review requested',
          format('%s sent "%s" for review', COALESCE(actor_name, 'Someone'), t.task_name)
            || CASE WHEN COALESCE(hours_total, 0) > 0 THEN format(' · %sh logged', ROUND(hours_total, 2)) ELSE '' END,
          _task_id, 'REVIEW_REQ_' || r.id::text)
  ON CONFLICT (dedupe_key) DO NOTHING;

  RETURN r;
END;
$$;

-- 7) The assignee enters or corrects today's logged hours while the task is in review.
CREATE OR REPLACE FUNCTION public.log_review_hours(_task_id uuid, _hours numeric, _note text DEFAULT NULL)
RETURNS public.task_reviews
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid uuid := auth.uid();
  t public.tasks;
  r public.task_reviews;
  hours_today numeric;
  hours_total numeric;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _hours IS NULL OR _hours < 0 OR _hours > 24 THEN
    RAISE EXCEPTION 'Logged hours must be between 0 and 24';
  END IF;

  SELECT * INTO t FROM public.tasks WHERE id = _task_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Task not found'; END IF;
  IF t.status <> 'In Review' THEN RAISE EXCEPTION 'This task is not in review'; END IF;
  IF t.assigned_to IS DISTINCT FROM uid THEN
    RAISE EXCEPTION 'Only the assignee can enter logged hours for this task';
  END IF;

  SELECT h.eod_today, h.eod_total INTO hours_today, hours_total
    FROM public.apply_task_eod_hours(_task_id, uid, _hours, _note) h;
  IF COALESCE(hours_total, 0) <= 0 THEN
    RAISE EXCEPTION 'Enter the hours you worked';
  END IF;

  r := public.ensure_pending_review(t);
  UPDATE public.task_reviews
     SET logged_hours_confirmed_at = now(), logged_hours_today = hours_today, logged_hours_total = hours_total
   WHERE id = r.id
   RETURNING * INTO r;

  INSERT INTO public.task_history (task_id, old_status, new_status, updated_by, comment)
  VALUES (_task_id, 'In Review', 'In Review', uid,
          format('Logged hours confirmed during review (%sh today, %sh total)', hours_today, hours_total));

  RETURN r;
END;
$$;

-- 8) Approve / request changes
CREATE OR REPLACE FUNCTION public.decide_task_review(_task_id uuid, _decision text, _feedback text DEFAULT NULL)
RETURNS public.task_reviews
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid uuid := auth.uid();
  t public.tasks;
  r public.task_reviews;
  fb text := NULLIF(btrim(COALESCE(_feedback, '')), '');
  actor_name text;
  next_status public.task_status;
  elapsed numeric;
  sys_total numeric;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _decision NOT IN ('approved', 'changes_requested') THEN
    RAISE EXCEPTION 'Decision must be approved or changes_requested';
  END IF;
  IF _decision = 'changes_requested' AND fb IS NULL THEN
    RAISE EXCEPTION 'Feedback is required when requesting changes';
  END IF;
  IF fb IS NOT NULL AND length(fb) > 5000 THEN
    RAISE EXCEPTION 'Feedback is too long (max 5000 characters)';
  END IF;

  SELECT * INTO t FROM public.tasks WHERE id = _task_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Task not found'; END IF;
  IF t.status <> 'In Review' THEN RAISE EXCEPTION 'This task is not in review'; END IF;

  r := public.ensure_pending_review(t);

  IF t.reviewer IS DISTINCT FROM uid AND NOT public.is_manager_or_admin(uid) THEN
    RAISE EXCEPTION 'Only the assigned reviewer or a manager/admin can decide this review';
  END IF;
  -- No self-approval: neither the assignee nor whoever submitted the work may decide it.
  IF uid = t.assigned_to OR uid = r.submitted_by THEN
    RAISE EXCEPTION 'You cannot review your own work';
  END IF;
  -- The assignee must have entered/confirmed logged hours before the task can be completed.
  IF _decision = 'approved' AND COALESCE(t.actual_hours, 0) <= 0 THEN
    RAISE EXCEPTION 'Logged hours are missing: the assignee must enter or confirm them before this task can be approved';
  END IF;

  next_status := CASE WHEN _decision = 'approved' THEN 'Completed' ELSE 'In Progress' END;

  -- A timer left running on a task that was In Review before this workflow existed is banked
  -- (once, to the assignee) and stopped, so no tracked time is lost.
  elapsed := public.bank_task_timer(_task_id, t.started_at, COALESCE(t.assigned_to, uid));
  sys_total := COALESCE(t.system_hours, 0) + elapsed;

  PERFORM set_config('app.review_bypass', _task_id::text, true);
  IF _decision = 'approved' THEN
    UPDATE public.tasks
       SET status = 'Completed', done = true, completed_at = now(), started_at = NULL,
           system_hours = sys_total, updated_by = uid
     WHERE id = _task_id;
  ELSE
    UPDATE public.tasks
       SET status = 'In Progress', started_at = NULL, system_hours = sys_total, updated_by = uid
     WHERE id = _task_id;
  END IF;
  PERFORM set_config('app.review_bypass', '', true);

  UPDATE public.task_reviews
     SET decision = _decision, decided_by = uid, decided_at = now(), feedback = fb
   WHERE id = r.id
   RETURNING * INTO r;

  SELECT COALESCE(NULLIF(btrim(display_name), ''), 'Someone') INTO actor_name
    FROM public.profiles WHERE id = uid;

  INSERT INTO public.task_history (task_id, old_status, new_status, updated_by, comment)
  VALUES (_task_id, next_status, next_status, uid,
          CASE WHEN _decision = 'approved'
               THEN format('Review cycle %s approved', r.cycle_no)
               ELSE format('Review cycle %s: changes requested', r.cycle_no) END
          || COALESCE(' — ' || fb, ''));

  IF t.assigned_to IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, task_id, dedupe_key)
    VALUES (t.assigned_to,
            CASE WHEN _decision = 'approved' THEN 'review_approved' ELSE 'review_changes_requested' END,
            COALESCE(t.task_code, 'Task') ||
              CASE WHEN _decision = 'approved' THEN ' — approved' ELSE ' — changes requested' END,
            CASE WHEN _decision = 'approved'
                 THEN format('%s approved "%s"', COALESCE(actor_name, 'Someone'), t.task_name)
                 ELSE format('%s requested changes: %s', COALESCE(actor_name, 'Someone'), left(fb, 200)) END
              || CASE WHEN _decision = 'approved' AND fb IS NOT NULL THEN ' — ' || left(fb, 160) ELSE '' END,
            _task_id, 'REVIEW_DEC_' || r.id::text)
    ON CONFLICT (dedupe_key) DO NOTHING;
  END IF;

  RETURN r;
END;
$$;

-- Internal helpers are not callable by users; the workflow functions are.
REVOKE EXECUTE ON FUNCTION public.bank_task_timer(uuid, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_task_eod_hours(uuid, uuid, numeric, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ensure_pending_review(public.tasks) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.submit_task_for_review(uuid, numeric, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.log_review_hours(uuid, numeric, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.decide_task_review(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_task_for_review(uuid, numeric, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.log_review_hours(uuid, numeric, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.decide_task_review(uuid, text, text) TO authenticated, service_role;
-- Trigger functions are never called directly.
REVOKE EXECUTE ON FUNCTION public.enforce_review_locks() FROM PUBLIC, anon, authenticated;
