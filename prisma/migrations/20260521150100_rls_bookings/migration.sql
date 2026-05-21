-- Phase 5.2 Stage 2 Tier 5 — RLS on bookings.
-- Hospitality bookings.
-- Same shape as Tier 1 pilot (indicator_values, 20260512000200).

ALTER TABLE "bookings" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "bookings";

CREATE POLICY tenant_isolation ON "bookings"
  FOR ALL
  USING (
    "organizationId" = current_setting('app.organization_id', true)
    OR current_setting('app.bypass_rls', true) = 'true'
  );
