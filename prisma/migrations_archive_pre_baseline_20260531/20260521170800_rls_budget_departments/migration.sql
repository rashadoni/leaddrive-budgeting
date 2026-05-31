-- Phase 5.2 Stage 2 Tier 7 — RLS on budget_departments.
-- Org chart departments.
-- Same shape as Tier 1 pilot (indicator_values, 20260512000200).

ALTER TABLE "budget_departments" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "budget_departments";

CREATE POLICY tenant_isolation ON "budget_departments"
  FOR ALL
  USING (
    "organizationId" = current_setting('app.organization_id', true)
    OR current_setting('app.bypass_rls', true) = 'true'
  );
