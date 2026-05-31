-- Phase 5.2 Stage 2 Tier 3 — RLS on budget_forecast_entries.
-- Rolling forecast entries.
-- Same shape as Tier 1 pilot (indicator_values, 20260512000200).

ALTER TABLE "budget_forecast_entries" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "budget_forecast_entries";

CREATE POLICY tenant_isolation ON "budget_forecast_entries"
  FOR ALL
  USING (
    "organizationId" = current_setting('app.organization_id', true)
    OR current_setting('app.bypass_rls', true) = 'true'
  );
