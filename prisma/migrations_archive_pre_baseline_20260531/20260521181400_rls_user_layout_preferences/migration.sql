-- Phase 5.2 Stage 2 Tier 8 — RLS on user_layout_preferences.
-- Per-user UI preferences (org-scoped via user).
-- Same shape as Tier 1 pilot (indicator_values, 20260512000200).

ALTER TABLE "user_layout_preferences" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "user_layout_preferences";

CREATE POLICY tenant_isolation ON "user_layout_preferences"
  FOR ALL
  USING (
    "organizationId" = current_setting('app.organization_id', true)
    OR current_setting('app.bypass_rls', true) = 'true'
  );
