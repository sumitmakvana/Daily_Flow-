-- Industry templates
CREATE TABLE public.industry_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  industry text NOT NULL CHECK (industry IN ('it','pharma','adhesives','manufacturing','consulting','generic')),
  version int NOT NULL DEFAULT 1,
  description text,
  is_installed boolean NOT NULL DEFAULT false,
  installed_at timestamptz,
  installed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.industry_templates TO authenticated;
GRANT ALL ON public.industry_templates TO service_role;
ALTER TABLE public.industry_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY it_read ON public.industry_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY it_admin ON public.industry_templates FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_it_updated_at BEFORE UPDATE ON public.industry_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.template_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.industry_templates(id) ON DELETE CASCADE,
  component_kind text NOT NULL CHECK (component_kind IN
    ('work_item_type','status','transition','field_def','approval_chain','approval_step')),
  payload jsonb NOT NULL,
  apply_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_tc_template ON public.template_components(template_id, apply_order);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.template_components TO authenticated;
GRANT ALL ON public.template_components TO service_role;
ALTER TABLE public.template_components ENABLE ROW LEVEL SECURITY;
CREATE POLICY tc_read ON public.template_components FOR SELECT TO authenticated USING (true);
CREATE POLICY tc_admin ON public.template_components FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Work item relations
CREATE TABLE public.work_item_relations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_work_item_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  to_work_item_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  relation_kind text NOT NULL CHECK (relation_kind IN
    ('blocks','blocked_by','duplicates','parent','child','relates_to')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (from_work_item_id, to_work_item_id, relation_kind),
  CHECK (from_work_item_id <> to_work_item_id)
);
CREATE INDEX idx_wir_from ON public.work_item_relations(from_work_item_id);
CREATE INDEX idx_wir_to ON public.work_item_relations(to_work_item_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_item_relations TO authenticated;
GRANT ALL ON public.work_item_relations TO service_role;
ALTER TABLE public.work_item_relations ENABLE ROW LEVEL SECURITY;
CREATE POLICY wir_read ON public.work_item_relations FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = from_work_item_id));
CREATE POLICY wir_write ON public.work_item_relations FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = from_work_item_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = from_work_item_id));

-- Generic audit log
CREATE TABLE public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_id uuid,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  diff jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_entity ON public.audit_log(entity_type, entity_id, created_at DESC);
GRANT SELECT, INSERT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_read ON public.audit_log FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(),'admin')
    OR (entity_type = 'task' AND EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = entity_id))
  );
CREATE POLICY audit_insert ON public.audit_log FOR INSERT TO authenticated
  WITH CHECK (actor_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

-- Template installer (skeleton — resolves payload refs in order)
CREATE OR REPLACE FUNCTION public.install_template(_template_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  caller uuid := auth.uid();
  comp record;
  refs jsonb := '{}'::jsonb;
  new_id uuid;
  type_id_local uuid;
BEGIN
  IF NOT public.has_role(caller, 'admin') THEN
    RAISE EXCEPTION 'admin required';
  END IF;

  FOR comp IN
    SELECT * FROM public.template_components
     WHERE template_id = _template_id ORDER BY apply_order, created_at
  LOOP
    CASE comp.component_kind
      WHEN 'work_item_type' THEN
        INSERT INTO public.work_item_types(key, label, icon, color, description, sort_order)
        VALUES (comp.payload->>'key', comp.payload->>'label',
                comp.payload->>'icon', comp.payload->>'color',
                comp.payload->>'description',
                COALESCE((comp.payload->>'sort_order')::int, 100))
        ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label
        RETURNING id INTO new_id;
        refs := refs || jsonb_build_object(comp.payload->>'ref', new_id::text);

      WHEN 'status' THEN
        type_id_local := (refs->>(comp.payload->>'type_ref'))::uuid;
        INSERT INTO public.work_item_statuses(type_id, key, label, category, color, sort_order, is_initial, is_terminal)
        VALUES (type_id_local, comp.payload->>'key', comp.payload->>'label',
                comp.payload->>'category', comp.payload->>'color',
                COALESCE((comp.payload->>'sort_order')::int, 0),
                COALESCE((comp.payload->>'is_initial')::boolean, false),
                COALESCE((comp.payload->>'is_terminal')::boolean, false))
        ON CONFLICT (type_id, key) DO UPDATE SET label = EXCLUDED.label
        RETURNING id INTO new_id;
        refs := refs || jsonb_build_object(comp.payload->>'ref', new_id::text);

      WHEN 'field_def' THEN
        type_id_local := (refs->>(comp.payload->>'type_ref'))::uuid;
        INSERT INTO public.work_item_field_defs(type_id, key, label, data_type, required, options, validation, sort_order)
        VALUES (type_id_local, comp.payload->>'key', comp.payload->>'label',
                comp.payload->>'data_type',
                COALESCE((comp.payload->>'required')::boolean, false),
                COALESCE(comp.payload->'options','[]'::jsonb),
                COALESCE(comp.payload->'validation','{}'::jsonb),
                COALESCE((comp.payload->>'sort_order')::int, 0))
        ON CONFLICT (type_id, key) DO UPDATE SET label = EXCLUDED.label;

      WHEN 'transition' THEN
        type_id_local := (refs->>(comp.payload->>'type_ref'))::uuid;
        INSERT INTO public.work_item_transitions(type_id, from_status_id, to_status_id, label, sort_order)
        VALUES (type_id_local,
                NULLIF(refs->>(comp.payload->>'from_ref'),'')::uuid,
                (refs->>(comp.payload->>'to_ref'))::uuid,
                comp.payload->>'label',
                COALESCE((comp.payload->>'sort_order')::int, 0))
        ON CONFLICT DO NOTHING;

      ELSE
        -- approval_chain / approval_step: deferred to Phase B installer
        NULL;
    END CASE;
  END LOOP;

  UPDATE public.industry_templates
     SET is_installed = true, installed_at = now(), installed_by = caller
   WHERE id = _template_id;
  RETURN _template_id;
END $$;
REVOKE EXECUTE ON FUNCTION public.install_template(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.install_template(uuid) TO authenticated;

-- Seed template catalog (definitions only, not installed)
INSERT INTO public.industry_templates(key, name, industry, description) VALUES
  ('it_startup',    'IT Startup',    'it',            'Engineering tasks, incidents, sprints, code reviews'),
  ('pharma',        'Pharmaceutical','pharma',        'GxP audits, batch reviews, deviations, CAPA'),
  ('adhesives',     'Adhesives',     'adhesives',     'Batch QC, customer trials, formulation requests'),
  ('manufacturing', 'Manufacturing', 'manufacturing', 'Work orders, equipment inspections, downtime tickets'),
  ('consulting',    'Consulting',    'consulting',    'Client deliverables, engagement reviews, time entries');