-- Approval chain definition
CREATE TABLE public.approval_chains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type_id uuid NOT NULL REFERENCES public.work_item_types(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.approval_chains TO authenticated;
GRANT ALL ON public.approval_chains TO service_role;
ALTER TABLE public.approval_chains ENABLE ROW LEVEL SECURITY;
CREATE POLICY ac_read ON public.approval_chains FOR SELECT TO authenticated USING (true);
CREATE POLICY ac_admin ON public.approval_chains FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_ac_updated_at BEFORE UPDATE ON public.approval_chains
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.approval_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id uuid NOT NULL REFERENCES public.approval_chains(id) ON DELETE CASCADE,
  step_order int NOT NULL,
  name text NOT NULL,
  approver_mode text NOT NULL CHECK (approver_mode IN ('role','user','reviewer_field')),
  approver_role public.app_role,
  approver_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  required_count int NOT NULL DEFAULT 1,
  allow_self boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chain_id, step_order)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.approval_steps TO authenticated;
GRANT ALL ON public.approval_steps TO service_role;
ALTER TABLE public.approval_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY as_read ON public.approval_steps FOR SELECT TO authenticated USING (true);
CREATE POLICY as_admin ON public.approval_steps FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Live approval requests on work items
CREATE TABLE public.approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  chain_id uuid NOT NULL REFERENCES public.approval_chains(id),
  current_step int NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ar_wi ON public.approval_requests(work_item_id);
CREATE INDEX idx_ar_status ON public.approval_requests(status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.approval_requests TO authenticated;
GRANT ALL ON public.approval_requests TO service_role;
ALTER TABLE public.approval_requests ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_ar_updated_at BEFORE UPDATE ON public.approval_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Helper: is the calling user an approver for any step of this request
CREATE OR REPLACE FUNCTION public.is_request_approver(_request_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.approval_requests r
      JOIN public.approval_steps s ON s.chain_id = r.chain_id
      LEFT JOIN public.tasks t ON t.id = r.work_item_id
     WHERE r.id = _request_id
       AND (
         (s.approver_mode = 'user' AND s.approver_user_id = _user_id)
      OR (s.approver_mode = 'role' AND public.has_role(_user_id, s.approver_role))
      OR (s.approver_mode = 'reviewer_field' AND t.reviewer = _user_id)
       )
  );
$$;
REVOKE EXECUTE ON FUNCTION public.is_request_approver(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_request_approver(uuid, uuid) TO authenticated;

CREATE POLICY ar_read ON public.approval_requests FOR SELECT TO authenticated
  USING (
    requested_by = auth.uid()
    OR public.has_role(auth.uid(),'admin')
    OR public.is_request_approver(id, auth.uid())
  );
CREATE POLICY ar_insert ON public.approval_requests FOR INSERT TO authenticated
  WITH CHECK (requested_by = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY ar_update_admin ON public.approval_requests FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.approval_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.approval_requests(id) ON DELETE CASCADE,
  step_order int NOT NULL,
  approver_id uuid NOT NULL REFERENCES auth.users(id),
  decision text NOT NULL CHECK (decision IN ('approve','reject','delegate')),
  comment text,
  decided_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, step_order, approver_id)
);
CREATE INDEX idx_ad_request ON public.approval_decisions(request_id);
GRANT SELECT, INSERT ON public.approval_decisions TO authenticated;
GRANT ALL ON public.approval_decisions TO service_role;
ALTER TABLE public.approval_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY ad_read ON public.approval_decisions FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(),'admin')
    OR EXISTS (SELECT 1 FROM public.approval_requests r
                WHERE r.id = approval_decisions.request_id
                  AND (r.requested_by = auth.uid()
                       OR public.is_request_approver(r.id, auth.uid())))
  );
CREATE POLICY ad_insert ON public.approval_decisions FOR INSERT TO authenticated
  WITH CHECK (
    approver_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.approval_requests r
       WHERE r.id = request_id
         AND r.status = 'pending'
         AND r.current_step = step_order
         AND public.is_request_approver(r.id, auth.uid())
    )
  );

-- Trigger: on decision, advance request + notify next approver(s) ---------
CREATE OR REPLACE FUNCTION public.on_approval_decision()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  r public.approval_requests;
  next_step int;
  has_next boolean;
  t public.tasks;
  k text;
  approver record;
BEGIN
  SELECT * INTO r FROM public.approval_requests WHERE id = NEW.request_id FOR UPDATE;

  IF NEW.decision = 'reject' THEN
    UPDATE public.approval_requests
       SET status='rejected', completed_at=now() WHERE id = r.id;
    RETURN NEW;
  END IF;

  IF NEW.decision = 'approve' THEN
    next_step := r.current_step + 1;
    SELECT EXISTS(SELECT 1 FROM public.approval_steps WHERE chain_id=r.chain_id AND step_order=next_step) INTO has_next;
    IF has_next THEN
      UPDATE public.approval_requests SET current_step = next_step WHERE id = r.id;

      -- notify next approvers
      SELECT * INTO t FROM public.tasks WHERE id = r.work_item_id;
      FOR approver IN
        SELECT DISTINCT u.id AS user_id
          FROM public.approval_steps s
          LEFT JOIN public.user_roles ur ON ur.role = s.approver_role
          LEFT JOIN auth.users u ON u.id = COALESCE(s.approver_user_id, ur.user_id, t.reviewer)
         WHERE s.chain_id = r.chain_id AND s.step_order = next_step
           AND u.id IS NOT NULL
      LOOP
        k := 'APPROVAL_' || r.id::text || '_' || next_step::text || '_' || approver.user_id::text;
        INSERT INTO public.notifications(user_id, type, title, body, task_id, dedupe_key)
        VALUES (approver.user_id, 'approval_request',
                COALESCE(t.task_code,'Work item') || ' — approval needed',
                'Step ' || next_step::text || ' of approval chain', r.work_item_id, k)
        ON CONFLICT (dedupe_key) DO NOTHING;
      END LOOP;
    ELSE
      UPDATE public.approval_requests
         SET status='approved', completed_at=now() WHERE id = r.id;
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.on_approval_decision() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_on_approval_decision
AFTER INSERT ON public.approval_decisions
FOR EACH ROW EXECUTE FUNCTION public.on_approval_decision();