-- Fix set_task_code() privilege escalation by adding SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.set_task_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  pfx text;
  n bigint;
  yr text;
BEGIN
  IF NEW.task_code IS NOT NULL AND NEW.task_code <> '' THEN
    RETURN NEW;
  END IF;
  SELECT id_prefix INTO pfx FROM public.work_item_types WHERE id = NEW.type_id;
  IF pfx IS NULL OR pfx = '' THEN
    NEW.task_code := 'T-' || LPAD(nextval('public.task_code_seq')::TEXT, 4, '0');
  ELSE
    UPDATE public.work_item_types
       SET id_seq = id_seq + 1
     WHERE id = NEW.type_id
     RETURNING id_seq INTO n;
    yr := to_char(now() AT TIME ZONE 'utc', 'YYYY');
    NEW.task_code := pfx || '-' || yr || '-' || LPAD(n::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;
