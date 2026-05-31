-- Phase 5.2 Stage 2 Tier 8 — RLS on product_lines.
-- Product lines per org.
-- Same shape as Tier 1 pilot (indicator_values, 20260512000200).

ALTER TABLE "product_lines" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "product_lines";

CREATE POLICY tenant_isolation ON "product_lines"
  FOR ALL
  USING (
    "organizationId" = current_setting('app.organization_id', true)
    OR current_setting('app.bypass_rls', true) = 'true'
  );
