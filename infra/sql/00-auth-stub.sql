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

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'anon')
$$;

CREATE OR REPLACE FUNCTION auth.email() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.email', true), '')
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


