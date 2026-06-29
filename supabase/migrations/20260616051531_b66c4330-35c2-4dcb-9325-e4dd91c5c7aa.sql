
CREATE TABLE public.attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  file_name text NOT NULL CHECK (length(file_name) BETWEEN 1 AND 255),
  file_size bigint NOT NULL CHECK (file_size >= 0 AND file_size <= 26214400), -- 25MB
  file_type text NOT NULL CHECK (length(file_type) BETWEEN 1 AND 127),
  storage_path text NOT NULL UNIQUE,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, DELETE ON public.attachments TO authenticated;
GRANT ALL ON public.attachments TO service_role;

ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;

-- Visibility mirrors tasks_read_all (all authenticated)
CREATE POLICY attach_read ON public.attachments
  FOR SELECT TO authenticated USING (true);

CREATE POLICY attach_insert ON public.attachments
  FOR INSERT TO authenticated
  WITH CHECK (uploaded_by = auth.uid());

CREATE POLICY attach_delete_own_or_mgr ON public.attachments
  FOR DELETE TO authenticated
  USING (uploaded_by = auth.uid() OR public.is_manager_or_admin(auth.uid()));

CREATE INDEX idx_attachments_work_item ON public.attachments(work_item_id, uploaded_at DESC);
