-- Multiple reviewers for the In Review workflow (builds on 20261027000000_in_review_workflow).
--
-- Single source of truth
--   task_reviewers          WHO is assigned as a reviewer of a task (the only place assignments live).
--   task_review_decisions   one row per reviewer per review cycle: that reviewer's OWN status
--                           (pending / approved / changes_requested / withdrawn), who actually
--                           decided, when, and why. Reviewers never touch each other's rows.
--   task_reviews            the review CYCLE (submission, hours snapshot). Its decision /
--                           decided_by / decided_at / feedback are DERIVED from the rows above
--                           and written only by decide_task_review.
--   tasks.reviewer          kept only as a mirror of the primary reviewer (first by position) so
--                           existing readers keep working. A trigger maintains it from
--                           task_reviewers; a write to it from legacy code is translated into
--                           task_reviewers by another trigger.
--
-- Rules
--   * A task is fully approved (and Completed) only when EVERY reviewer of the cycle has approved.
--   * One reviewer approving or requesting changes never changes another reviewer's status.
--   * A change request sends the task back to In Progress immediately; reviewers who had approved
--     keep that recorded status in the closed cycle. Resubmitting opens a new cycle in which every
--     reviewer starts pending again (the work changed, so earlier approvals do not carry over).
--   * A reviewer decides once per cycle. A manager/admin may decide on behalf of a named reviewer;
--     the row then shows reviewer_id (who was asked) and decided_by (who actually decided).
--
-- Additive: only adds objects, backfills new tables from existing data, and replaces functions
-- defined by earlier migrations. It never updates or deletes existing rows.

-- 0) Prerequisite: the single-reviewer workflow migration must be applied first.
DO $$
BEGIN
  IF to_regclass('public.task_reviews') IS NULL
     OR to_regprocedure('public.ensure_pending_review(public.tasks)') IS NULL
     OR to_regprocedure('public.bank_task_timer(uuid,timestamptz,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Apply 20261027000000_in_review_workflow.sql before this migration';
  END IF;
END $$;

-- Idempotent safety net for databases that missed the hours snapshot columns.
ALTER TABLE public.task_reviews
  ADD COLUMN IF NOT EXISTS logged_hours_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS logged_hours_today        numeric,
  ADD COLUMN IF NOT EXISTS logged_hours_total        numeric,
  ADD COLUMN IF NOT EXISTS system_hours_total        numeric;

-- 1) Assignments -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.task_reviewers (
  task_id      uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  reviewer_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  position     integer NOT NULL DEFAULT 0,
  added_by     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, reviewer_id)
);
CREATE INDEX IF NOT EXISTS task_reviewers_reviewer_idx ON public.task_reviewers (reviewer_id);

-- 2) Per-reviewer decisions ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.task_review_decisions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id    uuid NOT NULL REFERENCES public.task_reviews(id) ON DELETE CASCADE,
  task_id      uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  reviewer_id  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  decision     text NOT NULL DEFAULT 'pending'
               CHECK (decision IN ('pending','approved','changes_requested','withdrawn')),
  decided_by   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  decided_at   timestamptz,
  feedback     text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (review_id, reviewer_id)
);
CREATE INDEX IF NOT EXISTS task_review_decisions_task_idx ON public.task_review_decisions (task_id);
CREATE INDEX IF NOT EXISTS task_review_decisions_reviewer_pending
  ON public.task_review_decisions (reviewer_id) WHERE decision = 'pending';

ALTER TABLE public.task_reviewers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_review_decisions ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.task_reviewers, public.task_review_decisions TO authenticated;
GRANT ALL ON public.task_reviewers, public.task_review_decisions TO service_role;
-- Same visibility as tasks. No INSERT/UPDATE/DELETE policy: only the functions below write.
DROP POLICY IF EXISTS task_reviewers_read ON public.task_reviewers;
CREATE POLICY task_reviewers_read ON public.task_reviewers FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS task_review_decisions_read ON public.task_review_decisions;
CREATE POLICY task_review_decisions_read ON public.task_review_decisions FOR SELECT TO authenticated USING (true);

