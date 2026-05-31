-- Phase 5.2 Stage 2 Tier 7 — RLS on scenarios.
-- What-if scenario overlays.
-- Same shape as Tier 1 pilot (indicator_values, 20260512000200).

ALTER TABLE "scenarios" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "scenarios";

CREATE POLICY tenant_isolation ON "scenarios"
  FOR ALL
  USING (
    "organizationId" = current_setting('app.organization_id', true)
    OR current_setting('app.bypass_rls', true) = 'true'
  );
