-- Phase 5.2 Stage 2 Tier 8 — RLS on saved_budget_reports.
-- User-saved report definitions.
-- Same shape as Tier 1 pilot (indicator_values, 20260512000200).

ALTER TABLE "saved_budget_reports" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "saved_budget_reports";

CREATE POLICY tenant_isolation ON "saved_budget_reports"
  FOR ALL
  USING (
    "organizationId" = current_setting('app.organization_id', true)
    OR current_setting('app.bypass_rls', true) = 'true'
  );
