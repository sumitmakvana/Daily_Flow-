-- Rollback of supabase/migrations/20261120000000_projects_unique_name_link_tasks.sql
-- Removes the auto-link trigger and the unique index. Duplicate projects that were merged are NOT restored.
--
-- Apply manually:  psql -v ON_ERROR_STOP=1 -1 -f 20261120000000_projects_unique_name_link_tasks.down.sql

DROP TRIGGER IF EXISTS trg_tasks_a_link_project ON public.tasks;
DROP FUNCTION IF EXISTS public.link_task_project();
DROP INDEX IF EXISTS public.projects_name_unique_idx;
