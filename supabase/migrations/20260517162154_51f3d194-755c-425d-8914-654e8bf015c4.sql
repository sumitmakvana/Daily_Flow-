
REVOKE EXECUTE ON FUNCTION public.generate_planning_suggestions(date) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.generate_nudges() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.adoption_rollup(date) FROM authenticated;

-- predict_tomorrow_risks: only reads tables already governed by read_all policies, switch to invoker.
CREATE OR REPLACE FUNCTION public.predict_tomorrow_risks()
RETURNS TABLE(task_id uuid, risk_score int, reasons text[])
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH cap_load AS (
    SELECT assigned_to, SUM(COALESCE(planned_hours,0)) AS load
      FROM public.tasks
     WHERE assigned_to IS NOT NULL AND status NOT IN ('Completed')
       AND due_date = ((now() AT TIME ZONE 'utc')::date + 1)
     GROUP BY assigned_to
  ),
  cap AS (SELECT COALESCE((SELECT daily_capacity_hours FROM public.work_settings WHERE id=1),8) AS h)
  SELECT t.id AS task_id,
         (CASE WHEN t.carry_forward_count >= 2 THEN 30 ELSE 0 END
          + CASE WHEN t.status = 'Blocked' THEN 25 ELSE 0 END
          + CASE WHEN t.priority = 'High' THEN 15 ELSE 0 END
          + CASE WHEN t.updated_at < now() - interval '2 days' THEN 10 ELSE 0 END
          + CASE WHEN cl.load > (SELECT h FROM cap) * 1.1 THEN 20 ELSE 0 END)::int AS risk_score,
         ARRAY_REMOVE(ARRAY[
           CASE WHEN t.carry_forward_count >= 2 THEN format('carried forward %sx', t.carry_forward_count) END,
           CASE WHEN t.status = 'Blocked' THEN 'currently blocked' END,
           CASE WHEN t.priority = 'High' THEN 'high priority' END,
           CASE WHEN t.updated_at < now() - interval '2 days' THEN 'stale' END,
           CASE WHEN cl.load > (SELECT h FROM cap) * 1.1 THEN 'assignee overloaded tomorrow' END
         ], NULL) AS reasons
    FROM public.tasks t
    LEFT JOIN cap_load cl ON cl.assigned_to = t.assigned_to
   WHERE t.status NOT IN ('Completed')
     AND (t.due_date <= ((now() AT TIME ZONE 'utc')::date + 1) OR t.due_date IS NULL);
$$;

GRANT EXECUTE ON FUNCTION public.predict_tomorrow_risks() TO authenticated;