-- 3) Backfill from existing data (INSERT only; triggers are created afterwards) ----------
INSERT INTO public.task_reviewers (task_id, reviewer_id, position)
SELECT t.id, t.reviewer, 1
  FROM public.tasks t
 WHERE t.reviewer IS NOT NULL
   AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = t.reviewer)
ON CONFLICT (task_id, reviewer_id) DO NOTHING;

-- Every existing cycle becomes one decision row for the reviewer it was addressed to.
INSERT INTO public.task_review_decisions
  (review_id, task_id, reviewer_id, decision, decided_by, decided_at, feedback)
SELECT c.id, c.task_id, COALESCE(c.reviewer_id, t.reviewer), c.decision, c.decided_by, c.decided_at, c.feedback
  FROM public.task_reviews c
  JOIN public.tasks t ON t.id = c.task_id
 WHERE COALESCE(c.reviewer_id, t.reviewer) IS NOT NULL
   AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = COALESCE(c.reviewer_id, t.reviewer))
   AND NOT EXISTS (SELECT 1 FROM public.task_review_decisions d WHERE d.review_id = c.id)
ON CONFLICT (review_id, reviewer_id) DO NOTHING;

-- 4) Read model: who still has to review what (used by queues, dashboards, push) ----------
--    A task in an open cycle: the reviewers whose own decision is still pending.
--    A task In Review with no open cycle (pre-workflow data): its assigned reviewers.
CREATE OR REPLACE VIEW public.pending_review_assignments WITH (security_invoker = true) AS
SELECT d.task_id, d.reviewer_id, d.review_id, c.cycle_no, c.submitted_at
  FROM public.task_review_decisions d
  JOIN public.task_reviews c ON c.id = d.review_id AND c.decision = 'pending'
  JOIN public.tasks t ON t.id = d.task_id AND t.status = 'In Review'
 WHERE d.decision = 'pending' AND d.reviewer_id IS NOT NULL
UNION ALL
SELECT t.id, r.reviewer_id, NULL::uuid, NULL::integer, t.review_submitted_at
  FROM public.tasks t
  JOIN public.task_reviewers r ON r.task_id = t.id
 WHERE t.status = 'In Review'
   AND NOT EXISTS (SELECT 1 FROM public.task_reviews c WHERE c.task_id = t.id AND c.decision = 'pending');
GRANT SELECT ON public.pending_review_assignments TO authenticated, service_role;

-- 5) Keep tasks.reviewer (primary reviewer mirror) consistent with task_reviewers ---------

-- 5a) task_reviewers -> tasks.reviewer. The only writer of the mirror.
CREATE OR REPLACE FUNCTION public.sync_primary_reviewer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  tid uuid := COALESCE(NEW.task_id, OLD.task_id);
  prim uuid;
  prev_bypass text;
  prev_sync text;
BEGIN
  SELECT reviewer_id INTO prim FROM public.task_reviewers
   WHERE task_id = tid ORDER BY position, created_at LIMIT 1;
  IF EXISTS (SELECT 1 FROM public.tasks WHERE id = tid AND reviewer IS DISTINCT FROM prim) THEN
    prev_bypass := COALESCE(current_setting('app.review_bypass', true), '');
    prev_sync := COALESCE(current_setting('app.reviewers_sync', true), '');
    PERFORM set_config('app.review_bypass', tid::text, true);
    PERFORM set_config('app.reviewers_sync', tid::text, true);
    UPDATE public.tasks SET reviewer = prim WHERE id = tid;
    PERFORM set_config('app.review_bypass', prev_bypass, true);
    PERFORM set_config('app.reviewers_sync', prev_sync, true);
  END IF;
  RETURN NULL;
END;
$$;

