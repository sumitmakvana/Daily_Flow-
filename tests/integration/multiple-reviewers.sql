-- Behavioural checks for multiple reviewers (migration 20261028000000).
-- Run by tests/integration/multiple-reviewers.test.ts against a fully migrated database.
-- One transaction, rolled back. Steps run as the `authenticated` role with
-- request.jwt.claim.sub set, like withUser() does, so RLS and triggers are live.
--
-- SAFETY: creates users/tasks and consumes sequence values (task codes) which ROLLBACK does not
-- undo. Refuses to run unless the database name contains "test" AND app.allow_db_tests=yes.
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
GRANT EXECUTE ON FUNCTION public.__expect_ok(text), public.__expect_err(text, text), public.__assert(boolean, text) TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;

-- A assignee | R1 R2 R3 R4 reviewers | M manager | X outsider | I inactive user
INSERT INTO auth.users (id, email) VALUES
  ('cccccccc-0000-4000-8000-000000000001', 'mr-a@example.test'),
  ('cccccccc-0000-4000-8000-000000000002', 'mr-r1@example.test'),
  ('cccccccc-0000-4000-8000-000000000003', 'mr-r2@example.test'),
  ('cccccccc-0000-4000-8000-000000000004', 'mr-r3@example.test'),
  ('cccccccc-0000-4000-8000-000000000005', 'mr-m@example.test'),
  ('cccccccc-0000-4000-8000-000000000006', 'mr-x@example.test'),
  ('cccccccc-0000-4000-8000-000000000007', 'mr-r4@example.test'),
  ('cccccccc-0000-4000-8000-000000000008', 'mr-i@example.test')
ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (id, display_name, email) VALUES
  ('cccccccc-0000-4000-8000-000000000001', 'Alice', 'mr-a@example.test'),
  ('cccccccc-0000-4000-8000-000000000002', 'Rita', 'mr-r1@example.test'),
  ('cccccccc-0000-4000-8000-000000000003', 'Rob', 'mr-r2@example.test'),
  ('cccccccc-0000-4000-8000-000000000004', 'Ravi', 'mr-r3@example.test'),
  ('cccccccc-0000-4000-8000-000000000005', 'Max', 'mr-m@example.test'),
  ('cccccccc-0000-4000-8000-000000000006', 'Xavier', 'mr-x@example.test'),
  ('cccccccc-0000-4000-8000-000000000007', 'Rene', 'mr-r4@example.test'),
  ('cccccccc-0000-4000-8000-000000000008', 'Inge', 'mr-i@example.test')
ON CONFLICT (id) DO NOTHING;
UPDATE public.profiles SET is_active = false WHERE id = 'cccccccc-0000-4000-8000-000000000008';
DELETE FROM public.user_roles WHERE user_id::text LIKE 'cccccccc-0000-4000-8000-00000000000%';
INSERT INTO public.user_roles (user_id, role)
SELECT id, CASE WHEN id = 'cccccccc-0000-4000-8000-000000000005' THEN 'manager'::public.app_role ELSE 'member'::public.app_role END
  FROM public.profiles WHERE id::text LIKE 'cccccccc-0000-4000-8000-00000000000%';

