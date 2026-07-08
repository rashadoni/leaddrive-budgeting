-- Phase 5.2 Stage 2 — provision the RESTRICTED (RLS-enforced) Postgres role.
--
-- Companion to create-bypass-role.sql. That script makes `budgetpro_admin`
-- (BYPASSRLS, for migrations + cross-org cron). THIS script makes
-- `budgetpro_app` — the role HTTP request handlers use via `DATABASE_URL_APP`
-- (wrapped by `withOrgScope`). It has NO BYPASSRLS, so every Row-Level
-- Security policy created by the prisma/migrations/*_rls_* migrations applies,
-- enforcing per-org isolation at the DB layer (defence-in-depth beyond the
-- app-layer `where: { organizationId }`).
--
-- USAGE (run as a Postgres superuser, AFTER `prisma migrate deploy` has
-- created the tables + RLS policies):
--   psql "$DATABASE_URL" \
--     -v app_password="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)" \
--     -v db_name=budgetpro \
--     -f scripts/sql/create-app-role.sql
-- Then set DATABASE_URL_APP in .env.production to:
--   postgresql scheme · budgetpro_app · <the password you passed> · host db · 5432 · <db_name>
--
-- WHO USES IT
--   • every org-scoped HTTP route wrapped in `withOrgScope` (16 today)
--   • the RLS integration test (src/lib/db/rls-leak.integration.test.ts)
-- The BYPASSRLS `budgetpro_admin` role keeps handling migrations + cron.
--
-- ROTATION: rotate like any secret — update DATABASE_URL_APP + the vault entry.
-- ROLLBACK: DROP ROLE budgetpro_app;  (handlers fall back to the default
--   client; app-layer org-scoping still holds, DB-layer RLS no longer enforced.)
--
-- NOTE: grants mirror create-bypass-role.sql EXACTLY except the role is created
-- WITHOUT BYPASSRLS — that single attribute is the whole differentiator.

\set ON_ERROR_STOP true

-- Idempotent: create only if missing; never silently flip BYPASSRLS on.
SELECT format(
  'CREATE ROLE budgetpro_app LOGIN NOBYPASSRLS PASSWORD %L',
  :'app_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'budgetpro_app')
\gexec

-- Defensive: ensure the role can NEVER bypass RLS even if it pre-existed
-- with the attribute set (a misconfigured app role would leak cross-org).
ALTER ROLE budgetpro_app NOBYPASSRLS;

-- Same table/schema privileges as the app needs; RLS policies (not GRANTs)
-- are what scope rows to the caller's org.
GRANT CONNECT ON DATABASE :"db_name" TO budgetpro_app;
GRANT USAGE ON SCHEMA public TO budgetpro_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public
  TO budgetpro_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public
  TO budgetpro_app;
-- Future tables (later Prisma migrations) inherit these without re-grant.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO budgetpro_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO budgetpro_app;