-- 5b) A direct write to tasks.reviewer (CSV import, older code) is translated into
--     task_reviewers: it replaces the PRIMARY reviewer and leaves the others alone.
CREATE OR REPLACE FUNCTION public.sync_legacy_reviewer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF COALESCE(current_setting('app.reviewers_sync', true), '') = NEW.id::text THEN
    RETURN NULL; -- this write came from sync_primary_reviewer
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.reviewer IS NOT NULL THEN
      INSERT INTO public.task_reviewers (task_id, reviewer_id, position, added_by)
      VALUES (NEW.id, NEW.reviewer, 1, auth.uid())
      ON CONFLICT (task_id, reviewer_id) DO NOTHING;
    END IF;
    RETURN NULL;
  END IF;

  IF NEW.reviewer IS NOT DISTINCT FROM OLD.reviewer THEN
    RETURN NULL;
  END IF;

  -- The profile was deleted (FK SET NULL): the reviewer row cascades away on its own.
  IF NEW.reviewer IS NULL AND OLD.reviewer IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = OLD.reviewer) THEN
    RETURN NULL;
  END IF;

  IF NEW.status = 'In Review' THEN
    RAISE EXCEPTION 'Change the reviewers of a task in review through the reviewers list (set_task_reviewers)';
  END IF;

  IF OLD.reviewer IS NOT NULL THEN
    DELETE FROM public.task_reviewers WHERE task_id = NEW.id AND reviewer_id = OLD.reviewer;
  END IF;
  IF NEW.reviewer IS NOT NULL THEN
    INSERT INTO public.task_reviewers (task_id, reviewer_id, position, added_by)
    VALUES (NEW.id, NEW.reviewer,
            COALESCE((SELECT MIN(position) FROM public.task_reviewers WHERE task_id = NEW.id), 1) - 1,
            auth.uid())
    ON CONFLICT (task_id, reviewer_id) DO UPDATE SET position = EXCLUDED.position;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_task_reviewers_sync_primary ON public.task_reviewers;
CREATE TRIGGER trg_task_reviewers_sync_primary
AFTER INSERT OR UPDATE OR DELETE ON public.task_reviewers
FOR EACH ROW EXECUTE FUNCTION public.sync_primary_reviewer();

DROP TRIGGER IF EXISTS trg_tasks_sync_legacy_reviewer ON public.tasks;
CREATE TRIGGER trg_tasks_sync_legacy_reviewer
AFTER INSERT OR UPDATE OF reviewer ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.sync_legacy_reviewer();

-- 6) Review cycle bootstrap: make sure a pending cycle AND its per-reviewer rows exist ------
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
  IF NOT FOUND THEN
    INSERT INTO public.task_reviews (task_id, cycle_no, submitted_by, submitted_at, reviewer_id)
    VALUES (_t.id,
            (SELECT COALESCE(MAX(cycle_no), 0) + 1 FROM public.task_reviews WHERE task_id = _t.id),
            COALESCE(_t.assigned_to, _t.updated_by), COALESCE(_t.review_submitted_at, _t.updated_at), _t.reviewer)
    RETURNING * INTO r;
  END IF;

  -- A cycle created before multiple reviewers existed has no per-reviewer rows yet.
  IF NOT EXISTS (SELECT 1 FROM public.task_review_decisions WHERE review_id = r.id) THEN
    INSERT INTO public.task_review_decisions (review_id, task_id, reviewer_id)
    SELECT r.id, _t.id, x.reviewer_id
      FROM (SELECT reviewer_id FROM public.task_reviewers WHERE task_id = _t.id
            UNION SELECT r.reviewer_id WHERE r.reviewer_id IS NOT NULL
            UNION SELECT _t.reviewer WHERE _t.reviewer IS NOT NULL) x
     WHERE x.reviewer_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = x.reviewer_id)
    ON CONFLICT (review_id, reviewer_id) DO NOTHING;
  END IF;
  RETURN r;
END;
$$;

