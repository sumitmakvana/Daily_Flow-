-- Minimal stand-in for the production tables the realtime triggers read (columns that matter only).
-- Used by tests/realtime/outbox-db.test.ts against a DISPOSABLE database (SCRATCH_PG_URL).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
END $$;
CREATE TYPE public.app_role AS ENUM ('admin', 'manager', 'member');
CREATE TABLE public.tasks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), assigned_to uuid, reviewer uuid, created_by uuid, task_name text DEFAULT 'secret title', status text DEFAULT 'To Do', updated_at timestamptz DEFAULT now());
CREATE TABLE public.task_reviewers (task_id uuid NOT NULL, reviewer_id uuid NOT NULL, PRIMARY KEY (task_id, reviewer_id));
CREATE TABLE public.task_review_decisions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id uuid NOT NULL, reviewer_id uuid, decided_by uuid, decision text DEFAULT 'pending', feedback text);
CREATE TABLE public.task_worklogs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id uuid NOT NULL, user_id uuid NOT NULL, system_hours numeric DEFAULT 0);
CREATE TABLE public.leaves (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, request_to uuid, reviewed_by uuid, status text DEFAULT 'pending', reason text DEFAULT 'private reason');
CREATE TABLE public.eod_checkins (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, note text);
CREATE TABLE public.nudges (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, message text);
CREATE TABLE public.risk_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), entity_type text, entity_id uuid, detail text);
CREATE TABLE public.planning_suggestions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id uuid, from_user_id uuid, to_user_id uuid, status text DEFAULT 'open');
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, role public.app_role NOT NULL, UNIQUE (user_id, role));
CREATE TABLE public.approval_chains (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.approval_steps (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), chain_id uuid NOT NULL, step_order int NOT NULL, approver_mode text NOT NULL, approver_role public.app_role, approver_user_id uuid);
CREATE TABLE public.approval_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), work_item_id uuid NOT NULL, chain_id uuid NOT NULL, requested_by uuid, status text DEFAULT 'pending');
CREATE TABLE public.automation_runs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text DEFAULT 'ok');
CREATE TABLE public.automation_rules (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), is_active boolean DEFAULT true);
CREATE TABLE public.automation_queue_stats (id smallint PRIMARY KEY DEFAULT 1, pending_count bigint DEFAULT 0);
INSERT INTO public.automation_queue_stats (id) VALUES (1);
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
