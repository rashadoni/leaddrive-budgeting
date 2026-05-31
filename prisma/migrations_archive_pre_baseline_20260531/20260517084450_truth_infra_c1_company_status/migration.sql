-- Truth-infra C.1 — Company.status onboarding readiness gate.
--
-- Adds nullable-then-NOT-NULL pattern is unnecessary because the column
-- has a non-null default; new + existing rows get 'pending' first, then
-- the in-place UPDATE flips existing-with-data rows to 'active'.
--
-- Apply via:
--   psql -d budgetpro -f prisma/migrations/.../migration.sql
-- OR record after psql apply via:
--   INSERT INTO _prisma_migrations (id, checksum, finished_at,
--     migration_name, logs, rolled_back_at, started_at, applied_steps_count)
--   VALUES (...);

ALTER TABLE "companies"
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'pending';

-- Backfill: companies with at least one IndicatorValue OR BudgetLine
-- are not new — flip them to 'active' so the terminal doesn't hide
-- already-onboarded entities.
UPDATE "companies" c
SET "status" = 'active'
WHERE c."status" = 'pending'
  AND (
    EXISTS (SELECT 1 FROM "indicator_values" iv WHERE iv."companyId" = c.id)
    OR EXISTS (SELECT 1 FROM "budget_lines" bl WHERE bl."companyId" = c.id)
  );
