-- Phase 7.F sub-group RBAC: per-user company-scope filter.
-- Empty array = full org access (admins, CFO). Non-empty = user can
-- only see those sub-group Company IDs and their operational children.
-- `admin` role bypasses regardless. Applied via raw SQL (idempotent
-- block) so re-runs against an already-migrated DB are safe.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='users' AND column_name='allowedSubGroupIds'
  ) THEN
    ALTER TABLE "users"
      ADD COLUMN "allowedSubGroupIds" TEXT[] NOT NULL DEFAULT '{}';
  END IF;
END$$;
