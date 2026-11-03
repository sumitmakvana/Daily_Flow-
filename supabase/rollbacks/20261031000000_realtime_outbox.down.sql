-- Rollback for supabase/migrations/20261031000000_realtime_outbox.sql
-- Kept outside supabase/migrations so the Supabase CLI never applies it by accident.
--
-- After this runs the database no longer announces changes. The app version that depends on the
-- outbox will log "realtime outbox missing" and deliver no live events (pages still load over REST).
-- To get live updates back you must re-apply the migration (or redeploy the previous app version,
-- which still has the polling entity-watcher).

DO $$
DECLARE
  t text;
  tables text[] := ARRAY['tasks', 'nudges', 'risk_events', 'planning_suggestions', 'approval_requests',
                         'task_review_decisions', 'task_worklogs', 'leaves', 'eod_checkins',
                         'automation_runs', 'automation_rules', 'automation_queue_stats'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_realtime_%1$s ON public.%1$I', t);
      EXECUTE format('DROP TRIGGER IF EXISTS trg_realtime_%1$s_truncate ON public.%1$I', t);
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'realtime-outbox-prune';
  END IF;
END
$$;

DROP FUNCTION IF EXISTS realtime.capture();
DROP FUNCTION IF EXISTS realtime.capture_statement();
DROP FUNCTION IF EXISTS realtime.emit(text, text, text, jsonb);
DROP TABLE IF EXISTS realtime.outbox;
DROP SCHEMA IF EXISTS realtime;