-- All tasks: assignee A, 2h already logged (so the logged-hours gate is satisfied)
--  01 permissions/legacy sync   02 legacy-column insert   03 all-approve   04 rejection
--  05 on behalf of reviewers    06 mid-review changes     07 timer + two reviewers
--  08 blocked notice            09 In Review, no cycle (pre-workflow)
INSERT INTO public.tasks (id, task_name, assigned_to, reviewer, created_by, status, started_at, system_hours, actual_hours) VALUES
  ('dddddddd-0000-4000-8000-000000000001', 'T01', 'cccccccc-0000-4000-8000-000000000001', NULL, 'cccccccc-0000-4000-8000-000000000001', 'In Progress', NULL, 0, 2),
  ('dddddddd-0000-4000-8000-000000000002', 'T02', 'cccccccc-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000002', 'cccccccc-0000-4000-8000-000000000001', 'In Progress', NULL, 0, 2),
  ('dddddddd-0000-4000-8000-000000000003', 'T03', 'cccccccc-0000-4000-8000-000000000001', NULL, 'cccccccc-0000-4000-8000-000000000001', 'In Progress', NULL, 0, 2),
  ('dddddddd-0000-4000-8000-000000000004', 'T04', 'cccccccc-0000-4000-8000-000000000001', NULL, 'cccccccc-0000-4000-8000-000000000001', 'In Progress', NULL, 0, 2),
  ('dddddddd-0000-4000-8000-000000000005', 'T05', 'cccccccc-0000-4000-8000-000000000001', NULL, 'cccccccc-0000-4000-8000-000000000001', 'In Progress', NULL, 0, 2),
  ('dddddddd-0000-4000-8000-000000000006', 'T06', 'cccccccc-0000-4000-8000-000000000001', NULL, 'cccccccc-0000-4000-8000-000000000001', 'In Progress', NULL, 0, 2),
  ('dddddddd-0000-4000-8000-000000000007', 'T07', 'cccccccc-0000-4000-8000-000000000001', NULL, 'cccccccc-0000-4000-8000-000000000001', 'In Progress', now() - interval '2 hours', 0, NULL),
  ('dddddddd-0000-4000-8000-000000000008', 'T08', 'cccccccc-0000-4000-8000-000000000001', NULL, 'cccccccc-0000-4000-8000-000000000001', 'In Progress', NULL, 0, 2),
  ('dddddddd-0000-4000-8000-000000000009', 'T09', 'cccccccc-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000003', 'cccccccc-0000-4000-8000-000000000001', 'In Review', NULL, 0, 2);

-- ---- 1. the legacy column and the reviewer list stay one thing -------------------------------
SELECT public.__assert(
  (SELECT count(*) = 1 AND bool_and(reviewer_id = 'cccccccc-0000-4000-8000-000000000002')
     FROM public.task_reviewers WHERE task_id = 'dddddddd-0000-4000-8000-000000000002'),
  'a task created with the legacy reviewer column gets a matching task_reviewers row');
SELECT public.__assert(
  (SELECT count(*) = 0 FROM public.task_reviewers WHERE task_id = 'dddddddd-0000-4000-8000-000000000001'),
  'a task without reviewers has no rows');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'cccccccc-0000-4000-8000-000000000006', true);
SELECT public.__expect_err($$SELECT * FROM public.set_task_reviewers('dddddddd-0000-4000-8000-000000000001', ARRAY['cccccccc-0000-4000-8000-000000000002']::uuid[])$$, 'You can only change reviewers');
SELECT set_config('request.jwt.claim.sub', 'cccccccc-0000-4000-8000-000000000001', true);
SELECT public.__expect_err($$SELECT * FROM public.set_task_reviewers('dddddddd-0000-4000-8000-000000000001', ARRAY['cccccccc-0000-4000-8000-000000000001']::uuid[])$$, 'cannot be the assignee');
SELECT public.__expect_err($$SELECT * FROM public.set_task_reviewers('dddddddd-0000-4000-8000-000000000001', ARRAY['cccccccc-0000-4000-8000-000000000008']::uuid[])$$, 'unknown or inactive');
SELECT public.__expect_err($$SELECT * FROM public.set_task_reviewers('dddddddd-0000-4000-8000-000000000001', ARRAY(SELECT gen_random_uuid() FROM generate_series(1, 11)))$$, 'at most 10');
SELECT public.__expect_ok($$SELECT * FROM public.set_task_reviewers('dddddddd-0000-4000-8000-000000000001', ARRAY['cccccccc-0000-4000-8000-000000000002','cccccccc-0000-4000-8000-000000000002','cccccccc-0000-4000-8000-000000000003','cccccccc-0000-4000-8000-000000000004']::uuid[])$$);
-- direct writes bypassing the function are not possible
SELECT public.__expect_err($$INSERT INTO public.task_reviewers (task_id, reviewer_id) VALUES ('dddddddd-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000007')$$, 'row-level security');
SELECT public.__expect_err($$INSERT INTO public.task_review_decisions (review_id, task_id, reviewer_id) VALUES (gen_random_uuid(), 'dddddddd-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000007')$$, 'row-level security');
RESET ROLE;
SELECT public.__assert(
  (SELECT array_agg(reviewer_id ORDER BY position) = ARRAY['cccccccc-0000-4000-8000-000000000002','cccccccc-0000-4000-8000-000000000003','cccccccc-0000-4000-8000-000000000004']::uuid[]
     FROM public.task_reviewers WHERE task_id = 'dddddddd-0000-4000-8000-000000000001'),
  'the list is de-duplicated and keeps the given order');
