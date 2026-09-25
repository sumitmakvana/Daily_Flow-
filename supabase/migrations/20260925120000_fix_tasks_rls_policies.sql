-- Fix RLS policies and field permissions for public.tasks table
-- 1. Fix tasks_insert policy: allow task creation if created_by matches user or user is manager/admin.
-- 2. Fix tasks_update policy: allow task update if user is creator, assignee, or manager/admin,
--    and specify WITH CHECK (true) so modifying task fields (e.g. reassignment, status updates) does not fail post-check.
-- 3. Update enforce_task_field_perms function: allow members to transfer/reassign tasks they created or are assigned to.

DROP POLICY IF EXISTS "tasks_insert" ON public.tasks;
DROP POLICY IF EXISTS tasks_insert ON public.tasks;
CREATE POLICY "tasks_insert" ON public.tasks
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    OR public.is_manager_or_admin(auth.uid())
  );

DROP POLICY IF EXISTS "tasks_update" ON public.tasks;
DROP POLICY IF EXISTS tasks_update ON public.tasks;
CREATE POLICY "tasks_update" ON public.tasks
  FOR UPDATE TO authenticated
  USING (
    created_by = auth.uid()
    OR assigned_to = auth.uid()
    OR public.is_manager_or_admin(auth.uid())
  )
  WITH CHECK (
    true
  );

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
