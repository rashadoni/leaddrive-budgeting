-- Phase 5.2 Stage 2 Tier 2 (table 3/53) — RLS on budget_change_logs.
--
-- Why Tier 2: append-only change history is the safest table to roll
-- after audit_events. Every write goes through `logBudgetChange()` in
-- src/lib/audit/log.ts which already passes organizationId through.
-- Low risk of "forgot to filter" bugs because the write path is
-- centralised.

ALTER TABLE "budget_change_logs" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "budget_change_logs";

CREATE POLICY tenant_isolation ON "budget_change_logs"
  FOR ALL
  USING (
    "organizationId" = current_setting('app.organization_id', true)
    OR current_setting('app.bypass_rls', true) = 'true'
  );
