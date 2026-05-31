-- Phase 5.2 Stage 2 Tier 3 — RLS on cash_flow_entries.
-- Cash flow statement detail.
-- Same shape as Tier 1 pilot (indicator_values, 20260512000200).

ALTER TABLE "cash_flow_entries" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "cash_flow_entries";

CREATE POLICY tenant_isolation ON "cash_flow_entries"
  FOR ALL
  USING (
    "organizationId" = current_setting('app.organization_id', true)
    OR current_setting('app.bypass_rls', true) = 'true'
  );
