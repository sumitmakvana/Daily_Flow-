-- RLS: evaluate the current user's id and role checks once per statement instead of once per row.
--
-- Policies called auth.uid() / req_uid() / has_role(<current user>, '<role>') / is_manager_or_admin(<current user>)
-- directly, so Postgres ran them for EVERY row a query touched (has_role / is_manager_or_admin are SET search_path
-- SQL functions, which are never inlined). A 21-page probe read user_roles 9,793 times (147,514 rows, 79% of all rows
-- read) for a 24-row table. Wrapping each call in ( SELECT ... ) turns it into an InitPlan: computed once per
-- statement, same value, same result. Row-dependent calls (can_see_task(task_id), is_request_approver(id, ...)) are
-- unchanged apart from their auth.uid() argument.
--
-- Only the expressions change: ALTER POLICY keeps each policy's command, roles and permissive/restrictive type.
-- Rollback: supabase/rollbacks/20261104000000_rls_initplan_role_checks.down.sql
-- Generated from pg_policies; 91 of 120 public policies.

ALTER POLICY "ad_read_self_or_mgr" ON public."adoption_daily"
  USING (((user_id = ( SELECT auth.uid())) OR ( SELECT is_manager_or_admin(auth.uid()))));

ALTER POLICY "announcements_admin_policy" ON public."announcements"
  USING (( SELECT has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK (( SELECT has_role(auth.uid(), 'admin'::app_role)));

ALTER POLICY "ac_admin" ON public."approval_chains"
  USING (( SELECT has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK (( SELECT has_role(auth.uid(), 'admin'::app_role)));

ALTER POLICY "ad_insert" ON public."approval_decisions"
  WITH CHECK (((approver_id = ( SELECT auth.uid())) AND (EXISTS ( SELECT 1
   FROM approval_requests r
  WHERE ((r.id = approval_decisions.request_id) AND (r.status = 'pending'::text) AND (r.current_step = approval_decisions.step_order) AND is_request_approver(r.id, ( SELECT auth.uid())))))));

ALTER POLICY "ad_read" ON public."approval_decisions"
  USING ((( SELECT has_role(auth.uid(), 'admin'::app_role)) OR (EXISTS ( SELECT 1
   FROM approval_requests r
  WHERE ((r.id = approval_decisions.request_id) AND ((r.requested_by = ( SELECT auth.uid())) OR is_request_approver(r.id, ( SELECT auth.uid()))))))));

ALTER POLICY "managers view approval outbox" ON public."approval_outbox_events"
  USING (( SELECT is_manager_or_admin(auth.uid())));

ALTER POLICY "ar_insert" ON public."approval_requests"
  WITH CHECK (((requested_by = ( SELECT auth.uid())) OR ( SELECT has_role(auth.uid(), 'admin'::app_role))));

ALTER POLICY "ar_read" ON public."approval_requests"
  USING (((requested_by = ( SELECT auth.uid())) OR ( SELECT has_role(auth.uid(), 'admin'::app_role)) OR is_request_approver(id, ( SELECT auth.uid()))));

ALTER POLICY "ar_update_admin" ON public."approval_requests"
  USING (( SELECT has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK (( SELECT has_role(auth.uid(), 'admin'::app_role)));

ALTER POLICY "as_admin" ON public."approval_steps"
  USING (( SELECT has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK (( SELECT has_role(auth.uid(), 'admin'::app_role)));

ALTER POLICY "attach_delete_own_or_mgr" ON public."attachments"
  USING (((uploaded_by = ( SELECT auth.uid())) OR ( SELECT is_manager_or_admin(auth.uid()))));

ALTER POLICY "attach_insert" ON public."attachments"
  WITH CHECK ((uploaded_by = ( SELECT auth.uid())));

ALTER POLICY "attach_read_scoped" ON public."attachments"
  USING ((( SELECT is_manager_or_admin(req_uid())) OR can_see_task(work_item_id)));

ALTER POLICY "ae_read_mgr" ON public."audit_exports"
  USING (( SELECT is_manager_or_admin(auth.uid())));

ALTER POLICY "ae_write_mgr" ON public."audit_exports"
  WITH CHECK ((( SELECT is_manager_or_admin(auth.uid())) AND (user_id = ( SELECT auth.uid()))));

ALTER POLICY "audit_insert" ON public."audit_log"
  WITH CHECK (((actor_id = ( SELECT auth.uid())) OR ( SELECT has_role(auth.uid(), 'admin'::app_role))));

ALTER POLICY "audit_read" ON public."audit_log"
  USING ((( SELECT has_role(auth.uid(), 'admin'::app_role)) OR ((entity_type = 'task'::text) AND (EXISTS ( SELECT 1
   FROM tasks t
  WHERE (t.id = audit_log.entity_id))))));

ALTER POLICY "managers view automation action log" ON public."automation_action_log"
  USING (( SELECT is_manager_or_admin(auth.uid())));

ALTER POLICY "managers view automation events" ON public."automation_events"
  USING (( SELECT is_manager_or_admin(auth.uid())));

ALTER POLICY "admins manage automation rules" ON public."automation_rules"
  USING (( SELECT has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK (( SELECT has_role(auth.uid(), 'admin'::app_role)));

ALTER POLICY "admins replay automation runs" ON public."automation_runs"
  USING (( SELECT has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK (( SELECT has_role(auth.uid(), 'admin'::app_role)));

ALTER POLICY "managers view automation runs" ON public."automation_runs"
  USING (( SELECT is_manager_or_admin(auth.uid())));

ALTER POLICY "cfe_insert_self_or_mgr" ON public."carry_forward_events"
  WITH CHECK ((( SELECT is_manager_or_admin(auth.uid())) OR (EXISTS ( SELECT 1
   FROM tasks t
  WHERE ((t.id = carry_forward_events.task_id) AND (t.assigned_to = ( SELECT auth.uid())))))));

ALTER POLICY "cfe_read_scoped" ON public."carry_forward_events"
  USING ((( SELECT is_manager_or_admin(req_uid())) OR can_see_task(task_id)));

ALTER POLICY "cm_delete" ON public."comment_mentions"
  USING (((EXISTS ( SELECT 1
   FROM comments c
  WHERE ((c.id = comment_mentions.comment_id) AND (c.user_id = ( SELECT auth.uid()))))) OR ( SELECT is_manager_or_admin(auth.uid()))));

ALTER POLICY "cm_insert" ON public."comment_mentions"
  WITH CHECK ((EXISTS ( SELECT 1
   FROM comments c
  WHERE ((c.id = comment_mentions.comment_id) AND (c.user_id = ( SELECT auth.uid()))))));

ALTER POLICY "comments_delete_own_or_mgr" ON public."comments"
  USING (((user_id = ( SELECT auth.uid())) OR ( SELECT is_manager_or_admin(auth.uid()))));

ALTER POLICY "comments_insert" ON public."comments"
  WITH CHECK ((user_id = ( SELECT auth.uid())));

ALTER POLICY "comments_read_scoped" ON public."comments"
  USING ((( SELECT is_manager_or_admin(req_uid())) OR can_see_task(work_item_id)));

ALTER POLICY "comments_update_own" ON public."comments"
  USING (((user_id = ( SELECT auth.uid())) AND (deleted_at IS NULL)))
  WITH CHECK ((user_id = ( SELECT auth.uid())));

ALTER POLICY "cs_admin_delete" ON public."config_snapshots"
  USING (( SELECT has_role(auth.uid(), 'admin'::app_role)));

ALTER POLICY "cs_admin_read" ON public."config_snapshots"
  USING (( SELECT has_role(auth.uid(), 'admin'::app_role)));

ALTER POLICY "cs_admin_write" ON public."config_snapshots"
  WITH CHECK (( SELECT has_role(auth.uid(), 'admin'::app_role)));

ALTER POLICY "wls_read_self_or_mgr" ON public."daily_workload_snapshot"
  USING (((user_id = ( SELECT auth.uid())) OR ( SELECT is_manager_or_admin(auth.uid()))));

ALTER POLICY "wls_update_mgr" ON public."daily_workload_snapshot"
  USING (( SELECT is_manager_or_admin(auth.uid())));

ALTER POLICY "wls_write_mgr" ON public."daily_workload_snapshot"
  WITH CHECK (( SELECT is_manager_or_admin(auth.uid())));

ALTER POLICY "Users manage own device tokens" ON public."device_tokens"
  USING ((( SELECT auth.uid()) = user_id))
  WITH CHECK ((( SELECT auth.uid()) = user_id));

ALTER POLICY "eod_insert_self" ON public."eod_checkins"
  WITH CHECK ((user_id = ( SELECT auth.uid())));

ALTER POLICY "eod_read_self_or_mgr" ON public."eod_checkins"
  USING (((user_id = ( SELECT auth.uid())) OR ( SELECT is_manager_or_admin(auth.uid()))));

ALTER POLICY "eod_update_self" ON public."eod_checkins"
  USING ((user_id = ( SELECT auth.uid())))
  WITH CHECK ((user_id = ( SELECT auth.uid())));

ALTER POLICY "hc_write_mgr" ON public."holiday_calendar"
  USING (( SELECT is_manager_or_admin(auth.uid())))
  WITH CHECK (( SELECT is_manager_or_admin(auth.uid())));

ALTER POLICY "it_admin" ON public."industry_templates"
  USING (( SELECT has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK (( SELECT has_role(auth.uid(), 'admin'::app_role)));

ALTER POLICY "Users manage own notebook notes" ON public."notebook_notes"
  USING ((( SELECT auth.uid()) = user_id))
  WITH CHECK ((( SELECT auth.uid()) = user_id));

ALTER POLICY "Users manage own notebook seed flag" ON public."notebook_seeded"
  USING ((( SELECT auth.uid()) = user_id))
  WITH CHECK ((( SELECT auth.uid()) = user_id));

ALTER POLICY "np_read_self" ON public."notification_prefs"
  USING (((user_id = ( SELECT auth.uid())) OR ( SELECT is_manager_or_admin(auth.uid()))));

ALTER POLICY "np_update_self" ON public."notification_prefs"
  USING ((user_id = ( SELECT auth.uid())))
  WITH CHECK ((user_id = ( SELECT auth.uid())));

ALTER POLICY "np_upsert_self" ON public."notification_prefs"
  WITH CHECK ((user_id = ( SELECT auth.uid())));

ALTER POLICY "notifications_insert_self_or_manager" ON public."notifications"
  WITH CHECK (((user_id = ( SELECT auth.uid())) OR ( SELECT is_manager_or_admin(auth.uid()))));

ALTER POLICY "notifications_read_own" ON public."notifications"
  USING ((user_id = ( SELECT auth.uid())));

ALTER POLICY "notifications_update_own" ON public."notifications"
  USING ((user_id = ( SELECT auth.uid())));

ALTER POLICY "nudges_read_self_or_mgr" ON public."nudges"
  USING (((user_id = ( SELECT auth.uid())) OR ( SELECT is_manager_or_admin(auth.uid()))));

ALTER POLICY "nudges_update_self" ON public."nudges"
  USING ((user_id = ( SELECT auth.uid())))
  WITH CHECK ((user_id = ( SELECT auth.uid())));

ALTER POLICY "ops_failures_admin_read" ON public."operations_failures"
  USING (( SELECT is_manager_or_admin(auth.uid())));

ALTER POLICY "orh_admin_write" ON public."org_role_hierarchy"
  USING (( SELECT has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK (( SELECT has_role(auth.uid(), 'admin'::app_role)));

ALTER POLICY "org_roles_admin_write" ON public."org_roles"
  USING (( SELECT has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK (( SELECT has_role(auth.uid(), 'admin'::app_role)));

ALTER POLICY "ps_update_mgr" ON public."planning_suggestions"
  USING (( SELECT is_manager_or_admin(auth.uid())))
  WITH CHECK (( SELECT is_manager_or_admin(auth.uid())));

ALTER POLICY "ps_write_mgr" ON public."planning_suggestions"
  WITH CHECK (( SELECT is_manager_or_admin(auth.uid())));

ALTER POLICY "profiles_update_self_or_admin" ON public."profiles"
  USING (((( SELECT auth.uid()) = id) OR ( SELECT has_role(auth.uid(), 'admin'::app_role))))
  WITH CHECK (((( SELECT auth.uid()) = id) OR ( SELECT has_role(auth.uid(), 'admin'::app_role))));

ALTER POLICY "projects_write_mgr" ON public."projects"
  USING (( SELECT is_manager_or_admin(auth.uid())))
  WITH CHECK (( SELECT is_manager_or_admin(auth.uid())));

ALTER POLICY "risk_read_scoped" ON public."risk_events"
  USING ((( SELECT is_manager_or_admin(req_uid())) OR ((entity_type = 'task'::text) AND can_see_task(entity_id))));

ALTER POLICY "risk_update_mgr" ON public."risk_events"
  USING (( SELECT is_manager_or_admin(auth.uid())))
  WITH CHECK (( SELECT is_manager_or_admin(auth.uid())));

ALTER POLICY "risk_write_mgr" ON public."risk_events"
  WITH CHECK (( SELECT is_manager_or_admin(auth.uid())));

ALTER POLICY "rrc_write_mgr" ON public."risk_rules_config"
  USING (( SELECT is_manager_or_admin(auth.uid())))
  WITH CHECK (( SELECT is_manager_or_admin(auth.uid())));

ALTER POLICY "managers acknowledge eod" ON public."task_eod_submissions"
  USING ((( SELECT has_role(auth.uid(), 'manager'::app_role)) OR ( SELECT has_role(auth.uid(), 'admin'::app_role))))
  WITH CHECK ((( SELECT has_role(auth.uid(), 'manager'::app_role)) OR ( SELECT has_role(auth.uid(), 'admin'::app_role))));

ALTER POLICY "managers read all eod" ON public."task_eod_submissions"
  USING ((( SELECT has_role(auth.uid(), 'manager'::app_role)) OR ( SELECT has_role(auth.uid(), 'admin'::app_role))));

ALTER POLICY "users insert own eod today" ON public."task_eod_submissions"
  WITH CHECK (((user_id = ( SELECT auth.uid())) AND (submission_date = ((now() AT TIME ZONE 'UTC'::text))::date)));

ALTER POLICY "users read own eod" ON public."task_eod_submissions"
  USING ((user_id = ( SELECT auth.uid())));

ALTER POLICY "users update own eod today" ON public."task_eod_submissions"
  USING (((user_id = ( SELECT auth.uid())) AND (submission_date = ((now() AT TIME ZONE 'UTC'::text))::date)))
  WITH CHECK (((user_id = ( SELECT auth.uid())) AND (submission_date = ((now() AT TIME ZONE 'UTC'::text))::date)));

ALTER POLICY "history_insert_comment_only" ON public."task_history"
  WITH CHECK (((updated_by = ( SELECT auth.uid())) AND (comment IS NOT NULL) AND (NOT (old_status IS DISTINCT FROM new_status))));

ALTER POLICY "history_read_scoped" ON public."task_history"
  USING ((( SELECT is_manager_or_admin(req_uid())) OR can_see_task(task_id)));

ALTER POLICY "task_review_decisions_read_scoped" ON public."task_review_decisions"
  USING ((( SELECT is_manager_or_admin(req_uid())) OR (reviewer_id = ( SELECT req_uid())) OR can_see_task(task_id)));

ALTER POLICY "task_reviewers_read_scoped" ON public."task_reviewers"
  USING (((reviewer_id = ( SELECT req_uid())) OR ( SELECT is_manager_or_admin(req_uid())) OR can_see_task(task_id)));

ALTER POLICY "task_reviews_read_scoped" ON public."task_reviews"
  USING ((( SELECT is_manager_or_admin(req_uid())) OR can_see_task(task_id)));

ALTER POLICY "Users can insert worklogs" ON public."task_worklogs"
  WITH CHECK (((( SELECT auth.uid()) = user_id) OR (EXISTS ( SELECT 1
   FROM user_roles ur
  WHERE ((ur.user_id = ( SELECT auth.uid())) AND (ur.role = ANY (ARRAY['admin'::app_role, 'manager'::app_role])))))));

ALTER POLICY "Users can update worklogs" ON public."task_worklogs"
  USING (((( SELECT auth.uid()) = user_id) OR (EXISTS ( SELECT 1
   FROM user_roles ur
  WHERE ((ur.user_id = ( SELECT auth.uid())) AND (ur.role = ANY (ARRAY['admin'::app_role, 'manager'::app_role])))))));

ALTER POLICY "worklogs_read_scoped" ON public."task_worklogs"
  USING (((user_id = ( SELECT req_uid())) OR ( SELECT is_manager_or_admin(req_uid())) OR can_see_task(task_id)));

ALTER POLICY "tasks_delete" ON public."tasks"
  USING (((created_by = ( SELECT auth.uid())) OR (assigned_to = ( SELECT auth.uid())) OR ( SELECT is_manager_or_admin(auth.uid()))));

ALTER POLICY "tasks_insert" ON public."tasks"
  WITH CHECK (((created_by = ( SELECT auth.uid())) OR ( SELECT is_manager_or_admin(auth.uid()))));

ALTER POLICY "tasks_read_scoped" ON public."tasks"
  USING (((assigned_to = ( SELECT req_uid())) OR (created_by = ( SELECT req_uid())) OR (reviewer = ( SELECT req_uid())) OR (EXISTS ( SELECT 1
   FROM task_reviewers r
  WHERE ((r.task_id = tasks.id) AND (r.reviewer_id = ( SELECT req_uid()))))) OR ( SELECT is_manager_or_admin(req_uid()))));

ALTER POLICY "tasks_update" ON public."tasks"
  USING (((created_by = ( SELECT auth.uid())) OR (assigned_to = ( SELECT auth.uid())) OR ( SELECT is_manager_or_admin(auth.uid()))))
  WITH CHECK (true);

ALTER POLICY "teams_write_mgr" ON public."teams"
  USING (( SELECT is_manager_or_admin(auth.uid())))
  WITH CHECK (( SELECT is_manager_or_admin(auth.uid())));

ALTER POLICY "tc_admin" ON public."template_components"
  USING (( SELECT has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK (( SELECT has_role(auth.uid(), 'admin'::app_role)));

ALTER POLICY "tob_admin_write" ON public."tenant_onboarding"
  USING (( SELECT has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK (( SELECT has_role(auth.uid(), 'admin'::app_role)));

ALTER POLICY "uor_admin_write" ON public."user_org_roles"
  USING (( SELECT has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK (( SELECT has_role(auth.uid(), 'admin'::app_role)));

ALTER POLICY "roles_admin_write" ON public."user_roles"
  USING (( SELECT has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK (( SELECT has_role(auth.uid(), 'admin'::app_role)));

ALTER POLICY "us_read_self_or_mgr" ON public."user_streaks"
  USING (((user_id = ( SELECT auth.uid())) OR ( SELECT is_manager_or_admin(auth.uid()))));

ALTER POLICY "wifd_admin" ON public."work_item_field_defs"
  USING (( SELECT has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK (( SELECT has_role(auth.uid(), 'admin'::app_role)));

ALTER POLICY "wis_admin_write" ON public."work_item_statuses"
  USING (( SELECT has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK (( SELECT has_role(auth.uid(), 'admin'::app_role)));

ALTER POLICY "wit_admin_write" ON public."work_item_transitions"
  USING (( SELECT has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK (( SELECT has_role(auth.uid(), 'admin'::app_role)));

ALTER POLICY "wit_admin_write" ON public."work_item_types"
  USING (( SELECT has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK (( SELECT has_role(auth.uid(), 'admin'::app_role)));

ALTER POLICY "ws_update_mgr" ON public."work_settings"
  USING (( SELECT is_manager_or_admin(auth.uid())))
  WITH CHECK (( SELECT is_manager_or_admin(auth.uid())));

NOTIFY pgrst, 'reload schema';
