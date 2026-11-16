-- Rollback for 20261116000000_remove_pg_cron_http_hooks.sql
--
-- Restores only what is safe. The pg_cron HTTP jobs and trigger_cron_hook are intentionally NOT restored:
-- the in-app CronTicker sends the digests. If an external scheduler is ever needed, call the hooks from
-- outside Postgres (host cron / scheduler) with the x-cron-* headers.
-- The revoked table grants on cron_config / cron_invocations are not restored either: they were drift
-- (20260616044539 revokes them) and the app reaches both tables only as service_role.
-- Deleted cron.job_run_details rows are not recoverable (history only); export them first if needed.

CREATE OR REPLACE FUNCTION public._cron_secret() RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
  AS $$ SELECT value FROM public.cron_config WHERE key = 'cron_secret' LIMIT 1 $$;
REVOKE ALL ON FUNCTION public._cron_secret() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._cron_secret() TO service_role;
