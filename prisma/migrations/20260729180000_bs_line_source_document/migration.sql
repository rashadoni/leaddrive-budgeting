-- Phase 11.21 (2026-07-29) — per-sheet provenance on balance_sheet_lines.
--
-- Without it the apply-multi BS dispatcher can only delete the months present
-- in the NEW file, so a corrected re-import covering FEWER months leaves the
-- dropped ones holding the previous import's balances. Widening the delete to
-- the whole year is not the fix: two sheets covering different months of the
-- same year would then delete each other's rows.
--
-- NULLABLE on purpose. Rows written before this migration carry null, and the
-- dispatcher keeps the old month-window delete for exactly those, so the first
-- re-import after deploy cannot double-count pre-existing data.
ALTER TABLE "balance_sheet_lines" ADD COLUMN "sourceDocument" TEXT;

CREATE INDEX "balance_sheet_lines_planId_companyId_sourceDocument_idx"
  ON "balance_sheet_lines" ("planId", "companyId", "sourceDocument");
