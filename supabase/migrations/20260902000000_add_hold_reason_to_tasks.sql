-- Add hold_reason column to tasks table for tracking why a task was put On Hold
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS hold_reason TEXT;