SELECT public.__assert(
  (SELECT reviewer = 'cccccccc-0000-4000-8000-000000000002' FROM public.tasks WHERE id = 'dddddddd-0000-4000-8000-000000000001'),
  'tasks.reviewer mirrors the primary (first) reviewer');

-- reordering changes the primary; a legacy write replaces only the primary
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'cccccccc-0000-4000-8000-000000000001', true);
SELECT public.__expect_ok($$SELECT * FROM public.set_task_reviewers('dddddddd-0000-4000-8000-000000000001', ARRAY['cccccccc-0000-4000-8000-000000000004','cccccccc-0000-4000-8000-000000000002','cccccccc-0000-4000-8000-000000000003']::uuid[])$$);
RESET ROLE;
SELECT public.__assert(
  (SELECT reviewer = 'cccccccc-0000-4000-8000-000000000004' FROM public.tasks WHERE id = 'dddddddd-0000-4000-8000-000000000001'),
  'reordering moves the mirror to the new primary');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'cccccccc-0000-4000-8000-000000000005', true);
SELECT public.__expect_ok($$UPDATE public.tasks SET reviewer = 'cccccccc-0000-4000-8000-000000000007' WHERE id = 'dddddddd-0000-4000-8000-000000000001'$$);
RESET ROLE;
SELECT public.__assert(
  (SELECT array_agg(reviewer_id ORDER BY position) = ARRAY['cccccccc-0000-4000-8000-000000000007','cccccccc-0000-4000-8000-000000000002','cccccccc-0000-4000-8000-000000000003']::uuid[]
     FROM public.task_reviewers WHERE task_id = 'dddddddd-0000-4000-8000-000000000001'),
  'a legacy write to tasks.reviewer replaces only the old primary and keeps the other reviewers');
SELECT public.__assert(
  (SELECT reviewer = 'cccccccc-0000-4000-8000-000000000007' FROM public.tasks WHERE id = 'dddddddd-0000-4000-8000-000000000001'),
  'the mirror still equals the primary after a legacy write');

-- ---- 2. send for review: one pending decision per reviewer -------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'cccccccc-0000-4000-8000-000000000001', true);
SELECT public.__expect_ok($$SELECT * FROM public.set_task_reviewers('dddddddd-0000-4000-8000-000000000003', ARRAY['cccccccc-0000-4000-8000-000000000002','cccccccc-0000-4000-8000-000000000003','cccccccc-0000-4000-8000-000000000004']::uuid[])$$);
SELECT public.__expect_ok($$SELECT public.submit_task_for_review('dddddddd-0000-4000-8000-000000000003', 2)$$);
RESET ROLE;
CREATE TABLE public.__snap AS SELECT id, version, updated_at, system_hours, actual_hours FROM public.tasks;

SELECT public.__assert(
  (SELECT count(*) = 3 AND bool_and(d.decision = 'pending') AND bool_and(d.decided_by IS NULL)
     FROM public.task_review_decisions d JOIN public.task_reviews c ON c.id = d.review_id
    WHERE c.task_id = 'dddddddd-0000-4000-8000-000000000003' AND c.cycle_no = 1),
  'the cycle has one pending decision per reviewer');
SELECT public.__assert(
  (SELECT count(*) = 3 FROM public.notifications
    WHERE task_id = 'dddddddd-0000-4000-8000-000000000003' AND type = 'review_requested'
      AND user_id IN ('cccccccc-0000-4000-8000-000000000002','cccccccc-0000-4000-8000-000000000003','cccccccc-0000-4000-8000-000000000004')),
  'every reviewer is notified');
SELECT public.__assert(
  (SELECT count(*) = 3 FROM public.pending_review_assignments WHERE task_id = 'dddddddd-0000-4000-8000-000000000003'),
  'the read model lists all three pending reviewers');

