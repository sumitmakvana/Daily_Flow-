CREATE TABLE public.work_item_statuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type_id uuid NOT NULL REFERENCES public.work_item_types(id) ON DELETE CASCADE,
  key text NOT NULL,
  label text NOT NULL,
  category text NOT NULL CHECK (category IN ('todo','in_progress','done','cancelled')),
  color text,
  sort_order int NOT NULL DEFAULT 0,
  is_initial boolean NOT NULL DEFAULT false,
  is_terminal boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (type_id, key)
);
CREATE INDEX idx_wis_type ON public.work_item_statuses(type_id, sort_order);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_item_statuses TO authenticated;
GRANT ALL ON public.work_item_statuses TO service_role;
ALTER TABLE public.work_item_statuses ENABLE ROW LEVEL SECURITY;
CREATE POLICY wis_read ON public.work_item_statuses FOR SELECT TO authenticated USING (true);
CREATE POLICY wis_admin_write ON public.work_item_statuses FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_wis_updated_at BEFORE UPDATE ON public.work_item_statuses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.work_item_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type_id uuid NOT NULL REFERENCES public.work_item_types(id) ON DELETE CASCADE,
  from_status_id uuid REFERENCES public.work_item_statuses(id) ON DELETE CASCADE,
  to_status_id uuid NOT NULL REFERENCES public.work_item_statuses(id) ON DELETE CASCADE,
  label text,
  required_role public.app_role,
  guard_expr jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_wit_type ON public.work_item_transitions(type_id);
CREATE UNIQUE INDEX uq_wit_edge ON public.work_item_transitions(
  type_id, COALESCE(from_status_id, '00000000-0000-0000-0000-000000000000'::uuid), to_status_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_item_transitions TO authenticated;
GRANT ALL ON public.work_item_transitions TO service_role;
ALTER TABLE public.work_item_transitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY wit_read ON public.work_item_transitions FOR SELECT TO authenticated USING (true);
CREATE POLICY wit_admin_write ON public.work_item_transitions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

ALTER TABLE public.tasks ADD COLUMN status_id uuid REFERENCES public.work_item_statuses(id);
CREATE INDEX idx_tasks_type_status ON public.tasks(type_id, status_id);

DO $$
DECLARE
  task_type uuid;
  s_todo uuid; s_prog uuid; s_review uuid; s_blocked uuid; s_done uuid; s_cancel uuid;
BEGIN
  SELECT id INTO task_type FROM public.work_item_types WHERE key='task';
  IF task_type IS NULL THEN RAISE EXCEPTION 'task work_item_type missing'; END IF;

  INSERT INTO public.work_item_statuses(type_id,key,label,category,color,sort_order,is_initial,is_terminal) VALUES
    (task_type,'todo','To Do','todo','#94a3b8',10,true,false),
    (task_type,'in_progress','In Progress','in_progress','#3b82f6',20,false,false),
    (task_type,'in_review','In Review','in_progress','#a855f7',30,false,false),
    (task_type,'blocked','Blocked','in_progress','#ef4444',40,false,false),
    (task_type,'completed','Completed','done','#22c55e',50,false,true),
    (task_type,'cancelled','Cancelled','cancelled','#6b7280',60,false,true);

  SELECT id INTO s_todo    FROM public.work_item_statuses WHERE type_id=task_type AND key='todo';
  SELECT id INTO s_prog    FROM public.work_item_statuses WHERE type_id=task_type AND key='in_progress';
  SELECT id INTO s_review  FROM public.work_item_statuses WHERE type_id=task_type AND key='in_review';
  SELECT id INTO s_blocked FROM public.work_item_statuses WHERE type_id=task_type AND key='blocked';
  SELECT id INTO s_done    FROM public.work_item_statuses WHERE type_id=task_type AND key='completed';
  SELECT id INTO s_cancel  FROM public.work_item_statuses WHERE type_id=task_type AND key='cancelled';

  INSERT INTO public.work_item_transitions(type_id,from_status_id,to_status_id,label,sort_order) VALUES
    (task_type, NULL, s_todo,    'Reopen',          10),
    (task_type, NULL, s_prog,    'Start',           20),
    (task_type, NULL, s_review,  'Send for Review', 30),
    (task_type, NULL, s_blocked, 'Block',           40),
    (task_type, NULL, s_done,    'Complete',        50),
    (task_type, NULL, s_cancel,  'Cancel',          60);
END $$;

UPDATE public.tasks t
   SET status_id = s.id
  FROM public.work_item_statuses s
 WHERE s.type_id = t.type_id
   AND lower(s.label) = lower(t.status::text)
   AND t.status_id IS NULL;

CREATE OR REPLACE FUNCTION public.tasks_sync_status()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE
  s public.work_item_statuses;
BEGIN
  IF NEW.status_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.status_id IS DISTINCT FROM OLD.status_id) THEN
    SELECT * INTO s FROM public.work_item_statuses WHERE id = NEW.status_id;
    IF FOUND THEN NEW.status := s.label::public.task_status; END IF;
    RETURN NEW;
  END IF;
  IF NEW.status IS NOT NULL AND (TG_OP='INSERT' OR NEW.status IS DISTINCT FROM OLD.status) THEN
    SELECT * INTO s FROM public.work_item_statuses
     WHERE type_id = NEW.type_id AND lower(label) = lower(NEW.status::text) LIMIT 1;
    IF FOUND THEN NEW.status_id := s.id; END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_tasks_sync_status
BEFORE INSERT OR UPDATE OF status, status_id, type_id ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.tasks_sync_status();