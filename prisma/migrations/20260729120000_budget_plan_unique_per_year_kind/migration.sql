-- Phase 11.4 (2026-07-29) — one live BudgetPlan per (organization, year, kind).
--
-- Why
-- ───
-- `budget_plans` carried only `@@index([organizationId])`. Four import routes
-- resolved their target plan differently — two by `kind`, three by a hardcoded
-- NAME, and those three created the row WITHOUT `kind`, so it took the schema
-- default 'actual'. Importing one year through two different tabs therefore
-- produced two live 'actual' plans for the same year.
--
-- The risk engine reads `plan: { year, kind: 'actual' }` with no planId
-- (src/lib/risk/recompute-data-source.ts), so it SUMS both — every P&L and
-- balance-sheet number silently doubles. Each import's clean-slate is
-- plan-scoped, so neither plan can ever reach the other's rows to correct it.
--
-- The application-layer fix is src/lib/onboarding/resolve-plan.ts, which every
-- import path now calls. This index is the backstop that keeps the invariant
-- true even if a fifth path is added without reading that file.
--
-- PARTIAL index: soft-deleted plans (deletedAt IS NOT NULL) are historical and
-- may legitimately repeat a (year, kind) that a live plan now occupies.
--
-- PRE-FLIGHT — this migration FAILS LOUDLY if duplicates already exist, which
-- is deliberate: silently merging two plans' financial rows is not a decision a
-- migration gets to make. Find them with
--
--   SELECT "organizationId", year, kind, count(*), array_agg(id), array_agg(name)
--   FROM budget_plans WHERE "deletedAt" IS NULL
--   GROUP BY 1,2,3 HAVING count(*) > 1;
--
-- then decide per group which plan is canonical (normally the OLDEST — it is
-- the one the readers already converge on and the one resolve-plan.ts picks),
-- re-point the child rows, soft-delete the loser, and re-run. The admin check
-- at /api/admin/duplicate-plans reports the same groups.

DO $$
DECLARE
  dupe_count integer;
  dupe_detail text;
BEGIN
  SELECT count(*), coalesce(string_agg(detail, '; '), '')
    INTO dupe_count, dupe_detail
  FROM (
    -- Column names are camelCase and MUST stay quoted: Postgres folds
    -- unquoted identifiers to lower case, so `organizationId` would be looked
    -- up as `organizationid` and the migration would die on "column does not
    -- exist" instead of doing its job. `year` and `kind` are genuinely
    -- lower-case in the schema.
    SELECT format('org=%s year=%s kind=%s plans=[%s]',
                  "organizationId", year, kind, string_agg(name, ' | ')) AS detail
    FROM budget_plans
    WHERE "deletedAt" IS NULL
    GROUP BY "organizationId", year, kind
    HAVING count(*) > 1
  ) d;

  IF dupe_count > 0 THEN
    RAISE EXCEPTION
      'Phase 11.4: % duplicate (organization, year, kind) plan group(s) must be merged before this unique index can be created. Groups: %',
      dupe_count, dupe_detail;
  END IF;
END $$;

CREATE UNIQUE INDEX "budget_plans_org_year_kind_live_key"
  ON "budget_plans" ("organizationId", "year", "kind")
  WHERE "deletedAt" IS NULL;
