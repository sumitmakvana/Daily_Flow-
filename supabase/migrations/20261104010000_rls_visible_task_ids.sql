-- RLS: the 9 policies that called can_see_task(<task id>) for EVERY row now test membership in the caller's
-- visible task ids, computed ONCE per statement (a hashed subplan) by public.visible_task_ids().
--
-- Measured on the local test DB (member ltmem1, full-table reads): task_history 769 ms -> 5 ms (97,268 -> 5,227 rows
-- read), task_worklogs 94 ms -> 5 ms, task_reviewers 51 ms -> 4 ms. Permissions verified identical (232 checks + exact
-- visible-row checksums for these 9 tables). The manager check stays first in each policy, so managers/admins
-- short-circuit exactly as before and never build the list.
-- visible_task_ids() returns exactly the tasks for which can_see_task() is true (same conditions, same SECURITY
-- DEFINER context). A NULL task id is not in the list, as can_see_task(NULL) is false. can_see_task() is kept.
--
-- Also adds the missing index on tasks(created_by), used by the tasks read policy and by visible_task_ids().
-- PRODUCTION: create that index separately with CREATE INDEX CONCURRENTLY (cannot run inside a transaction).
--
-- Rollback: supabase/rollbacks/20261104010000_rls_visible_task_ids.down.sql

CREATE OR REPLACE FUNCTION public.visible_task_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO public, pg_temp
AS $function$
  -- Exactly the conditions of public.can_see_task(), for every task at once. SECURITY DEFINER like can_see_task,
  -- so it reads tasks / task_reviewers without their RLS (no recursion through the tasks policy). The caller is
  -- resolved once per statement (scalar subqueries become InitPlans).
  SELECT t.id FROM public.tasks t
  WHERE t.assigned_to = (SELECT public.req_uid())
     OR t.created_by  = (SELECT public.req_uid())
     OR t.reviewer    = (SELECT public.req_uid())
     OR EXISTS (SELECT 1 FROM public.task_reviewers r WHERE r.task_id = t.id AND r.reviewer_id = (SELECT public.req_uid()))
     OR (SELECT public.is_manager_or_admin(public.req_uid()));
$function$;

CREATE INDEX IF NOT EXISTS idx_tasks_created_by ON public.tasks (created_by);

ALTER POLICY "attach_read_scoped" ON public."attachments"
  USING ((( SELECT is_manager_or_admin(req_uid()) AS is_manager_or_admin) OR (work_item_id IN ( SELECT visible_task_ids() AS visible_task_ids))));

ALTER POLICY "cfe_read_scoped" ON public."carry_forward_events"
  USING ((( SELECT is_manager_or_admin(req_uid()) AS is_manager_or_admin) OR (task_id IN ( SELECT visible_task_ids() AS visible_task_ids))));

ALTER POLICY "comments_read_scoped" ON public."comments"
  USING ((( SELECT is_manager_or_admin(req_uid()) AS is_manager_or_admin) OR (work_item_id IN ( SELECT visible_task_ids() AS visible_task_ids))));

ALTER POLICY "risk_read_scoped" ON public."risk_events"
  USING ((( SELECT is_manager_or_admin(req_uid()) AS is_manager_or_admin) OR ((entity_type = 'task'::text) AND (entity_id IN ( SELECT visible_task_ids() AS visible_task_ids)))));

ALTER POLICY "history_read_scoped" ON public."task_history"
  USING ((( SELECT is_manager_or_admin(req_uid()) AS is_manager_or_admin) OR (task_id IN ( SELECT visible_task_ids() AS visible_task_ids))));

ALTER POLICY "task_review_decisions_read_scoped" ON public."task_review_decisions"
  USING ((( SELECT is_manager_or_admin(req_uid()) AS is_manager_or_admin) OR (reviewer_id = ( SELECT req_uid() AS req_uid)) OR (task_id IN ( SELECT visible_task_ids() AS visible_task_ids))));

ALTER POLICY "task_reviewers_read_scoped" ON public."task_reviewers"
  USING (((reviewer_id = ( SELECT req_uid() AS req_uid)) OR ( SELECT is_manager_or_admin(req_uid()) AS is_manager_or_admin) OR (task_id IN ( SELECT visible_task_ids() AS visible_task_ids))));

ALTER POLICY "task_reviews_read_scoped" ON public."task_reviews"
  USING ((( SELECT is_manager_or_admin(req_uid()) AS is_manager_or_admin) OR (task_id IN ( SELECT visible_task_ids() AS visible_task_ids))));

ALTER POLICY "worklogs_read_scoped" ON public."task_worklogs"
  USING (((user_id = ( SELECT req_uid() AS req_uid)) OR ( SELECT is_manager_or_admin(req_uid()) AS is_manager_or_admin) OR (task_id IN ( SELECT visible_task_ids() AS visible_task_ids))));

NOTIFY pgrst, 'reload schema';