-- ---- 3. independent statuses; fully approved only when ALL approved ----------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'cccccccc-0000-4000-8000-000000000001', true);
SELECT public.__expect_err($$SELECT public.decide_task_review('dddddddd-0000-4000-8000-000000000003', 'approved', NULL)$$, 'assigned reviewer or a manager');
SELECT set_config('request.jwt.claim.sub', 'cccccccc-0000-4000-8000-000000000006', true);
SELECT public.__expect_err($$SELECT public.decide_task_review('dddddddd-0000-4000-8000-000000000003', 'approved', NULL)$$, 'assigned reviewer or a manager');
SELECT set_config('request.jwt.claim.sub', 'cccccccc-0000-4000-8000-000000000005', true);
SELECT public.__expect_err($$SELECT public.decide_task_review('dddddddd-0000-4000-8000-000000000003', 'approved', NULL)$$, 'Choose which reviewer');
-- R1 approves
SELECT set_config('request.jwt.claim.sub', 'cccccccc-0000-4000-8000-000000000002', true);
SELECT public.__expect_err($$SELECT public.decide_task_review('dddddddd-0000-4000-8000-000000000003', 'approved', NULL, 'cccccccc-0000-4000-8000-000000000003')$$, 'Only a manager/admin can decide on behalf');
SELECT public.__expect_ok($$SELECT public.decide_task_review('dddddddd-0000-4000-8000-000000000003', 'approved', 'R1 ok')$$);
SELECT public.__expect_err($$SELECT public.decide_task_review('dddddddd-0000-4000-8000-000000000003', 'approved', NULL)$$, 'already decided');
RESET ROLE;

SELECT public.__assert(
  (SELECT decision = 'approved' AND decided_by = reviewer_id AND reviewer_id = 'cccccccc-0000-4000-8000-000000000002' AND feedback = 'R1 ok'
     FROM public.task_review_decisions WHERE task_id = 'dddddddd-0000-4000-8000-000000000003' AND reviewer_id = 'cccccccc-0000-4000-8000-000000000002'),
  'R1''s own row records R1''s approval');
SELECT public.__assert(
  (SELECT count(*) = 2 AND bool_and(decision = 'pending') AND bool_and(decided_at IS NULL)
     FROM public.task_review_decisions WHERE task_id = 'dddddddd-0000-4000-8000-000000000003' AND reviewer_id <> 'cccccccc-0000-4000-8000-000000000002'),
  'R1''s approval did not touch R2''s or R3''s status');
SELECT public.__assert(
  (SELECT status::text = 'In Review' FROM public.tasks WHERE id = 'dddddddd-0000-4000-8000-000000000003'),
  'one approval out of three does not complete the task');
SELECT public.__assert(
  (SELECT t.version = s.version AND t.updated_at = s.updated_at AND t.system_hours IS NOT DISTINCT FROM s.system_hours AND t.actual_hours IS NOT DISTINCT FROM s.actual_hours
     FROM public.tasks t JOIN public.__snap s ON s.id = t.id WHERE t.id = 'dddddddd-0000-4000-8000-000000000003'),
  'a partial approval does not modify the task row at all');
SELECT public.__assert(
  (SELECT decision = 'pending' FROM public.task_reviews WHERE task_id = 'dddddddd-0000-4000-8000-000000000003' AND cycle_no = 1),
  'the cycle stays pending until everyone has approved');
SELECT public.__assert(
  (SELECT count(*) = 1 FROM public.notifications
    WHERE task_id = 'dddddddd-0000-4000-8000-000000000003' AND user_id = 'cccccccc-0000-4000-8000-000000000001'
      AND type = 'review_approved' AND title LIKE '%approved by % (1/3)%'),
  'the assignee is told about each approval with progress (1/3)');
SELECT public.__assert(
  (SELECT count(*) = 2 FROM public.pending_review_assignments WHERE task_id = 'dddddddd-0000-4000-8000-000000000003'),
  'the read model drops R1 and keeps R2 and R3');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'cccccccc-0000-4000-8000-000000000003', true);
SELECT public.__expect_ok($$SELECT public.decide_task_review('dddddddd-0000-4000-8000-000000000003', 'approved', NULL)$$);
RESET ROLE;
SELECT public.__assert(
  (SELECT status::text = 'In Review' FROM public.tasks WHERE id = 'dddddddd-0000-4000-8000-000000000003'),
  'two of three approvals still does not complete the task');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'cccccccc-0000-4000-8000-000000000004', true);
SELECT public.__expect_ok($$SELECT public.decide_task_review('dddddddd-0000-4000-8000-000000000003', 'approved', 'all good')$$);
RESET ROLE;
SELECT public.__assert(
  (SELECT status::text = 'Completed' AND done AND completed_at IS NOT NULL FROM public.tasks WHERE id = 'dddddddd-0000-4000-8000-000000000003'),
  'the third approval completes the task');
