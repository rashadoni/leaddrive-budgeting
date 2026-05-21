-- Phase 5.2 Stage 2 Tier 8 — RLS on period_snapshots.
-- Quarterly snapshots.
-- Same shape as Tier 1 pilot (indicator_values, 20260512000200).

ALTER TABLE "period_snapshots" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "period_snapshots";

CREATE POLICY tenant_isolation ON "period_snapshots"
  FOR ALL
  USING (
    "organizationId" = current_setting('app.organization_id', true)
    OR current_setting('app.bypass_rls', true) = 'true'
  );
