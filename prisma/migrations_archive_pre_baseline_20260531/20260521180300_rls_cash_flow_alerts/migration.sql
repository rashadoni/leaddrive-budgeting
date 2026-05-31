-- Phase 5.2 Stage 2 Tier 8 — RLS on cash_flow_alerts.
-- Cash-flow-specific alert state.
-- Same shape as Tier 1 pilot (indicator_values, 20260512000200).

ALTER TABLE "cash_flow_alerts" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "cash_flow_alerts";

CREATE POLICY tenant_isolation ON "cash_flow_alerts"
  FOR ALL
  USING (
    "organizationId" = current_setting('app.organization_id', true)
    OR current_setting('app.bypass_rls', true) = 'true'
  );
