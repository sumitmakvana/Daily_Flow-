
-- =========================================================================
-- Phase D — Automation Engine foundation (v2)
-- =========================================================================

-- 1. automation_rules ----------------------------------------------------
CREATE TABLE public.automation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  description_internal text,
  type_id uuid REFERENCES public.work_item_types(id) ON DELETE CASCADE,
  trigger_kind text NOT NULL CHECK (trigger_kind IN (
    'work_item.created','status.changed','work_item.completed',
    'approval.completed','approval.rejected',
    'due.reached','due.missed',
    'risk.created','comment.added','eod.submitted'
  )),
  condition_expr jsonb NOT NULL DEFAULT '{}'::jsonb,
  actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  run_mode text NOT NULL DEFAULT 'async' CHECK (run_mode IN ('async','sync')),
  dedupe_window_minutes int NOT NULL DEFAULT 60 CHECK (dedupe_window_minutes >= 0),
  max_runs_per_entity int CHECK (max_runs_per_entity IS NULL OR max_runs_per_entity > 0),
  max_runs_per_minute int NOT NULL DEFAULT 60 CHECK (max_runs_per_minute > 0),
  allow_self_retrigger boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 100,
  auto_disabled_at timestamptz,
  auto_disabled_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE INDEX automation_rules_trigger_idx
  ON public.automation_rules (trigger_kind, type_id)
  WHERE is_active = true AND auto_disabled_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.automation_rules TO authenticated;
GRANT ALL ON public.automation_rules TO service_role;
ALTER TABLE public.automation_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage automation rules"
  ON public.automation_rules FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER automation_rules_updated_at
  BEFORE UPDATE ON public.automation_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. automation_events (outbox / queue) ----------------------------------
CREATE TABLE public.automation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_kind text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid,
  depth int NOT NULL DEFAULT 0,
  enqueued_at timestamptz NOT NULL DEFAULT now(),
  available_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  attempts int NOT NULL DEFAULT 0,
  dropped boolean NOT NULL DEFAULT false,
  drop_reason text
);
CREATE INDEX automation_events_pending_idx
  ON public.automation_events (available_at)
  WHERE processed_at IS NULL AND dropped = false;
CREATE INDEX automation_events_enqueued_brin
  ON public.automation_events USING BRIN (enqueued_at);
CREATE UNIQUE INDEX automation_events_scheduled_uniq
  ON public.automation_events (event_kind, entity_id, ((available_at AT TIME ZONE 'UTC')::date))
  WHERE event_kind IN ('due.reached','due.missed') AND entity_id IS NOT NULL;

GRANT SELECT ON public.automation_events TO authenticated;
GRANT ALL ON public.automation_events TO service_role;
ALTER TABLE public.automation_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "managers view automation events"
  ON public.automation_events FOR SELECT TO authenticated
  USING (public.is_manager_or_admin(auth.uid()));

-- 3. automation_runs (audit + DLQ) ---------------------------------------
CREATE TABLE public.automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid REFERENCES public.automation_rules(id) ON DELETE CASCADE,
  event_id uuid REFERENCES public.automation_events(id) ON DELETE SET NULL,
  entity_type text,
  entity_id uuid,
  dedupe_key text UNIQUE,
  status text NOT NULL CHECK (status IN (
    'succeeded','failed','dead','pending',
    'skipped_condition','skipped_dedupe','skipped_cap','skipped_rate','skipped_depth'
  )),
  attempts int NOT NULL DEFAULT 1,
  actions_log jsonb NOT NULL DEFAULT '[]'::jsonb,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX automation_runs_rule_started_idx
  ON public.automation_runs (rule_id, started_at DESC);
CREATE INDEX automation_runs_status_idx
  ON public.automation_runs (status) WHERE status IN ('failed','dead','pending');
CREATE INDEX automation_runs_entity_idx
  ON public.automation_runs (entity_type, entity_id, started_at DESC);

GRANT SELECT ON public.automation_runs TO authenticated;
GRANT UPDATE (status, attempts) ON public.automation_runs TO authenticated;
GRANT ALL ON public.automation_runs TO service_role;
ALTER TABLE public.automation_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "managers view automation runs"
  ON public.automation_runs FOR SELECT TO authenticated
  USING (public.is_manager_or_admin(auth.uid()));
CREATE POLICY "admins replay automation runs"
  ON public.automation_runs FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

