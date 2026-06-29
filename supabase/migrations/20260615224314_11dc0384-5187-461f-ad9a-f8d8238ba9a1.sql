
CREATE OR REPLACE FUNCTION public.record_export(_kind text, _filters jsonb, _row_count int)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE new_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  INSERT INTO public.audit_exports(user_id, kind, params, row_count)
  VALUES (auth.uid(), _kind, COALESCE(_filters,'{}'::jsonb), COALESCE(_row_count,0))
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.record_export(text, jsonb, int) TO authenticated;
