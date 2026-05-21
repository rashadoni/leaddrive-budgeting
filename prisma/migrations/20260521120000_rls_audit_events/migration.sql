-- Phase 5.2 Stage 2 Tier 2 (table 2/53) — RLS on audit_events.
--
-- Why this table is Tier 2: compliance / SOX audit trail leaking
-- across tenants is the most expensive class of cross-org bug to ship.
-- Apply RIGHT AFTER indicator_values (Tier 1 pilot) — the same shape,
-- mature pattern, low blast radius.
--
-- Pattern: identical to indicator_values (20260512000200) policy.
-- Idempotent guards via DROP POLICY IF EXISTS.

ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "audit_events";

CREATE POLICY tenant_isolation ON "audit_events"
  FOR ALL
  USING (
    "organizationId" = current_setting('app.organization_id', true)
    OR current_setting('app.bypass_rls', true) = 'true'
  );
