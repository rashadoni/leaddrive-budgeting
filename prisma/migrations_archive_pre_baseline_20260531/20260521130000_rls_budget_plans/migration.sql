-- Phase 5.2 Stage 2 Tier 3 — RLS on budget_plans.
-- Top-level container for budget data — leak would expose entire plan structures across tenants.
-- Same shape as Tier 1 pilot (indicator_values, 20260512000200).

ALTER TABLE "budget_plans" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "budget_plans";

CREATE POLICY tenant_isolation ON "budget_plans"
  FOR ALL
  USING (
    "organizationId" = current_setting('app.organization_id', true)
    OR current_setting('app.bypass_rls', true) = 'true'
  );
