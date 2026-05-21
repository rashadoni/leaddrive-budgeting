-- Phase 5.2 Stage 2 Tier 6 — RLS on predictive_breaches.
-- Forward breach forecasts.
-- Same shape as Tier 1 pilot (indicator_values, 20260512000200).

ALTER TABLE "predictive_breaches" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "predictive_breaches";

CREATE POLICY tenant_isolation ON "predictive_breaches"
  FOR ALL
  USING (
    "organizationId" = current_setting('app.organization_id', true)
    OR current_setting('app.bypass_rls', true) = 'true'
  );
