CREATE TABLE IF NOT EXISTS public.announcements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    emoji TEXT DEFAULT '📢',
    theme_color TEXT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    image_url TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

-- Drop policy if exists
DROP POLICY IF EXISTS announcements_select_policy ON public.announcements;
DROP POLICY IF EXISTS announcements_admin_policy ON public.announcements;

-- Select policy: Allow authenticated users to view announcements
CREATE POLICY announcements_select_policy ON public.announcements
    FOR SELECT
    TO authenticated
    USING (true);

-- Admin policy: Allow admins to do everything
CREATE POLICY announcements_admin_policy ON public.announcements
    FOR ALL
    TO authenticated
    USING (public.has_role(auth.uid(), 'admin'))
    WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Grant privileges to authenticated and service roles
GRANT SELECT, INSERT, UPDATE, DELETE ON public.announcements TO authenticated;
GRANT ALL ON public.announcements TO service_role;

-- Force PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';

