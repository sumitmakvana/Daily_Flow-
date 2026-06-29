
-- =========================================================
-- P1. APPROVAL SECURITY — enforce allow_self
-- =========================================================
CREATE OR REPLACE FUNCTION public.is_request_approver(_request_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.approval_requests r
      JOIN public.approval_steps s ON s.chain_id = r.chain_id
      LEFT JOIN public.tasks t ON t.id = r.work_item_id
     WHERE r.id = _request_id
       -- self-approval guard: blocks requester unless the step explicitly allows it
       AND (s.allow_self = true OR r.requested_by IS DISTINCT FROM _user_id)
       AND (
         (s.approver_mode = 'user' AND s.approver_user_id = _user_id)
      OR (s.approver_mode = 'role' AND s.approver_role_key IS NOT NULL
          AND public.has_org_role(_user_id, s.approver_role_key))
      OR (s.approver_mode = 'role' AND s.approver_role_key IS NULL
          AND s.approver_role IS NOT NULL
          AND public.has_role(_user_id, s.approver_role))
      OR (s.approver_mode = 'reviewer_field' AND t.reviewer = _user_id)
       )
  );
$$;

-- =========================================================
-- P2. SYSTEM ROLE PROTECTION
-- =========================================================
-- Mark the three built-ins as system roles if they exist
UPDATE public.org_roles SET is_system = true
 WHERE key IN ('admin','manager','member');

CREATE OR REPLACE FUNCTION public.protect_system_org_roles()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.is_system THEN
    RAISE EXCEPTION 'System role "%" cannot be deleted', OLD.key
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.is_system THEN
    IF NEW.key IS DISTINCT FROM OLD.key THEN
      RAISE EXCEPTION 'System role "%" cannot be renamed', OLD.key
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.is_active = false AND OLD.is_active = true THEN
      RAISE EXCEPTION 'System role "%" cannot be deactivated', OLD.key
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.is_system = false THEN
      RAISE EXCEPTION 'System flag on role "%" cannot be cleared', OLD.key
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_protect_system_org_roles ON public.org_roles;
CREATE TRIGGER trg_protect_system_org_roles
BEFORE UPDATE OR DELETE ON public.org_roles
FOR EACH ROW EXECUTE FUNCTION public.protect_system_org_roles();

-- =========================================================
-- P4. HOT PATH INDEXES
-- =========================================================
-- Today / planning: assignee + due_date with status filter already covered by
--   tasks_assigned_status_idx (assigned_to, status, due_date). Add reviewer queue
--   and a partial index for open tasks (planning/risk hot scans).
CREATE INDEX IF NOT EXISTS idx_tasks_reviewer_status
  ON public.tasks (reviewer, status) WHERE reviewer IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_open_due
  ON public.tasks (due_date, priority)
  WHERE status <> 'Completed';

CREATE INDEX IF NOT EXISTS idx_tasks_updated_at
  ON public.tasks (updated_at DESC);

-- Notifications: recent feed and retention scan
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON public.notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_created_read
  ON public.notifications (created_at) WHERE read_at IS NOT NULL;

-- Risk events: retention scan by resolved_at
CREATE INDEX IF NOT EXISTS idx_risk_events_resolved
  ON public.risk_events (resolved_at) WHERE resolved_at IS NOT NULL;

-- Snapshots & audit retention
CREATE INDEX IF NOT EXISTS idx_config_snapshots_created
  ON public.config_snapshots (created_at);

CREATE INDEX IF NOT EXISTS idx_audit_exports_created
  ON public.audit_exports (created_at);

CREATE INDEX IF NOT EXISTS idx_task_history_created
  ON public.task_history (created_at);

-- =========================================================
-- P5. RETENTION FUNCTIONS (admin-callable; safe to cron)
-- =========================================================
CREATE OR REPLACE FUNCTION public.purge_old_notifications(_days int DEFAULT 90)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE n int;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') AND auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'admin required'; END IF;
  DELETE FROM public.notifications
   WHERE created_at < now() - (_days || ' days')::interval
     AND read_at IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.purge_old_risk_events(_days int DEFAULT 180)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE n int;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') AND auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'admin required'; END IF;
  DELETE FROM public.risk_events
   WHERE resolved_at IS NOT NULL
     AND resolved_at < now() - (_days || ' days')::interval;
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.purge_old_snapshots(_keep int DEFAULT 50)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE n int;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') AND auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'admin required'; END IF;
  WITH ranked AS (
    SELECT id, row_number() OVER (ORDER BY created_at DESC) AS rn
      FROM public.config_snapshots
  )
  DELETE FROM public.config_snapshots
   WHERE id IN (SELECT id FROM ranked WHERE rn > _keep);
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.purge_old_audit_exports(_days int DEFAULT 365)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE n int;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') AND auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'admin required'; END IF;
  DELETE FROM public.audit_exports
   WHERE created_at < now() - (_days || ' days')::interval;
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.purge_old_task_history(_days int DEFAULT 365)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE n int;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') AND auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'admin required'; END IF;
  DELETE FROM public.task_history
   WHERE created_at < now() - (_days || ' days')::interval;
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $$;
