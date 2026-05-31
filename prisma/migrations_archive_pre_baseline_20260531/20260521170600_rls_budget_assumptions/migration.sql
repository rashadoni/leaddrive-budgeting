-- Phase 5.2 Stage 2 Tier 7 — RLS on budget_assumptions.
-- Free-text assumption rows attached to plans.
-- Same shape as Tier 1 pilot (indicator_values, 20260512000200).

ALTER TABLE "budget_assumptions" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "budget_assumptions";

CREATE POLICY tenant_isolation ON "budget_assumptions"
  FOR ALL
  USING (
    "organizationId" = current_setting('app.organization_id', true)
    OR current_setting('app.bypass_rls', true) = 'true'
  );
