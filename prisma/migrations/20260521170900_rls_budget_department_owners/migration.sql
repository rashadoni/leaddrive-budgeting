-- Phase 5.2 Stage 2 Tier 7 — RLS on budget_department_owners.
-- Department → owner mapping.
-- Same shape as Tier 1 pilot (indicator_values, 20260512000200).

ALTER TABLE "budget_department_owners" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "budget_department_owners";

CREATE POLICY tenant_isolation ON "budget_department_owners"
  FOR ALL
  USING (
    "organizationId" = current_setting('app.organization_id', true)
    OR current_setting('app.bypass_rls', true) = 'true'
  );
