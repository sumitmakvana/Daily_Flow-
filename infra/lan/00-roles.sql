-- LAN stack: roles that the restored dump's GRANTs and PostgREST expect.
-- Schemas/functions (auth.*, keycloak, public.*) come from the restored dump itself.
-- PostgREST connects as POSTGRES_USER, so no role here has a login password.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticator') THEN CREATE ROLE authenticator NOINHERIT NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='admin') THEN CREATE ROLE admin NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='manager') THEN CREATE ROLE manager NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='member') THEN CREATE ROLE member NOLOGIN; END IF;
END $$;
GRANT anon, authenticated, service_role TO authenticator;
GRANT authenticated TO admin, manager, member;
GRANT admin, manager, member TO authenticator;
