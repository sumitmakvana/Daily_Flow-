-- Managers/admins can soft-delete any comment (the UI already offers it), but
-- the only UPDATE policy was owner-only, so the delete silently did nothing.
-- The WITH CHECK pins the new row to the soft-delete shape so this cannot be
-- used to rewrite another user's comment.
DROP POLICY IF EXISTS comments_soft_delete_mgr ON public.comments;
CREATE POLICY comments_soft_delete_mgr ON public.comments FOR UPDATE TO authenticated
  USING (public.is_manager_or_admin(auth.uid()) AND deleted_at IS NULL)
  WITH CHECK (public.is_manager_or_admin(auth.uid()) AND deleted_at IS NOT NULL AND body = '[deleted]');
