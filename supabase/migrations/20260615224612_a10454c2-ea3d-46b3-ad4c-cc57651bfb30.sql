
CREATE TABLE IF NOT EXISTS public.cron_config (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.cron_config TO service_role;
ALTER TABLE public.cron_config ENABLE ROW LEVEL SECURITY;
-- No policies = locked to service_role / cron.

-- Helper read function (callable by cron without exposing the table to anyone else).
CREATE OR REPLACE FUNCTION public._cron_secret()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$ SELECT value FROM public.cron_config WHERE key = 'cron_secret' LIMIT 1 $$;
REVOKE EXECUTE ON FUNCTION public._cron_secret() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._cron_secret() TO service_role;
