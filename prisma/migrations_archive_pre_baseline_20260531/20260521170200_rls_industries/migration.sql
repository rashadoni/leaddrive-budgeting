-- Phase 5.2 Stage 2 Tier 7 — RLS on industries.
-- Global reference table (no per-org isolation needed).
-- Enable RLS for infrastructure consistency; use an open policy so all
-- authenticated connections can read the seed catalogue.

ALTER TABLE "industries" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "industries";

-- Global shared table — any authenticated session may read all rows.
CREATE POLICY tenant_isolation ON "industries"
  FOR ALL
  USING (true);