-- 7) Assign reviewers (the single write path for the reviewer list) --------------------------
CREATE OR REPLACE FUNCTION public.set_task_reviewers(_task_id uuid, _reviewer_ids uuid[])
RETURNS SETOF public.task_reviewers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid uuid := auth.uid();
  t public.tasks;
  r public.task_reviews;
  is_mgr boolean;
  ids uuid[] := ARRAY[]::uuid[];
  old_ids uuid[];
  removed uuid[];
  added uuid[];
  x uuid;
  i integer := 0;
  pending_left integer;
  actor_name text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO t FROM public.tasks WHERE id = _task_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Task not found'; END IF;

  is_mgr := public.is_manager_or_admin(uid);
  IF NOT is_mgr THEN
    IF t.status = 'In Review' THEN
      RAISE EXCEPTION 'Only a manager can change the reviewers while the task is in review';
    END IF;
    IF t.assigned_to IS DISTINCT FROM uid AND t.created_by IS DISTINCT FROM uid THEN
      RAISE EXCEPTION 'You can only change reviewers on tasks you created or are assigned to';
    END IF;
  END IF;

  FOREACH x IN ARRAY COALESCE(_reviewer_ids, ARRAY[]::uuid[]) LOOP
    IF x IS NOT NULL AND NOT (x = ANY(ids)) THEN ids := array_append(ids, x); END IF;
  END LOOP;
  IF COALESCE(cardinality(ids), 0) > 10 THEN RAISE EXCEPTION 'A task can have at most 10 reviewers'; END IF;
  IF t.assigned_to IS NOT NULL AND t.assigned_to = ANY(ids) THEN
    RAISE EXCEPTION 'The reviewer cannot be the assignee';
  END IF;
  FOREACH x IN ARRAY ids LOOP
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = x AND COALESCE(is_active, true)) THEN
      RAISE EXCEPTION 'A selected reviewer is unknown or inactive';
    END IF;
  END LOOP;

  old_ids := ARRAY(SELECT reviewer_id FROM public.task_reviewers WHERE task_id = _task_id ORDER BY position, created_at);
  removed := ARRAY(SELECT unnest(old_ids) EXCEPT SELECT unnest(ids));
  added := ARRAY(SELECT unnest(ids) EXCEPT SELECT unnest(old_ids));

  IF t.status = 'In Review' THEN
    IF COALESCE(cardinality(ids), 0) = 0 THEN
      RAISE EXCEPTION 'A task in review needs at least one reviewer';
    END IF;
    r := public.ensure_pending_review(t);   -- snapshot the current set before changing it
    IF EXISTS (SELECT 1 FROM unnest(removed) rm
                WHERE NOT EXISTS (SELECT 1 FROM public.task_review_decisions d
                                   WHERE d.review_id = r.id AND d.reviewer_id = rm AND d.decision = 'pending')) THEN
      RAISE EXCEPTION 'Only reviewers who have not decided yet can be removed from a review in progress';
    END IF;
    SELECT count(*) INTO pending_left FROM public.task_review_decisions d
     WHERE d.review_id = r.id AND d.decision = 'pending' AND d.reviewer_id <> ALL (removed);
    pending_left := pending_left + COALESCE(cardinality(added), 0);
    IF pending_left = 0 THEN
      RAISE EXCEPTION 'Cannot remove the last reviewer who still has to decide';
    END IF;
  END IF;

  DELETE FROM public.task_reviewers WHERE task_id = _task_id AND reviewer_id <> ALL (ids);
  FOREACH x IN ARRAY ids LOOP
    i := i + 1;
    INSERT INTO public.task_reviewers (task_id, reviewer_id, position, added_by)
    VALUES (_task_id, x, i, uid)
    ON CONFLICT (task_id, reviewer_id) DO UPDATE SET position = EXCLUDED.position;
  END LOOP;

  IF t.status = 'In Review' AND (COALESCE(cardinality(removed), 0) > 0 OR COALESCE(cardinality(added), 0) > 0) THEN
    UPDATE public.task_review_decisions
       SET decision = 'withdrawn', decided_by = uid, decided_at = now()
     WHERE review_id = r.id AND decision = 'pending' AND reviewer_id = ANY (removed);
    INSERT INTO public.task_review_decisions (review_id, task_id, reviewer_id)
    SELECT r.id, _task_id, a FROM unnest(added) a
    ON CONFLICT (review_id, reviewer_id) DO UPDATE
      SET decision = 'pending', decided_by = NULL, decided_at = NULL, feedback = NULL;

    SELECT COALESCE(NULLIF(btrim(display_name), ''), 'Someone') INTO actor_name FROM public.profiles WHERE id = uid;
    INSERT INTO public.notifications (user_id, type, title, body, task_id, dedupe_key)
    SELECT a, 'review_requested', COALESCE(t.task_code, 'Task') || ' — review requested',
           format('%s added you as a reviewer of "%s"', COALESCE(actor_name, 'Someone'), t.task_name),
           _task_id, 'REVIEW_ADDED_' || r.id::text || '_' || a::text
      FROM unnest(added) a
    ON CONFLICT (dedupe_key) DO NOTHING;
    INSERT INTO public.task_history (task_id, old_status, new_status, updated_by, comment)
    VALUES (_task_id, 'In Review', 'In Review', uid,
            format('Reviewers changed during review cycle %s (%s added, %s removed)',
                   r.cycle_no, COALESCE(cardinality(added), 0), COALESCE(cardinality(removed), 0)));
  END IF;

  RETURN QUERY SELECT * FROM public.task_reviewers WHERE task_id = _task_id ORDER BY position, created_at;
