
-- Lock down new mention function
REVOKE EXECUTE ON FUNCTION public.on_comment_mention() FROM PUBLIC, anon, authenticated;

-- Storage policies for work-item-files (private bucket)
CREATE POLICY "wif_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'work-item-files');

CREATE POLICY "wif_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'work-item-files' AND owner = auth.uid());

CREATE POLICY "wif_delete_own_or_mgr" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'work-item-files' AND (owner = auth.uid() OR public.is_manager_or_admin(auth.uid())));
