-- Phase 12 / A04 (2026-08-02) — three tables the tenant boundary did not cover.
--
-- Found by auditing production directly rather than reading the code: of 76
-- public tables, 70 had row-level security and six did not. Two of the six
-- carry `organizationId` and were readable in full regardless of the tenant
-- GUC — proven live, not inferred:
--
--   SET LOCAL ROLE budgetpro_app;
--   SELECT set_config('app.organization_id', 'some-other-org-id', true);
--   SELECT count(*) FROM companies;              -- 0   (RLS working)
--   SELECT count(*) FROM guide_views;            -- 7   (leaked)
--   SELECT count(*) FROM import_batch_reports;   -- 7   (leaked)
--
-- Practical exposure TODAY is nil because production holds exactly one
-- organization. That is a fact about the data, not about the control, and it
-- stops being true the day a second tenant is created — which is the whole of
-- Phase 5. `import_batch_reports` is the one that would matter: it holds
-- import receipts, naming companies, file names and row counts.
--
-- Why the CI gate did not catch it: `scripts/rls-coverage-scan.mjs` checks
-- APPLICATION CODE — that routes wrap org-scoped Prisma delegates in
-- `withOrgScope`. It never asks whether the TABLE has a policy, so a table
-- with zero policies passes a green build. A companion schema-level gate ships
-- with this migration.
--
-- `company_indicators` has no `organizationId` of its own and is scoped
-- through its parent company. It is empty in production, so this closes the
-- hole before there is anything in it to fall through.
--
-- Deliberately NOT enabled, with reasons, so the next audit does not re-open
-- them as oversights:
--   Organization        the tenant table itself; read during auth bootstrap
--                       before any tenant GUC exists. RLS here breaks login.
--   accounts            NextAuth OAuth records, written during sign-in for the
--                       same reason. No organizationId; keyed by user.
--   _prisma_migrations  migration bookkeeping, not application data.

-- `guide_views.organizationId` is NULLABLE on purpose: `/api/telemetry/guide-view`
-- bypasses auth so an anonymous reader of the public guide still gets counted
-- (`organizationId: session?.orgId ?? null`). Production holds 0 such rows
-- today, but the route can produce them at any time.
--
-- Hence USING and WITH CHECK differ, which is the whole point. A row belonging
-- to no tenant must be visible to NO tenant (USING), and must still be
-- insertable (WITH CHECK) — a single expression would either expose anonymous
-- telemetry to whichever tenant asked, or start rejecting the beacon the day
-- someone moves that route onto the RLS-enforced client.
ALTER TABLE "guide_views" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "guide_views";
CREATE POLICY tenant_isolation ON "guide_views"
  USING ((("organizationId" = current_setting('app.organization_id'::text, true))
          OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)))
  WITH CHECK ((("organizationId" = current_setting('app.organization_id'::text, true))
               OR ("organizationId" IS NULL)
               OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));

ALTER TABLE "import_batch_reports" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "import_batch_reports";
CREATE POLICY tenant_isolation ON "import_batch_reports"
  USING ((("organizationId" = current_setting('app.organization_id'::text, true))
          OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));

-- Scoped through the parent company, because the row carries no tenant of its
-- own. The inner SELECT is itself RLS-filtered on `companies`, so the explicit
-- organizationId test is belt-and-braces rather than the only guard.
ALTER TABLE "company_indicators" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "company_indicators";
CREATE POLICY tenant_isolation ON "company_indicators"
  USING ((EXISTS (SELECT 1 FROM "companies" c
                   WHERE c."id" = "company_indicators"."companyId"
                     AND c."organizationId" = current_setting('app.organization_id'::text, true))
          OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));
