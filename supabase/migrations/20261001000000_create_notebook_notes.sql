-- Notebook notes (per-user, auto-saved from the Notebook UI)
CREATE TABLE IF NOT EXISTS public.notebook_notes (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  content text NOT NULL DEFAULT '',
  tags text[] NOT NULL DEFAULT '{}',
  color text NOT NULL DEFAULT 'slate',
  is_pinned boolean NOT NULL DEFAULT false,
  images jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notebook_notes_user ON public.notebook_notes(user_id, updated_at DESC);

ALTER TABLE public.notebook_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own notebook notes" ON public.notebook_notes;
CREATE POLICY "Users manage own notebook notes" ON public.notebook_notes
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Tracks users who already went through first-login seeding, so the default
-- note is created once and never recreated after the user edits/deletes it.
CREATE TABLE IF NOT EXISTS public.notebook_seeded (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  seeded_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notebook_seeded ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own notebook seed flag" ON public.notebook_seeded;
CREATE POLICY "Users manage own notebook seed flag" ON public.notebook_seeded
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
