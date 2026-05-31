-- Phase 5.2 Stage 2 Tier 5 — RLS on operational_facts.
-- KPI facts (yield, occupancy, FCR).
-- Same shape as Tier 1 pilot (indicator_values, 20260512000200).

ALTER TABLE "operational_facts" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "operational_facts";

CREATE POLICY tenant_isolation ON "operational_facts"
  FOR ALL
  USING (
    "organizationId" = current_setting('app.organization_id', true)
    OR current_setting('app.bypass_rls', true) = 'true'
  );
