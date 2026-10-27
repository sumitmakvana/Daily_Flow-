-- Behavioural checks for the In Review workflow (migration 20261027000000).
-- Run by tests/integration/in-review-workflow.test.ts against a migrated database.
-- Everything happens inside one transaction that is rolled back, so no rows persist.
-- Each step runs as the `authenticated` role with request.jwt.claim.sub set, exactly like
-- withUser() does, so RLS, field-permission and transition triggers are all live. The
-- workflow functions are called directly (as a direct RPC would), not through the app.
--
-- SAFETY: this script creates users/tasks and consumes sequence values (task codes), and the
-- sequence part is NOT undone by ROLLBACK. It refuses to run unless the database is
-- explicitly opted in as a disposable test database (name contains "test" AND the session
-- has app.allow_db_tests=yes, which the vitest wrapper sets via PGOPTIONS).
\set ON_ERROR_STOP on
DO $$
BEGIN
  IF COALESCE(current_setting('app.allow_db_tests', true), '') <> 'yes'
     OR current_database() !~* 'test' THEN
    RAISE EXCEPTION 'Refusing to run: needs a disposable database whose name contains "test" and app.allow_db_tests=yes (current database: %)', current_database();
  END IF;
END $$;
BEGIN;

CREATE FUNCTION public.__expect_ok(_sql text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; END $$;

CREATE FUNCTION public.__expect_err(_sql text, _pattern text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE _sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM ~* _pattern THEN RETURN; END IF;
    RAISE EXCEPTION 'wrong error for [%]: got "%", wanted /%/', _sql, SQLERRM, _pattern;
  END;
  RAISE EXCEPTION 'expected an error for [%] (/%/) but it succeeded', _sql, _pattern;
END $$;

CREATE FUNCTION public.__assert(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'assertion failed: %', _msg; END IF; END $$;

GRANT EXECUTE ON FUNCTION public.__expect_ok(text), public.__expect_err(text, text), public.__assert(boolean, text)
  TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;

-- A = assignee, R = reviewer, M = manager, X = unrelated member
INSERT INTO auth.users (id, email) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'rv-a@example.test'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'rv-r@example.test'),
  ('aaaaaaaa-0000-4000-8000-000000000003', 'rv-m@example.test'),
  ('aaaaaaaa-0000-4000-8000-000000000004', 'rv-x@example.test')
ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (id, display_name, email) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'Alice', 'rv-a@example.test'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'Rita', 'rv-r@example.test'),
  ('aaaaaaaa-0000-4000-8000-000000000003', 'Max', 'rv-m@example.test'),
  ('aaaaaaaa-0000-4000-8000-000000000004', 'Xavier', 'rv-x@example.test')
ON CONFLICT (id) DO NOTHING;
DELETE FROM public.user_roles WHERE user_id IN (
  'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002',
  'aaaaaaaa-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000004');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'member'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'member'),
  ('aaaaaaaa-0000-4000-8000-000000000003', 'manager'),
  ('aaaaaaaa-0000-4000-8000-000000000004', 'member');

