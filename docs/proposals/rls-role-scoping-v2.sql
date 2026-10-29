-- ============================================================================================
-- RLS ROLE SCOPING v2  (supersedes rls-role-scoping.PROPOSAL-NOT-APPLIED.sql)
-- Applied and tested on the LOCAL Docker database only. NOT applied to Production.
--
-- Who may read a task (and the rows that hang off it: worklogs, comments, attachments, history,
-- carry-forward events, reviewers, reviews, review decisions, task risks):
--   * Admin / Manager            -> every task
--   * the task's assignee        -> assigned_to = me
--   * the task's creator         -> created_by  = me
--   * its reviewers              -> tasks.reviewer = me OR a task_reviewers row for me
-- Visibility is NOT widened by updated_by.
--
-- Reassignment: an assignee who is not the creator hands a task away, after which they can no longer read it.
-- PostgreSQL rejects an UPDATE whose new row the user cannot read, so that update can no longer be a plain
-- UPDATE. It goes through reassign_task() below (SECURITY DEFINER): it checks WHO is calling and changes
-- assigned_to (+ updated_by) and nothing else.
--
-- PREREQUISITE FOUND DURING TESTING (section 0): on this stack PostgREST does NOT set request.jwt.claim.sub,
-- so auth.uid() is NULL for every REST request. Policies written with auth.uid() alone would hide every row
-- from every user (managers and admins included) on the REST path the task lists use. The new objects use
-- public.req_uid(), which also reads the verified claims JSON. auth.uid() and all existing policies are untouched.
--
-- Before running anywhere else: take a backup; add the indexes (CREATE INDEX CONCURRENTLY, outside this
-- transaction) tasks(created_by) and task_reviewers(reviewer_id, task_id); deploy the app change in
-- src/services/tasks.functions.ts (updateTaskFn calls reassign_task) at the same time; run
-- NOTIFY pgrst, 'reload schema' (PostgREST does not see a new function until its schema cache reloads);
-- and test with real admin / manager / reviewer / member accounts.
-- ============================================================================================

BEGIN;

-- 0) Caller id that works on BOTH paths -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.req_uid()
RETURNS uuid LANGUAGE sql STABLE SET search_path = public, pg_temp AS $fn$
  SELECT COALESCE(
    auth.uid(),
    (SELECT x.s::uuid
       FROM (SELECT NULLIF(CASE WHEN COALESCE(current_setting('request.jwt.claims', true), '') ~ '^\s*\{'
                                THEN current_setting('request.jwt.claims', true)::jsonb ->> 'sub' END, '') AS s) x
      WHERE x.s ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  );
$fn$;
REVOKE ALL ON FUNCTION public.req_uid() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.req_uid() FROM anon;
GRANT EXECUTE ON FUNCTION public.req_uid() TO authenticated, service_role;

-- 1) Visibility helper -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_see_task(_task_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.id = _task_id
      AND (   t.assigned_to = public.req_uid()
           OR t.created_by  = public.req_uid()
           OR t.reviewer    = public.req_uid()
           OR EXISTS (SELECT 1 FROM public.task_reviewers r WHERE r.task_id = t.id AND r.reviewer_id = public.req_uid())
           OR public.is_manager_or_admin(public.req_uid()))
  );
$fn$;

-- 2) Secure reassignment -----------------------------------------------------------------------
-- Same authority as the existing tasks_update policy / trigger: the current assignee, the creator, or a
-- manager/admin. Everything else in the task is untouched. The table triggers still run, but they read
-- auth.uid() (NULL over REST) and then skip their checks, so the In-Review rule is repeated here explicitly.
CREATE OR REPLACE FUNCTION public.reassign_task(_task_id uuid, _new_assignee uuid)
RETURNS public.tasks LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  uid uuid := public.req_uid();
  t   public.tasks;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO t FROM public.tasks WHERE id = _task_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT (t.assigned_to = uid OR t.created_by = uid OR public.is_manager_or_admin(uid)) THEN
    RAISE EXCEPTION 'You can only reassign tasks assigned to or created by you' USING ERRCODE = '42501';
  END IF;

  IF t.status = 'In Review' AND NOT public.is_manager_or_admin(uid) THEN
    RAISE EXCEPTION 'Only a manager can change assignee while the task is in review' USING ERRCODE = '42501';
  END IF;

  IF _new_assignee IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _new_assignee) THEN
    RAISE EXCEPTION 'Assignee not found' USING ERRCODE = '22023';
  END IF;

  IF t.assigned_to IS NOT DISTINCT FROM _new_assignee THEN
    RETURN t; -- nothing to do
  END IF;

  UPDATE public.tasks
     SET assigned_to = _new_assignee,
         updated_by  = uid
   WHERE id = _task_id
  RETURNING * INTO t;
  RETURN t;
