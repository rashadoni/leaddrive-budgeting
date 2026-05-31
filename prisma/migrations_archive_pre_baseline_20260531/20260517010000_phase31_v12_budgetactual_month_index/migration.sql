-- Phase 3.1 v1.2 (Turn LIX v1.2) — explicit 0-indexed month for
-- BudgetActual rows so VarianceTab sparkline can overlay actual vs
-- planned per month. Mirrors BudgetLine.monthIndex shape.
--
-- Nullable for backward compat with all pre-migration rows. Backfill
-- from `expense_date` parse (YYYY-MM-DD) where possible is a separate
-- one-shot script (scripts/backfill-budget-actual-month-index.cjs).
ALTER TABLE "budget_actuals" ADD COLUMN IF NOT EXISTS "monthIndex" INTEGER;
