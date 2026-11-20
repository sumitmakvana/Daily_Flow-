-- Renaming a project must update EVERY task of that project, not only the ones the person renaming it can
-- update under row-level security. The function now runs with its owner's rights (only reachable through
-- the projects UPDATE policy, which is manager / admin only).
CREATE OR REPLACE FUNCTION public.propagate_project_rename()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE public.tasks SET project_name = NEW.name WHERE project_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.propagate_project_rename() FROM PUBLIC;

-- Tasks created before project_id was the link have only the old name text. Rename also reaches them
-- when their old name matches the project's old name exactly (case-insensitive).
CREATE OR REPLACE FUNCTION public.propagate_project_rename_legacy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE public.tasks
       SET project_name = NEW.name
     WHERE project_id IS NULL AND lower(btrim(project_name)) = lower(btrim(OLD.name));
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.propagate_project_rename_legacy() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_projects_rename_legacy ON public.projects;
CREATE TRIGGER trg_projects_rename_legacy
AFTER UPDATE OF name ON public.projects
FOR EACH ROW EXECUTE FUNCTION public.propagate_project_rename_legacy();