-- Tasks (all assigned to A unless noted; reviewer R):
--  T1 normal flow, timer running 2h, 1h already banked
--  T2 no reviewer      T3 reviewer = assignee      T4 manager's own task
--  T5 legacy In Review (no cycle row, 1h logged)
--  T6 timer running 3h, submitted by a direct call WITHOUT hours
--  T7 timer running 1h, submitted by the manager on A's behalf
--  T8 legacy In Review WITH a still-running timer (3h) and 2h logged
--  T9 4h logged on a previous day     T10 nothing logged
--  T11 timer left running 30h (cap)   T12 timer started before midnight (two days)
INSERT INTO public.tasks (id, task_name, assigned_to, reviewer, created_by, status, started_at, system_hours, actual_hours) VALUES
  ('bbbbbbbb-0000-4000-8000-000000000001', 'T1', 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'In Progress', now() - interval '2 hours', 1, NULL),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'T2', 'aaaaaaaa-0000-4000-8000-000000000001', NULL, 'aaaaaaaa-0000-4000-8000-000000000001', 'In Progress', NULL, 0, NULL),
  ('bbbbbbbb-0000-4000-8000-000000000003', 'T3', 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'In Progress', NULL, 0, NULL),
  ('bbbbbbbb-0000-4000-8000-000000000004', 'T4', 'aaaaaaaa-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000003', 'In Progress', NULL, 0, NULL),
  ('bbbbbbbb-0000-4000-8000-000000000005', 'T5', 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'In Review', NULL, 0, 1),
  ('bbbbbbbb-0000-4000-8000-000000000006', 'T6', 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'In Progress', now() - interval '3 hours', 0, NULL),
  ('bbbbbbbb-0000-4000-8000-000000000007', 'T7', 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'In Progress', now() - interval '1 hour', 0, NULL),
  ('bbbbbbbb-0000-4000-8000-000000000008', 'T8', 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'In Review', now() - interval '3 hours', 0, 2),
  ('bbbbbbbb-0000-4000-8000-000000000009', 'T9', 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'In Progress', NULL, 2, 4),
  ('bbbbbbbb-0000-4000-8000-000000000010', 'T10', 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'In Progress', NULL, 0, NULL),
  ('bbbbbbbb-0000-4000-8000-000000000011', 'T11', 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'In Progress', now() - interval '30 hours', 0, NULL),
  ('bbbbbbbb-0000-4000-8000-000000000012', 'T12', 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'In Progress', date_trunc('day', now()) - interval '2 hours', 0, NULL);
-- T9: those 4 logged hours were entered on a previous day
INSERT INTO public.task_eod_submissions (task_id, user_id, submission_date, progress_status, actual_hours)
VALUES ('bbbbbbbb-0000-4000-8000-000000000009', 'aaaaaaaa-0000-4000-8000-000000000001',
        (now() AT TIME ZONE 'UTC')::date - 1, 'in_progress', 4);

