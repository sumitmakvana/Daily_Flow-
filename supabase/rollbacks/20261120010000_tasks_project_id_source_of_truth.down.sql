-- Rollback of supabase/migrations/20261120010000_tasks_project_id_source_of_truth.sql
-- Removes the project_name sync triggers. The name-based link from 20261120000000 is not re-created
-- (use that migration's rollback / re-run its trigger block if you need it).
--
-- Apply manually:  psql -v ON_ERROR_STOP=1 -1 -f 20261120010000_tasks_project_id_source_of_truth.down.sql

DROP TRIGGER IF EXISTS trg_projects_rename ON public.projects;
DROP FUNCTION IF EXISTS public.propagate_project_rename();
DROP TRIGGER IF EXISTS trg_tasks_a_sync_project_name ON public.tasks;
DROP FUNCTION IF EXISTS public.sync_task_project_name();
