-- Remove the pg_cron -> curl -> app hook path and close the exposures it created.
--
-- Background (prod dump 2026-10-27):
--   * cron jobs morning-digest and evening-digest (* * * * *) and no-tasks-reminder (*/20) call
--     public.trigger_cron_hook(route), which runs COPY ... TO PROGRAM 'curl ...'. The in-app CronTicker
--     (src/lib/cron-ticker.server.ts) already runs both digests; the no-tasks reminder was removed (2ff0458).
--   * trigger_cron_hook is SECURITY DEFINER, owned by a superuser, executable by PUBLIC and concatenates
--     `route` into a shell command: reachable as /rest/v1/rpc/trigger_cron_hook.
--   * _cron_secret() is SECURITY DEFINER and was granted to anon/authenticated (drift from 20260616044539).
--
-- Apply with:  psql -v ON_ERROR_STOP=1 -1 -f <this file>   (single transaction; any error rolls back all)
-- Rollback:    supabase/rollbacks/20261116000000_remove_pg_cron_http_hooks.down.sql
-- Does NOT touch realtime-outbox-prune or any other cron job.

-- 1. Close the RCE first (harmless to the jobs: pg_cron runs them as the function owner).
DO $$
BEGIN
  IF to_regprocedure('public.trigger_cron_hook(text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.trigger_cron_hook(text) FROM PUBLIC;
  END IF;
  IF to_regprocedure('public._cron_secret()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public._cron_secret() FROM PUBLIC;
  END IF;
END $$;

-- 2. Unschedule the three obsolete jobs and delete their run history.
DO $$
DECLARE
  v_ids  bigint[];
  v_left int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed: no jobs to unschedule';
    RETURN;
  END IF;

  SELECT array_agg(jobid) INTO v_ids
    FROM cron.job
   WHERE jobname IN ('morning-digest', 'evening-digest', 'no-tasks-reminder');

  IF v_ids IS NOT NULL THEN
    PERFORM cron.unschedule(j) FROM unnest(v_ids) AS j;
    DELETE FROM cron.job_run_details WHERE jobid = ANY (v_ids);
    RAISE NOTICE 'unscheduled % job(s): %', cardinality(v_ids), v_ids;
  ELSE
    RAISE NOTICE 'no obsolete hook jobs found (already removed)';
  END IF;

  -- Never drop the function out from under a job we did not expect.
  SELECT count(*) INTO v_left FROM cron.job WHERE command ILIKE '%trigger_cron_hook%';
  IF v_left > 0 THEN
    RAISE EXCEPTION 'cron.job still has % job(s) calling trigger_cron_hook; review them first', v_left;
  END IF;
END $$;

-- 3. Drop the hook function and the secret reader (no CASCADE: an unexpected dependent fails the migration).
DROP FUNCTION IF EXISTS public.trigger_cron_hook(text);
DROP FUNCTION IF EXISTS public._cron_secret();

-- 4. Restore the intended grants on the cron tables (service_role only; RLS deny-all policies stay).
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'admin', 'manager', 'member'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      IF to_regclass('public.cron_config') IS NOT NULL THEN
        EXECUTE format('REVOKE ALL ON TABLE public.cron_config FROM %I', r);
      END IF;
      IF to_regclass('public.cron_invocations') IS NOT NULL THEN
        EXECUTE format('REVOKE ALL ON TABLE public.cron_invocations FROM %I', r);
      END IF;
    END IF;
  END LOOP;
END $$;

-- 5. Postconditions.
DO $$
BEGIN
  IF to_regprocedure('public.trigger_cron_hook(text)') IS NOT NULL THEN
    RAISE EXCEPTION 'trigger_cron_hook still exists';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE prosrc ILIKE '%TO PROGRAM%') THEN
    RAISE WARNING 'another function still contains COPY ... TO PROGRAM: review it';
  END IF;
END $$;
