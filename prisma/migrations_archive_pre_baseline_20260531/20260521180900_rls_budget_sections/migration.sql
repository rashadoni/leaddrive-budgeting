-- Phase 5.2 Stage 2 Tier 8 — RLS on budget_sections.
-- Plan section structure.
-- Same shape as Tier 1 pilot (indicator_values, 20260512000200).

ALTER TABLE "budget_sections" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "budget_sections";

CREATE POLICY tenant_isolation ON "budget_sections"
  FOR ALL
  USING (
    "organizationId" = current_setting('app.organization_id', true)
    OR current_setting('app.bypass_rls', true) = 'true'
  );
