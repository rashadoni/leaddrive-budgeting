-- Phase 5.2 Stage 2 Tier 7 — RLS on industries.
-- Per-org industry overrides on top of seed packs.
-- Same shape as Tier 1 pilot (indicator_values, 20260512000200).

ALTER TABLE "industries" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "industries";

CREATE POLICY tenant_isolation ON "industries"
  FOR ALL
  USING (
    "organizationId" = current_setting('app.organization_id', true)
    OR current_setting('app.bypass_rls', true) = 'true'
  );
