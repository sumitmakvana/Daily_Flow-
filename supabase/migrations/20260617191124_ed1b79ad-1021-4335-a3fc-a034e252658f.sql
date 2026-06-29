
-- M2 fix: server-side helper to set the depth GUC for the current transaction.
-- Worker calls this before each rule execution so any trigger-emitted child
-- events inherit depth+1.
CREATE OR REPLACE FUNCTION public.automation_set_depth(_depth int)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('app.automation_depth', GREATEST(_depth, 0)::text, true);
END $$;

REVOKE ALL ON FUNCTION public.automation_set_depth(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.automation_set_depth(int) TO service_role;

-- M6 completion: soft backpressure warning. Logs an ops failure the first
-- time a tick crosses the 5,000 pending-event soft cap in a 5-minute window.
-- Replaces the previous enqueue body to add soft-cap signaling while keeping
-- hard-cap drop semantics intact.
CREATE OR REPLACE FUNCTION public.enqueue_automation_event(
  _event_kind text,
  _entity_type text,
  _entity_id uuid,
  _payload jsonb DEFAULT '{}'::jsonb,
  _actor_id uuid DEFAULT NULL,
  _depth int DEFAULT NULL,
  _available_at timestamptz DEFAULT now()
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  qd bigint;
  new_id uuid;
  d int;
  low_pri CONSTANT text[] := ARRAY['comment.added','eod.submitted'];
  SOFT_CAP CONSTANT bigint := 5000;
  HARD_CAP CONSTANT bigint := 50000;
  last_soft timestamptz;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.automation_rules
     WHERE trigger_kind = _event_kind
       AND is_active = true AND auto_disabled_at IS NULL
  ) THEN
    RETURN NULL;
  END IF;

  d := COALESCE(_depth, public._current_automation_depth());
  IF d > 5 THEN
    INSERT INTO public.operations_failures(source, entity_type, entity_id, error_code, error_message, context)
    VALUES ('automation.enqueue', _entity_type, _entity_id, 'depth_exceeded',
            'Event depth exceeded ceiling of 5',
            jsonb_build_object('event_kind', _event_kind, 'depth', d));
    RETURN NULL;
  END IF;

  SELECT pending_count INTO qd FROM public.automation_queue_stats WHERE id = 1;

  -- Hard cap: drop low-priority kinds.
  IF qd > HARD_CAP AND _event_kind = ANY(low_pri) THEN
    INSERT INTO public.operations_failures(source, entity_type, entity_id, error_code, error_message, context)
    VALUES ('automation.enqueue', _entity_type, _entity_id, 'queue_full',
            'Dropped low-priority event due to queue backpressure',
            jsonb_build_object('event_kind', _event_kind, 'queue_depth', qd));
    RETURN NULL;
  END IF;

  -- Soft cap: log a warning once per 5 minutes so it surfaces in Health
  -- without flooding ops_failures on every enqueue.
  IF qd >= SOFT_CAP THEN
    SELECT max(created_at) INTO last_soft
      FROM public.operations_failures
     WHERE source = 'automation.enqueue'
       AND error_code = 'queue_soft_cap'
       AND created_at > now() - interval '5 minutes';
    IF last_soft IS NULL THEN
      INSERT INTO public.operations_failures(source, entity_type, entity_id, error_code, error_message, context)
      VALUES ('automation.enqueue', _entity_type, _entity_id, 'queue_soft_cap',
              'Automation queue depth crossed soft cap (5,000). Worker throughput may be degraded.',
              jsonb_build_object('event_kind', _event_kind, 'queue_depth', qd));
    END IF;
  END IF;

  INSERT INTO public.automation_events(event_kind, entity_type, entity_id, payload, actor_id, depth, available_at)
  VALUES (_event_kind, _entity_type, _entity_id, COALESCE(_payload,'{}'::jsonb), _actor_id, d, _available_at)
  RETURNING id INTO new_id;
  RETURN new_id;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.operations_failures(source, entity_type, entity_id, error_code, error_message, context)
  VALUES ('automation.enqueue', _entity_type, _entity_id, 'enqueue_error',
          SQLERRM, jsonb_build_object('event_kind', _event_kind));
  RETURN NULL;
END $$;

-- Type-deactivation guard: blocks flipping `active` from true → false on a
-- work_item_type while an active automation rule references it.
CREATE OR REPLACE FUNCTION public.guard_type_deactivation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE n int;
BEGIN
  IF OLD.active = true AND NEW.active = false THEN
    SELECT count(*) INTO n FROM public.automation_rules r
     WHERE r.is_active AND r.auto_disabled_at IS NULL
       AND r.type_id = OLD.id;
    IF n > 0 THEN
      RAISE EXCEPTION 'Work item type "%" is referenced by % active automation rule(s). Disable those rules first.', OLD.key, n
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guard_type_deactivation ON public.work_item_types;
CREATE TRIGGER trg_guard_type_deactivation
  BEFORE UPDATE ON public.work_item_types
  FOR EACH ROW EXECUTE FUNCTION public.guard_type_deactivation();
