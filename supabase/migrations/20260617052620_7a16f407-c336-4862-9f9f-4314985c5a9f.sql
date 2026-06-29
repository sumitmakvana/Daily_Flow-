
-- ============================================================
-- Phase C: Commercialization & Pilot Readiness
-- ============================================================

-- 1. Auto-numbering on work_item_types ------------------------
ALTER TABLE public.work_item_types
  ADD COLUMN IF NOT EXISTS id_prefix text,
  ADD COLUMN IF NOT EXISTS id_seq bigint NOT NULL DEFAULT 0;

ALTER TABLE public.work_item_types
  ADD CONSTRAINT work_item_types_id_prefix_chk
  CHECK (id_prefix IS NULL OR id_prefix ~ '^[A-Z][A-Z0-9]{0,7}$');

CREATE OR REPLACE FUNCTION public.set_task_code()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  pfx text;
  n bigint;
  yr text;
BEGIN
  IF NEW.task_code IS NOT NULL AND NEW.task_code <> '' THEN
    RETURN NEW;
  END IF;
  SELECT id_prefix INTO pfx FROM public.work_item_types WHERE id = NEW.type_id;
  IF pfx IS NULL OR pfx = '' THEN
    NEW.task_code := 'T-' || LPAD(nextval('public.task_code_seq')::TEXT, 4, '0');
  ELSE
    UPDATE public.work_item_types
       SET id_seq = id_seq + 1
     WHERE id = NEW.type_id
     RETURNING id_seq INTO n;
    yr := to_char(now() AT TIME ZONE 'utc', 'YYYY');
    NEW.task_code := pfx || '-' || yr || '-' || LPAD(n::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

-- 2. config_snapshots ----------------------------------------
CREATE TABLE IF NOT EXISTS public.config_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('manual','pre_install','pre_import','pre_restore')),
  label text NOT NULL,
  payload jsonb NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, DELETE ON public.config_snapshots TO authenticated;
GRANT ALL ON public.config_snapshots TO service_role;
ALTER TABLE public.config_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cs_admin_read" ON public.config_snapshots FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "cs_admin_write" ON public.config_snapshots FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "cs_admin_delete" ON public.config_snapshots FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

-- helper: capture current config as jsonb
CREATE OR REPLACE FUNCTION public.capture_config_payload()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'version', 1,
    'captured_at', now(),
    'work_item_types', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM public.work_item_types t), '[]'::jsonb),
    'work_item_statuses', COALESCE((SELECT jsonb_agg(to_jsonb(s)) FROM public.work_item_statuses s), '[]'::jsonb),
    'work_item_transitions', COALESCE((SELECT jsonb_agg(to_jsonb(tr)) FROM public.work_item_transitions tr), '[]'::jsonb),
    'work_item_field_defs', COALESCE((SELECT jsonb_agg(to_jsonb(f)) FROM public.work_item_field_defs f), '[]'::jsonb),
    'approval_chains', COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM public.approval_chains c), '[]'::jsonb),
    'approval_steps', COALESCE((SELECT jsonb_agg(to_jsonb(s)) FROM public.approval_steps s), '[]'::jsonb),
    'org_roles', COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM public.org_roles r), '[]'::jsonb),
    'org_role_hierarchy', COALESCE((SELECT jsonb_agg(to_jsonb(h)) FROM public.org_role_hierarchy h), '[]'::jsonb)
  );
$$;

CREATE OR REPLACE FUNCTION public.snapshot_config(_label text, _kind text DEFAULT 'manual')
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE new_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'admin required';
  END IF;
  INSERT INTO public.config_snapshots(kind,label,payload,created_by)
  VALUES (_kind, _label, public.capture_config_payload(), auth.uid())
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

