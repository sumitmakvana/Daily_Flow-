-- 1) One project per name (case-insensitive, trimmed).
--    Existing duplicates are merged first: tasks are re-pointed to the oldest project of each name, then the
--    extra rows are removed, so no task loses its project link.
WITH ranked AS (
  SELECT id,
         first_value(id) OVER (PARTITION BY lower(btrim(name)) ORDER BY created_at, id) AS keep_id
    FROM public.projects
)
UPDATE public.tasks t
   SET project_id = r.keep_id
  FROM ranked r
 WHERE t.project_id = r.id AND r.id <> r.keep_id;

DELETE FROM public.projects p
 USING (
   SELECT id,
          first_value(id) OVER (PARTITION BY lower(btrim(name)) ORDER BY created_at, id) AS keep_id
     FROM public.projects
 ) r
 WHERE p.id = r.id AND r.id <> r.keep_id;

CREATE UNIQUE INDEX IF NOT EXISTS projects_name_unique_idx
  ON public.projects (lower(btrim(name)));

-- 2) A task that names a project but has no project_id gets linked to the matching master project, so it
--    also gets its SLA due date and shows in project reports. Covers every save path (single, grid, bulk, edit).
--    Only exact single-name matches are linked; merged "A | B" names and unknown names are left alone.
--    The trigger name sorts before trg_tasks_sync_status / the review guard, so those see the final row.
CREATE OR REPLACE FUNCTION public.link_task_project()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  pid uuid;
  d int;
BEGIN
  IF NEW.project_id IS NULL AND NEW.project_name IS NOT NULL AND btrim(NEW.project_name) <> '' THEN
    SELECT id, sla_days INTO pid, d
      FROM public.projects
     WHERE lower(btrim(name)) = lower(btrim(NEW.project_name))
     LIMIT 1;
    IF pid IS NOT NULL THEN
      NEW.project_id := pid;
      -- trg_compute_task_sla only fires when project_id is in the UPDATE's SET list, so apply the SLA here.
      IF d IS NOT NULL THEN
        NEW.sla_due_at := COALESCE(NEW.created_at, now()) + (d || ' days')::interval;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tasks_a_link_project ON public.tasks;
CREATE TRIGGER trg_tasks_a_link_project
BEFORE INSERT OR UPDATE OF project_name ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.link_task_project();
