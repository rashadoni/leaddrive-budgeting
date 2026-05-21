-- Phase 5.2 Stage 2 Tier 8 — RLS on accounting_imports.
-- External accounting system imports.
-- Same shape as Tier 1 pilot (indicator_values, 20260512000200).

ALTER TABLE "accounting_imports" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "accounting_imports";

CREATE POLICY tenant_isolation ON "accounting_imports"
  FOR ALL
  USING (
    "organizationId" = current_setting('app.organization_id', true)
    OR current_setting('app.bypass_rls', true) = 'true'
  );
