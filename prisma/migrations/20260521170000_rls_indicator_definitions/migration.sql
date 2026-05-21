-- Phase 5.2 Stage 2 Tier 7 — RLS on indicator_definitions (nullable orgId).
-- Indicator catalogue: global seeds + org-specific overrides.
-- Policy allows NULL through so global rows (seed catalogue) stay
-- visible to all orgs.

ALTER TABLE "indicator_definitions" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "indicator_definitions";

CREATE POLICY tenant_isolation ON "indicator_definitions"
  FOR ALL
  USING (
    "organizationId" IS NULL
    OR "organizationId" = current_setting('app.organization_id', true)
    OR current_setting('app.bypass_rls', true) = 'true'
  );
