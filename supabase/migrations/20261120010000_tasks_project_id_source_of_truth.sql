-- `projects` is the single source of truth and tasks are linked by project_id only.
--
-- 1) Drop the name-based auto-link from 20261120000000 (tasks no longer carry free-typed project names).
DROP TRIGGER IF EXISTS trg_tasks_a_link_project ON public.tasks;
DROP FUNCTION IF EXISTS public.link_task_project();

-- 2) tasks.project_name stays only as a read-only copy for existing screens and reports. It is always
--    derived from project_id, so it can never disagree with the master list.
CREATE OR REPLACE FUNCTION public.sync_task_project_name()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.project_id IS NOT NULL THEN
    SELECT name INTO NEW.project_name FROM public.projects WHERE id = NEW.project_id;
  ELSIF TG_OP = 'UPDATE' AND OLD.project_id IS NOT NULL THEN
    NEW.project_name := NULL;   -- project removed from the task
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tasks_a_sync_project_name ON public.tasks;
CREATE TRIGGER trg_tasks_a_sync_project_name
BEFORE INSERT OR UPDATE OF project_id ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.sync_task_project_name();

-- 3) Renaming a project updates the copy on its tasks.
CREATE OR REPLACE FUNCTION public.propagate_project_rename()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE public.tasks SET project_name = NEW.name WHERE project_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_projects_rename ON public.projects;
CREATE TRIGGER trg_projects_rename
AFTER UPDATE OF name ON public.projects
FOR EACH ROW EXECUTE FUNCTION public.propagate_project_rename();