SELECT public.__assert(
  (SELECT decision = 'approved' AND decided_by = 'cccccccc-0000-4000-8000-000000000004' FROM public.task_reviews WHERE task_id = 'dddddddd-0000-4000-8000-000000000003' AND cycle_no = 1),
  'the cycle summary is derived: approved, closed by the last approver');
SELECT public.__assert(
  (SELECT count(*) = 3 AND bool_and(decision = 'approved' AND decided_by = reviewer_id)
     FROM public.task_review_decisions WHERE task_id = 'dddddddd-0000-4000-8000-000000000003'),
  'each reviewer''s own decision is stored on their own row');
SELECT public.__assert(
  (SELECT count(*) = 1 FROM public.notifications WHERE task_id = 'dddddddd-0000-4000-8000-000000000003' AND title LIKE '%— approved' AND body LIKE 'All 3 reviewers approved%'),
  'the assignee gets one final "all reviewers approved" notice');
SELECT public.__assert(
  (SELECT t.actual_hours = s.actual_hours AND t.system_hours IS NOT DISTINCT FROM s.system_hours
     FROM public.tasks t JOIN public.__snap s ON s.id = t.id WHERE t.id = 'dddddddd-0000-4000-8000-000000000003'),
  'completing with several reviewers does not change logged or tracked hours');

-- ---- 4. one rejection sends it back; the others keep their own status -------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'cccccccc-0000-4000-8000-000000000001', true);
SELECT public.__expect_ok($$SELECT * FROM public.set_task_reviewers('dddddddd-0000-4000-8000-000000000004', ARRAY['cccccccc-0000-4000-8000-000000000002','cccccccc-0000-4000-8000-000000000003','cccccccc-0000-4000-8000-000000000004']::uuid[])$$);
SELECT public.__expect_ok($$SELECT public.submit_task_for_review('dddddddd-0000-4000-8000-000000000004', 2)$$);
SELECT set_config('request.jwt.claim.sub', 'cccccccc-0000-4000-8000-000000000002', true);
SELECT public.__expect_ok($$SELECT public.decide_task_review('dddddddd-0000-4000-8000-000000000004', 'approved', NULL)$$);
RESET ROLE;
CREATE TABLE public.__r1_before AS SELECT decided_at FROM public.task_review_decisions
 WHERE task_id = 'dddddddd-0000-4000-8000-000000000004' AND reviewer_id = 'cccccccc-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'cccccccc-0000-4000-8000-000000000003', true);
SELECT public.__expect_err($$SELECT public.decide_task_review('dddddddd-0000-4000-8000-000000000004', 'changes_requested', '  ')$$, 'Feedback is required');
SELECT public.__expect_ok($$SELECT public.decide_task_review('dddddddd-0000-4000-8000-000000000004', 'changes_requested', 'Needs tests')$$);
SELECT set_config('request.jwt.claim.sub', 'cccccccc-0000-4000-8000-000000000004', true);
SELECT public.__expect_err($$SELECT public.decide_task_review('dddddddd-0000-4000-8000-000000000004', 'approved', NULL)$$, 'not in review');
RESET ROLE;
SELECT public.__assert(
  (SELECT status::text = 'In Progress' FROM public.tasks WHERE id = 'dddddddd-0000-4000-8000-000000000004'),
  'a single change request sends the task back to In Progress');
SELECT public.__assert(
  (SELECT d.decision = 'approved' AND d.decided_at = b.decided_at FROM public.task_review_decisions d, public.__r1_before b
    WHERE d.task_id = 'dddddddd-0000-4000-8000-000000000004' AND d.reviewer_id = 'cccccccc-0000-4000-8000-000000000002'),
  'R1''s earlier approval is untouched by R2''s rejection');
SELECT public.__assert(
  (SELECT decision = 'changes_requested' AND feedback = 'Needs tests' AND decided_by = 'cccccccc-0000-4000-8000-000000000003'
     FROM public.task_review_decisions WHERE task_id = 'dddddddd-0000-4000-8000-000000000004' AND reviewer_id = 'cccccccc-0000-4000-8000-000000000003'),
  'R2''s row records the change request');
