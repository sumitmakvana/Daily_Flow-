DROP FUNCTION IF EXISTS public.task_list_counters(text, uuid, date);
NOTIFY pgrst, 'reload schema';
