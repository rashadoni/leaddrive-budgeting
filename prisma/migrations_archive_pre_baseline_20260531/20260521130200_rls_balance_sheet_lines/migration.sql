-- Phase 5.2 Stage 2 Tier 3 — RLS on balance_sheet_lines.
-- Balance sheet detail — same sensitivity as budget_lines.
-- Same shape as Tier 1 pilot (indicator_values, 20260512000200).

ALTER TABLE "balance_sheet_lines" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "balance_sheet_lines";

CREATE POLICY tenant_isolation ON "balance_sheet_lines"
  FOR ALL
  USING (
    "organizationId" = current_setting('app.organization_id', true)
    OR current_setting('app.bypass_rls', true) = 'true'
  );
