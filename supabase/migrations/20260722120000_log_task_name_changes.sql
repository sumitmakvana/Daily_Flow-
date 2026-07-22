-- Migration to log task name changes in task_history and resolve display names
CREATE OR REPLACE FUNCTION public.log_task_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := COALESCE(NEW.updated_by, auth.uid());
  parts text[] := ARRAY[]::text[];
  temp_name text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.task_history(task_id, old_status, new_status, updated_by, comment)
    VALUES (NEW.id, NULL, NEW.status, actor, 'created');
    RETURN NEW;
  END IF;

  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.task_history(task_id, old_status, new_status, updated_by, comment)
    VALUES (NEW.id, OLD.status, NEW.status, actor, NULL);
  END IF;

  IF OLD.task_name IS DISTINCT FROM NEW.task_name THEN
    parts := parts || format('name → %s', NEW.task_name);
  END IF;
  
  IF OLD.assigned_to IS DISTINCT FROM NEW.assigned_to THEN
    IF NEW.assigned_to IS NULL THEN
      parts := parts || 'assignee → unassigned';
    ELSE
      SELECT display_name INTO temp_name FROM public.profiles WHERE id = NEW.assigned_to;
      parts := parts || format('assignee → %s', COALESCE(temp_name, 'unknown'));
    END IF;
  END IF;

  IF OLD.priority IS DISTINCT FROM NEW.priority THEN
    parts := parts || format('priority %s → %s', OLD.priority, NEW.priority);
  END IF;
  
  IF OLD.due_date IS DISTINCT FROM NEW.due_date THEN
    parts := parts || format('due %s → %s', COALESCE(OLD.due_date::text,'—'), COALESCE(NEW.due_date::text,'—'));
  END IF;
  
  IF OLD.reviewer IS DISTINCT FROM NEW.reviewer THEN
    IF NEW.reviewer IS NULL THEN
      parts := parts || 'reviewer → none';
    ELSE
      SELECT display_name INTO temp_name FROM public.profiles WHERE id = NEW.reviewer;
      parts := parts || format('reviewer → %s', COALESCE(temp_name, 'unknown'));
    END IF;
  END IF;

  IF array_length(parts,1) IS NOT NULL THEN
    INSERT INTO public.task_history(task_id, old_status, new_status, updated_by, comment)
    VALUES (NEW.id, OLD.status, NEW.status, actor, array_to_string(parts, '; '));
  END IF;

  RETURN NEW;
END;
$$;
