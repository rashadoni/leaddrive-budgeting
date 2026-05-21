-- Phase 5.2 Stage 2 Tier 6 — RLS on intel_data_points.
-- External intel (commodity prices, macro).
-- Same shape as Tier 1 pilot (indicator_values, 20260512000200).

ALTER TABLE "intel_data_points" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "intel_data_points";

CREATE POLICY tenant_isolation ON "intel_data_points"
  FOR ALL
  USING (
    "organizationId" = current_setting('app.organization_id', true)
    OR current_setting('app.bypass_rls', true) = 'true'
  );