SELECT public.__assert(
  (SELECT decision = 'pending' FROM public.task_review_decisions WHERE task_id = 'dddddddd-0000-4000-8000-000000000004' AND reviewer_id = 'cccccccc-0000-4000-8000-000000000004'),
  'R3 who had not decided is still pending in the closed cycle');
SELECT public.__assert(
  (SELECT decision = 'changes_requested' AND decided_by = 'cccccccc-0000-4000-8000-000000000003' FROM public.task_reviews WHERE task_id = 'dddddddd-0000-4000-8000-000000000004' AND cycle_no = 1),
  'the cycle summary is changes_requested');
SELECT public.__assert(
  (SELECT count(*) = 0 FROM public.pending_review_assignments WHERE task_id = 'dddddddd-0000-4000-8000-000000000004'),
  'once sent back nobody has a pending review on the task');

-- resubmit: a new cycle where everyone starts pending again, history of cycle 1 is kept
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'cccccccc-0000-4000-8000-000000000001', true);
SELECT public.__expect_ok($$SELECT public.submit_task_for_review('dddddddd-0000-4000-8000-000000000004', 2)$$);
RESET ROLE;
SELECT public.__assert(
  (SELECT count(*) = 3 AND bool_and(d.decision = 'pending')
     FROM public.task_review_decisions d JOIN public.task_reviews c ON c.id = d.review_id
    WHERE c.task_id = 'dddddddd-0000-4000-8000-000000000004' AND c.cycle_no = 2),
  'the new cycle starts with all three reviewers pending');
SELECT public.__assert(
  (SELECT count(*) FILTER (WHERE d.decision = 'approved') = 1 AND count(*) FILTER (WHERE d.decision = 'changes_requested') = 1 AND count(*) FILTER (WHERE d.decision = 'pending') = 1
     FROM public.task_review_decisions d JOIN public.task_reviews c ON c.id = d.review_id
    WHERE c.task_id = 'dddddddd-0000-4000-8000-000000000004' AND c.cycle_no = 1),
  'cycle 1 keeps each reviewer''s recorded status');

-- ---- 5. on behalf of a reviewer: who was asked vs who actually decided ---------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'cccccccc-0000-4000-8000-000000000001', true);
SELECT public.__expect_ok($$SELECT * FROM public.set_task_reviewers('dddddddd-0000-4000-8000-000000000005', ARRAY['cccccccc-0000-4000-8000-000000000002','cccccccc-0000-4000-8000-000000000003']::uuid[])$$);
SELECT public.__expect_ok($$SELECT public.submit_task_for_review('dddddddd-0000-4000-8000-000000000005', 2)$$);
SELECT set_config('request.jwt.claim.sub', 'cccccccc-0000-4000-8000-000000000005', true);
SELECT public.__expect_err($$SELECT public.decide_task_review('dddddddd-0000-4000-8000-000000000005', 'approved', NULL, 'cccccccc-0000-4000-8000-000000000007')$$, 'not a reviewer');
SELECT public.__expect_ok($$SELECT public.decide_task_review('dddddddd-0000-4000-8000-000000000005', 'approved', 'on behalf', 'cccccccc-0000-4000-8000-000000000003')$$);
-- exactly one reviewer is left pending, so no name is needed
SELECT public.__expect_ok($$SELECT public.decide_task_review('dddddddd-0000-4000-8000-000000000005', 'approved', NULL)$$);
RESET ROLE;
SELECT public.__assert(
  (SELECT decided_by = 'cccccccc-0000-4000-8000-000000000005' AND reviewer_id = 'cccccccc-0000-4000-8000-000000000003' AND decision = 'approved'
     FROM public.task_review_decisions WHERE task_id = 'dddddddd-0000-4000-8000-000000000005' AND reviewer_id = 'cccccccc-0000-4000-8000-000000000003'),
  'R2''s row shows R2 as the reviewer and the manager as the actual decider');
SELECT public.__assert(
  (SELECT decided_by = 'cccccccc-0000-4000-8000-000000000005' AND reviewer_id = 'cccccccc-0000-4000-8000-000000000002'
     FROM public.task_review_decisions WHERE task_id = 'dddddddd-0000-4000-8000-000000000005' AND reviewer_id = 'cccccccc-0000-4000-8000-000000000002'),
  'the single remaining pending reviewer was targeted automatically');
