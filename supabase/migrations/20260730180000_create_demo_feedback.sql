-- Create table for storing demo session metrics and user feedback
CREATE TABLE IF NOT EXISTS public.demo_feedback_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,
    user_email TEXT,
    user_role TEXT DEFAULT 'member',
    session_id TEXT NOT NULL,
    step_reached INT DEFAULT 1,
    my_day_capacity_hours NUMERIC DEFAULT 8.0,
    tasks_interacted_count INT DEFAULT 0,
    eod_submitted BOOLEAN DEFAULT FALSE,
    is_useful TEXT NOT NULL, -- 'yes', 'partially', 'no'
    overall_rating INT NOT NULL, -- 1 to 5
    ratings_json JSONB DEFAULT '{}'::jsonb, -- { myDay: 5, taskTimer: 4, eod: 5, managerView: 4 }
    most_liked_feature TEXT,
    improvement_suggestions TEXT,
    detailed_feedback TEXT,
    completed_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.demo_feedback_logs ENABLE ROW LEVEL SECURITY;

-- Drop policies if existing
DROP POLICY IF EXISTS demo_feedback_select_policy ON public.demo_feedback_logs;
DROP POLICY IF EXISTS demo_feedback_insert_policy ON public.demo_feedback_logs;

-- Allow authenticated users to view feedback logs
CREATE POLICY demo_feedback_select_policy ON public.demo_feedback_logs
    FOR SELECT
    TO authenticated
    USING (true);

-- Allow authenticated users to insert their own feedback logs
CREATE POLICY demo_feedback_insert_policy ON public.demo_feedback_logs
    FOR INSERT
    TO authenticated
    WITH CHECK (true);

-- Grant permissions to authenticated and service_role
GRANT SELECT, INSERT ON public.demo_feedback_logs TO authenticated;
GRANT ALL ON public.demo_feedback_logs TO service_role;
