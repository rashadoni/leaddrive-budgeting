-- Phase 5.2 Stage 2 Tier 2 (table 4/53) — RLS on approval_requests.
--
-- Why Tier 2: completes the compliance tier. ApprovalRequest holds
-- pre-commit change snapshots in `proposedChange Json` which often
-- contains BudgetLine deltas — cross-tenant leak here would expose
-- pre-approval financial proposals.

ALTER TABLE "approval_requests" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "approval_requests";

CREATE POLICY tenant_isolation ON "approval_requests"
  FOR ALL
  USING (
    "organizationId" = current_setting('app.organization_id', true)
    OR current_setting('app.bypass_rls', true) = 'true'
  );
