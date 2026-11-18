-- Tell the app when the CronTicker's cached settings change, from ANY writer.
--
-- The CronTicker (src/lib/cron-ticker.server.ts) caches work_settings (workdays + digest times) and today's
-- holiday_calendar status for the whole IST day. In-app saves already mark that cache stale in the app process,
-- but edits made in DBeaver/psql, by a migration or by pg_restore bypass the app. These statement-level triggers
-- send NOTIFY ticker_settings_changed (payload: the table name) on COMMIT for every write; the app LISTENs and
-- re-reads the settings on its next tick. A rolled-back write sends nothing.
--
--   * Statement-level, not row-level: a bulk import of N holidays is N small messages at most, never N per row,
--     and the app collapses them into one re-read.
--   * ENABLE ALWAYS: also fires under session_replication_role = replica (pg_restore, logical replication apply).
--   * The NOTIFY carries only the table name, never row content.
--   * Harmless before the app that LISTENs is deployed: a NOTIFY nobody listens to is discarded.
--
-- Apply manually:  psql -v ON_ERROR_STOP=1 -1 -f 20261118000000_ticker_settings_notify.sql
-- Idempotent: safe to run again.
-- Rollback: supabase/rollbacks/20261118000000_ticker_settings_notify.down.sql

CREATE OR REPLACE FUNCTION public.notify_ticker_settings_changed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM pg_notify('ticker_settings_changed', TG_TABLE_NAME);
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.notify_ticker_settings_changed() FROM PUBLIC;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['work_settings', 'holiday_calendar'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION 'ticker settings notify: public.% does not exist', t;
    END IF;

    EXECUTE format('DROP TRIGGER IF EXISTS trg_ticker_settings_%1$s ON public.%1$I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_ticker_settings_%1$s AFTER INSERT OR UPDATE OR DELETE ON public.%1$I '
      'FOR EACH STATEMENT EXECUTE FUNCTION public.notify_ticker_settings_changed()', t);
    EXECUTE format('ALTER TABLE public.%1$I ENABLE ALWAYS TRIGGER trg_ticker_settings_%1$s', t);

    EXECUTE format('DROP TRIGGER IF EXISTS trg_ticker_settings_%1$s_truncate ON public.%1$I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_ticker_settings_%1$s_truncate AFTER TRUNCATE ON public.%1$I '
      'FOR EACH STATEMENT EXECUTE FUNCTION public.notify_ticker_settings_changed()', t);
    EXECUTE format('ALTER TABLE public.%1$I ENABLE ALWAYS TRIGGER trg_ticker_settings_%1$s_truncate', t);
  END LOOP;
END
$$;

-- Postcondition: all four triggers exist and fire always ('A').
DO $$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n
    FROM pg_trigger
   WHERE NOT tgisinternal
     AND tgenabled = 'A'
     AND tgname IN ('trg_ticker_settings_work_settings', 'trg_ticker_settings_work_settings_truncate',
                    'trg_ticker_settings_holiday_calendar', 'trg_ticker_settings_holiday_calendar_truncate');
  IF n <> 4 THEN
    RAISE EXCEPTION 'ticker settings notify: expected 4 enabled-always triggers, found %', n;
  END IF;
END
$$;
