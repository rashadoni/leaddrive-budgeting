-- Phase 5.2 — Postgres row-level security for indicator_values.
-- First table in the incremental rollout. Policy filters rows by
-- the session var `app.organization_id` set inside withOrgScope().
-- Bypass clause supports admin / system scripts via app.bypass_rls.
--
-- Idempotent: ENABLE / CREATE POLICY guarded by IF NOT EXISTS-style
-- catalog checks so re-runs against a partially-migrated DB are safe.

-- 1. Enable RLS on the table.
ALTER TABLE "indicator_values" ENABLE ROW LEVEL SECURITY;

-- 2. Drop any existing policy with the same name so re-creation is
--    idempotent (Postgres doesn't have CREATE OR REPLACE POLICY).
DROP POLICY IF EXISTS tenant_isolation ON "indicator_values";

-- 3. Create the tenant-isolation policy. NULL session var → 0 rows
--    visible (current_setting with `true` flag returns NULL on unset
--    instead of erroring; equality with NULL is FALSE so all rows
--    fail the predicate — fail closed).
CREATE POLICY tenant_isolation ON "indicator_values"
  FOR ALL
  USING (
    "organizationId" = current_setting('app.organization_id', true)
    OR current_setting('app.bypass_rls', true) = 'true'
  );
