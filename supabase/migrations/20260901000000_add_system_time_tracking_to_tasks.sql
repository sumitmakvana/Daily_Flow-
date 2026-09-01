-- Add started_at and system_hours columns to public.tasks for automated time tracking vs user logged hours
ALTER TABLE public.tasks 
ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS system_hours NUMERIC(6,2) DEFAULT 0;
