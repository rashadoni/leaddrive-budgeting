-- Phase 5.2 Stage 2 Tier 5 — RLS on budget_cost_types.
-- Cost-type taxonomy per org.
-- Same shape as Tier 1 pilot (indicator_values, 20260512000200).

ALTER TABLE "budget_cost_types" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "budget_cost_types";

CREATE POLICY tenant_isolation ON "budget_cost_types"
  FOR ALL
  USING (
    "organizationId" = current_setting('app.organization_id', true)
    OR current_setting('app.bypass_rls', true) = 'true'
  );