-- ---- internal helpers are not callable by users -------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000001', true);
SELECT public.__expect_err($$SELECT public.bank_task_timer('bbbbbbbb-0000-4000-8000-000000000001', now() - interval '1 hour', 'aaaaaaaa-0000-4000-8000-000000000001')$$, 'permission denied');
SELECT public.__expect_err($$SELECT * FROM public.apply_task_eod_hours('bbbbbbbb-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 5, NULL)$$, 'permission denied');
RESET ROLE;

-- ---- submit rules -------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000004', true);
SELECT public.__expect_err($$SELECT public.submit_task_for_review('bbbbbbbb-0000-4000-8000-000000000001', 2.5)$$, 'assignee or a manager');

SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000001', true);
SELECT public.__expect_err($$UPDATE public.tasks SET status = 'In Review' WHERE id = 'bbbbbbbb-0000-4000-8000-000000000001'$$, 'Send for review');
SELECT public.__expect_err($$SELECT public.submit_task_for_review('bbbbbbbb-0000-4000-8000-000000000002')$$, 'Assign a reviewer');
SELECT public.__expect_err($$SELECT public.submit_task_for_review('bbbbbbbb-0000-4000-8000-000000000003')$$, 'cannot be the assignee');
-- logged hours must be sane, and a task with nothing logged can't be sent with 0
SELECT public.__expect_err($$SELECT public.submit_task_for_review('bbbbbbbb-0000-4000-8000-000000000010', 25)$$, 'between 0 and 24');
SELECT public.__expect_err($$SELECT public.submit_task_for_review('bbbbbbbb-0000-4000-8000-000000000010', -1)$$, 'between 0 and 24');
SELECT public.__expect_err($$SELECT public.submit_task_for_review('bbbbbbbb-0000-4000-8000-000000000010', 0)$$, 'Enter the hours');
-- T1: the assignee confirms 2.5h and sends it
SELECT public.__expect_ok($$SELECT public.submit_task_for_review('bbbbbbbb-0000-4000-8000-000000000001', 2.5, 'wrapping up')$$);
SELECT public.__expect_err($$SELECT public.submit_task_for_review('bbbbbbbb-0000-4000-8000-000000000001', 2.5)$$, 'Only In Progress');
RESET ROLE;

SELECT public.__assert(
  (SELECT status::text = 'In Review' AND review_submitted_at IS NOT NULL AND started_at IS NULL
     FROM public.tasks WHERE id = 'bbbbbbbb-0000-4000-8000-000000000001'),
  'submit moves the task to In Review, stamps review_submitted_at and stops the timer');
-- final timer segment: banked once, into system_hours AND task_worklogs, credited to the assignee
SELECT public.__assert(
  (SELECT system_hours = 3.00 FROM public.tasks WHERE id = 'bbbbbbbb-0000-4000-8000-000000000001'),
  'the running 2h segment is added to the 1h already banked (system_hours = 3.00)');
SELECT public.__assert(
  (SELECT count(*) = 1 AND sum(system_hours) = 2.00 AND bool_and(user_id = 'aaaaaaaa-0000-4000-8000-000000000001')
     FROM public.task_worklogs WHERE task_id = 'bbbbbbbb-0000-4000-8000-000000000001'),
  'exactly one worklog row for the final segment (2.00h), credited to the assignee');
-- manual EOD logged hours
SELECT public.__assert(
  (SELECT actual_hours = 2.50 FROM public.tasks WHERE id = 'bbbbbbbb-0000-4000-8000-000000000001'),
  'tasks.actual_hours holds the confirmed hours');
SELECT public.__assert(
  (SELECT count(*) = 1 AND sum(actual_hours) = 2.50 AND bool_and(progress_status = 'in_progress')
     FROM public.task_eod_submissions
    WHERE task_id = 'bbbbbbbb-0000-4000-8000-000000000001'
      AND user_id = 'aaaaaaaa-0000-4000-8000-000000000001'
      AND submission_date = (now() AT TIME ZONE 'UTC')::date),
  'the hours are recorded as today''s EOD submission');
SELECT public.__assert(
  (SELECT cycle_no = 1 AND decision = 'pending'
          AND submitted_by = 'aaaaaaaa-0000-4000-8000-000000000001'
          AND reviewer_id = 'aaaaaaaa-0000-4000-8000-000000000002'
          AND logged_hours_confirmed_at IS NOT NULL AND logged_hours_today = 2.5
          AND logged_hours_total = 2.5 AND system_hours_total = 3.00
     FROM public.task_reviews WHERE task_id = 'bbbbbbbb-0000-4000-8000-000000000001'),
  'cycle 1 records submitter, reviewer and a snapshot of the confirmed hours');
SELECT public.__assert(
  (SELECT count(*) = 1 FROM public.notifications
    WHERE task_id = 'bbbbbbbb-0000-4000-8000-000000000001' AND type = 'review_requested'
      AND user_id = 'aaaaaaaa-0000-4000-8000-000000000002' AND body LIKE '%2.50h logged%'),
  'reviewer is notified (with the logged hours) when the task enters review');

-- ---- guard: the bypass is per task, status_id can not skip it ----------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000001', true);
SELECT set_config('app.review_bypass', 'bbbbbbbb-0000-4000-8000-000000000003', true);
SELECT public.__expect_err($$UPDATE public.tasks SET status = 'In Review' WHERE id = 'bbbbbbbb-0000-4000-8000-000000000002'$$, 'Send for review');
SELECT set_config('app.review_bypass', '', true);
SELECT public.__expect_err($$UPDATE public.tasks SET status_id = (SELECT s.id FROM public.work_item_statuses s WHERE s.type_id = tasks.type_id AND s.label = 'In Review') WHERE id = 'bbbbbbbb-0000-4000-8000-000000000002'$$, 'Send for review');
SELECT public.__expect_err($$UPDATE public.tasks SET status_id = (SELECT s.id FROM public.work_item_statuses s WHERE s.type_id = tasks.type_id AND s.label = 'Completed') WHERE id = 'bbbbbbbb-0000-4000-8000-000000000001'$$, 'approved or have changes requested');

-- ---- locks while the review is pending (non-manager assignee) ---------------------
SELECT public.__expect_err($$UPDATE public.tasks SET reviewer = 'aaaaaaaa-0000-4000-8000-000000000004' WHERE id = 'bbbbbbbb-0000-4000-8000-000000000001'$$, 'Only a manager can change reviewer');
SELECT public.__expect_err($$UPDATE public.tasks SET assigned_to = 'aaaaaaaa-0000-4000-8000-000000000004' WHERE id = 'bbbbbbbb-0000-4000-8000-000000000001'$$, 'Only a manager can change assignee');
SELECT public.__expect_err($$UPDATE public.tasks SET priority = 'High', task_name = 'renamed', planned_hours = 99 WHERE id = 'bbbbbbbb-0000-4000-8000-000000000001'$$, 'Only a manager can change');
SELECT public.__expect_err($$UPDATE public.tasks SET due_date = '2031-01-01' WHERE id = 'bbbbbbbb-0000-4000-8000-000000000001'$$, 'due date');
SELECT public.__expect_err($$UPDATE public.tasks SET started_at = now() WHERE id = 'bbbbbbbb-0000-4000-8000-000000000001'$$, 'timer can not be started');
SELECT public.__expect_ok($$UPDATE public.tasks SET remarks = 'still editable', priority = priority, reviewer = reviewer WHERE id = 'bbbbbbbb-0000-4000-8000-000000000001'$$);

-- a manager may still adjust a task in review, but not start its timer
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000003', true);
SELECT public.__expect_ok($$UPDATE public.tasks SET priority = 'High' WHERE id = 'bbbbbbbb-0000-4000-8000-000000000001'$$);
SELECT public.__expect_err($$UPDATE public.tasks SET started_at = now() WHERE id = 'bbbbbbbb-0000-4000-8000-000000000001'$$, 'timer can not be started');
RESET ROLE;

-- ---- hardening ---------------------------------------------------------------------
SELECT public.__assert(
  (SELECT bool_and(coalesce(array_to_string(proconfig, ',') LIKE '%search_path=public, pg_temp%', false))
     FROM pg_proc
    WHERE oid IN ('public.submit_task_for_review(uuid,numeric,text)'::regprocedure,
                  'public.log_review_hours(uuid,numeric,text)'::regprocedure,
                  'public.decide_task_review(uuid,text,text,uuid)'::regprocedure,
                  'public.bank_task_timer(uuid,timestamptz,uuid)'::regprocedure,
                  'public.apply_task_eod_hours(uuid,uuid,numeric,text)'::regprocedure,
                  'public.ensure_pending_review(public.tasks)'::regprocedure,
                  'public.enforce_review_locks()'::regprocedure,
                  'public.enforce_task_field_perms()'::regprocedure)),
  'every review function and the replaced trigger function sets search_path = public, pg_temp');
SELECT public.__assert(
  (SELECT tgname FROM pg_trigger
    WHERE tgrelid = 'public.tasks'::regclass AND NOT tgisinternal
      AND (tgtype & 2) = 2 AND (tgtype & 16) = 16
    ORDER BY tgname DESC LIMIT 1) = 'trg_zz_enforce_review_locks',
  'guard trigger fires after every other BEFORE UPDATE trigger on tasks');

-- ---- logging / correcting hours while in review ------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000004', true);
SELECT public.__expect_err($$SELECT public.log_review_hours('bbbbbbbb-0000-4000-8000-000000000001', 3)$$, 'Only the assignee');
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000003', true);
SELECT public.__expect_err($$SELECT public.log_review_hours('bbbbbbbb-0000-4000-8000-000000000001', 3)$$, 'Only the assignee');
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000001', true);
SELECT public.__expect_err($$SELECT public.log_review_hours('bbbbbbbb-0000-4000-8000-000000000001', 25)$$, 'between 0 and 24');
SELECT public.__expect_err($$SELECT public.log_review_hours('bbbbbbbb-0000-4000-8000-000000000002', 3)$$, 'not in review');
-- correcting today's figure REPLACES it (2.5 -> 3), it never adds to it
SELECT public.__expect_ok($$SELECT public.log_review_hours('bbbbbbbb-0000-4000-8000-000000000001', 3, 'fixed')$$);
-- 0 never lowers an existing figure
SELECT public.__expect_ok($$SELECT public.log_review_hours('bbbbbbbb-0000-4000-8000-000000000001', 0)$$);
RESET ROLE;
SELECT public.__assert(
  (SELECT actual_hours = 3.00 FROM public.tasks WHERE id = 'bbbbbbbb-0000-4000-8000-000000000001'),
  're-confirming today replaces the figure (3.00), no double-adding');
SELECT public.__assert(
  (SELECT count(*) = 1 AND sum(actual_hours) = 3.00 FROM public.task_eod_submissions
    WHERE task_id = 'bbbbbbbb-0000-4000-8000-000000000001'),
  'still a single EOD row for the task today');
SELECT public.__assert(
  (SELECT logged_hours_total = 3.00 AND logged_hours_today = 3.00 FROM public.task_reviews
    WHERE task_id = 'bbbbbbbb-0000-4000-8000-000000000001' AND cycle_no = 1),
  'the open cycle''s snapshot follows the corrected hours');

-- ---- decision rules ------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000001', true);
SELECT public.__expect_err($$SELECT public.decide_task_review('bbbbbbbb-0000-4000-8000-000000000001', 'approved', NULL)$$, 'assigned reviewer or a manager');
SELECT public.__expect_err($$UPDATE public.tasks SET status = 'Completed' WHERE id = 'bbbbbbbb-0000-4000-8000-000000000001'$$, 'approved or have changes requested');
SELECT public.__expect_err($$UPDATE public.tasks SET status = 'In Progress' WHERE id = 'bbbbbbbb-0000-4000-8000-000000000001'$$, 'approved or have changes requested');

SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000004', true);
SELECT public.__expect_err($$SELECT public.decide_task_review('bbbbbbbb-0000-4000-8000-000000000001', 'approved', NULL)$$, 'assigned reviewer or a manager');

SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000002', true);
SELECT public.__expect_err($$SELECT public.decide_task_review('bbbbbbbb-0000-4000-8000-000000000001', 'changes_requested', '   ')$$, 'Feedback is required');
SELECT public.__expect_err($$SELECT public.decide_task_review('bbbbbbbb-0000-4000-8000-000000000001', 'maybe', 'x')$$, 'Decision must be');
SELECT public.__expect_ok($$SELECT public.decide_task_review('bbbbbbbb-0000-4000-8000-000000000001', 'changes_requested', 'Please add tests')$$);
SELECT public.__expect_err($$SELECT public.decide_task_review('bbbbbbbb-0000-4000-8000-000000000001', 'approved', NULL)$$, 'not in review');
RESET ROLE;

SELECT public.__assert(
  (SELECT status::text = 'In Progress' AND done = false FROM public.tasks WHERE id = 'bbbbbbbb-0000-4000-8000-000000000001'),
  'request changes sends the task back to In Progress');
SELECT public.__assert(
  (SELECT decision = 'changes_requested' AND feedback = 'Please add tests'
          AND decided_by = 'aaaaaaaa-0000-4000-8000-000000000002' AND decided_at IS NOT NULL
     FROM public.task_reviews WHERE task_id = 'bbbbbbbb-0000-4000-8000-000000000001' AND cycle_no = 1),
  'cycle 1 records the decision, decider, feedback and time');
SELECT public.__assert(
  (SELECT count(*) = 1 FROM public.notifications
    WHERE task_id = 'bbbbbbbb-0000-4000-8000-000000000001' AND type = 'review_changes_requested'
      AND user_id = 'aaaaaaaa-0000-4000-8000-000000000001' AND body LIKE '%Please add tests%'),
  'assignee is notified of requested changes with the feedback');
SELECT public.__assert(
  (SELECT actual_hours = 3.00 AND system_hours = 3.00 FROM public.tasks WHERE id = 'bbbbbbbb-0000-4000-8000-000000000001'),
  'logged hours and tracked hours are untouched by a request for changes');

-- ---- second round: no double counting ----------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000001', true);
SELECT public.__expect_ok($$UPDATE public.tasks SET due_date = '2031-01-01', priority = 'Low', started_at = now() - interval '1 hour' WHERE id = 'bbbbbbbb-0000-4000-8000-000000000001'$$);
SELECT public.__expect_ok($$SELECT public.submit_task_for_review('bbbbbbbb-0000-4000-8000-000000000001', 3.5)$$);
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000003', true);
SELECT public.__expect_ok($$SELECT public.decide_task_review('bbbbbbbb-0000-4000-8000-000000000001', 'approved', 'Good')$$);
RESET ROLE;

SELECT public.__assert(
  (SELECT status::text = 'Completed' AND done AND completed_at IS NOT NULL
     FROM public.tasks WHERE id = 'bbbbbbbb-0000-4000-8000-000000000001'),
  'approve completes the task');
SELECT public.__assert(
  (SELECT system_hours = 4.00 FROM public.tasks WHERE id = 'bbbbbbbb-0000-4000-8000-000000000001'),
  'the second hour was banked exactly once (3.00 + 1.00), approval added nothing');
SELECT public.__assert(
  (SELECT count(*) = 2 AND sum(system_hours) = 3.00 FROM public.task_worklogs WHERE task_id = 'bbbbbbbb-0000-4000-8000-000000000001'),
  'worklogs hold exactly the two banked segments (2h + 1h); approval wrote none');
SELECT public.__assert(
  (SELECT actual_hours = 3.50 FROM public.tasks WHERE id = 'bbbbbbbb-0000-4000-8000-000000000001'),
  'logged hours after approval are exactly what the assignee confirmed (3.50)');
SELECT public.__assert(
  (SELECT cycle_no = 2 AND decision = 'approved'
          AND decided_by = 'aaaaaaaa-0000-4000-8000-000000000003'
          AND reviewer_id = 'aaaaaaaa-0000-4000-8000-000000000002'
     FROM public.task_reviews WHERE task_id = 'bbbbbbbb-0000-4000-8000-000000000001' AND cycle_no = 2),
  'cycle 2 keeps the assigned reviewer and the actual approver separately');
SELECT public.__assert(
  (SELECT count(*) = 2 FROM public.task_reviews WHERE task_id = 'bbbbbbbb-0000-4000-8000-000000000001'),
  'every cycle is kept');
SELECT public.__assert(
  (SELECT count(*) >= 4 FROM public.task_history
    WHERE task_id = 'bbbbbbbb-0000-4000-8000-000000000001' AND comment LIKE 'Review cycle%'),
  'review events are written to task_history');

-- ---- direct submission WITHOUT hours: timer still banked; approval waits for hours ---
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000001', true);
SELECT public.__expect_ok($$SELECT public.submit_task_for_review('bbbbbbbb-0000-4000-8000-000000000006')$$);
RESET ROLE;
SELECT public.__assert(
  (SELECT system_hours = 3.00 AND started_at IS NULL AND COALESCE(actual_hours, 0) = 0
     FROM public.tasks WHERE id = 'bbbbbbbb-0000-4000-8000-000000000006'),
  'a direct RPC submit banks the 3h segment and leaves logged hours alone');
SELECT public.__assert(
  (SELECT count(*) = 1 AND sum(system_hours) = 3.00 AND bool_and(user_id = 'aaaaaaaa-0000-4000-8000-000000000001')
     FROM public.task_worklogs WHERE task_id = 'bbbbbbbb-0000-4000-8000-000000000006'),
  'direct RPC submit writes the worklog for the assignee');
SELECT public.__assert(
  (SELECT logged_hours_confirmed_at IS NULL FROM public.task_reviews WHERE task_id = 'bbbbbbbb-0000-4000-8000-000000000006'),
  'the cycle shows hours were not confirmed');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000002', true);
SELECT public.__expect_err($$SELECT public.decide_task_review('bbbbbbbb-0000-4000-8000-000000000006', 'approved', NULL)$$, 'Logged hours are missing');
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000001', true);
SELECT public.__expect_ok($$SELECT public.log_review_hours('bbbbbbbb-0000-4000-8000-000000000006', 3)$$);
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000002', true);
SELECT public.__expect_ok($$SELECT public.decide_task_review('bbbbbbbb-0000-4000-8000-000000000006', 'approved', NULL)$$);
RESET ROLE;
SELECT public.__assert(
  (SELECT status::text = 'Completed' AND actual_hours = 3.00 AND system_hours = 3.00
     FROM public.tasks WHERE id = 'bbbbbbbb-0000-4000-8000-000000000006'),
  'after the assignee logged hours the approval completes the task without touching hours');

-- ---- a manager sending on someone's behalf: hours stay with the assignee ----------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000003', true);
SELECT public.__expect_err($$SELECT public.submit_task_for_review('bbbbbbbb-0000-4000-8000-000000000007', 2)$$, 'Only the assignee can enter logged hours');
SELECT public.__expect_ok($$SELECT public.submit_task_for_review('bbbbbbbb-0000-4000-8000-000000000007')$$);
RESET ROLE;
SELECT public.__assert(
  (SELECT count(*) = 1 AND sum(system_hours) = 1.00 AND bool_and(user_id = 'aaaaaaaa-0000-4000-8000-000000000001')
     FROM public.task_worklogs WHERE task_id = 'bbbbbbbb-0000-4000-8000-000000000007'),
  'the worklog is credited to the assignee, not the manager who sent it');
SELECT public.__assert(
  (SELECT count(*) = 0 FROM public.task_worklogs WHERE user_id = 'aaaaaaaa-0000-4000-8000-000000000003'),
  'nothing is credited to the manager');

-- ---- tasks already In Review before this workflow ----------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000002', true);
SELECT public.__expect_ok($$SELECT public.decide_task_review('bbbbbbbb-0000-4000-8000-000000000005', 'changes_requested', 'legacy fix')$$);
-- T8 still has a timer running from before the workflow: approving banks it once
SELECT public.__expect_ok($$SELECT public.decide_task_review('bbbbbbbb-0000-4000-8000-000000000008', 'approved', NULL)$$);
RESET ROLE;
SELECT public.__assert(
  (SELECT count(*) = 1 FROM public.task_reviews WHERE task_id = 'bbbbbbbb-0000-4000-8000-000000000005' AND decision = 'changes_requested'),
  'a legacy In Review task gets a cycle row when first decided');
SELECT public.__assert(
  (SELECT status::text = 'Completed' AND started_at IS NULL AND system_hours = 3.00 AND actual_hours = 2.00
     FROM public.tasks WHERE id = 'bbbbbbbb-0000-4000-8000-000000000008'),
  'approving a legacy task with a running timer banks the 3h once and keeps the 2h logged');
SELECT public.__assert(
  (SELECT count(*) = 1 AND sum(system_hours) = 3.00 AND bool_and(user_id = 'aaaaaaaa-0000-4000-8000-000000000001')
     FROM public.task_worklogs WHERE task_id = 'bbbbbbbb-0000-4000-8000-000000000008'),
  'the legacy timer segment is a single worklog credited to the assignee');

-- ---- earlier days' logged hours are preserved ---------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000001', true);
SELECT public.__expect_ok($$SELECT public.submit_task_for_review('bbbbbbbb-0000-4000-8000-000000000009', 1.5)$$);
RESET ROLE;
SELECT public.__assert(
  (SELECT actual_hours = 5.50 FROM public.tasks WHERE id = 'bbbbbbbb-0000-4000-8000-000000000009'),
  '4h from yesterday + 1.5h today = 5.5h logged');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000001', true);
