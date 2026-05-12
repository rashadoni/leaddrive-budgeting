-- Phase 7.E AI Morning Brief — additive enum value.
-- Idempotent (IF NOT EXISTS pattern via DO block since ALTER TYPE
-- ADD VALUE doesn't support IF NOT EXISTS in all PG versions).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'ai_morning_brief_run'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'AuditAction')
  ) THEN
    ALTER TYPE "AuditAction" ADD VALUE 'ai_morning_brief_run';
  END IF;
END$$;
