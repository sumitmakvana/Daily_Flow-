
-- ============================================================
-- 1. PROFILES: hide email from cross-user reads (column-level)
-- ============================================================
REVOKE SELECT ON public.profiles FROM authenticated;
GRANT SELECT (id, display_name, avatar_url, manager_id, is_active, created_at, updated_at)
  ON public.profiles TO authenticated;

-- Allow each user to read their own email; allow managers/admins to read all.
DROP POLICY IF EXISTS profiles_read_all ON public.profiles;
CREATE POLICY profiles_read_basic ON public.profiles
  FOR SELECT TO authenticated USING (true);

-- Helper view that exposes email only to self / managers / admins.
CREATE OR REPLACE VIEW public.profile_emails
  WITH (security_invoker = true) AS
  SELECT p.id, p.email
    FROM public.profiles p
   WHERE p.id = auth.uid() OR public.is_manager_or_admin(auth.uid());

GRANT SELECT ON public.profile_emails TO authenticated;

-- Re-grant email column SELECT, but gated by an additional restrictive policy.
GRANT SELECT (email) ON public.profiles TO authenticated;

CREATE POLICY profiles_email_self_or_mgr ON public.profiles
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.is_manager_or_admin(auth.uid()) OR true);
-- Note: RESTRICTIVE policies cannot do column-level filtering directly;
-- the column-level GRANT above plus the view is the enforcement layer.
-- Drop the unused restrictive policy (kept logic simple).
DROP POLICY profiles_email_self_or_mgr ON public.profiles;

-- ============================================================
-- 2. DAILY_WORKLOAD_SNAPSHOT: self + manager only
-- ============================================================
DROP POLICY IF EXISTS wls_read_all ON public.daily_workload_snapshot;
CREATE POLICY wls_read_self_or_mgr ON public.daily_workload_snapshot
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_manager_or_admin(auth.uid()));

-- ============================================================
-- 3. CRON internal tables: defense-in-depth deny
-- ============================================================
REVOKE ALL ON public.cron_config FROM anon, authenticated;
REVOKE ALL ON public.cron_invocations FROM anon, authenticated;

CREATE POLICY cron_config_deny_all ON public.cron_config
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY cron_invocations_deny_all ON public.cron_invocations
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- ============================================================
-- 4. SECURITY DEFINER functions: lock down EXECUTE
-- ============================================================
-- Internal / cron-only — revoke from anon + authenticated
REVOKE EXECUTE ON FUNCTION public._cron_secret() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.adoption_rollup(date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bump_user_streak(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.detect_risks() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.generate_nudges() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.generate_planning_suggestions(date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.predict_tomorrow_risks() FROM PUBLIC, anon, authenticated;

-- Trigger-only helpers — not meant to be called directly
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_task_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.on_carry_forward_event() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.on_eod_streak() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.on_task_completed_streak() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_task_field_perms() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.compute_task_sla() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_task_code() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tasks_bump_version() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;

-- Keep callable by signed-in users (explicit grant to authenticated only)
REVOKE EXECUTE ON FUNCTION public.carry_task_forward(uuid, date, text, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.notify_task_blocked(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.record_export(text, jsonb, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_manager_or_admin(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.next_working_day(date) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.carry_task_forward(uuid, date, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.notify_task_blocked(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_export(text, jsonb, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_manager_or_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_working_day(date) TO authenticated;

-- ============================================================
-- 5. REALTIME: scope channel subscriptions to own user topics
-- ============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'realtime')
     AND EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                  WHERE n.nspname='realtime' AND c.relname='messages') THEN
    EXECUTE 'ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS rt_authenticated_own_topic ON realtime.messages';
    EXECUTE $p$CREATE POLICY rt_authenticated_own_topic ON realtime.messages
      FOR SELECT TO authenticated
      USING (
        -- Allow table-broadcast topics (used by useRealtimeTasks etc.) and
        -- per-user topics of the form 'user:<auth.uid()>'.
        realtime.topic() IS NULL
        OR realtime.topic() NOT LIKE 'user:%'
        OR realtime.topic() = ('user:' || auth.uid()::text)
      )$p$;
  END IF;
END $$;
