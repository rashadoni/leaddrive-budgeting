-- Truth-infra Phase C.2 (2026-05-26)
-- Add company_industry_change to AuditAction enum.
--
-- Idempotent DO block mirrors the company_status_change pattern from C.1
-- (20260526200000_company_status_change_audit/migration.sql) so re-running
-- against a DB that already has the value is a safe no-op.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'company_industry_change'
      AND enumtypid = (
        SELECT oid FROM pg_type WHERE typname = 'AuditAction'
      )
  ) THEN
    ALTER TYPE "AuditAction" ADD VALUE 'company_industry_change';
  END IF;
END
$$;
