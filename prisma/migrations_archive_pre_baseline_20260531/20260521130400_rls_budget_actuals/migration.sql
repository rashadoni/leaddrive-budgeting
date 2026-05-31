-- Phase 5.2 Stage 2 Tier 3 — RLS on budget_actuals.
-- Posted actuals — variance baseline.
-- Same shape as Tier 1 pilot (indicator_values, 20260512000200).

ALTER TABLE "budget_actuals" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "budget_actuals";

CREATE POLICY tenant_isolation ON "budget_actuals"
  FOR ALL
  USING (
    "organizationId" = current_setting('app.organization_id', true)
    OR current_setting('app.bypass_rls', true) = 'true'
  );
