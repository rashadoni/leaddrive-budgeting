-- Phase 5.2 Stage 2 Tier 5 — RLS on cogs_cost_details.
-- COGS cost-component detail.
-- Same shape as Tier 1 pilot (indicator_values, 20260512000200).

ALTER TABLE "cogs_cost_details" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "cogs_cost_details";

CREATE POLICY tenant_isolation ON "cogs_cost_details"
  FOR ALL
  USING (
    "organizationId" = current_setting('app.organization_id', true)
    OR current_setting('app.bypass_rls', true) = 'true'
  );
