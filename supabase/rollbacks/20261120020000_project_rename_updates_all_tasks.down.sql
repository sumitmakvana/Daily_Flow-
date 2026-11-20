-- Rollback of supabase/migrations/20261120020000_project_rename_updates_all_tasks.sql
-- Apply manually:  psql -v ON_ERROR_STOP=1 -1 -f 20261120020000_project_rename_updates_all_tasks.down.sql

DROP TRIGGER IF EXISTS trg_projects_rename_legacy ON public.projects;
DROP FUNCTION IF EXISTS public.propagate_project_rename_legacy();

CREATE OR REPLACE FUNCTION public.propagate_project_rename()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE public.tasks SET project_name = NEW.name WHERE project_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