-- restore: upsert by natural keys; does not touch user-owned data (tasks etc.)
CREATE OR REPLACE FUNCTION public.restore_config(_snapshot_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  snap jsonb;
  rec jsonb;
  type_id_local uuid;
  status_id_local uuid;
  chain_id_local uuid;
  role_id_local uuid;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'admin required';
  END IF;
  -- auto-snapshot current state first
  PERFORM public.snapshot_config('Auto: before restore', 'pre_restore');

  SELECT payload INTO snap FROM public.config_snapshots WHERE id = _snapshot_id;
  IF snap IS NULL THEN RAISE EXCEPTION 'snapshot not found'; END IF;

  -- org_roles
  FOR rec IN SELECT * FROM jsonb_array_elements(COALESCE(snap->'org_roles','[]'::jsonb)) LOOP
    INSERT INTO public.org_roles(key,label,description,sort_order,is_system,is_active)
    VALUES (rec->>'key', rec->>'label', rec->>'description',
            COALESCE((rec->>'sort_order')::int,100),
            COALESCE((rec->>'is_system')::bool,false),
            COALESCE((rec->>'is_active')::bool,true))
    ON CONFLICT (key) DO UPDATE SET
      label=EXCLUDED.label, description=EXCLUDED.description,
      sort_order=EXCLUDED.sort_order, is_active=EXCLUDED.is_active;
  END LOOP;

  -- work_item_types
  FOR rec IN SELECT * FROM jsonb_array_elements(COALESCE(snap->'work_item_types','[]'::jsonb)) LOOP
    INSERT INTO public.work_item_types(key,name,description,icon,color,sort_order,active,id_prefix)
    VALUES (rec->>'key', rec->>'name', rec->>'description', rec->>'icon', rec->>'color',
            COALESCE((rec->>'sort_order')::int,100),
            COALESCE((rec->>'active')::bool,true),
            rec->>'id_prefix')
    ON CONFLICT (key) DO UPDATE SET
      name=EXCLUDED.name, description=EXCLUDED.description, icon=EXCLUDED.icon,
      color=EXCLUDED.color, sort_order=EXCLUDED.sort_order,
      active=EXCLUDED.active, id_prefix=EXCLUDED.id_prefix;
  END LOOP;

  -- statuses
  FOR rec IN SELECT * FROM jsonb_array_elements(COALESCE(snap->'work_item_statuses','[]'::jsonb)) LOOP
    SELECT id INTO type_id_local FROM public.work_item_types WHERE id = (rec->>'type_id')::uuid
      OR key = (SELECT key FROM public.work_item_types WHERE id = (rec->>'type_id')::uuid) LIMIT 1;
    IF type_id_local IS NULL THEN CONTINUE; END IF;
    INSERT INTO public.work_item_statuses(type_id,key,label,category,color,sort_order,is_initial,is_terminal)
    VALUES (type_id_local, rec->>'key', rec->>'label', rec->>'category', rec->>'color',
            COALESCE((rec->>'sort_order')::int,0),
            COALESCE((rec->>'is_initial')::bool,false),
            COALESCE((rec->>'is_terminal')::bool,false))
    ON CONFLICT (type_id,key) DO UPDATE SET
      label=EXCLUDED.label, category=EXCLUDED.category, color=EXCLUDED.color,
      sort_order=EXCLUDED.sort_order, is_initial=EXCLUDED.is_initial,
      is_terminal=EXCLUDED.is_terminal;
  END LOOP;

  -- field defs
  FOR rec IN SELECT * FROM jsonb_array_elements(COALESCE(snap->'work_item_field_defs','[]'::jsonb)) LOOP
    INSERT INTO public.work_item_field_defs(type_id,key,label,data_type,required,options,validation,sort_order,is_active,required_for_completion)
    VALUES ((rec->>'type_id')::uuid, rec->>'key', rec->>'label', rec->>'data_type',
            COALESCE((rec->>'required')::bool,false),
            COALESCE(rec->'options','[]'::jsonb),
            COALESCE(rec->'validation','{}'::jsonb),
            COALESCE((rec->>'sort_order')::int,0),
            COALESCE((rec->>'is_active')::bool,true),
            COALESCE((rec->>'required_for_completion')::bool,false))
    ON CONFLICT (type_id,key) DO UPDATE SET
      label=EXCLUDED.label, data_type=EXCLUDED.data_type, required=EXCLUDED.required,
      options=EXCLUDED.options, validation=EXCLUDED.validation, sort_order=EXCLUDED.sort_order,
      is_active=EXCLUDED.is_active, required_for_completion=EXCLUDED.required_for_completion;
  END LOOP;
END;
$$;

-- 3. tenant_onboarding ---------------------------------------
CREATE TABLE IF NOT EXISTS public.tenant_onboarding (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  current_step smallint NOT NULL DEFAULT 0,
  industry text,
  completed_at timestamptz,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.tenant_onboarding(id) VALUES (1) ON CONFLICT DO NOTHING;

GRANT SELECT, UPDATE ON public.tenant_onboarding TO authenticated;
GRANT ALL ON public.tenant_onboarding TO service_role;
ALTER TABLE public.tenant_onboarding ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tob_read" ON public.tenant_onboarding FOR SELECT TO authenticated USING (true);
CREATE POLICY "tob_admin_write" ON public.tenant_onboarding FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TRIGGER trg_tob_updated_at BEFORE UPDATE ON public.tenant_onboarding
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. Rewrite install_template -------------------------------
CREATE OR REPLACE FUNCTION public.install_template(_template_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  caller uuid := auth.uid();
  tpl public.industry_templates;
  comp record;
  refs jsonb := '{}'::jsonb;
  new_id uuid;
  type_id_local uuid;
  chain_id_local uuid;
  role_id_local uuid;
BEGIN
  IF NOT public.has_role(caller,'admin') THEN
    RAISE EXCEPTION 'admin required';
  END IF;
  SELECT * INTO tpl FROM public.industry_templates WHERE id = _template_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'template not found'; END IF;

  PERFORM public.snapshot_config('Auto: before installing '||tpl.name, 'pre_install');

  FOR comp IN
    SELECT * FROM public.template_components
     WHERE template_id = _template_id ORDER BY apply_order, created_at
  LOOP
    CASE comp.component_kind
      WHEN 'work_item_type' THEN
        INSERT INTO public.work_item_types(key,name,icon,color,description,sort_order,id_prefix)
        VALUES (comp.payload->>'key',
                COALESCE(comp.payload->>'name', comp.payload->>'label'),
                comp.payload->>'icon', comp.payload->>'color',
                comp.payload->>'description',
                COALESCE((comp.payload->>'sort_order')::int,100),
                comp.payload->>'id_prefix')
        ON CONFLICT (key) DO UPDATE SET
          name = COALESCE(EXCLUDED.name, public.work_item_types.name),
          icon = COALESCE(EXCLUDED.icon, public.work_item_types.icon),
          color = COALESCE(EXCLUDED.color, public.work_item_types.color),
          description = COALESCE(EXCLUDED.description, public.work_item_types.description),
          id_prefix = COALESCE(EXCLUDED.id_prefix, public.work_item_types.id_prefix)
        RETURNING id INTO new_id;
        refs := refs || jsonb_build_object(comp.payload->>'ref', new_id::text);

      WHEN 'status' THEN
        type_id_local := (refs->>(comp.payload->>'type_ref'))::uuid;
        IF type_id_local IS NULL THEN CONTINUE; END IF;
        INSERT INTO public.work_item_statuses(type_id,key,label,category,color,sort_order,is_initial,is_terminal)
        VALUES (type_id_local, comp.payload->>'key', comp.payload->>'label',
                comp.payload->>'category', comp.payload->>'color',
                COALESCE((comp.payload->>'sort_order')::int,0),
                COALESCE((comp.payload->>'is_initial')::bool,false),
                COALESCE((comp.payload->>'is_terminal')::bool,false))
        ON CONFLICT (type_id,key) DO UPDATE SET label=EXCLUDED.label
        RETURNING id INTO new_id;
        refs := refs || jsonb_build_object(comp.payload->>'ref', new_id::text);

      WHEN 'field_def' THEN
        type_id_local := (refs->>(comp.payload->>'type_ref'))::uuid;
        IF type_id_local IS NULL THEN CONTINUE; END IF;
        INSERT INTO public.work_item_field_defs(type_id,key,label,data_type,required,options,validation,sort_order,required_for_completion)
        VALUES (type_id_local, comp.payload->>'key', comp.payload->>'label',
                comp.payload->>'data_type',
                COALESCE((comp.payload->>'required')::bool,false),
                COALESCE(comp.payload->'options','[]'::jsonb),
                COALESCE(comp.payload->'validation','{}'::jsonb),
                COALESCE((comp.payload->>'sort_order')::int,0),
                COALESCE((comp.payload->>'required_for_completion')::bool,false))
        ON CONFLICT (type_id,key) DO UPDATE SET
          label=EXCLUDED.label, data_type=EXCLUDED.data_type,
          required=EXCLUDED.required, required_for_completion=EXCLUDED.required_for_completion;

      WHEN 'transition' THEN
        type_id_local := (refs->>(comp.payload->>'type_ref'))::uuid;
        IF type_id_local IS NULL THEN CONTINUE; END IF;
        INSERT INTO public.work_item_transitions(type_id,from_status_id,to_status_id,label,sort_order,guard_expr,required_role_key)
        VALUES (type_id_local,
                NULLIF(refs->>(comp.payload->>'from_ref'),'')::uuid,
                (refs->>(comp.payload->>'to_ref'))::uuid,
                comp.payload->>'label',
                COALESCE((comp.payload->>'sort_order')::int,0),
                COALESCE(comp.payload->'guard_expr','{}'::jsonb),
                comp.payload->>'required_role_key')
        ON CONFLICT DO NOTHING;

      WHEN 'org_role' THEN
        INSERT INTO public.org_roles(key,label,description,sort_order)
        VALUES (comp.payload->>'key', comp.payload->>'label',
                comp.payload->>'description',
                COALESCE((comp.payload->>'sort_order')::int,100))
        ON CONFLICT (key) DO UPDATE SET label=EXCLUDED.label;

      WHEN 'approval_chain' THEN
        type_id_local := (refs->>(comp.payload->>'type_ref'))::uuid;
        IF type_id_local IS NULL THEN CONTINUE; END IF;
        INSERT INTO public.approval_chains(type_id,name,description)
        VALUES (type_id_local, comp.payload->>'name', comp.payload->>'description')
        RETURNING id INTO new_id;
        refs := refs || jsonb_build_object(comp.payload->>'ref', new_id::text);

      WHEN 'approval_step' THEN
        chain_id_local := (refs->>(comp.payload->>'chain_ref'))::uuid;
        IF chain_id_local IS NULL THEN CONTINUE; END IF;
        INSERT INTO public.approval_steps(chain_id,step_order,name,approver_mode,approver_role_key,required_count,allow_self)
        VALUES (chain_id_local,
                COALESCE((comp.payload->>'step_order')::int,1),
                comp.payload->>'name',
                COALESCE(comp.payload->>'approver_mode','role'),
                comp.payload->>'approver_role_key',
                COALESCE((comp.payload->>'required_count')::int,1),
                COALESCE((comp.payload->>'allow_self')::bool,false))
        ON CONFLICT (chain_id,step_order) DO UPDATE SET
          name=EXCLUDED.name, approver_mode=EXCLUDED.approver_mode,
          approver_role_key=EXCLUDED.approver_role_key;

      ELSE NULL;
    END CASE;
  END LOOP;

  UPDATE public.industry_templates
     SET is_installed = true, installed_at = now(), installed_by = caller
   WHERE id = _template_id;
  RETURN _template_id;
END $$;

-- Allow 'org_role' as a valid component_kind
ALTER TABLE public.template_components
  DROP CONSTRAINT IF EXISTS template_components_component_kind_check;
ALTER TABLE public.template_components
  ADD CONSTRAINT template_components_component_kind_check
  CHECK (component_kind = ANY (ARRAY[
    'work_item_type','status','transition','field_def',
    'approval_chain','approval_step','org_role'
  ]));

-- 5. Seed 5 Industry Template Packs --------------------------
-- Clear existing components (currently empty) and reseed
DELETE FROM public.template_components
 WHERE template_id IN (SELECT id FROM public.industry_templates
                        WHERE key IN ('it_startup','pharma','adhesives','manufacturing','consulting'));

-- Update template descriptions
UPDATE public.industry_templates SET
  name = 'IT Engineering',
  description = 'Development Task, Bug, Release. Linear workflow, code-review gate. Prefix: ENG.'
WHERE key = 'it_startup';

UPDATE public.industry_templates SET
  name = 'Pharma Field Force',
  description = 'Doctor Visit, Sample Drop, Chemist Survey. Photo+Geo capture required. Area Manager → Regional Manager approval. Prefix: DV.'
WHERE key = 'pharma';

UPDATE public.industry_templates SET
  name = 'Adhesives Channel Ops',
  description = 'Dealer Visit (with Follow-Up branching), Order, Sample Request. Photo+Geo on visit. Prefix: DLR.'
WHERE key = 'adhesives';

UPDATE public.industry_templates SET
  name = 'Manufacturing Quality',
  description = 'Quality Inspection, Non-Conformance, CAPA. Supervisor → Plant Head two-step approval. Prefix: QI.'
WHERE key = 'manufacturing';

UPDATE public.industry_templates SET
  name = 'Consulting Delivery',
  description = 'Client Deliverable, Status Report, Change Request. Reviewer approval. Prefix: DEL.'
WHERE key = 'consulting';

-- Helper: build payload
DO $seed$
DECLARE tid uuid;
BEGIN
  -- ============ IT ENGINEERING ============
  SELECT id INTO tid FROM public.industry_templates WHERE key='it_startup';

  INSERT INTO public.template_components(template_id,component_kind,payload,apply_order) VALUES
  -- types
  (tid,'work_item_type', jsonb_build_object('ref','t_dev','key','dev_task','name','Development Task','icon','Code','color','#3b82f6','id_prefix','ENG','sort_order',10), 1),
  (tid,'work_item_type', jsonb_build_object('ref','t_bug','key','bug','name','Bug','icon','Bug','color','#ef4444','id_prefix','BUG','sort_order',20), 2),
  (tid,'work_item_type', jsonb_build_object('ref','t_rel','key','release','name','Release','icon','Rocket','color','#10b981','id_prefix','REL','sort_order',30), 3),
  -- dev statuses
  (tid,'status', jsonb_build_object('ref','s_dev_todo','type_ref','t_dev','key','todo','label','To Do','category','todo','sort_order',1,'is_initial',true), 10),
  (tid,'status', jsonb_build_object('ref','s_dev_prog','type_ref','t_dev','key','in_progress','label','In Progress','category','in_progress','sort_order',2), 11),
  (tid,'status', jsonb_build_object('ref','s_dev_rev','type_ref','t_dev','key','in_review','label','In Review','category','in_progress','sort_order',3), 12),
  (tid,'status', jsonb_build_object('ref','s_dev_done','type_ref','t_dev','key','done','label','Done','category','done','sort_order',4,'is_terminal',true), 13),
  -- dev transitions
  (tid,'transition', jsonb_build_object('type_ref','t_dev','from_ref','s_dev_todo','to_ref','s_dev_prog','label','Start work'), 20),
  (tid,'transition', jsonb_build_object('type_ref','t_dev','from_ref','s_dev_prog','to_ref','s_dev_rev','label','Request review'), 21),
  (tid,'transition', jsonb_build_object('type_ref','t_dev','from_ref','s_dev_rev','to_ref','s_dev_done','label','Approve & merge'), 22),
  (tid,'transition', jsonb_build_object('type_ref','t_dev','from_ref','s_dev_rev','to_ref','s_dev_prog','label','Changes requested'), 23),
  -- dev fields
  (tid,'field_def', jsonb_build_object('type_ref','t_dev','key','repo','label','Repository','data_type','text','sort_order',1), 30),
  (tid,'field_def', jsonb_build_object('type_ref','t_dev','key','pr_url','label','Pull Request URL','data_type','url','sort_order',2), 31),
  (tid,'field_def', jsonb_build_object('type_ref','t_dev','key','story_points','label','Story Points','data_type','number','sort_order',3), 32),
  -- bug
  (tid,'status', jsonb_build_object('ref','s_bug_open','type_ref','t_bug','key','open','label','Open','category','todo','sort_order',1,'is_initial',true), 40),
  (tid,'status', jsonb_build_object('ref','s_bug_fix','type_ref','t_bug','key','fixing','label','Fixing','category','in_progress','sort_order',2), 41),
  (tid,'status', jsonb_build_object('ref','s_bug_ver','type_ref','t_bug','key','verifying','label','Verifying','category','in_progress','sort_order',3), 42),
  (tid,'status', jsonb_build_object('ref','s_bug_closed','type_ref','t_bug','key','closed','label','Closed','category','done','sort_order',4,'is_terminal',true), 43),
  (tid,'transition', jsonb_build_object('type_ref','t_bug','from_ref','s_bug_open','to_ref','s_bug_fix','label','Start fix'), 50),
  (tid,'transition', jsonb_build_object('type_ref','t_bug','from_ref','s_bug_fix','to_ref','s_bug_ver','label','Send to QA'), 51),
  (tid,'transition', jsonb_build_object('type_ref','t_bug','from_ref','s_bug_ver','to_ref','s_bug_closed','label','QA passed'), 52),
  (tid,'transition', jsonb_build_object('type_ref','t_bug','from_ref','s_bug_ver','to_ref','s_bug_fix','label','QA failed'), 53),
  (tid,'field_def', jsonb_build_object('type_ref','t_bug','key','severity','label','Severity','data_type','select','options', '["S1","S2","S3","S4"]'::jsonb,'required',true,'sort_order',1), 60),
  (tid,'field_def', jsonb_build_object('type_ref','t_bug','key','steps_to_reproduce','label','Steps to Reproduce','data_type','text','required',true,'sort_order',2), 61),
  -- release
  (tid,'status', jsonb_build_object('ref','s_rel_plan','type_ref','t_rel','key','planned','label','Planned','category','todo','sort_order',1,'is_initial',true), 70),
  (tid,'status', jsonb_build_object('ref','s_rel_stg','type_ref','t_rel','key','staging','label','In Staging','category','in_progress','sort_order',2), 71),
  (tid,'status', jsonb_build_object('ref','s_rel_prod','type_ref','t_rel','key','released','label','Released','category','done','sort_order',3,'is_terminal',true), 72),
  (tid,'transition', jsonb_build_object('type_ref','t_rel','from_ref','s_rel_plan','to_ref','s_rel_stg','label','Deploy to staging'), 80),
  (tid,'transition', jsonb_build_object('type_ref','t_rel','from_ref','s_rel_stg','to_ref','s_rel_prod','label','Release to production'), 81),
  (tid,'field_def', jsonb_build_object('type_ref','t_rel','key','version','label','Version','data_type','text','required',true,'sort_order',1), 90),
  (tid,'field_def', jsonb_build_object('type_ref','t_rel','key','release_notes_url','label','Release Notes','data_type','url','sort_order',2), 91);

  -- ============ PHARMA ============
  SELECT id INTO tid FROM public.industry_templates WHERE key='pharma';

  INSERT INTO public.template_components(template_id,component_kind,payload,apply_order) VALUES
  (tid,'org_role', jsonb_build_object('key','medical_rep','label','Medical Representative','sort_order',50), 1),
  (tid,'org_role', jsonb_build_object('key','area_manager','label','Area Manager','sort_order',40), 2),
  (tid,'org_role', jsonb_build_object('key','regional_manager','label','Regional Manager','sort_order',30), 3),
  (tid,'work_item_type', jsonb_build_object('ref','t_dv','key','doctor_visit','name','Doctor Visit','icon','Stethoscope','color','#06b6d4','id_prefix','DV','sort_order',10), 10),
  (tid,'work_item_type', jsonb_build_object('ref','t_sd','key','sample_drop','name','Sample Drop','icon','Package','color','#8b5cf6','id_prefix','SMP','sort_order',20), 11),
  (tid,'work_item_type', jsonb_build_object('ref','t_cs','key','chemist_survey','name','Chemist Survey','icon','ClipboardCheck','color','#f59e0b','id_prefix','CHM','sort_order',30), 12),
  -- doctor visit workflow
  (tid,'status', jsonb_build_object('ref','s_dv_plan','type_ref','t_dv','key','planned','label','Planned','category','todo','sort_order',1,'is_initial',true), 20),
  (tid,'status', jsonb_build_object('ref','s_dv_check','type_ref','t_dv','key','checked_in','label','Checked In','category','in_progress','sort_order',2), 21),
  (tid,'status', jsonb_build_object('ref','s_dv_sub','type_ref','t_dv','key','submitted','label','Submitted','category','review','sort_order',3), 22),
  (tid,'status', jsonb_build_object('ref','s_dv_app','type_ref','t_dv','key','approved','label','Approved','category','done','sort_order',4,'is_terminal',true), 23),
  (tid,'transition', jsonb_build_object('type_ref','t_dv','from_ref','s_dv_plan','to_ref','s_dv_check','label','Check in'), 30),
  (tid,'transition', jsonb_build_object('type_ref','t_dv','from_ref','s_dv_check','to_ref','s_dv_sub','label','Submit visit'), 31),
  (tid,'transition', jsonb_build_object('type_ref','t_dv','from_ref','s_dv_sub','to_ref','s_dv_app','label','Approve','required_role_key','area_manager'), 32),
  -- doctor visit fields (photo+geo required for completion)
  (tid,'field_def', jsonb_build_object('type_ref','t_dv','key','doctor_name','label','Doctor Name','data_type','text','required',true,'sort_order',1), 40),
  (tid,'field_def', jsonb_build_object('type_ref','t_dv','key','clinic','label','Clinic / Hospital','data_type','text','required',true,'sort_order',2), 41),
  (tid,'field_def', jsonb_build_object('type_ref','t_dv','key','products_discussed','label','Products Discussed','data_type','multiselect','options','["Product A","Product B","Product C"]'::jsonb,'sort_order',3), 42),
  (tid,'field_def', jsonb_build_object('type_ref','t_dv','key','visit_proof','label','Visit Proof (Photo + Location)','data_type','photo_geo','required_for_completion',true,'sort_order',4), 43),
  (tid,'field_def', jsonb_build_object('type_ref','t_dv','key','next_call_date','label','Next Call Date','data_type','date','sort_order',5), 44),
  -- approval chain
  (tid,'approval_chain', jsonb_build_object('ref','c_dv','type_ref','t_dv','name','Doctor Visit Approval'), 50),
  (tid,'approval_step', jsonb_build_object('chain_ref','c_dv','step_order',1,'name','Area Manager Review','approver_mode','role','approver_role_key','area_manager'), 51),
  (tid,'approval_step', jsonb_build_object('chain_ref','c_dv','step_order',2,'name','Regional Manager Sign-off','approver_mode','role','approver_role_key','regional_manager'), 52),
  -- sample drop
  (tid,'status', jsonb_build_object('ref','s_sd_pen','type_ref','t_sd','key','pending','label','Pending','category','todo','sort_order',1,'is_initial',true), 60),
  (tid,'status', jsonb_build_object('ref','s_sd_del','type_ref','t_sd','key','delivered','label','Delivered','category','done','sort_order',2,'is_terminal',true), 61),
  (tid,'transition', jsonb_build_object('type_ref','t_sd','from_ref','s_sd_pen','to_ref','s_sd_del','label','Mark delivered'), 70),
  (tid,'field_def', jsonb_build_object('type_ref','t_sd','key','product','label','Product','data_type','text','required',true,'sort_order',1), 80),
  (tid,'field_def', jsonb_build_object('type_ref','t_sd','key','quantity','label','Quantity','data_type','number','required',true,'sort_order',2), 81),
  (tid,'field_def', jsonb_build_object('type_ref','t_sd','key','recipient_signature','label','Recipient Signature','data_type','signature','required_for_completion',true,'sort_order',3), 82),
  -- chemist survey
  (tid,'status', jsonb_build_object('ref','s_cs_open','type_ref','t_cs','key','open','label','Open','category','todo','sort_order',1,'is_initial',true), 90),
  (tid,'status', jsonb_build_object('ref','s_cs_done','type_ref','t_cs','key','completed','label','Completed','category','done','sort_order',2,'is_terminal',true), 91),
  (tid,'transition', jsonb_build_object('type_ref','t_cs','from_ref','s_cs_open','to_ref','s_cs_done','label','Submit survey'), 100),
  (tid,'field_def', jsonb_build_object('type_ref','t_cs','key','chemist_name','label','Chemist Name','data_type','text','required',true,'sort_order',1), 110),
  (tid,'field_def', jsonb_build_object('type_ref','t_cs','key','stock_available','label','Stock Available','data_type','boolean','sort_order',2), 111),
  (tid,'field_def', jsonb_build_object('type_ref','t_cs','key','survey_proof','label','Store Photo','data_type','photo_geo','required_for_completion',true,'sort_order',3), 112);

  -- ============ ADHESIVES ============
  SELECT id INTO tid FROM public.industry_templates WHERE key='adhesives';

  INSERT INTO public.template_components(template_id,component_kind,payload,apply_order) VALUES
  (tid,'org_role', jsonb_build_object('key','sales_executive','label','Sales Executive','sort_order',50), 1),
  (tid,'org_role', jsonb_build_object('key','sales_manager','label','Sales Manager','sort_order',40), 2),
  (tid,'work_item_type', jsonb_build_object('ref','t_dlr','key','dealer_visit','name','Dealer Visit','icon','Store','color','#f97316','id_prefix','DLR','sort_order',10), 10),
  (tid,'work_item_type', jsonb_build_object('ref','t_ord','key','order','name','Order','icon','ShoppingCart','color','#10b981','id_prefix','ORD','sort_order',20), 11),
  (tid,'work_item_type', jsonb_build_object('ref','t_smp','key','sample_request','name','Sample Request','icon','Package','color','#8b5cf6','id_prefix','SMP','sort_order',30), 12),
  -- dealer visit with branching follow-up
  (tid,'status', jsonb_build_object('ref','s_dlr_plan','type_ref','t_dlr','key','planned','label','Planned','category','todo','sort_order',1,'is_initial',true), 20),
  (tid,'status', jsonb_build_object('ref','s_dlr_visit','type_ref','t_dlr','key','visited','label','Visited','category','in_progress','sort_order',2), 21),
  (tid,'status', jsonb_build_object('ref','s_dlr_fu','type_ref','t_dlr','key','follow_up','label','Follow Up','category','in_progress','sort_order',3), 22),
  (tid,'status', jsonb_build_object('ref','s_dlr_closed','type_ref','t_dlr','key','closed','label','Closed','category','done','sort_order',4,'is_terminal',true), 23),
  (tid,'transition', jsonb_build_object('type_ref','t_dlr','from_ref','s_dlr_plan','to_ref','s_dlr_visit','label','Check in'), 30),
  -- branching based on follow_up_required field
  (tid,'transition', jsonb_build_object('type_ref','t_dlr','from_ref','s_dlr_visit','to_ref','s_dlr_fu','label','Schedule follow-up',
       'guard_expr', '{"all":[{"field":"follow_up_required","op":"eq","value":true}]}'::jsonb), 31),
  (tid,'transition', jsonb_build_object('type_ref','t_dlr','from_ref','s_dlr_visit','to_ref','s_dlr_closed','label','Close visit',
       'guard_expr', '{"all":[{"field":"follow_up_required","op":"eq","value":false}]}'::jsonb), 32),
  (tid,'transition', jsonb_build_object('type_ref','t_dlr','from_ref','s_dlr_fu','to_ref','s_dlr_visit','label','Re-visit'), 33),
  (tid,'transition', jsonb_build_object('type_ref','t_dlr','from_ref','s_dlr_fu','to_ref','s_dlr_closed','label','Close after follow-up'), 34),
  (tid,'field_def', jsonb_build_object('type_ref','t_dlr','key','dealer_name','label','Dealer Name','data_type','text','required',true,'sort_order',1), 40),
  (tid,'field_def', jsonb_build_object('type_ref','t_dlr','key','visit_proof','label','Storefront Photo + Location','data_type','photo_geo','required_for_completion',true,'sort_order',2), 41),
  (tid,'field_def', jsonb_build_object('type_ref','t_dlr','key','follow_up_required','label','Follow-Up Required?','data_type','boolean','required',true,'sort_order',3), 42),
  (tid,'field_def', jsonb_build_object('type_ref','t_dlr','key','notes','label','Visit Notes','data_type','text','sort_order',4), 43),
  -- order
  (tid,'status', jsonb_build_object('ref','s_ord_draft','type_ref','t_ord','key','draft','label','Draft','category','todo','sort_order',1,'is_initial',true), 50),
  (tid,'status', jsonb_build_object('ref','s_ord_sub','type_ref','t_ord','key','submitted','label','Submitted','category','review','sort_order',2), 51),
  (tid,'status', jsonb_build_object('ref','s_ord_app','type_ref','t_ord','key','approved','label','Approved','category','done','sort_order',3,'is_terminal',true), 52),
  (tid,'transition', jsonb_build_object('type_ref','t_ord','from_ref','s_ord_draft','to_ref','s_ord_sub','label','Submit order'), 60),
  (tid,'transition', jsonb_build_object('type_ref','t_ord','from_ref','s_ord_sub','to_ref','s_ord_app','label','Approve','required_role_key','sales_manager'), 61),
  (tid,'approval_chain', jsonb_build_object('ref','c_ord','type_ref','t_ord','name','Order Approval'), 65),
  (tid,'approval_step', jsonb_build_object('chain_ref','c_ord','step_order',1,'name','Sales Manager Approval','approver_mode','role','approver_role_key','sales_manager'), 66),
  (tid,'field_def', jsonb_build_object('type_ref','t_ord','key','order_value','label','Order Value','data_type','number','required',true,'sort_order',1), 70),
  (tid,'field_def', jsonb_build_object('type_ref','t_ord','key','dealer_name','label','Dealer','data_type','text','required',true,'sort_order',2), 71),
  -- sample request
  (tid,'status', jsonb_build_object('ref','s_smp_req','type_ref','t_smp','key','requested','label','Requested','category','todo','sort_order',1,'is_initial',true), 80),
  (tid,'status', jsonb_build_object('ref','s_smp_ship','type_ref','t_smp','key','shipped','label','Shipped','category','done','sort_order',2,'is_terminal',true), 81),
  (tid,'transition', jsonb_build_object('type_ref','t_smp','from_ref','s_smp_req','to_ref','s_smp_ship','label','Mark shipped'), 90),
  (tid,'field_def', jsonb_build_object('type_ref','t_smp','key','product','label','Product','data_type','text','required',true,'sort_order',1), 100);

  -- ============ MANUFACTURING ============
  SELECT id INTO tid FROM public.industry_templates WHERE key='manufacturing';

  INSERT INTO public.template_components(template_id,component_kind,payload,apply_order) VALUES
  (tid,'org_role', jsonb_build_object('key','inspector','label','Quality Inspector','sort_order',50), 1),
  (tid,'org_role', jsonb_build_object('key','supervisor','label','Shift Supervisor','sort_order',40), 2),
  (tid,'org_role', jsonb_build_object('key','plant_head','label','Plant Head','sort_order',30), 3),
  (tid,'work_item_type', jsonb_build_object('ref','t_qi','key','quality_inspection','name','Quality Inspection','icon','ShieldCheck','color','#0ea5e9','id_prefix','QI','sort_order',10), 10),
  (tid,'work_item_type', jsonb_build_object('ref','t_nc','key','non_conformance','name','Non-Conformance','icon','AlertTriangle','color','#ef4444','id_prefix','NC','sort_order',20), 11),
  (tid,'work_item_type', jsonb_build_object('ref','t_capa','key','capa','name','CAPA','icon','Wrench','color','#f59e0b','id_prefix','CAPA','sort_order',30), 12),
  -- quality inspection
  (tid,'status', jsonb_build_object('ref','s_qi_open','type_ref','t_qi','key','open','label','Open','category','todo','sort_order',1,'is_initial',true), 20),
  (tid,'status', jsonb_build_object('ref','s_qi_insp','type_ref','t_qi','key','inspecting','label','Inspecting','category','in_progress','sort_order',2), 21),
  (tid,'status', jsonb_build_object('ref','s_qi_rev','type_ref','t_qi','key','in_review','label','In Review','category','review','sort_order',3), 22),
  (tid,'status', jsonb_build_object('ref','s_qi_pass','type_ref','t_qi','key','passed','label','Passed','category','done','sort_order',4,'is_terminal',true), 23),
  (tid,'status', jsonb_build_object('ref','s_qi_fail','type_ref','t_qi','key','failed','label','Failed','category','done','sort_order',5,'is_terminal',true), 24),
  (tid,'transition', jsonb_build_object('type_ref','t_qi','from_ref','s_qi_open','to_ref','s_qi_insp','label','Start inspection'), 30),
  (tid,'transition', jsonb_build_object('type_ref','t_qi','from_ref','s_qi_insp','to_ref','s_qi_rev','label','Submit'), 31),
  (tid,'transition', jsonb_build_object('type_ref','t_qi','from_ref','s_qi_rev','to_ref','s_qi_pass','label','Pass','required_role_key','plant_head'), 32),
  (tid,'transition', jsonb_build_object('type_ref','t_qi','from_ref','s_qi_rev','to_ref','s_qi_fail','label','Fail','required_role_key','plant_head'), 33),
  (tid,'field_def', jsonb_build_object('type_ref','t_qi','key','batch_number','label','Batch Number','data_type','text','required',true,'sort_order',1), 40),
  (tid,'field_def', jsonb_build_object('type_ref','t_qi','key','line','label','Production Line','data_type','select','options','["Line 1","Line 2","Line 3"]'::jsonb,'required',true,'sort_order',2), 41),
  (tid,'field_def', jsonb_build_object('type_ref','t_qi','key','defect_count','label','Defect Count','data_type','number','sort_order',3), 42),
  (tid,'field_def', jsonb_build_object('type_ref','t_qi','key','inspection_photo','label','Inspection Photo','data_type','photo','required_for_completion',true,'sort_order',4), 43),
  -- two-step approval
  (tid,'approval_chain', jsonb_build_object('ref','c_qi','type_ref','t_qi','name','Quality Sign-off'), 50),
  (tid,'approval_step', jsonb_build_object('chain_ref','c_qi','step_order',1,'name','Supervisor Review','approver_mode','role','approver_role_key','supervisor'), 51),
  (tid,'approval_step', jsonb_build_object('chain_ref','c_qi','step_order',2,'name','Plant Head Sign-off','approver_mode','role','approver_role_key','plant_head'), 52),
  -- non-conformance
  (tid,'status', jsonb_build_object('ref','s_nc_open','type_ref','t_nc','key','open','label','Open','category','todo','sort_order',1,'is_initial',true), 60),
  (tid,'status', jsonb_build_object('ref','s_nc_inv','type_ref','t_nc','key','investigating','label','Investigating','category','in_progress','sort_order',2), 61),
  (tid,'status', jsonb_build_object('ref','s_nc_res','type_ref','t_nc','key','resolved','label','Resolved','category','done','sort_order',3,'is_terminal',true), 62),
  (tid,'transition', jsonb_build_object('type_ref','t_nc','from_ref','s_nc_open','to_ref','s_nc_inv','label','Investigate'), 70),
  (tid,'transition', jsonb_build_object('type_ref','t_nc','from_ref','s_nc_inv','to_ref','s_nc_res','label','Resolve'), 71),
  (tid,'field_def', jsonb_build_object('type_ref','t_nc','key','severity','label','Severity','data_type','select','options','["Minor","Major","Critical"]'::jsonb,'required',true,'sort_order',1), 80),
  (tid,'field_def', jsonb_build_object('type_ref','t_nc','key','root_cause','label','Root Cause','data_type','text','sort_order',2), 81),
  -- CAPA
  (tid,'status', jsonb_build_object('ref','s_capa_plan','type_ref','t_capa','key','planned','label','Planned','category','todo','sort_order',1,'is_initial',true), 90),
  (tid,'status', jsonb_build_object('ref','s_capa_done','type_ref','t_capa','key','closed','label','Closed','category','done','sort_order',2,'is_terminal',true), 91),
  (tid,'transition', jsonb_build_object('type_ref','t_capa','from_ref','s_capa_plan','to_ref','s_capa_done','label','Close CAPA','required_role_key','plant_head'), 100),
  (tid,'field_def', jsonb_build_object('type_ref','t_capa','key','corrective_action','label','Corrective Action','data_type','text','required',true,'sort_order',1), 110),
  (tid,'field_def', jsonb_build_object('type_ref','t_capa','key','target_date','label','Target Date','data_type','date','required',true,'sort_order',2), 111);

  -- ============ CONSULTING ============
  SELECT id INTO tid FROM public.industry_templates WHERE key='consulting';

  INSERT INTO public.template_components(template_id,component_kind,payload,apply_order) VALUES
  (tid,'org_role', jsonb_build_object('key','consultant','label','Consultant','sort_order',50), 1),
  (tid,'org_role', jsonb_build_object('key','project_manager','label','Project Manager','sort_order',40), 2),
  (tid,'work_item_type', jsonb_build_object('ref','t_del','key','deliverable','name','Client Deliverable','icon','FileText','color','#6366f1','id_prefix','DEL','sort_order',10), 10),
  (tid,'work_item_type', jsonb_build_object('ref','t_sr','key','status_report','name','Status Report','icon','BarChart','color','#0ea5e9','id_prefix','SR','sort_order',20), 11),
  (tid,'work_item_type', jsonb_build_object('ref','t_cr','key','change_request','name','Change Request','icon','GitPullRequest','color','#f59e0b','id_prefix','CR','sort_order',30), 12),
  -- deliverable
  (tid,'status', jsonb_build_object('ref','s_del_draft','type_ref','t_del','key','draft','label','Draft','category','todo','sort_order',1,'is_initial',true), 20),
  (tid,'status', jsonb_build_object('ref','s_del_rev','type_ref','t_del','key','in_review','label','In Review','category','review','sort_order',2), 21),
  (tid,'status', jsonb_build_object('ref','s_del_del','type_ref','t_del','key','delivered','label','Delivered','category','done','sort_order',3,'is_terminal',true), 22),
  (tid,'transition', jsonb_build_object('type_ref','t_del','from_ref','s_del_draft','to_ref','s_del_rev','label','Submit for review'), 30),
  (tid,'transition', jsonb_build_object('type_ref','t_del','from_ref','s_del_rev','to_ref','s_del_del','label','Approve & deliver','required_role_key','project_manager'), 31),
  (tid,'transition', jsonb_build_object('type_ref','t_del','from_ref','s_del_rev','to_ref','s_del_draft','label','Send back'), 32),
  (tid,'field_def', jsonb_build_object('type_ref','t_del','key','client','label','Client','data_type','text','required',true,'sort_order',1), 40),
  (tid,'field_def', jsonb_build_object('type_ref','t_del','key','deliverable_type','label','Type','data_type','select','options','["Report","Presentation","Document","Code"]'::jsonb,'required',true,'sort_order',2), 41),
  (tid,'field_def', jsonb_build_object('type_ref','t_del','key','client_sign_off','label','Client Sign-off','data_type','signature','required_for_completion',true,'sort_order',3), 42),
  (tid,'approval_chain', jsonb_build_object('ref','c_del','type_ref','t_del','name','Deliverable Approval'), 50),
  (tid,'approval_step', jsonb_build_object('chain_ref','c_del','step_order',1,'name','Reviewer Sign-off','approver_mode','reviewer_field'), 51),
  -- status report
  (tid,'status', jsonb_build_object('ref','s_sr_open','type_ref','t_sr','key','open','label','Open','category','todo','sort_order',1,'is_initial',true), 60),
  (tid,'status', jsonb_build_object('ref','s_sr_sent','type_ref','t_sr','key','sent','label','Sent','category','done','sort_order',2,'is_terminal',true), 61),
  (tid,'transition', jsonb_build_object('type_ref','t_sr','from_ref','s_sr_open','to_ref','s_sr_sent','label','Send report'), 70),
  (tid,'field_def', jsonb_build_object('type_ref','t_sr','key','week_of','label','Week Of','data_type','date','required',true,'sort_order',1), 80),
  (tid,'field_def', jsonb_build_object('type_ref','t_sr','key','highlights','label','Highlights','data_type','text','required',true,'sort_order',2), 81),
  (tid,'field_def', jsonb_build_object('type_ref','t_sr','key','blockers','label','Blockers','data_type','text','sort_order',3), 82),
  -- change request
  (tid,'status', jsonb_build_object('ref','s_cr_sub','type_ref','t_cr','key','submitted','label','Submitted','category','todo','sort_order',1,'is_initial',true), 90),
  (tid,'status', jsonb_build_object('ref','s_cr_app','type_ref','t_cr','key','approved','label','Approved','category','done','sort_order',2,'is_terminal',true), 91),
  (tid,'status', jsonb_build_object('ref','s_cr_rej','type_ref','t_cr','key','rejected','label','Rejected','category','done','sort_order',3,'is_terminal',true), 92),
  (tid,'transition', jsonb_build_object('type_ref','t_cr','from_ref','s_cr_sub','to_ref','s_cr_app','label','Approve','required_role_key','project_manager'), 100),
  (tid,'transition', jsonb_build_object('type_ref','t_cr','from_ref','s_cr_sub','to_ref','s_cr_rej','label','Reject','required_role_key','project_manager'), 101),
  (tid,'field_def', jsonb_build_object('type_ref','t_cr','key','impact','label','Impact','data_type','select','options','["Low","Medium","High"]'::jsonb,'required',true,'sort_order',1), 110),
  (tid,'field_def', jsonb_build_object('type_ref','t_cr','key','justification','label','Justification','data_type','text','required',true,'sort_order',2), 111);
END $seed$;