END;
$$;

-- 8) Send for review: one pending decision per reviewer ------------------------------------
DROP FUNCTION IF EXISTS public.submit_task_for_review(uuid, numeric, text);
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
  rids uuid[];
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

  rids := ARRAY(SELECT reviewer_id FROM public.task_reviewers WHERE task_id = _task_id ORDER BY position, created_at);
  IF COALESCE(cardinality(rids), 0) = 0 AND t.reviewer IS NOT NULL THEN
    rids := ARRAY[t.reviewer];
  END IF;
  IF COALESCE(cardinality(rids), 0) = 0 THEN
    RAISE EXCEPTION 'Assign a reviewer before sending this task for review';
  END IF;
  IF t.assigned_to IS NULL THEN
    RAISE EXCEPTION 'Assign this task to someone before sending it for review';
  END IF;
  IF t.assigned_to = ANY (rids) THEN
    RAISE EXCEPTION 'The reviewer cannot be the assignee';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(rids) x
              WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = x AND COALESCE(p.is_active, true))) THEN
    RAISE EXCEPTION 'An assigned reviewer is inactive; update the reviewers';
  END IF;
  IF _logged_hours IS NOT NULL THEN
    IF t.assigned_to IS DISTINCT FROM uid THEN
      RAISE EXCEPTION 'Only the assignee can enter logged hours for this task';
    END IF;
    IF _logged_hours < 0 OR _logged_hours > 24 THEN
      RAISE EXCEPTION 'Logged hours must be between 0 and 24';
    END IF;
  END IF;

  IF _logged_hours IS NOT NULL THEN
    SELECT h.eod_today, h.eod_total INTO hours_today, hours_total
      FROM public.apply_task_eod_hours(_task_id, uid, _logged_hours, _note) h;
    IF COALESCE(hours_total, 0) <= 0 THEN
      RAISE EXCEPTION 'Enter the hours you worked before sending this task for review';
    END IF;
  ELSE
    hours_total := t.actual_hours;
  END IF;

  elapsed := public.bank_task_timer(_task_id, t.started_at, COALESCE(t.assigned_to, uid));
  sys_total := COALESCE(t.system_hours, 0) + elapsed;

  -- Close any cycle left open by an earlier out-of-band status change (this task only).
  UPDATE public.task_review_decisions d SET decision = 'withdrawn', decided_at = now()
   WHERE d.decision = 'pending'
     AND d.review_id IN (SELECT id FROM public.task_reviews WHERE task_id = _task_id AND decision = 'pending');
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
    (_task_id, n, uid, rids[1],
     CASE WHEN _logged_hours IS NOT NULL THEN now() END, hours_today, hours_total, sys_total)
  RETURNING * INTO r;

  -- Every reviewer gets their own pending decision for this cycle.
  INSERT INTO public.task_review_decisions (review_id, task_id, reviewer_id)
  SELECT r.id, _task_id, x FROM unnest(rids) x;

  SELECT COALESCE(NULLIF(btrim(display_name), ''), 'Someone') INTO actor_name
    FROM public.profiles WHERE id = uid;

  INSERT INTO public.task_history (task_id, old_status, new_status, updated_by, comment)
  VALUES (_task_id, 'In Review', 'In Review', uid,
          format('Review cycle %s requested from %s reviewer%s', n, cardinality(rids), CASE WHEN cardinality(rids) = 1 THEN '' ELSE 's' END)
          || CASE WHEN _logged_hours IS NOT NULL
                  THEN format(' (logged %sh today, %sh total)', hours_today, hours_total) ELSE '' END);

  INSERT INTO public.notifications (user_id, type, title, body, task_id, dedupe_key)
  SELECT x, 'review_requested',
         COALESCE(t.task_code, 'Task') || ' — review requested',
         format('%s sent "%s" for review', COALESCE(actor_name, 'Someone'), t.task_name)
           || CASE WHEN COALESCE(hours_total, 0) > 0 THEN format(' · %sh logged', ROUND(hours_total, 2)) ELSE '' END,
         _task_id, 'REVIEW_REQ_' || r.id::text || '_' || x::text
    FROM unnest(rids) x
  ON CONFLICT (dedupe_key) DO NOTHING;

  RETURN r;
