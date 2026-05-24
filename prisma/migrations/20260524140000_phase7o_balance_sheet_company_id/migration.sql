-- Phase 7.O (2026-05-24) — Add companyId to BalanceSheetLine for per-entity resolver queries.
-- Nullable so all existing rows remain valid (no data loss, no backfill needed).
-- The balanceSheetLine resolver filters companyId IS NOT NULL — legacy rows are
-- safely excluded from company-specific inventory aggregations.

ALTER TABLE "balance_sheet_lines"
  ADD COLUMN "companyId" TEXT REFERENCES "companies"("id") ON DELETE SET NULL;

-- Covering indexes for (companyId, year, month) — used by the inventory resolver
-- query: WHERE companyId = ? AND year = ? AND lineType = 'asset' AND deletedAt IS NULL.
CREATE INDEX "balance_sheet_lines_companyId_idx"
  ON "balance_sheet_lines"("companyId");

CREATE INDEX "balance_sheet_lines_companyId_year_month_idx"
  ON "balance_sheet_lines"("companyId", "year", "month");
