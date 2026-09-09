-- Migration: 20260910000000_create_task_worklogs.sql
-- Create task_worklogs table for tracking daily system timer sessions and user logged hours

CREATE TABLE IF NOT EXISTS public.task_worklogs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    work_date DATE NOT NULL DEFAULT CURRENT_DATE,
    system_hours NUMERIC(6,2) DEFAULT 0,
    logged_hours NUMERIC(6,2) DEFAULT 0,
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexing for fast queries by task and date, and user and date
CREATE INDEX IF NOT EXISTS idx_task_worklogs_task_date ON public.task_worklogs(task_id, work_date);
CREATE INDEX IF NOT EXISTS idx_task_worklogs_user_date ON public.task_worklogs(user_id, work_date);

-- Enable RLS
ALTER TABLE public.task_worklogs ENABLE ROW LEVEL SECURITY;

-- Policies
DROP POLICY IF EXISTS "Authenticated users can select worklogs" ON public.task_worklogs;
CREATE POLICY "Authenticated users can select worklogs"
  ON public.task_worklogs FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Users can insert worklogs" ON public.task_worklogs;
CREATE POLICY "Users can insert worklogs"
  ON public.task_worklogs FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id OR EXISTS (
    SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('admin', 'manager')
  ));

DROP POLICY IF EXISTS "Users can update worklogs" ON public.task_worklogs;
CREATE POLICY "Users can update worklogs"
  ON public.task_worklogs FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id OR EXISTS (
    SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('admin', 'manager')
  ));

-- Grant table permissions to authenticated, service_role, and postgres
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_worklogs TO authenticated;
GRANT ALL ON public.task_worklogs TO service_role;
GRANT ALL ON public.task_worklogs TO postgres;
