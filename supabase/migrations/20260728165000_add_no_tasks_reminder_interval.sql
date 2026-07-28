ALTER TABLE public.work_settings 
ADD COLUMN IF NOT EXISTS no_tasks_reminder_interval INT DEFAULT 20;