END;
$$;

-- 9) Decide. Each reviewer decides their OWN row; the task completes only when all approved. ---
DROP FUNCTION IF EXISTS public.decide_task_review(uuid, text, text);
CREATE OR REPLACE FUNCTION public.decide_task_review(
  _task_id uuid, _decision text, _feedback text DEFAULT NULL, _reviewer_id uuid DEFAULT NULL)
RETURNS public.task_reviews
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid uuid := auth.uid();
  t public.tasks;
  r public.task_reviews;
  d public.task_review_decisions;
  fb text := NULLIF(btrim(COALESCE(_feedback, '')), '');
  is_mgr boolean;
  target uuid;
  pending_n integer;
  approved_n integer;
  total_n integer;
  terminal boolean;
  all_approved boolean;
  next_status public.task_status;
  elapsed numeric;
  sys_total numeric;
  actor_name text;
  target_name text;
  n_title text;
  n_body text;
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

  SELECT * INTO t FROM public.tasks WHERE id = _task_id FOR UPDATE;   -- serialises concurrent reviewers
  IF NOT FOUND THEN RAISE EXCEPTION 'Task not found'; END IF;
  IF t.status <> 'In Review' THEN RAISE EXCEPTION 'This task is not in review'; END IF;

  r := public.ensure_pending_review(t);
  is_mgr := public.is_manager_or_admin(uid);

  -- Whose decision is this?
  target := _reviewer_id;
  IF target IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.task_review_decisions
                WHERE review_id = r.id AND reviewer_id = uid AND decision <> 'withdrawn') THEN
      target := uid;
    ELSIF is_mgr THEN
      SELECT count(*) INTO pending_n FROM public.task_review_decisions
       WHERE review_id = r.id AND decision = 'pending';
      IF pending_n = 0 THEN
        RAISE EXCEPTION 'Every reviewer has already decided';
      ELSIF pending_n > 1 THEN
        RAISE EXCEPTION 'Choose which reviewer you are deciding for';
      END IF;
      SELECT reviewer_id INTO target FROM public.task_review_decisions
       WHERE review_id = r.id AND decision = 'pending';
    ELSE
      RAISE EXCEPTION 'Only an assigned reviewer or a manager/admin can decide this review';
    END IF;
  END IF;
  IF target IS DISTINCT FROM uid AND NOT is_mgr THEN
    RAISE EXCEPTION 'Only a manager/admin can decide on behalf of another reviewer';
  END IF;

  -- No self-approval: neither the assignee nor whoever submitted the work may decide it.
  IF uid = t.assigned_to OR uid = r.submitted_by THEN
    RAISE EXCEPTION 'You cannot review your own work';
  END IF;

  SELECT * INTO d FROM public.task_review_decisions
   WHERE review_id = r.id AND reviewer_id = target FOR UPDATE;
  IF NOT FOUND OR d.decision = 'withdrawn' THEN
    RAISE EXCEPTION 'That person is not a reviewer on this review';
  END IF;
  IF d.decision <> 'pending' THEN
    RAISE EXCEPTION 'This reviewer has already decided on this review';
  END IF;

  IF _decision = 'approved' AND COALESCE(t.actual_hours, 0) <= 0 THEN
    RAISE EXCEPTION 'Logged hours are missing: the assignee must enter or confirm them before this task can be approved';
  END IF;

  -- Record THIS reviewer's decision. No other reviewer's row is touched.
  UPDATE public.task_review_decisions
     SET decision = _decision, decided_by = uid, decided_at = now(), feedback = fb
   WHERE id = d.id
   RETURNING * INTO d;

  SELECT count(*) FILTER (WHERE decision = 'approved'),
         count(*) FILTER (WHERE decision <> 'withdrawn')
    INTO approved_n, total_n
    FROM public.task_review_decisions WHERE review_id = r.id;
  all_approved := (_decision = 'approved' AND approved_n = total_n);
  terminal := (_decision = 'changes_requested') OR all_approved;

  SELECT COALESCE(NULLIF(btrim(display_name), ''), 'Someone') INTO actor_name FROM public.profiles WHERE id = uid;
  SELECT COALESCE(NULLIF(btrim(display_name), ''), 'A reviewer') INTO target_name FROM public.profiles WHERE id = target;

  IF terminal THEN
    next_status := CASE WHEN all_approved THEN 'Completed' ELSE 'In Progress' END;

    -- Bank a timer still running from before the workflow existed (once, to the assignee).
    elapsed := public.bank_task_timer(_task_id, t.started_at, COALESCE(t.assigned_to, uid));
    sys_total := COALESCE(t.system_hours, 0) + elapsed;

    PERFORM set_config('app.review_bypass', _task_id::text, true);
    IF all_approved THEN
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

    -- The cycle's summary is derived from the decision rows.
    UPDATE public.task_reviews
       SET decision = CASE WHEN all_approved THEN 'approved' ELSE 'changes_requested' END,
           decided_by = uid, decided_at = now(), feedback = fb
     WHERE id = r.id;
  END IF;

  INSERT INTO public.task_history (task_id, old_status, new_status, updated_by, comment)
  VALUES (_task_id,
          CASE WHEN terminal THEN next_status ELSE 'In Review' END,
          CASE WHEN terminal THEN next_status ELSE 'In Review' END,
          uid,
          format('Review cycle %s: %s %s%s%s', r.cycle_no, target_name,
                 CASE WHEN _decision = 'approved' THEN 'approved' ELSE 'requested changes' END,
                 CASE WHEN _decision = 'approved' THEN format(' (%s/%s)', approved_n, total_n) ELSE '' END,
                 CASE WHEN target IS DISTINCT FROM uid THEN format(' [decided by %s on their behalf]', actor_name) ELSE '' END)
          || COALESCE(' — ' || fb, '')
          || CASE WHEN all_approved THEN ' · all reviewers approved, task completed' ELSE '' END);

  IF t.assigned_to IS NOT NULL THEN
    IF _decision = 'changes_requested' THEN
      n_title := COALESCE(t.task_code, 'Task') || ' — changes requested';
      n_body := format('%s requested changes: %s', target_name, left(fb, 200));
    ELSIF all_approved THEN
      n_title := COALESCE(t.task_code, 'Task') || ' — approved';
      n_body := format('All %s reviewer%s approved "%s"', total_n, CASE WHEN total_n = 1 THEN '' ELSE 's' END, t.task_name)
                || CASE WHEN fb IS NOT NULL THEN ' — ' || left(fb, 160) ELSE '' END;
    ELSE
      n_title := COALESCE(t.task_code, 'Task') || format(' — approved by %s (%s/%s)', target_name, approved_n, total_n);
      n_body := format('%s approved "%s"; waiting for %s more reviewer%s', target_name, t.task_name,
                       total_n - approved_n, CASE WHEN total_n - approved_n = 1 THEN '' ELSE 's' END)
                || CASE WHEN fb IS NOT NULL THEN ' — ' || left(fb, 160) ELSE '' END;
    END IF;
    INSERT INTO public.notifications (user_id, type, title, body, task_id, dedupe_key)
    VALUES (t.assigned_to,
            CASE WHEN _decision = 'approved' THEN 'review_approved' ELSE 'review_changes_requested' END,
            n_title, n_body, _task_id, 'REVIEW_DEC_' || d.id::text)
    ON CONFLICT (dedupe_key) DO NOTHING;
  END IF;

  SELECT * INTO r FROM public.task_reviews WHERE id = r.id;
  RETURN r;
