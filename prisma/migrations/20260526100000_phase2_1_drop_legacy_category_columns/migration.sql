-- Phase 2.1 session 3 (2026-05-26) — drop legacy code/name string
-- columns now that every row carries a real ChartOfAccount FK.
--
-- Pre-conditions (verified 2026-05-26 11:18 via session2-wipe-orphans
-- + AI Auto Import multi-file re-upload):
--   - budget_lines       : 4593 rows, 100% accountId populated
--   - balance_sheet_lines:  251 rows, 100% accountId populated
--   - cash_flow_entries  :  309 rows, 100% accountId populated
--   - cogs_budget_lines  :    0 rows (table currently unused; legacy
--                           import-excel was the only writer, deleted
--                           Phase 2.3)
--
-- Changes:
--   1. DROP COLUMN category from budget_lines + cash_flow_entries.
--   2. DROP COLUMN accountCode from cogs_budget_lines.
--   3. DROP COLUMN accountCode + accountName from balance_sheet_lines.
--   4. ALTER COLUMN accountId SET NOT NULL on all 4 tables.
--   5. Replace FK constraint ON DELETE SET NULL → ON DELETE RESTRICT:
--      now a CoA admin can no longer accidentally orphan thousands of
--      ledger rows by deleting a chart-of-accounts entry; they must
--      reassign first.

-- ── 1. Drop legacy string columns ─────────────────────────────────────
ALTER TABLE "budget_lines"        DROP COLUMN "category";
ALTER TABLE "cash_flow_entries"   DROP COLUMN "category";
ALTER TABLE "cogs_budget_lines"   DROP COLUMN "accountCode";
ALTER TABLE "balance_sheet_lines" DROP COLUMN "accountCode";
ALTER TABLE "balance_sheet_lines" DROP COLUMN "accountName";

-- ── 2. accountId NOT NULL ─────────────────────────────────────────────
ALTER TABLE "budget_lines"        ALTER COLUMN "accountId" SET NOT NULL;
ALTER TABLE "cash_flow_entries"   ALTER COLUMN "accountId" SET NOT NULL;
ALTER TABLE "cogs_budget_lines"   ALTER COLUMN "accountId" SET NOT NULL;
ALTER TABLE "balance_sheet_lines" ALTER COLUMN "accountId" SET NOT NULL;

-- ── 3. FK: SET NULL → RESTRICT ────────────────────────────────────────
ALTER TABLE "budget_lines"
  DROP CONSTRAINT "budget_lines_accountId_fkey",
  ADD CONSTRAINT  "budget_lines_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "chart_of_accounts"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cash_flow_entries"
  DROP CONSTRAINT "cash_flow_entries_accountId_fkey",
  ADD CONSTRAINT  "cash_flow_entries_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "chart_of_accounts"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cogs_budget_lines"
  DROP CONSTRAINT "cogs_budget_lines_accountId_fkey",
  ADD CONSTRAINT  "cogs_budget_lines_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "chart_of_accounts"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "balance_sheet_lines"
  DROP CONSTRAINT "balance_sheet_lines_accountId_fkey",
  ADD CONSTRAINT  "balance_sheet_lines_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "chart_of_accounts"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
