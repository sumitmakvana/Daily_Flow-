
-- 1) Optimistic concurrency
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

-- 2) Trigger: bump version + maintain updated_at on every UPDATE
CREATE OR REPLACE FUNCTION public.tasks_bump_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.version := COALESCE(OLD.version, 0) + 1;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tasks_bump_version ON public.tasks;
CREATE TRIGGER trg_tasks_bump_version
BEFORE UPDATE ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.tasks_bump_version();

-- 3) Trigger: enforce per-role field permissions for INSERT/UPDATE
CREATE OR REPLACE FUNCTION public.enforce_task_field_perms()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  is_mgr boolean := public.is_manager_or_admin(auth.uid());
BEGIN
  IF uid IS NULL THEN
    RETURN NEW; -- service-role / migrations
  END IF;
  IF is_mgr THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.assigned_to IS NOT NULL AND NEW.assigned_to <> uid THEN
      RAISE EXCEPTION 'Only managers can assign tasks to other members';
    END IF;
    IF NEW.reviewer IS NOT NULL AND NEW.reviewer <> uid THEN
      RAISE EXCEPTION 'Only managers can set a reviewer';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: members can only update tasks assigned to them, and only certain fields
  IF OLD.assigned_to IS DISTINCT FROM uid THEN
    RAISE EXCEPTION 'You can only update tasks assigned to you';
  END IF;
  IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
    RAISE EXCEPTION 'Only managers can reassign tasks';
  END IF;
  IF NEW.priority IS DISTINCT FROM OLD.priority THEN
    RAISE EXCEPTION 'Only managers can change priority';
  END IF;
  IF NEW.due_date IS DISTINCT FROM OLD.due_date THEN
    RAISE EXCEPTION 'Only managers can change due date';
  END IF;
  IF NEW.reviewer IS DISTINCT FROM OLD.reviewer THEN
    RAISE EXCEPTION 'Only managers can change reviewer';
  END IF;
  IF NEW.task_code IS DISTINCT FROM OLD.task_code THEN
    RAISE EXCEPTION 'Task code is immutable';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_task_field_perms ON public.tasks;
CREATE TRIGGER trg_enforce_task_field_perms
BEFORE INSERT OR UPDATE ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.enforce_task_field_perms();

-- 4) History audit trigger (tamper-resistant; SECURITY DEFINER bypasses RLS)
CREATE OR REPLACE FUNCTION public.log_task_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := COALESCE(NEW.updated_by, auth.uid());
  parts text[] := ARRAY[]::text[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.task_history(task_id, old_status, new_status, updated_by, comment)
    VALUES (NEW.id, NULL, NEW.status, actor, 'created');
    RETURN NEW;
  END IF;

  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.task_history(task_id, old_status, new_status, updated_by, comment)
    VALUES (NEW.id, OLD.status, NEW.status, actor, NULL);
  END IF;

  IF OLD.assigned_to IS DISTINCT FROM NEW.assigned_to THEN
    parts := parts || format('assignee → %s', COALESCE(NEW.assigned_to::text, 'unassigned'));
  END IF;
  IF OLD.priority IS DISTINCT FROM NEW.priority THEN
    parts := parts || format('priority %s → %s', OLD.priority, NEW.priority);
  END IF;
  IF OLD.due_date IS DISTINCT FROM NEW.due_date THEN
    parts := parts || format('due %s → %s', COALESCE(OLD.due_date::text,'—'), COALESCE(NEW.due_date::text,'—'));
  END IF;
  IF OLD.reviewer IS DISTINCT FROM NEW.reviewer THEN
    parts := parts || 'reviewer changed';
  END IF;
  IF array_length(parts,1) IS NOT NULL THEN
    INSERT INTO public.task_history(task_id, old_status, new_status, updated_by, comment)
    VALUES (NEW.id, OLD.status, NEW.status, actor, array_to_string(parts, '; '));
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_task_change ON public.tasks;
CREATE TRIGGER trg_log_task_change
AFTER INSERT OR UPDATE ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.log_task_change();

-- 5) Tighten task_history INSERT policy — only user comments, no status forging
DROP POLICY IF EXISTS history_insert ON public.task_history;
CREATE POLICY history_insert_comment_only ON public.task_history
FOR INSERT TO authenticated
WITH CHECK (
  updated_by = auth.uid()
  AND comment IS NOT NULL
  AND old_status IS NOT DISTINCT FROM new_status
);

-- 6) Tasks RLS — managers can insert anything; members only self-created (trigger handles columns)
DROP POLICY IF EXISTS tasks_insert ON public.tasks;
CREATE POLICY tasks_insert ON public.tasks
FOR INSERT TO authenticated
WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS tasks_update ON public.tasks;
CREATE POLICY tasks_update ON public.tasks
FOR UPDATE TO authenticated
USING (assigned_to = auth.uid() OR public.is_manager_or_admin(auth.uid()));

-- 7) Realtime
ALTER TABLE public.tasks REPLICA IDENTITY FULL;
ALTER TABLE public.task_history REPLICA IDENTITY FULL;
ALTER TABLE public.notifications REPLICA IDENTITY FULL;

DO $$ BEGIN
  PERFORM 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='tasks';
  IF NOT FOUND THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks';
  END IF;
  PERFORM 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='task_history';
  IF NOT FOUND THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.task_history';
  END IF;
  PERFORM 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='notifications';
  IF NOT FOUND THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications';
  END IF;
END $$;

-- 8) Helpful index for blocker aging queries
CREATE INDEX IF NOT EXISTS idx_tasks_blocked_at ON public.tasks(blocked_at) WHERE status = 'Blocked';
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON public.tasks(assigned_to);
