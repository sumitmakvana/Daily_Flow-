
-- Fix search_path on set_task_code
CREATE OR REPLACE FUNCTION public.set_task_code()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.task_code IS NULL OR NEW.task_code = '' THEN
    NEW.task_code := 'T-' || LPAD(nextval('public.task_code_seq')::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

-- Revoke public execute on SECURITY DEFINER helpers (RLS evaluation still works)
REVOKE EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_manager_or_admin(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_task_code() FROM PUBLIC, anon, authenticated;

-- Tighten permissive insert policies
DROP POLICY IF EXISTS "tasks_insert" ON public.tasks;
CREATE POLICY "tasks_insert" ON public.tasks FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "notifications_insert_any" ON public.notifications;
CREATE POLICY "notifications_insert_self_or_manager" ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR public.is_manager_or_admin(auth.uid())
  );
