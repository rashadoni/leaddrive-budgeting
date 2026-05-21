-- Phase 5.2 Stage 2 — provision the BYPASSRLS Postgres role.
--
-- USAGE (run as a Postgres superuser, e.g. the brew-installed default):
--   psql "$DATABASE_URL" -f scripts/sql/create-bypass-role.sql
--
-- WHAT IT DOES
-- 1. Creates `budgetpro_admin` role with the `BYPASSRLS` attribute —
--    queries issued by this role ignore every Row-Level Security
--    policy on every table.
-- 2. Grants the role full access on the BudgetPro schema (same as
--    the regular app role).
-- 3. Sets a password from psql variable `:'admin_password'` so the
--    invocation can pipe a secret without echoing.
--
-- WHO USES IT
--   • prisma migrate / prisma db push (DDL needs to ignore policies)
--   • scripts/* cron jobs that explicitly cross orgs (recompute
--     scheduler, archiver, etc.)
--   • background workers running cross-org maintenance
-- The regular app `DATABASE_URL` keeps using the non-BYPASSRLS role
-- so RLS-protected tables enforce per-org isolation for HTTP traffic.
--
-- ROTATION
-- The password is rotated like any other secret. Update both:
--   .env DATABASE_URL_ADMIN (postgres URL with new password)
--   keychain / vault entry for ops
--
-- ROLLBACK
--   DROP ROLE budgetpro_admin;
-- Migrations + cron switch back to the regular DATABASE_URL until
-- a new admin role is provisioned.

\set ON_ERROR_STOP true

-- Skip role creation when it already exists (idempotent for re-runs).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'budgetpro_admin') THEN
    EXECUTE format(
      'CREATE ROLE budgetpro_admin LOGIN BYPASSRLS PASSWORD %L',
      :'admin_password'
    );
  ELSE
    -- Ensure the attribute is set even if the role pre-existed without it.
    ALTER ROLE budgetpro_admin BYPASSRLS;
    -- Don't rotate the password on idempotent re-runs unless the caller
    -- explicitly passes a new one (use the dedicated rotate-password
    -- script for that).
  END IF;
END $$;

-- Grant database + schema privileges. The role inherits the same
-- table-level rights as the app role — RLS is the only differentiator.
GRANT CONNECT ON DATABASE :"db_name" TO budgetpro_admin;
GRANT USAGE ON SCHEMA public TO budgetpro_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public
  TO budgetpro_admin;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public
  TO budgetpro_admin;
-- Tables created in the future (e.g. Prisma migrations) inherit
-- these defaults without manual re-grant.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO budgetpro_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO budgetpro_admin;
