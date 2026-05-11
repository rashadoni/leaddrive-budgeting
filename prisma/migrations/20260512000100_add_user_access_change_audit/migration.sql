-- Phase 7.F sub-group RBAC admin v2: new audit-action enum value for
-- per-user access changes. Idempotent guard so re-runs against an
-- already-migrated DB are safe.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'AuditAction' AND e.enumlabel = 'user_access_change'
  ) THEN
    ALTER TYPE "AuditAction" ADD VALUE 'user_access_change';
  END IF;
END$$;
