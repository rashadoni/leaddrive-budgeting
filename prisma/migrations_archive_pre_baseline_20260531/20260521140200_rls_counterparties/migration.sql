-- Phase 5.2 Stage 2 Tier 4 — RLS on counterparties.
-- Customers / suppliers — concentration risk surface.
-- Same shape as Tier 1 pilot (indicator_values, 20260512000200).

ALTER TABLE "counterparties" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "counterparties";

CREATE POLICY tenant_isolation ON "counterparties"
  FOR ALL
  USING (
    "organizationId" = current_setting('app.organization_id', true)
    OR current_setting('app.bypass_rls', true) = 'true'
  );
