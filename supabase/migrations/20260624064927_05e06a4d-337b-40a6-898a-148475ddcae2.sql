
-- Per-task end-of-day submission, reviewable by managers.
CREATE TABLE public.task_eod_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  submission_date date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  progress_status text NOT NULL CHECK (progress_status IN ('done','in_progress','blocked')),
  actual_hours numeric(5,2) NOT NULL DEFAULT 0 CHECK (actual_hours >= 0 AND actual_hours <= 24),
  note text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  UNIQUE (task_id, user_id, submission_date)
);

CREATE INDEX idx_task_eod_user_date ON public.task_eod_submissions (user_id, submission_date DESC);
CREATE INDEX idx_task_eod_date ON public.task_eod_submissions (submission_date DESC);
CREATE INDEX idx_task_eod_task ON public.task_eod_submissions (task_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_eod_submissions TO authenticated;
GRANT ALL ON public.task_eod_submissions TO service_role;

ALTER TABLE public.task_eod_submissions ENABLE ROW LEVEL SECURITY;

-- Submitter can read their own EOD entries.
CREATE POLICY "users read own eod"
  ON public.task_eod_submissions FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Managers / admins can read all entries.
CREATE POLICY "managers read all eod"
  ON public.task_eod_submissions FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'manager') OR public.has_role(auth.uid(), 'admin'));

-- Submitter can insert their own row (for today only).
CREATE POLICY "users insert own eod today"
  ON public.task_eod_submissions FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND submission_date = (now() AT TIME ZONE 'UTC')::date
  );

-- Submitter can edit their own row until the next UTC day rolls over.
CREATE POLICY "users update own eod today"
  ON public.task_eod_submissions FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND submission_date = (now() AT TIME ZONE 'UTC')::date)
  WITH CHECK (user_id = auth.uid() AND submission_date = (now() AT TIME ZONE 'UTC')::date);

-- Managers can update acknowledged_* on any row.
CREATE POLICY "managers acknowledge eod"
  ON public.task_eod_submissions FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'manager') OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'manager') OR public.has_role(auth.uid(), 'admin'));

-- Touch updated_at on edits.
CREATE OR REPLACE FUNCTION public.touch_task_eod_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_task_eod_touch_updated_at
  BEFORE UPDATE ON public.task_eod_submissions
  FOR EACH ROW EXECUTE FUNCTION public.touch_task_eod_updated_at();
