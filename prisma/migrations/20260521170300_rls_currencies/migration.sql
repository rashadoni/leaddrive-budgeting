-- Phase 5.2 Stage 2 Tier 7 — RLS on currencies.
-- Per-org currency overrides.
-- Same shape as Tier 1 pilot (indicator_values, 20260512000200).

ALTER TABLE "currencies" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "currencies";

CREATE POLICY tenant_isolation ON "currencies"
  FOR ALL
  USING (
    "organizationId" = current_setting('app.organization_id', true)
    OR current_setting('app.bypass_rls', true) = 'true'
  );
