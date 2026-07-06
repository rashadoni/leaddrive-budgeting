-- Phase 9 follow-up (2026-07-06): RLS tenant isolation for the trade_*
-- tables. The 2026-05-31 baseline migration enabled RLS + the
-- tenant_isolation policy on all org-scoped tables that existed then;
-- the Phase-9 trade tables were created after and lacked coverage.
-- Policy body copied verbatim from the baseline pattern.

ALTER TABLE "trade_regions" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "trade_regions";
CREATE POLICY tenant_isolation ON "trade_regions" USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));

ALTER TABLE "trade_channels" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "trade_channels";
CREATE POLICY tenant_isolation ON "trade_channels" USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));

ALTER TABLE "trade_sales_reps" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "trade_sales_reps";
CREATE POLICY tenant_isolation ON "trade_sales_reps" USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));

ALTER TABLE "trade_outlets" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "trade_outlets";
CREATE POLICY tenant_isolation ON "trade_outlets" USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));

ALTER TABLE "trade_skus" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "trade_skus";
CREATE POLICY tenant_isolation ON "trade_skus" USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));

ALTER TABLE "trade_spend_types" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "trade_spend_types";
CREATE POLICY tenant_isolation ON "trade_spend_types" USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));

ALTER TABLE "trade_import_batches" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "trade_import_batches";
CREATE POLICY tenant_isolation ON "trade_import_batches" USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));

ALTER TABLE "trade_campaigns" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "trade_campaigns";
CREATE POLICY tenant_isolation ON "trade_campaigns" USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));

ALTER TABLE "trade_campaign_scopes" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "trade_campaign_scopes";
CREATE POLICY tenant_isolation ON "trade_campaign_scopes" USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));

ALTER TABLE "trade_plan_daily" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "trade_plan_daily";
CREATE POLICY tenant_isolation ON "trade_plan_daily" USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));

ALTER TABLE "trade_pacing_snapshots" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "trade_pacing_snapshots";
CREATE POLICY tenant_isolation ON "trade_pacing_snapshots" USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));