SELECT public.__expect_ok($$SELECT public.log_review_hours('bbbbbbbb-0000-4000-8000-000000000009', 2)$$);
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000002', true);
SELECT public.__expect_ok($$SELECT public.decide_task_review('bbbbbbbb-0000-4000-8000-000000000009', 'approved', NULL)$$);
RESET ROLE;
SELECT public.__assert(
  (SELECT actual_hours = 6.00 FROM public.tasks WHERE id = 'bbbbbbbb-0000-4000-8000-000000000009'),
  'correcting today to 2h gives 6h; approval leaves it at 6h');
SELECT public.__assert(
  (SELECT count(*) = 2 AND sum(actual_hours) = 6.00 FROM public.task_eod_submissions WHERE task_id = 'bbbbbbbb-0000-4000-8000-000000000009'),
  'yesterday''s EOD row (4h) is untouched and today has a single row (2h)');

-- ---- timer edge cases ----------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000001', true);
SELECT public.__expect_ok($$SELECT public.submit_task_for_review('bbbbbbbb-0000-4000-8000-000000000011', 1)$$);
SELECT public.__expect_ok($$SELECT public.submit_task_for_review('bbbbbbbb-0000-4000-8000-000000000012', 1)$$);
RESET ROLE;
SELECT public.__assert(
  (SELECT system_hours = 8.00 FROM public.tasks WHERE id = 'bbbbbbbb-0000-4000-8000-000000000011')
  AND (SELECT sum(system_hours) = 8.00 FROM public.task_worklogs WHERE task_id = 'bbbbbbbb-0000-4000-8000-000000000011'),
  'a timer left running for 30h is capped at 8h in both system_hours and worklogs');
