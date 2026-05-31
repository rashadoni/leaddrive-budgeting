-- Phase 5.2 Stage 2 Tier 6 — RLS on rolling_forecast_months.
-- 12-month rolling forecast snapshots.
-- Same shape as Tier 1 pilot (indicator_values, 20260512000200).

ALTER TABLE "rolling_forecast_months" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "rolling_forecast_months";

CREATE POLICY tenant_isolation ON "rolling_forecast_months"
  FOR ALL
  USING (
    "organizationId" = current_setting('app.organization_id', true)
    OR current_setting('app.bypass_rls', true) = 'true'
  );
