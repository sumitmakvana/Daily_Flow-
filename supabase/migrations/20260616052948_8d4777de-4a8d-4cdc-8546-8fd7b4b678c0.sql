CREATE TABLE public.work_item_field_defs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type_id uuid NOT NULL REFERENCES public.work_item_types(id) ON DELETE CASCADE,
  key text NOT NULL,
  label text NOT NULL,
  data_type text NOT NULL CHECK (data_type IN
    ('text','number','date','datetime','boolean','select','multiselect','user','url','email')),
  required boolean NOT NULL DEFAULT false,
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  validation jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (type_id, key),
  CONSTRAINT wifd_key_snake CHECK (key ~ '^[a-z][a-z0-9_]*$')
);
CREATE INDEX idx_wifd_type ON public.work_item_field_defs(type_id, sort_order);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_item_field_defs TO authenticated;
GRANT ALL ON public.work_item_field_defs TO service_role;
ALTER TABLE public.work_item_field_defs ENABLE ROW LEVEL SECURITY;
CREATE POLICY wifd_read ON public.work_item_field_defs FOR SELECT TO authenticated USING (true);
CREATE POLICY wifd_admin ON public.work_item_field_defs FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_wifd_updated_at BEFORE UPDATE ON public.work_item_field_defs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.tasks ADD COLUMN custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX idx_tasks_custom_fields ON public.tasks USING gin (custom_fields);

-- Validation trigger
CREATE OR REPLACE FUNCTION public.tasks_validate_custom_fields()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
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

  -- Reject unknown keys
  FOR k, v IN SELECT * FROM jsonb_each(NEW.custom_fields) LOOP
    SELECT * INTO def FROM public.work_item_field_defs
      WHERE type_id = NEW.type_id AND key = k AND is_active = true;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Unknown custom field "%" for this work item type', k;
    END IF;

    -- Basic type checks (null allowed unless required)
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
      ELSE
        IF jsonb_typeof(v) NOT IN ('string','number') THEN
          RAISE EXCEPTION 'Field "%" must be a string', k; END IF;
    END CASE;
  END LOOP;

  -- Required check
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
END $$;

CREATE TRIGGER trg_tasks_validate_custom_fields
BEFORE INSERT OR UPDATE OF custom_fields, type_id ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.tasks_validate_custom_fields();