SELECT public.__assert(
  (SELECT status::text = 'Completed' FROM public.tasks WHERE id = 'dddddddd-0000-4000-8000-000000000005'),
  'the task completes when every reviewer''s row is approved, whoever entered it');

-- ---- 6. changing reviewers while the review is open ----------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'cccccccc-0000-4000-8000-000000000001', true);
SELECT public.__expect_ok($$SELECT * FROM public.set_task_reviewers('dddddddd-0000-4000-8000-000000000006', ARRAY['cccccccc-0000-4000-8000-000000000002','cccccccc-0000-4000-8000-000000000003']::uuid[])$$);
SELECT public.__expect_ok($$SELECT public.submit_task_for_review('dddddddd-0000-4000-8000-000000000006', 2)$$);
SELECT public.__expect_err($$SELECT * FROM public.set_task_reviewers('dddddddd-0000-4000-8000-000000000006', ARRAY['cccccccc-0000-4000-8000-000000000002']::uuid[])$$, 'Only a manager can change the reviewers while');
SELECT public.__expect_err($$UPDATE public.tasks SET reviewer = 'cccccccc-0000-4000-8000-000000000004' WHERE id = 'dddddddd-0000-4000-8000-000000000006'$$, 'Only a manager can change reviewer');
SELECT set_config('request.jwt.claim.sub', 'cccccccc-0000-4000-8000-000000000005', true);
SELECT public.__expect_err($$UPDATE public.tasks SET reviewer = 'cccccccc-0000-4000-8000-000000000004' WHERE id = 'dddddddd-0000-4000-8000-000000000006'$$, 'reviewers list');
SELECT public.__expect_err($$SELECT * FROM public.set_task_reviewers('dddddddd-0000-4000-8000-000000000006', ARRAY[]::uuid[])$$, 'at least one reviewer');
-- add R4 (gets a pending row + notification); drop R2 (still pending)
SELECT public.__expect_ok($$SELECT * FROM public.set_task_reviewers('dddddddd-0000-4000-8000-000000000006', ARRAY['cccccccc-0000-4000-8000-000000000002','cccccccc-0000-4000-8000-000000000007']::uuid[])$$);
SELECT set_config('request.jwt.claim.sub', 'cccccccc-0000-4000-8000-000000000002', true);
SELECT public.__expect_ok($$SELECT public.decide_task_review('dddddddd-0000-4000-8000-000000000006', 'approved', NULL)$$);
SELECT set_config('request.jwt.claim.sub', 'cccccccc-0000-4000-8000-000000000005', true);
-- R1 has decided: cannot be removed; R4 is the last pending: cannot be removed
SELECT public.__expect_err($$SELECT * FROM public.set_task_reviewers('dddddddd-0000-4000-8000-000000000006', ARRAY['cccccccc-0000-4000-8000-000000000007']::uuid[])$$, 'have not decided yet');
RESET ROLE;
SELECT public.__assert(
  (SELECT decision = 'withdrawn' FROM public.task_review_decisions WHERE task_id = 'dddddddd-0000-4000-8000-000000000006' AND reviewer_id = 'cccccccc-0000-4000-8000-000000000003')
  AND (SELECT decision = 'pending' FROM public.task_review_decisions WHERE task_id = 'dddddddd-0000-4000-8000-000000000006' AND reviewer_id = 'cccccccc-0000-4000-8000-000000000007'),
  'the removed reviewer is withdrawn and the added reviewer is pending in the open cycle');
SELECT public.__assert(
  (SELECT count(*) = 1 FROM public.notifications WHERE task_id = 'dddddddd-0000-4000-8000-000000000006' AND user_id = 'cccccccc-0000-4000-8000-000000000007' AND type = 'review_requested'),
  'the added reviewer is notified');
SELECT public.__assert(
  (SELECT status::text = 'In Review' FROM public.tasks WHERE id = 'dddddddd-0000-4000-8000-000000000006'),
  'R1 approved but R4 has not: still in review');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'cccccccc-0000-4000-8000-000000000007', true);
SELECT public.__expect_ok($$SELECT public.decide_task_review('dddddddd-0000-4000-8000-000000000006', 'approved', NULL)$$);
RESET ROLE;
SELECT public.__assert(
  (SELECT status::text = 'Completed' FROM public.tasks WHERE id = 'dddddddd-0000-4000-8000-000000000006'),
  'withdrawn reviewers are ignored: R1 + R4 approving completes the task');

