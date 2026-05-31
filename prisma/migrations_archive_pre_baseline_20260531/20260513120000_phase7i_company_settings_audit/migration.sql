-- Phase 7.I — additive enum extension for company-settings audit.
-- Idempotent (ALTER TYPE ADD VALUE doesn't support IF NOT EXISTS in all PG versions).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'AuditAction' AND e.enumlabel = 'company_settings_update'
  ) THEN
    ALTER TYPE "AuditAction" ADD VALUE 'company_settings_update';
  END IF;
END$$;
