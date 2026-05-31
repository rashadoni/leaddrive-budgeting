-- Phase 5.2 Stage 2 Tier 8 — RLS on budget_approval_comments.
-- Per-approval comment thread.
-- Same shape as Tier 1 pilot (indicator_values, 20260512000200).

ALTER TABLE "budget_approval_comments" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "budget_approval_comments";

CREATE POLICY tenant_isolation ON "budget_approval_comments"
  FOR ALL
  USING (
    "organizationId" = current_setting('app.organization_id', true)
    OR current_setting('app.bypass_rls', true) = 'true'
  );