-- ---- 7. timers and hours are banked once, regardless of the number of reviewers -----------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'cccccccc-0000-4000-8000-000000000001', true);
SELECT public.__expect_ok($$SELECT * FROM public.set_task_reviewers('dddddddd-0000-4000-8000-000000000007', ARRAY['cccccccc-0000-4000-8000-000000000002','cccccccc-0000-4000-8000-000000000003']::uuid[])$$);
SELECT public.__expect_ok($$SELECT public.submit_task_for_review('dddddddd-0000-4000-8000-000000000007', 1.5)$$);
SELECT set_config('request.jwt.claim.sub', 'cccccccc-0000-4000-8000-000000000002', true);
SELECT public.__expect_ok($$SELECT public.decide_task_review('dddddddd-0000-4000-8000-000000000007', 'approved', NULL)$$);
SELECT set_config('request.jwt.claim.sub', 'cccccccc-0000-4000-8000-000000000003', true);
SELECT public.__expect_ok($$SELECT public.decide_task_review('dddddddd-0000-4000-8000-000000000007', 'approved', NULL)$$);
RESET ROLE;
SELECT public.__assert(
  (SELECT status::text = 'Completed' AND system_hours = 2.00 AND actual_hours = 1.50 FROM public.tasks WHERE id = 'dddddddd-0000-4000-8000-000000000007'),
  'the 2h timer segment is banked once at submit; two approvals add nothing');
SELECT public.__assert(
  (SELECT count(*) = 1 AND sum(system_hours) = 2.00 AND bool_and(user_id = 'cccccccc-0000-4000-8000-000000000001')
     FROM public.task_worklogs WHERE task_id = 'dddddddd-0000-4000-8000-000000000007'),
  'one worklog for the assignee, none added by either approval');

-- ---- 8. blocked notice reaches every reviewer; pre-workflow In Review shows up in the read model --
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'cccccccc-0000-4000-8000-000000000001', true);
SELECT public.__expect_ok($$SELECT * FROM public.set_task_reviewers('dddddddd-0000-4000-8000-000000000008', ARRAY['cccccccc-0000-4000-8000-000000000002','cccccccc-0000-4000-8000-000000000003']::uuid[])$$);
SELECT public.__expect_ok($$SELECT public.notify_task_blocked('dddddddd-0000-4000-8000-000000000008', 'waiting')$$);
RESET ROLE;
SELECT public.__assert(
  (SELECT count(*) = 2 FROM public.notifications WHERE task_id = 'dddddddd-0000-4000-8000-000000000008' AND type = 'task_blocked'
      AND user_id IN ('cccccccc-0000-4000-8000-000000000002','cccccccc-0000-4000-8000-000000000003')),
  'both reviewers are told a task is blocked');
SELECT public.__assert(
  (SELECT count(*) = 1 AND bool_and(reviewer_id = 'cccccccc-0000-4000-8000-000000000003')
     FROM public.pending_review_assignments WHERE task_id = 'dddddddd-0000-4000-8000-000000000009'),
  'an In Review task with no cycle yet still lists its reviewers as pending');

-- ---- 9. hardening ----------------------------------------------------------------------------------
SELECT public.__assert(
  (SELECT bool_and(coalesce(array_to_string(proconfig, ',') LIKE '%search_path=public, pg_temp%', false))
     FROM pg_proc
    WHERE oid IN ('public.set_task_reviewers(uuid,uuid[])'::regprocedure,
                  'public.submit_task_for_review(uuid,numeric,text)'::regprocedure,
                  'public.decide_task_review(uuid,text,text,uuid)'::regprocedure,
                  'public.ensure_pending_review(public.tasks)'::regprocedure,
                  'public.sync_primary_reviewer()'::regprocedure,
                  'public.sync_legacy_reviewer()'::regprocedure)),
  'new and replaced SECURITY DEFINER functions pin search_path = public, pg_temp');
SELECT public.__assert(
  (SELECT count(*) = 0 FROM pg_proc WHERE proname = 'decide_task_review' AND pronargs = 3),
  'the old three-argument decide function is gone (no ambiguous overload)');

ROLLBACK;
\echo MULTIPLE_REVIEWERS_OK
