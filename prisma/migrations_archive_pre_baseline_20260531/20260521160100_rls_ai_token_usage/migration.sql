-- Phase 5.2 Stage 2 Tier 6 — RLS on ai_token_usage.
-- Per-org LLM spend tracking.
-- Same shape as Tier 1 pilot (indicator_values, 20260512000200).

ALTER TABLE "ai_token_usage" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "ai_token_usage";

CREATE POLICY tenant_isolation ON "ai_token_usage"
  FOR ALL
  USING (
    "organizationId" = current_setting('app.organization_id', true)
    OR current_setting('app.bypass_rls', true) = 'true'
  );