-- a session that crossed midnight is split across both days and the parts add up exactly
-- (skipped in the first minute after midnight, when the second day has no time yet)
SELECT public.__assert(
  (SELECT (extract(epoch FROM now() - date_trunc('day', now())) < 60)
       OR (SELECT count(*) = 2 AND sum(system_hours) = (SELECT system_hours FROM public.tasks WHERE id = 'bbbbbbbb-0000-4000-8000-000000000012')
                  AND min(work_date) = (now() AT TIME ZONE 'UTC')::date - 1
                  FROM public.task_worklogs WHERE task_id = 'bbbbbbbb-0000-4000-8000-000000000012')),
  'a session across midnight is split into two days that sum to the tracked time');

-- ---- no self-approval: a manager cannot approve their own task ----------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000003', true);
SELECT public.__expect_ok($$SELECT public.submit_task_for_review('bbbbbbbb-0000-4000-8000-000000000004', 1)$$);
SELECT public.__expect_err($$SELECT public.decide_task_review('bbbbbbbb-0000-4000-8000-000000000004', 'approved', NULL)$$, 'your own work');
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000002', true);
SELECT public.__expect_ok($$SELECT public.decide_task_review('bbbbbbbb-0000-4000-8000-000000000004', 'approved', NULL)$$);
RESET ROLE;

-- ---- service-role paths (no auth.uid) are not blocked by the guard ----------------
SELECT set_config('request.jwt.claim.sub', '', true);
UPDATE public.tasks SET status = 'On Hold' WHERE id = 'bbbbbbbb-0000-4000-8000-000000000005';

-- ---- review rows are write-protected for users ----------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000001', true);
SELECT public.__expect_err($$INSERT INTO public.task_reviews (task_id, cycle_no) VALUES ('bbbbbbbb-0000-4000-8000-000000000001', 99)$$, 'row-level security');
RESET ROLE;

ROLLBACK;
\echo IN_REVIEW_WORKFLOW_OK
