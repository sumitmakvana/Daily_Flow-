  -- FCM device tokens for the Operon Android app (push notifications).
  CREATE TABLE IF NOT EXISTS public.device_tokens (
    token text PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    platform text NOT NULL DEFAULT 'android',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON public.device_tokens(user_id);

  ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS "Users manage own device tokens" ON public.device_tokens;
  CREATE POLICY "Users manage own device tokens" ON public.device_tokens
    FOR ALL TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
