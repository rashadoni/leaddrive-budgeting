-- Phase 5.2 Stage 2 Tier 8 — RLS on alert_rules.
-- Configured alert thresholds.
-- Same shape as Tier 1 pilot (indicator_values, 20260512000200).

ALTER TABLE "alert_rules" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "alert_rules";

CREATE POLICY tenant_isolation ON "alert_rules"
  FOR ALL
  USING (
    "organizationId" = current_setting('app.organization_id', true)
    OR current_setting('app.bypass_rls', true) = 'true'
  );
