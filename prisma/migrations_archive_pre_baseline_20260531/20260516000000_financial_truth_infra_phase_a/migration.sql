-- Financial-truth-infra Phase A.2 — provenance + reconciliation fields.
-- Adds nullable columns to existing tables; safe to apply on production
-- without locking writes (Postgres ALTER ADD COLUMN with no default is
-- metadata-only, O(1) regardless of table size).
--
-- IndicatorValue:
--   sourceDocument    — pointer to the artifact this value came from
--                       (`file.xlsx#sheet!cell` or `adapter:source-code`).
--   lastReconciledAt  — timestamp of the most-recent audit-company.cjs pass.
--   reconciledBy      — user id who ran (or signed off) the audit.
--   sanityBand        — verdict from industry sanity-band classifier
--                       (`normal` | `low_extreme` | `high_extreme`
--                       | `missing_input` | `no_band`).
--
-- BudgetLine:
--   sourceDocument    — mirror of the field above so drift detection can
--                       trace any divergent indicator down to the specific
--                       budget line and source-document cell that fed it.
--
-- All columns nullable for backward compat with pre-Phase-A rows. Index on
-- `lastReconciledAt` so the drift watchdog can paginate stale-or-missing
-- audit timestamps efficiently.

ALTER TABLE "indicator_values"
  ADD COLUMN "sourceDocument" TEXT,
  ADD COLUMN "lastReconciledAt" TIMESTAMP(3),
  ADD COLUMN "reconciledBy" TEXT,
  ADD COLUMN "sanityBand" TEXT;

CREATE INDEX "indicator_values_lastReconciledAt_idx"
  ON "indicator_values"("lastReconciledAt");

ALTER TABLE "budget_lines"
  ADD COLUMN "sourceDocument" TEXT;
