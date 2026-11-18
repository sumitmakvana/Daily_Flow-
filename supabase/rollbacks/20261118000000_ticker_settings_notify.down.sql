-- Rollback of supabase/migrations/20261118000000_ticker_settings_notify.sql
-- Removes the four triggers and the function. Application writes keep working; the CronTicker then only sees
-- in-app saves (and re-reads its settings at midnight IST and on restart).
--
-- Apply manually:  psql -v ON_ERROR_STOP=1 -1 -f 20261118000000_ticker_settings_notify.down.sql

DROP TRIGGER IF EXISTS trg_ticker_settings_work_settings ON public.work_settings;
DROP TRIGGER IF EXISTS trg_ticker_settings_work_settings_truncate ON public.work_settings;
DROP TRIGGER IF EXISTS trg_ticker_settings_holiday_calendar ON public.holiday_calendar;
DROP TRIGGER IF EXISTS trg_ticker_settings_holiday_calendar_truncate ON public.holiday_calendar;

DROP FUNCTION IF EXISTS public.notify_ticker_settings_changed();
