-- Phase 5.2 Stage 2 Tier 4 — RLS on companies.
-- Org structure — admin UI crosses orgs; carefully wrap before enabling.
-- Same shape as Tier 1 pilot (indicator_values, 20260512000200).

ALTER TABLE "companies" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "companies";

CREATE POLICY tenant_isolation ON "companies"
  FOR ALL
  USING (
    "organizationId" = current_setting('app.organization_id', true)
    OR current_setting('app.bypass_rls', true) = 'true'
  );
