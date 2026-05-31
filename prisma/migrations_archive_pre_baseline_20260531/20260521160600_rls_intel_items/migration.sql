-- Phase 5.2 Stage 2 Tier 6 — RLS on intel_items.
-- News / intel items.
-- Same shape as Tier 1 pilot (indicator_values, 20260512000200).

ALTER TABLE "intel_items" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "intel_items";

CREATE POLICY tenant_isolation ON "intel_items"
  FOR ALL
  USING (
    "organizationId" = current_setting('app.organization_id', true)
    OR current_setting('app.bypass_rls', true) = 'true'
  );
