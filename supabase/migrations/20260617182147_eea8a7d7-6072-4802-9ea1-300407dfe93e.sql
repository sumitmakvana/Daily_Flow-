
CREATE OR REPLACE FUNCTION public.automation_try_lock(_key bigint)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pg_try_advisory_lock(_key);
$$;

CREATE OR REPLACE FUNCTION public.automation_unlock(_key bigint)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pg_advisory_unlock(_key);
$$;

REVOKE EXECUTE ON FUNCTION public.automation_try_lock(bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.automation_unlock(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.automation_try_lock(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_unlock(bigint) TO service_role;