-- 4. automation_action_log -----------------------------------------------
CREATE TABLE public.automation_action_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.automation_runs(id) ON DELETE CASCADE,
  action_index int NOT NULL,
  action_kind text NOT NULL,
  target_type text,
  target_id uuid,
  status text NOT NULL CHECK (status IN ('succeeded','failed','dry_run','skipped')),
  error text,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX automation_action_log_run_idx ON public.automation_action_log (run_id);
CREATE INDEX automation_action_log_target_idx
  ON public.automation_action_log (target_type, target_id);

GRANT SELECT ON public.automation_action_log TO authenticated;
GRANT ALL ON public.automation_action_log TO service_role;
ALTER TABLE public.automation_action_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "managers view automation action log"
  ON public.automation_action_log FOR SELECT TO authenticated
  USING (public.is_manager_or_admin(auth.uid()));

-- 5. approval_outbox_events (M4 — decoupled) -----------------------------
CREATE TABLE public.approval_outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL,
  work_item_id uuid,
  event_kind text NOT NULL CHECK (event_kind IN ('approval.completed','approval.rejected')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
CREATE INDEX approval_outbox_pending_idx
  ON public.approval_outbox_events (created_at)
  WHERE processed_at IS NULL;

GRANT SELECT ON public.approval_outbox_events TO authenticated;
GRANT ALL ON public.approval_outbox_events TO service_role;
ALTER TABLE public.approval_outbox_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "managers view approval outbox"
  ON public.approval_outbox_events FOR SELECT TO authenticated
  USING (public.is_manager_or_admin(auth.uid()));

-- 6. automation_queue_stats (M16) ----------------------------------------
CREATE TABLE public.automation_queue_stats (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  pending_count bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.automation_queue_stats (id, pending_count) VALUES (1, 0);

GRANT SELECT ON public.automation_queue_stats TO authenticated;
GRANT ALL ON public.automation_queue_stats TO service_role;
ALTER TABLE public.automation_queue_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "all view queue stats"
  ON public.automation_queue_stats FOR SELECT TO authenticated USING (true);

-- =========================================================================
-- Helper functions
-- =========================================================================

-- Read the current automation depth from a session GUC. Returns 0 when unset.
CREATE OR REPLACE FUNCTION public._current_automation_depth()
RETURNS int LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE(NULLIF(current_setting('app.automation_depth', true), ''), '0')::int
$$;

-- Queue stats maintenance trigger
CREATE OR REPLACE FUNCTION public.automation_queue_stats_bump()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.processed_at IS NULL AND NEW.dropped = false THEN
      UPDATE public.automation_queue_stats
         SET pending_count = pending_count + 1, updated_at = now() WHERE id = 1;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.processed_at IS NULL AND OLD.dropped = false
       AND (NEW.processed_at IS NOT NULL OR NEW.dropped = true) THEN
      UPDATE public.automation_queue_stats
         SET pending_count = GREATEST(pending_count - 1, 0), updated_at = now() WHERE id = 1;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_automation_queue_stats
  AFTER INSERT OR UPDATE ON public.automation_events
  FOR EACH ROW EXECUTE FUNCTION public.automation_queue_stats_bump();

-- Enqueue with backpressure (M6) + depth ceiling (M2)
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
BEGIN
  -- short-circuit: no active rules for this trigger
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
  IF qd > 50000 AND _event_kind = ANY(low_pri) THEN
    INSERT INTO public.operations_failures(source, entity_type, entity_id, error_code, error_message, context)
    VALUES ('automation.enqueue', _entity_type, _entity_id, 'queue_full',
            'Dropped low-priority event due to queue backpressure',
            jsonb_build_object('event_kind', _event_kind, 'queue_depth', qd));
    RETURN NULL;
  END IF;

  INSERT INTO public.automation_events(event_kind, entity_type, entity_id, payload, actor_id, depth, available_at)
  VALUES (_event_kind, _entity_type, _entity_id, COALESCE(_payload,'{}'::jsonb), _actor_id, d, _available_at)
  RETURNING id INTO new_id;
  RETURN new_id;
EXCEPTION WHEN OTHERS THEN
  -- Never let enqueue failures break the originating write.
  INSERT INTO public.operations_failures(source, entity_type, entity_id, error_code, error_message)
  VALUES ('automation.enqueue', _entity_type, _entity_id, SQLSTATE, SQLERRM);
  RETURN NULL;
END $$;

-- Replay a dead run (admin)
CREATE OR REPLACE FUNCTION public.automation_replay_dead_run(_run_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.automation_runs;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'admin required';
  END IF;
  SELECT * INTO r FROM public.automation_runs WHERE id = _run_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'run not found'; END IF;
  IF r.status <> 'dead' THEN RAISE EXCEPTION 'only dead runs can be replayed'; END IF;
  UPDATE public.automation_runs
     SET status = 'pending', attempts = 0, error = NULL, finished_at = NULL
   WHERE id = _run_id;
  IF r.event_id IS NOT NULL THEN
    UPDATE public.automation_events
       SET processed_at = NULL, attempts = 0, available_at = now()
     WHERE id = r.event_id;
  END IF;
END $$;

-- Retention purge
CREATE OR REPLACE FUNCTION public.purge_automation_artifacts(_days int DEFAULT 7)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int := 0; nr int := 0;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'admin required';
  END IF;
  DELETE FROM public.automation_events
   WHERE processed_at IS NOT NULL
     AND processed_at < now() - (_days || ' days')::interval;
  GET DIAGNOSTICS n = ROW_COUNT;
  DELETE FROM public.automation_runs
   WHERE finished_at IS NOT NULL
     AND status IN ('succeeded','skipped_condition','skipped_dedupe','skipped_cap','skipped_rate','skipped_depth')
     AND finished_at < now() - (_days * 4 || ' days')::interval;
  GET DIAGNOSTICS nr = ROW_COUNT;
  DELETE FROM public.approval_outbox_events
   WHERE processed_at IS NOT NULL
     AND processed_at < now() - (_days || ' days')::interval;
  RETURN n + nr;
END $$;

-- =========================================================================
-- AFTER triggers on existing tables (additive only — do NOT alter the
-- existing trigger bodies, just add new ones).
-- =========================================================================

CREATE OR REPLACE FUNCTION public.trg_auto_tasks_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.enqueue_automation_event(
    'work_item.created', 'task', NEW.id,
    jsonb_build_object('type_id', NEW.type_id, 'status', NEW.status,
                       'status_id', NEW.status_id, 'priority', NEW.priority,
                       'assigned_to', NEW.assigned_to,
                       'custom_fields', COALESCE(NEW.custom_fields,'{}'::jsonb)),
    NEW.created_by);
  RETURN NEW;
END $$;
CREATE TRIGGER trg_auto_task_insert
  AFTER INSERT ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.trg_auto_tasks_insert();

CREATE OR REPLACE FUNCTION public.trg_auto_tasks_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE is_terminal boolean := false;
BEGIN
  IF OLD.status_id IS DISTINCT FROM NEW.status_id OR OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM public.enqueue_automation_event(
      'status.changed', 'task', NEW.id,
      jsonb_build_object('before', jsonb_build_object('status', OLD.status, 'status_id', OLD.status_id),
                         'after',  jsonb_build_object('status', NEW.status, 'status_id', NEW.status_id),
                         'type_id', NEW.type_id, 'priority', NEW.priority,
                         'assigned_to', NEW.assigned_to,
                         'custom_fields', COALESCE(NEW.custom_fields,'{}'::jsonb)),
      NEW.updated_by);

    IF NEW.status_id IS NOT NULL THEN
      SELECT s.is_terminal INTO is_terminal
        FROM public.work_item_statuses s WHERE s.id = NEW.status_id;
    END IF;
    IF COALESCE(is_terminal,false) OR NEW.status = 'Completed' THEN
      PERFORM public.enqueue_automation_event(
        'work_item.completed', 'task', NEW.id,
        jsonb_build_object('status', NEW.status, 'status_id', NEW.status_id,
                           'type_id', NEW.type_id,
                           'assigned_to', NEW.assigned_to,
                           'custom_fields', COALESCE(NEW.custom_fields,'{}'::jsonb)),
        NEW.updated_by);
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_auto_task_update
  AFTER UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.trg_auto_tasks_update();

CREATE OR REPLACE FUNCTION public.trg_auto_comments_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.enqueue_automation_event(
    'comment.added', 'comment', NEW.id,
    jsonb_build_object('work_item_id', NEW.work_item_id, 'user_id', NEW.user_id),
    NEW.user_id);
  RETURN NEW;
END $$;
CREATE TRIGGER trg_auto_comment_insert
  AFTER INSERT ON public.comments
  FOR EACH ROW EXECUTE FUNCTION public.trg_auto_comments_insert();

CREATE OR REPLACE FUNCTION public.trg_auto_eod_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.enqueue_automation_event(
    'eod.submitted', 'eod_checkin', NEW.id,
    jsonb_build_object('user_id', NEW.user_id, 'checkin_date', NEW.checkin_date),
    NEW.user_id);
  RETURN NEW;
END $$;
CREATE TRIGGER trg_auto_eod_insert
  AFTER INSERT ON public.eod_checkins
  FOR EACH ROW EXECUTE FUNCTION public.trg_auto_eod_insert();

CREATE OR REPLACE FUNCTION public.trg_auto_risk_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.enqueue_automation_event(
    'risk.created', 'risk_event', NEW.id,
    jsonb_build_object('kind', NEW.kind, 'severity', NEW.severity,
                       'entity_type', NEW.entity_type, 'entity_id', NEW.entity_id),
    NULL);
  RETURN NEW;
END $$;
CREATE TRIGGER trg_auto_risk_insert
  AFTER INSERT ON public.risk_events
  FOR EACH ROW EXECUTE FUNCTION public.trg_auto_risk_insert();

-- =========================================================================
-- Approval outbox tail (M4). We do NOT modify on_approval_decision's body
-- (it's a SECURITY DEFINER function the rest of the system depends on).
-- Instead we attach a second AFTER trigger on approval_decisions that
-- writes to the outbox, wrapped in EXCEPTION so it can never roll back
-- the underlying approval write.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.trg_approval_outbox()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  req public.approval_requests;
BEGIN
  BEGIN
    SELECT * INTO req FROM public.approval_requests WHERE id = NEW.request_id;
    IF NOT FOUND THEN RETURN NEW; END IF;

    IF req.status = 'approved' THEN
      INSERT INTO public.approval_outbox_events(request_id, work_item_id, event_kind, payload, actor_id)
      VALUES (req.id, req.work_item_id, 'approval.completed',
              jsonb_build_object('chain_id', req.chain_id, 'request_id', req.id),
              NEW.decided_by);
    ELSIF req.status = 'rejected' OR NEW.decision = 'reject' THEN
      INSERT INTO public.approval_outbox_events(request_id, work_item_id, event_kind, payload, actor_id)
      VALUES (req.id, req.work_item_id, 'approval.rejected',
              jsonb_build_object('chain_id', req.chain_id, 'request_id', req.id),
              NEW.decided_by);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.operations_failures(source, entity_type, entity_id, error_code, error_message)
    VALUES ('automation.approval_outbox', 'approval_request', NEW.request_id, SQLSTATE, SQLERRM);
  END;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_approval_outbox_after
  AFTER INSERT ON public.approval_decisions
  FOR EACH ROW EXECUTE FUNCTION public.trg_approval_outbox();

-- =========================================================================
-- Schema-integrity guards (M15): block deactivation/deletion of config
-- entities referenced by active automation rules. Read-only against
-- automation_rules; never touches existing config functions.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.guard_field_def_referenced()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.automation_rules r
   WHERE r.is_active AND r.auto_disabled_at IS NULL
     AND (r.condition_expr::text LIKE '%"' || OLD.key || '"%'
       OR r.actions::text       LIKE '%"' || OLD.key || '"%');
  IF n > 0 THEN
    RAISE EXCEPTION 'Field "%" is referenced by % active automation rule(s). Disable those rules first.', OLD.key, n
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER trg_guard_field_def_delete
  BEFORE DELETE ON public.work_item_field_defs
  FOR EACH ROW EXECUTE FUNCTION public.guard_field_def_referenced();

CREATE OR REPLACE FUNCTION public.guard_status_referenced()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.automation_rules r
   WHERE r.is_active AND r.auto_disabled_at IS NULL
     AND (r.condition_expr::text LIKE '%"' || OLD.key || '"%');
  IF n > 0 THEN
    RAISE EXCEPTION 'Status "%" is referenced by % active automation rule(s). Disable those rules first.', OLD.key, n
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER trg_guard_status_delete
  BEFORE DELETE ON public.work_item_statuses
  FOR EACH ROW EXECUTE FUNCTION public.guard_status_referenced();

CREATE OR REPLACE FUNCTION public.guard_type_referenced()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.automation_rules r
   WHERE r.is_active AND r.auto_disabled_at IS NULL
     AND r.type_id = OLD.id;
  IF n > 0 THEN
    RAISE EXCEPTION 'Work item type "%" is referenced by % active automation rule(s). Disable those rules first.', OLD.key, n
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER trg_guard_type_delete
  BEFORE DELETE ON public.work_item_types
  FOR EACH ROW EXECUTE FUNCTION public.guard_type_referenced();
