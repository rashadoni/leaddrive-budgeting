-- Truth-infra Phase C.1 (2026-05-26) — admin-controlled Company.status
-- via PATCH /api/companies/[id] { status }.
--
-- The Company.status field ('pending'/'active'/'archived') already exists
-- in the schema (added at Truth-infra C.1 schema merge). Auto-promotion
-- (pending→active on first import) is already wired in the onboarding
-- apply routes.  What was missing was:
--   (a) an API endpoint for admin manual overrides, and
--   (b) an audit trail for every manual override.
--
-- This migration adds the matching AuditAction enum value so the
-- company_status_change event can be persisted in audit_events.
--
-- Idempotent (DO block — same pattern as all prior additive enum migrations).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'company_status_change'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'AuditAction')
  ) THEN
    ALTER TYPE "AuditAction" ADD VALUE 'company_status_change';
  END IF;
END$$;