END;
$fn$;

REVOKE ALL ON FUNCTION public.reassign_task(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reassign_task(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.reassign_task(uuid, uuid) TO authenticated, service_role;

-- 3) Policies -----------------------------------------------------------------------------------
DROP POLICY IF EXISTS tasks_read_all ON public.tasks;
CREATE POLICY tasks_read_scoped ON public.tasks FOR SELECT TO authenticated USING (
     assigned_to = public.req_uid()
  OR created_by  = public.req_uid()
  OR reviewer    = public.req_uid()
  OR EXISTS (SELECT 1 FROM public.task_reviewers r WHERE r.task_id = tasks.id AND r.reviewer_id = public.req_uid())
  OR public.is_manager_or_admin(public.req_uid())
);

DROP POLICY IF EXISTS "Authenticated users can select worklogs" ON public.task_worklogs;
CREATE POLICY worklogs_read_scoped ON public.task_worklogs FOR SELECT TO authenticated USING (
     user_id = public.req_uid()
  OR public.is_manager_or_admin(public.req_uid())
  OR public.can_see_task(task_id)
);

DROP POLICY IF EXISTS comments_read ON public.comments;
CREATE POLICY comments_read_scoped ON public.comments FOR SELECT TO authenticated
  USING (public.is_manager_or_admin(public.req_uid()) OR public.can_see_task(work_item_id));

DROP POLICY IF EXISTS attach_read ON public.attachments;
CREATE POLICY attach_read_scoped ON public.attachments FOR SELECT TO authenticated
  USING (public.is_manager_or_admin(public.req_uid()) OR public.can_see_task(work_item_id));

DROP POLICY IF EXISTS history_read_all ON public.task_history;
CREATE POLICY history_read_scoped ON public.task_history FOR SELECT TO authenticated
  USING (public.is_manager_or_admin(public.req_uid()) OR public.can_see_task(task_id));

DROP POLICY IF EXISTS cfe_read_all ON public.carry_forward_events;
CREATE POLICY cfe_read_scoped ON public.carry_forward_events FOR SELECT TO authenticated
  USING (public.is_manager_or_admin(public.req_uid()) OR public.can_see_task(task_id));

DROP POLICY IF EXISTS task_reviewers_read ON public.task_reviewers;
CREATE POLICY task_reviewers_read_scoped ON public.task_reviewers FOR SELECT TO authenticated
  USING (reviewer_id = public.req_uid() OR public.is_manager_or_admin(public.req_uid()) OR public.can_see_task(task_id));

-- review cycles and decisions (new in v2: they carry the reviewer's feedback on a task)
DROP POLICY IF EXISTS task_reviews_read ON public.task_reviews;
CREATE POLICY task_reviews_read_scoped ON public.task_reviews FOR SELECT TO authenticated
  USING (public.is_manager_or_admin(public.req_uid()) OR public.can_see_task(task_id));

DROP POLICY IF EXISTS task_review_decisions_read ON public.task_review_decisions;
CREATE POLICY task_review_decisions_read_scoped ON public.task_review_decisions FOR SELECT TO authenticated
  USING (
    public.is_manager_or_admin(public.req_uid())
    OR reviewer_id = public.req_uid()
    OR public.can_see_task(task_id)
  );

DROP POLICY IF EXISTS risk_read_all ON public.risk_events;
CREATE POLICY risk_read_scoped ON public.risk_events FOR SELECT TO authenticated USING (
     public.is_manager_or_admin(public.req_uid())
  OR (entity_type = 'task' AND public.can_see_task(entity_id))
);

COMMIT;

-- Left as they are on purpose (decide separately):
--   * comment_mentions.cm_read (USING true): a mention row only holds comment_id + mentioned user; the comment
--     itself is now task-scoped. A person mentioned on a task they cannot see gets a notification they cannot open.
--   * tasks_update / tasks_delete still allow creator OR assignee to change/delete any column; the existing
--     enforce_task_field_perms / enforce_review_locks triggers are the field-level guard (when auth.uid() is set).
--   * Over REST auth.uid() is NULL on this stack, so every existing auth.uid()-based INSERT/UPDATE/DELETE
--     policy already fails there; the app writes through server functions (withUser sets both settings).
--   * LOCAL DATABASE DRIFT found while testing: row level security is OFF on public.notifications (the migration
--     enables it) and on public.leaves. Check Production with
--       SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('notifications','leaves') AND relkind='r';
