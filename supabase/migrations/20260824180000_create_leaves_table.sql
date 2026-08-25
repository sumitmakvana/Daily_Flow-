-- Leaves and WFH Management Table
CREATE TABLE IF NOT EXISTS public.leaves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  leave_type text NOT NULL DEFAULT 'casual', -- 'casual', 'sick', 'wfh', 'half_day', 'paid', 'unpaid'
  start_date date NOT NULL,
  end_date date NOT NULL,
  days_count numeric(4,1) DEFAULT 1.0,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'approved', -- 'pending', 'approved', 'rejected', 'cancelled'
  handover_note text,
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leaves_dates ON public.leaves(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_leaves_user ON public.leaves(user_id);
CREATE INDEX IF NOT EXISTS idx_leaves_status ON public.leaves(status);

ALTER TABLE public.leaves ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to view all approved leaves (for calendar/visibility) and their own requests
DROP POLICY IF EXISTS "Allow users to view leaves" ON public.leaves;
CREATE POLICY "Allow users to view leaves" ON public.leaves
  FOR SELECT TO authenticated
  USING (true);

-- Allow users to insert their own leaves
DROP POLICY IF EXISTS "Allow users to create leaves" ON public.leaves;
CREATE POLICY "Allow users to create leaves" ON public.leaves
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Allow users to update their own pending leaves or managers/admins to review
DROP POLICY IF EXISTS "Allow users and managers to update leaves" ON public.leaves;
CREATE POLICY "Allow users and managers to update leaves" ON public.leaves
  FOR UPDATE TO authenticated
  USING (
    auth.uid() = user_id OR
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role IN ('admin', 'manager')
    )
  );

-- Allow users to delete their own leaves if not approved yet, or admins
DROP POLICY IF EXISTS "Allow delete leaves" ON public.leaves;
CREATE POLICY "Allow delete leaves" ON public.leaves
  FOR DELETE TO authenticated
  USING (
    auth.uid() = user_id OR
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'admin'
    )
  );
