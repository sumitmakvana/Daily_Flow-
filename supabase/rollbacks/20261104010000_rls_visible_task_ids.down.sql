-- Restores the 9 policies to can_see_task(<task id>) and removes visible_task_ids() and idx_tasks_created_by.

ALTER POLICY "attach_read_scoped" ON public."attachments"
  USING ((( SELECT is_manager_or_admin(req_uid()) AS is_manager_or_admin) OR can_see_task(work_item_id)));

ALTER POLICY "cfe_read_scoped" ON public."carry_forward_events"
  USING ((( SELECT is_manager_or_admin(req_uid()) AS is_manager_or_admin) OR can_see_task(task_id)));

ALTER POLICY "comments_read_scoped" ON public."comments"
  USING ((( SELECT is_manager_or_admin(req_uid()) AS is_manager_or_admin) OR can_see_task(work_item_id)));

ALTER POLICY "risk_read_scoped" ON public."risk_events"
  USING ((( SELECT is_manager_or_admin(req_uid()) AS is_manager_or_admin) OR ((entity_type = 'task'::text) AND can_see_task(entity_id))));

ALTER POLICY "history_read_scoped" ON public."task_history"
  USING ((( SELECT is_manager_or_admin(req_uid()) AS is_manager_or_admin) OR can_see_task(task_id)));

ALTER POLICY "task_review_decisions_read_scoped" ON public."task_review_decisions"
  USING ((( SELECT is_manager_or_admin(req_uid()) AS is_manager_or_admin) OR (reviewer_id = ( SELECT req_uid() AS req_uid)) OR can_see_task(task_id)));

ALTER POLICY "task_reviewers_read_scoped" ON public."task_reviewers"
  USING (((reviewer_id = ( SELECT req_uid() AS req_uid)) OR ( SELECT is_manager_or_admin(req_uid()) AS is_manager_or_admin) OR can_see_task(task_id)));

ALTER POLICY "task_reviews_read_scoped" ON public."task_reviews"
  USING ((( SELECT is_manager_or_admin(req_uid()) AS is_manager_or_admin) OR can_see_task(task_id)));

ALTER POLICY "worklogs_read_scoped" ON public."task_worklogs"
  USING (((user_id = ( SELECT req_uid() AS req_uid)) OR ( SELECT is_manager_or_admin(req_uid()) AS is_manager_or_admin) OR can_see_task(task_id)));

DROP INDEX IF EXISTS public.idx_tasks_created_by;
DROP FUNCTION IF EXISTS public.visible_task_ids();

NOTIFY pgrst, 'reload schema';
