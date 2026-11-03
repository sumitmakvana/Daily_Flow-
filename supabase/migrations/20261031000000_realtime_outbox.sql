-- Transactional outbox + NOTIFY for real-time entity events.
--
-- Every committed change to a watched table writes ONE row to realtime.outbox in the SAME
-- transaction as the change, and sends a NOTIFY on commit. The app LISTENs, routes each event to
-- the sockets that may see it, and on any reconnect re-reads the outbox, so a committed change can
-- never be lost. This replaces the app's periodic fingerprint polling (entity-watcher).
--
--   * The outbox and the NOTIFY carry IDS ONLY (row id + routing user ids). Never row content.
--   * realtime.* is not in PGRST_DB_SCHEMAS (public only) and all privileges are revoked from
--     PUBLIC/anon/authenticated, so browsers can neither read nor write it. RLS is unchanged.
--   * Triggers are ENABLE ALWAYS: they also fire under session_replication_role = replica
--     (pg_restore, logical replication apply), so every write path produces an event.
--   * The outbox INSERT is deliberately NOT wrapped in an exception handler: if the event cannot be
--     recorded, the write fails with it (atomic), instead of committing a change nobody hears about.
--
-- Rollback: supabase/rollbacks/20261031000000_realtime_outbox.down.sql
-- Deployment order: apply this migration BEFORE deploying the app version that LISTENs.

CREATE SCHEMA IF NOT EXISTS realtime;
REVOKE ALL ON SCHEMA realtime FROM PUBLIC;

