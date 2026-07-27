-- Drop the old restricted tasks delete policy
DROP POLICY IF EXISTS "tasks_delete" ON public.tasks;

-- Create a new policy that allows managers/admins to delete any task, OR the user who created it, OR the assignee to delete it.
CREATE POLICY "tasks_delete" ON public.tasks 
  FOR DELETE TO authenticated
  USING (
    created_by = auth.uid()
    OR assigned_to = auth.uid()
    OR public.is_manager_or_admin(auth.uid())
  );
