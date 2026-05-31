-- Phase 7.F admin v2: add user_role_change audit action.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'AuditAction' AND e.enumlabel = 'user_role_change'
  ) THEN
    ALTER TYPE "AuditAction" ADD VALUE 'user_role_change';
  END IF;
END$$;