CREATE TABLE IF NOT EXISTS realtime.outbox (
  id         bigserial PRIMARY KEY,
  table_name text        NOT NULL,
  op         text        NOT NULL CHECK (op IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')),
  row_id     text,
  payload    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS outbox_created_at_idx ON realtime.outbox (created_at);
ALTER TABLE realtime.outbox ENABLE ROW LEVEL SECURITY; -- no policies: nobody but the owner / BYPASSRLS roles
REVOKE ALL ON realtime.outbox FROM PUBLIC;
REVOKE ALL ON SEQUENCE realtime.outbox_id_seq FROM PUBLIC;

-- Record one event and notify. The NOTIFY payload is small (ids); if it ever grew past the limit it
-- degrades to {id} and the listener fetches the row from the outbox by id.
CREATE OR REPLACE FUNCTION realtime.emit(p_table text, p_op text, p_row_id text, p_keys jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id  bigint;
  v_msg text;
BEGIN
  INSERT INTO realtime.outbox (table_name, op, row_id, payload)
  VALUES (p_table, p_op, p_row_id, COALESCE(p_keys, '{}'::jsonb))
  RETURNING id INTO v_id;

  v_msg := json_build_object('id', v_id, 'table', p_table, 'op', p_op, 'row_id', p_row_id, 'keys', COALESCE(p_keys, '{}'::jsonb))::text;
  IF length(v_msg) > 7000 THEN
    v_msg := json_build_object('id', v_id)::text;
  END IF;
  PERFORM pg_notify('realtime_outbox', v_msg);
END;
$$;

-- Row-level capture. Builds the routing keys (user ids only) for each watched table.
CREATE OR REPLACE FUNCTION realtime.capture()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  n    jsonb := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
  o    jsonb := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  r    jsonb := COALESCE(n, o);
  keys jsonb := '{}'::jsonb;
  rid  text  := r ->> 'id';
  v_task uuid;
  v_ids  jsonb;
BEGIN
  -- An UPDATE that changed nothing is not an event.
  IF TG_OP = 'UPDATE' AND n = o THEN
    RETURN NULL;
  END IF;

  IF TG_TABLE_NAME = 'tasks' THEN
    SELECT COALESCE(jsonb_agg(tr.reviewer_id), '[]'::jsonb) INTO v_ids
      FROM public.task_reviewers tr WHERE tr.task_id = (r ->> 'id')::uuid;
    keys := jsonb_strip_nulls(jsonb_build_object(
      'assigned_to', r ->> 'assigned_to', 'old_assigned_to', o ->> 'assigned_to',
      'reviewer', r ->> 'reviewer', 'old_reviewer', o ->> 'reviewer',
      'created_by', r ->> 'created_by', 'reviewers', v_ids));

  ELSIF TG_TABLE_NAME = 'task_review_decisions' THEN
    v_task := (r ->> 'task_id')::uuid;
    SELECT COALESCE(jsonb_agg(tr.reviewer_id), '[]'::jsonb) INTO v_ids
      FROM public.task_reviewers tr WHERE tr.task_id = v_task;
    keys := jsonb_strip_nulls(jsonb_build_object(
      'task_id', r ->> 'task_id', 'reviewer_id', r ->> 'reviewer_id', 'decided_by', r ->> 'decided_by',
      'assigned_to', (SELECT t.assigned_to FROM public.tasks t WHERE t.id = v_task), 'reviewers', v_ids));

  ELSIF TG_TABLE_NAME = 'task_worklogs' THEN
    v_task := (r ->> 'task_id')::uuid;
    keys := jsonb_strip_nulls(jsonb_build_object(
      'user_id', r ->> 'user_id', 'task_id', r ->> 'task_id',
      'assigned_to', (SELECT t.assigned_to FROM public.tasks t WHERE t.id = v_task)));

  ELSIF TG_TABLE_NAME = 'leaves' THEN
    keys := jsonb_strip_nulls(jsonb_build_object(
      'user_id', r ->> 'user_id', 'request_to', r ->> 'request_to', 'reviewed_by', r ->> 'reviewed_by'));

  ELSIF TG_TABLE_NAME IN ('eod_checkins', 'nudges') THEN
    keys := jsonb_strip_nulls(jsonb_build_object('user_id', r ->> 'user_id'));

  ELSIF TG_TABLE_NAME = 'planning_suggestions' THEN
    keys := jsonb_strip_nulls(jsonb_build_object(
      'task_id', r ->> 'task_id', 'from_user_id', r ->> 'from_user_id', 'to_user_id', r ->> 'to_user_id'));

  ELSIF TG_TABLE_NAME = 'risk_events' THEN
    keys := jsonb_strip_nulls(jsonb_build_object(
      'entity_type', r ->> 'entity_type', 'entity_id', r ->> 'entity_id'));

  ELSIF TG_TABLE_NAME = 'approval_requests' THEN
    -- Who may read the request (ar_read): the requester, admins, and the approvers of its chain.
    SELECT COALESCE(jsonb_agg(DISTINCT u.uid), '[]'::jsonb) INTO v_ids
      FROM (
        SELECT s.approver_user_id AS uid
          FROM public.approval_steps s
         WHERE s.chain_id = (r ->> 'chain_id')::uuid AND s.approver_mode = 'user' AND s.approver_user_id IS NOT NULL
        UNION
        SELECT ur.user_id
          FROM public.approval_steps s
          JOIN public.user_roles ur ON ur.role::text = s.approver_role::text
         WHERE s.chain_id = (r ->> 'chain_id')::uuid AND s.approver_mode = 'role'
        UNION
        SELECT t.reviewer
          FROM public.approval_steps s
          JOIN public.tasks t ON t.id = (r ->> 'work_item_id')::uuid
         WHERE s.chain_id = (r ->> 'chain_id')::uuid AND s.approver_mode = 'reviewer_field' AND t.reviewer IS NOT NULL
      ) u;
    keys := jsonb_strip_nulls(jsonb_build_object('requested_by', r ->> 'requested_by', 'approvers', v_ids));

  ELSE
    RAISE EXCEPTION 'realtime.capture(): no routing rule for table %', TG_TABLE_NAME;
  END IF;

  PERFORM realtime.emit(TG_TABLE_NAME, TG_OP, rid, keys);
  RETURN NULL;
END;
$$;

-- Statement-level capture: TRUNCATE (no row to name), and the automation tables that feed the
-- admin health panel (one event per statement, not per row).
CREATE OR REPLACE FUNCTION realtime.capture_statement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  tn text := CASE WHEN TG_TABLE_NAME LIKE 'automation\_%' THEN 'automation_health' ELSE TG_TABLE_NAME END;
BEGIN
  PERFORM realtime.emit(tn, TG_OP, NULL, '{}'::jsonb);
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION realtime.emit(text, text, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION realtime.capture() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION realtime.capture_statement() FROM PUBLIC;

-- Install triggers. A missing table is reported loudly (WARNING) rather than skipped silently; the
-- app also verifies the full trigger list at startup and logs what is missing.
DO $$
DECLARE
  t text;
  row_tables text[] := ARRAY['tasks', 'nudges', 'risk_events', 'planning_suggestions', 'approval_requests',
                             'task_review_decisions', 'task_worklogs', 'leaves', 'eod_checkins'];
  auto_tables text[] := ARRAY['automation_runs', 'automation_rules', 'automation_queue_stats'];
BEGIN
  FOREACH t IN ARRAY row_tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE WARNING 'realtime: public.% does not exist; no trigger installed for it', t;
      CONTINUE;
    END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS trg_realtime_%1$s ON public.%1$I', t);
    EXECUTE format('CREATE TRIGGER trg_realtime_%1$s AFTER INSERT OR UPDATE OR DELETE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION realtime.capture()', t);
    EXECUTE format('ALTER TABLE public.%1$I ENABLE ALWAYS TRIGGER trg_realtime_%1$s', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_realtime_%1$s_truncate ON public.%1$I', t);
    EXECUTE format('CREATE TRIGGER trg_realtime_%1$s_truncate AFTER TRUNCATE ON public.%1$I FOR EACH STATEMENT EXECUTE FUNCTION realtime.capture_statement()', t);
    EXECUTE format('ALTER TABLE public.%1$I ENABLE ALWAYS TRIGGER trg_realtime_%1$s_truncate', t);
  END LOOP;

  FOREACH t IN ARRAY auto_tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE WARNING 'realtime: public.% does not exist; no trigger installed for it', t;
      CONTINUE;
    END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS trg_realtime_%1$s ON public.%1$I', t);
    EXECUTE format('CREATE TRIGGER trg_realtime_%1$s AFTER INSERT OR UPDATE OR DELETE ON public.%1$I FOR EACH STATEMENT EXECUTE FUNCTION realtime.capture_statement()', t);
    EXECUTE format('ALTER TABLE public.%1$I ENABLE ALWAYS TRIGGER trg_realtime_%1$s', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_realtime_%1$s_truncate ON public.%1$I', t);
    EXECUTE format('CREATE TRIGGER trg_realtime_%1$s_truncate AFTER TRUNCATE ON public.%1$I FOR EACH STATEMENT EXECUTE FUNCTION realtime.capture_statement()', t);
    EXECUTE format('ALTER TABLE public.%1$I ENABLE ALWAYS TRIGGER trg_realtime_%1$s_truncate', t);
  END LOOP;
END
$$;

-- Housekeeping (not a poll: the app never reads the outbox on a timer). Keeps 24 h, enough to
-- replay after any outage the app itself could survive. The app also prunes once at startup.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'realtime-outbox-prune';
    PERFORM cron.schedule('realtime-outbox-prune', '17 * * * *',
      $job$DELETE FROM realtime.outbox WHERE created_at < now() - interval '24 hours'$job$);
  ELSE
    RAISE NOTICE 'realtime: pg_cron is not installed; the app prunes realtime.outbox at startup only';
  END IF;
END
$$;
