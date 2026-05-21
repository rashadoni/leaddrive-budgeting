-- Phase 5.2 Stage 2 Tier 6 — RLS on ai_mapper_proposal_cache.
-- Cached LLM column mappings.
-- Same shape as Tier 1 pilot (indicator_values, 20260512000200).

ALTER TABLE "ai_mapper_proposal_cache" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "ai_mapper_proposal_cache";

CREATE POLICY tenant_isolation ON "ai_mapper_proposal_cache"
  FOR ALL
  USING (
    "organizationId" = current_setting('app.organization_id', true)
    OR current_setting('app.bypass_rls', true) = 'true'
  );