END;
$$;

-- 10) Blocked-task notice goes to every reviewer (it used to reach only tasks.reviewer) ------
CREATE OR REPLACE FUNCTION public.notify_task_blocked(_task_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  t public.tasks;
  rid uuid;
  prim uuid;
  k text;
BEGIN
  SELECT * INTO t FROM public.tasks WHERE id = _task_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'task not found'; END IF;
  IF caller IS DISTINCT FROM t.assigned_to AND NOT public.is_manager_or_admin(caller) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  prim := t.reviewer;
  FOR rid IN
    SELECT reviewer_id FROM public.task_reviewers WHERE task_id = _task_id
    UNION SELECT t.reviewer WHERE t.reviewer IS NOT NULL
  LOOP
    IF rid = caller THEN CONTINUE; END IF;
    -- the primary reviewer keeps the original dedupe key, so nothing is notified twice
    k := 'BLOCKED_' || _task_id::text || '_' || (now() AT TIME ZONE 'utc')::date::text
         || CASE WHEN rid IS NOT DISTINCT FROM prim THEN '' ELSE '_' || rid::text END;
    INSERT INTO public.notifications(user_id, type, title, body, task_id, dedupe_key)
    VALUES (rid, 'task_blocked', t.task_code || ' blocked',
            COALESCE(_reason, 'Task marked as blocked'), _task_id, k)
    ON CONFLICT (dedupe_key) DO NOTHING;
  END LOOP;
END;
$$;

-- 11) Privileges -------------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.sync_primary_reviewer() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_legacy_reviewer() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ensure_pending_review(public.tasks) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_task_reviewers(uuid, uuid[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.submit_task_for_review(uuid, numeric, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.decide_task_review(uuid, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_task_reviewers(uuid, uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_task_for_review(uuid, numeric, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.decide_task_review(uuid, text, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.notify_task_blocked(uuid, text) TO authenticated, service_role;

-- 12) Realtime for per-reviewer changes (only where the publication exists) ----------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                      WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
                        AND tablename = 'task_review_decisions') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.task_review_decisions';
  END IF;
END $$;
