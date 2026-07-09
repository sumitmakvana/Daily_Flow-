-- Auth stub schema.
--
-- The whole point of this file: keep all 102 existing RLS policies and the
-- 14 functions that reference auth.uid() working unchanged after cutover.
-- GoTrue stores its tables in `auth.*` (we let it run its own migrations
-- inside this same schema). What we add here are the SQL helpers that
-- PostgREST + RLS expect from Supabase.
--
-- PostgREST sets request.jwt.claim.<key> from the bearer token for every
-- request. These helpers read those settings, exactly like Supabase does.

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS keycloak;

CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY,
  email TEXT,
  raw_user_meta_data JSONB
);

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.sub', true), ''),
    (auth.jwt()->>'sub')
  )::uuid
$$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    (auth.jwt()->>'role'),
    'anon'
  )
$$;

CREATE OR REPLACE FUNCTION auth.email() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.email', true), ''),
    (auth.jwt()->>'email')
  )
$$;

CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;

-- PostgREST roles. GoTrue issues JWTs with role=authenticated or role=anon;
-- PostgREST switches the connection role to match.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    CREATE ROLE authenticator NOINHERIT LOGIN PASSWORD 'change_me_authenticator';
  END IF;
END $$;

GRANT anon, authenticated, service_role TO authenticator;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA auth   TO anon, authenticated, service_role;

-- Helper to automatically provision profile and roles for Keycloak users upon login
CREATE OR REPLACE FUNCTION public.ensure_user_profile(user_id uuid, user_email text, user_name text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  is_first_user BOOLEAN;
BEGIN
  -- 0. Insert mock user into auth.users to satisfy foreign key constraints
  INSERT INTO auth.users (id, email)
  VALUES (ensure_user_profile.user_id, ensure_user_profile.user_email)
  ON CONFLICT (id) DO NOTHING;

  -- 1. Insert profile if it doesn't exist
  INSERT INTO public.profiles (id, display_name, email)
  VALUES (
    ensure_user_profile.user_id,
    COALESCE(ensure_user_profile.user_name, split_part(ensure_user_profile.user_email, '@', 1)),
    ensure_user_profile.user_email
  )
  ON CONFLICT (id) DO NOTHING;

  -- 2. Check if this is the first user overall in user_roles
  SELECT NOT EXISTS (SELECT 1 FROM public.user_roles) INTO is_first_user;

  -- 3. Assign role if user doesn't already have one
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_roles.user_id = ensure_user_profile.user_id) THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (
      ensure_user_profile.user_id,
      CASE WHEN is_first_user THEN 'admin'::public.app_role ELSE 'member'::public.app_role END
    );
  END IF;
END;
$$;

-- Create Keycloak-matching DB roles for PostgREST dynamic claim-to-role switching
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'admin') THEN
    CREATE ROLE admin NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'manager') THEN
    CREATE ROLE manager NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'member') THEN
    CREATE ROLE member NOLOGIN;
  END IF;
END
$$;

GRANT authenticated TO admin, manager, member;
GRANT admin, manager, member TO authenticator;

-- Ensure roles have permissions on all public tables, sequences, and functions
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO authenticated, anon, service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO authenticated, anon, service_role;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO authenticated, anon, service_role;

-- Fix notify_task_blocked partial index constraint mismatch bug
CREATE OR REPLACE FUNCTION public.notify_task_blocked(_task_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  t public.tasks;
  k text;
BEGIN
  SELECT * INTO t FROM public.tasks WHERE id = _task_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'task not found'; END IF;
  IF caller IS DISTINCT FROM t.assigned_to AND NOT public.is_manager_or_admin(caller) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  IF t.reviewer IS NULL OR t.reviewer = caller THEN RETURN; END IF;
  k := 'BLOCKED_' || _task_id::text || '_' || (now() AT TIME ZONE 'utc')::date::text;
  INSERT INTO public.notifications(user_id, type, title, body, task_id, dedupe_key)
  VALUES (t.reviewer, 'task_blocked', t.task_code || ' blocked',
          COALESCE(_reason, 'Task marked as blocked'), _task_id, k)
  ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
END;
$$;

-- Fix log_task_change function text array casting bug
CREATE OR REPLACE FUNCTION public.log_task_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := COALESCE(NEW.updated_by, auth.uid());
  parts text[] := ARRAY[]::text[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.task_history(task_id, old_status, new_status, updated_by, comment)
    VALUES (NEW.id, NULL, NEW.status, actor, 'created');
    RETURN NEW;
  END IF;

  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.task_history(task_id, old_status, new_status, updated_by, comment)
    VALUES (NEW.id, OLD.status, NEW.status, actor, NULL);
  END IF;

  IF OLD.assigned_to IS DISTINCT FROM NEW.assigned_to THEN
    parts := parts || format('assignee → %s', COALESCE(NEW.assigned_to::text, 'unassigned'));
  END IF;
  IF OLD.priority IS DISTINCT FROM NEW.priority THEN
    parts := parts || format('priority %s → %s', OLD.priority, NEW.priority);
  END IF;
  IF OLD.due_date IS DISTINCT FROM NEW.due_date THEN
    parts := parts || format('due %s → %s', COALESCE(OLD.due_date::text,'—'), COALESCE(NEW.due_date::text,'—'));
  END IF;
  IF OLD.reviewer IS DISTINCT FROM NEW.reviewer THEN
    parts := parts || 'reviewer changed'::text;
  END IF;
  IF array_length(parts,1) IS NOT NULL THEN
    INSERT INTO public.task_history(task_id, old_status, new_status, updated_by, comment)
    VALUES (NEW.id, OLD.status, NEW.status, actor, array_to_string(parts, '; '));
  END IF;

  RETURN NEW;
END;
$$;

-- Fix: work_item_types.updated_at column (queried by the app but missing from schema)
ALTER TABLE public.work_item_types ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION public.update_work_item_types_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_work_item_types_updated ON public.work_item_types;
CREATE TRIGGER trg_work_item_types_updated
  BEFORE UPDATE ON public.work_item_types
  FOR EACH ROW EXECUTE FUNCTION public.update_work_item_types_updated_at();





