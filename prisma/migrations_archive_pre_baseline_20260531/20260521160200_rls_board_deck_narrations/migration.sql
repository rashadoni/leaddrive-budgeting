-- Phase 5.2 Stage 2 Tier 6 — RLS on board_deck_narrations.
-- Generated narrative cache.
-- Same shape as Tier 1 pilot (indicator_values, 20260512000200).

ALTER TABLE "board_deck_narrations" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "board_deck_narrations";

CREATE POLICY tenant_isolation ON "board_deck_narrations"
  FOR ALL
  USING (
    "organizationId" = current_setting('app.organization_id', true)
    OR current_setting('app.bypass_rls', true) = 'true'
  );
