
-- =========================================================
-- P1: Tenant role catalog
-- =========================================================

CREATE TABLE public.org_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE CHECK (key ~ '^[a-z][a-z0-9_]*$'),
  label text NOT NULL,
  description text,
  sort_order int NOT NULL DEFAULT 100,
  is_system boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.org_roles TO authenticated;
GRANT ALL ON public.org_roles TO service_role;
ALTER TABLE public.org_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_roles_read" ON public.org_roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "org_roles_admin_write" ON public.org_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER trg_org_roles_updated_at BEFORE UPDATE ON public.org_roles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.org_role_hierarchy (
  parent_role_id uuid NOT NULL REFERENCES public.org_roles(id) ON DELETE CASCADE,
  child_role_id  uuid NOT NULL REFERENCES public.org_roles(id) ON DELETE CASCADE,
  PRIMARY KEY (parent_role_id, child_role_id),
  CHECK (parent_role_id <> child_role_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.org_role_hierarchy TO authenticated;
GRANT ALL ON public.org_role_hierarchy TO service_role;
ALTER TABLE public.org_role_hierarchy ENABLE ROW LEVEL SECURITY;
CREATE POLICY "orh_read" ON public.org_role_hierarchy FOR SELECT TO authenticated USING (true);
CREATE POLICY "orh_admin_write" ON public.org_role_hierarchy FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.user_org_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES public.org_roles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_org_roles TO authenticated;
GRANT ALL ON public.user_org_roles TO service_role;
ALTER TABLE public.user_org_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "uor_read" ON public.user_org_roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "uor_admin_write" ON public.user_org_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Seed system roles mirroring app_role enum
INSERT INTO public.org_roles(key, label, sort_order, is_system) VALUES
  ('admin',   'Admin',   10, true),
  ('manager', 'Manager', 20, true),
  ('member',  'Member',  30, true);

-- Backfill: every user_roles row → user_org_roles
INSERT INTO public.user_org_roles(user_id, role_id)
SELECT ur.user_id, r.id
  FROM public.user_roles ur
  JOIN public.org_roles r ON r.key = ur.role::text
ON CONFLICT DO NOTHING;

-- has_org_role: returns true if user has _role_key directly, OR has any parent role that inherits it.
-- Parent inherits child's permissions: if user has parent_role and parent → child mapping exists, user satisfies child.
CREATE OR REPLACE FUNCTION public.has_org_role(_user_id uuid, _role_key text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH RECURSIVE target AS (
    SELECT id FROM public.org_roles WHERE key = _role_key AND is_active
  ),
  -- ancestors of target = roles whose permission includes target
  ancestors AS (
    SELECT id FROM target
    UNION
    SELECT h.parent_role_id
      FROM public.org_role_hierarchy h
      JOIN ancestors a ON a.id = h.child_role_id
  )
  SELECT EXISTS (
    SELECT 1
      FROM public.user_org_roles uor
     WHERE uor.user_id = _user_id
       AND uor.role_id IN (SELECT id FROM ancestors)
  );
$$;

-- =========================================================
-- P1 bindings: approvals + transitions accept role keys
-- =========================================================

ALTER TABLE public.approval_steps
  ADD COLUMN approver_role_key text;

ALTER TABLE public.work_item_transitions
  ADD COLUMN required_role_key text;

-- Update is_request_approver to honour approver_role_key (with fallback to legacy enum)
CREATE OR REPLACE FUNCTION public.is_request_approver(_request_id uuid, _user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.approval_requests r
      JOIN public.approval_steps s ON s.chain_id = r.chain_id
      LEFT JOIN public.tasks t ON t.id = r.work_item_id
     WHERE r.id = _request_id
       AND (
         (s.approver_mode = 'user' AND s.approver_user_id = _user_id)
      OR (s.approver_mode = 'role' AND s.approver_role_key IS NOT NULL
          AND public.has_org_role(_user_id, s.approver_role_key))
      OR (s.approver_mode = 'role' AND s.approver_role_key IS NULL
          AND s.approver_role IS NOT NULL
          AND public.has_role(_user_id, s.approver_role))
      OR (s.approver_mode = 'reviewer_field' AND t.reviewer = _user_id)
       )
  );
$function$;

-- =========================================================
-- P2: Field-ops data types + required-for-completion
-- =========================================================

ALTER TABLE public.work_item_field_defs
  DROP CONSTRAINT work_item_field_defs_data_type_check;

ALTER TABLE public.work_item_field_defs
  ADD CONSTRAINT work_item_field_defs_data_type_check
  CHECK (data_type = ANY (ARRAY[
    'text','number','date','datetime','boolean','select','multiselect',
    'user','url','email',
    'photo','geo','photo_geo','signature'
  ]));

ALTER TABLE public.work_item_field_defs
  ADD COLUMN required_for_completion boolean NOT NULL DEFAULT false;

-- Extend custom-fields validator with new shapes
CREATE OR REPLACE FUNCTION public.tasks_validate_custom_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  k text; v jsonb; def record;
BEGIN
  IF NEW.custom_fields IS NULL THEN
    NEW.custom_fields := '{}'::jsonb;
    RETURN NEW;
  END IF;
  IF jsonb_typeof(NEW.custom_fields) <> 'object' THEN
    RAISE EXCEPTION 'custom_fields must be a JSON object';
  END IF;

  FOR k, v IN SELECT * FROM jsonb_each(NEW.custom_fields) LOOP
    SELECT * INTO def FROM public.work_item_field_defs
      WHERE type_id = NEW.type_id AND key = k AND is_active = true;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Unknown custom field "%" for this work item type', k;
    END IF;

    IF v IS NULL OR jsonb_typeof(v) = 'null' THEN CONTINUE; END IF;
    CASE def.data_type
      WHEN 'number' THEN
        IF jsonb_typeof(v) <> 'number' THEN
          RAISE EXCEPTION 'Field "%" must be a number', k; END IF;
      WHEN 'boolean' THEN
        IF jsonb_typeof(v) <> 'boolean' THEN
          RAISE EXCEPTION 'Field "%" must be a boolean', k; END IF;
      WHEN 'multiselect' THEN
        IF jsonb_typeof(v) <> 'array' THEN
          RAISE EXCEPTION 'Field "%" must be an array', k; END IF;
      WHEN 'photo', 'signature' THEN
        IF jsonb_typeof(v) <> 'object' OR NOT (v ? 'attachment_id') THEN
          RAISE EXCEPTION 'Field "%" must be { attachment_id, captured_at }', k; END IF;
      WHEN 'geo' THEN
        IF jsonb_typeof(v) <> 'object' OR NOT (v ? 'lat') OR NOT (v ? 'lng') THEN
          RAISE EXCEPTION 'Field "%" must be { lat, lng, accuracy_m?, captured_at? }', k; END IF;
      WHEN 'photo_geo' THEN
        IF jsonb_typeof(v) <> 'object' OR NOT (v ? 'attachment_id') OR NOT (v ? 'lat') OR NOT (v ? 'lng') THEN
          RAISE EXCEPTION 'Field "%" must include attachment_id, lat, lng', k; END IF;
      ELSE
        IF jsonb_typeof(v) NOT IN ('string','number') THEN
          RAISE EXCEPTION 'Field "%" must be a string', k; END IF;
    END CASE;
  END LOOP;

  FOR def IN
    SELECT key FROM public.work_item_field_defs
     WHERE type_id = NEW.type_id AND is_active = true AND required = true
  LOOP
    IF NOT (NEW.custom_fields ? def.key)
       OR jsonb_typeof(NEW.custom_fields -> def.key) = 'null' THEN
      RAISE EXCEPTION 'Required custom field "%" missing', def.key;
    END IF;
  END LOOP;
  RETURN NEW;
END $function$;

-- Block transitions into a terminal status when required_for_completion fields are missing
CREATE OR REPLACE FUNCTION public.tasks_enforce_completion_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  s public.work_item_statuses;
  def record;
BEGIN
  IF NEW.status_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.status_id IS NOT DISTINCT FROM OLD.status_id THEN
    RETURN NEW;
  END IF;
  SELECT * INTO s FROM public.work_item_statuses WHERE id = NEW.status_id;
  IF NOT FOUND OR s.is_terminal IS NOT TRUE THEN RETURN NEW; END IF;

  FOR def IN
    SELECT key, label FROM public.work_item_field_defs
     WHERE type_id = NEW.type_id AND is_active AND required_for_completion = true
  LOOP
    IF COALESCE(NEW.custom_fields, '{}'::jsonb) -> def.key IS NULL
       OR jsonb_typeof(COALESCE(NEW.custom_fields, '{}'::jsonb) -> def.key) = 'null' THEN
      RAISE EXCEPTION 'Cannot complete: "%" is required before this status', def.label;
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_tasks_enforce_completion_fields ON public.tasks;
CREATE TRIGGER trg_tasks_enforce_completion_fields
  BEFORE INSERT OR UPDATE OF status_id, custom_fields ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks_enforce_completion_fields();

-- =========================================================
-- P3: nothing else schema-wise; guard_expr already jsonb, label already exists,
--     required_role_key added above. Engine lives in app code.
-- =========================================================
