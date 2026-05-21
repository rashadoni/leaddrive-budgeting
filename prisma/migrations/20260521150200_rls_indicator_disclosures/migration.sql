-- Phase 5.2 Stage 2 Tier 5 — RLS on indicator_disclosures.
-- ESG / manual indicator overrides.
-- Same shape as Tier 1 pilot (indicator_values, 20260512000200).

ALTER TABLE "indicator_disclosures" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "indicator_disclosures";

CREATE POLICY tenant_isolation ON "indicator_disclosures"
  FOR ALL
  USING (
    "organizationId" = current_setting('app.organization_id', true)
    OR current_setting('app.bypass_rls', true) = 'true'
  );
