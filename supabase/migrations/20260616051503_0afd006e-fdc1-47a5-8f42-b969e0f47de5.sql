
-- 1. work_item_types lookup
CREATE TABLE public.work_item_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  icon text,
  color text,
  active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.work_item_types TO authenticated;
GRANT ALL ON public.work_item_types TO service_role;

ALTER TABLE public.work_item_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY wit_read ON public.work_item_types FOR SELECT TO authenticated USING (true);
CREATE POLICY wit_admin_write ON public.work_item_types FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 2. Seed
INSERT INTO public.work_item_types (key, name, description, icon, color, sort_order) VALUES
  ('task',             'Task',             'General task',                              'CheckSquare',  'primary',          10),
  ('visit',            'Visit',            'Field / customer visit',                    'MapPin',       'priority-medium',  20),
  ('beat',             'Beat',             'Sales beat / route',                        'Route',        'priority-medium',  30),
  ('lead_follow_up',   'Lead Follow Up',   'Sales lead follow up',                      'Phone',        'priority-high',    40),
  ('service_request',  'Service Request',  'Customer service request',                  'Wrench',       'destructive',      50),
  ('inspection',       'Inspection',       'Quality / safety inspection',               'ClipboardCheck','priority-medium', 60),
  ('audit',            'Audit',            'Compliance audit',                          'ShieldCheck',  'priority-high',    70),
  ('approval_request', 'Approval Request', 'Approval needed',                           'CheckCircle2', 'priority-high',    80),
  ('activity',         'Activity',         'General activity log',                      'Activity',     'muted',            90),
  ('meeting',          'Meeting',          'Scheduled meeting',                         'Users',        'primary',         100);

-- 3. Tasks.type_id (additive)
ALTER TABLE public.tasks ADD COLUMN type_id uuid REFERENCES public.work_item_types(id);

UPDATE public.tasks
   SET type_id = (SELECT id FROM public.work_item_types WHERE key='task')
 WHERE type_id IS NULL;

ALTER TABLE public.tasks ALTER COLUMN type_id SET NOT NULL;

-- 4. Default-fill trigger so client INSERTs without type_id still work
CREATE OR REPLACE FUNCTION public.tasks_default_type()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.type_id IS NULL THEN
    NEW.type_id := (SELECT id FROM public.work_item_types WHERE key='task');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_tasks_default_type
  BEFORE INSERT ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks_default_type();

CREATE INDEX idx_tasks_type_id ON public.tasks(type_id);
