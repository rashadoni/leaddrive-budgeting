-- Phase 5.2 Stage 2 Tier 7 — RLS on chart_of_accounts.
-- CoA per org.
-- Same shape as Tier 1 pilot (indicator_values, 20260512000200).

ALTER TABLE "chart_of_accounts" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "chart_of_accounts";

CREATE POLICY tenant_isolation ON "chart_of_accounts"
  FOR ALL
  USING (
    "organizationId" = current_setting('app.organization_id', true)
    OR current_setting('app.bypass_rls', true) = 'true'
  );
