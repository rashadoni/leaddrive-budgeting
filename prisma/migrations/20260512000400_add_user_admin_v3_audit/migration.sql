-- Phase 7.F admin v3: 3 new audit-action enum values for user lifecycle.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'AuditAction' AND e.enumlabel = 'user_create') THEN
    ALTER TYPE "AuditAction" ADD VALUE 'user_create';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'AuditAction' AND e.enumlabel = 'user_password_reset') THEN
    ALTER TYPE "AuditAction" ADD VALUE 'user_password_reset';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'AuditAction' AND e.enumlabel = 'user_active_toggle') THEN
    ALTER TYPE "AuditAction" ADD VALUE 'user_active_toggle';
  END IF;
END$$;
