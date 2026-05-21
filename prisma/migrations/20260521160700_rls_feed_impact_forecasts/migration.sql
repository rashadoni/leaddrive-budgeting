-- Phase 5.2 Stage 2 Tier 6 — RLS on feed_impact_forecasts.
-- Feed-price impact projections.
-- Same shape as Tier 1 pilot (indicator_values, 20260512000200).

ALTER TABLE "feed_impact_forecasts" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "feed_impact_forecasts";

CREATE POLICY tenant_isolation ON "feed_impact_forecasts"
  FOR ALL
  USING (
    "organizationId" = current_setting('app.organization_id', true)
    OR current_setting('app.bypass_rls', true) = 'true'
  );
