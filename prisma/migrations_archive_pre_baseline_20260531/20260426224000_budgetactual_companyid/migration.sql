-- Turn 35 (Bug fix): add companyId column to budget_actuals so per-company
-- drilldown in /api/budgeting/pnl + /api/budgeting/analytics can filter
-- actuals to a single op-co. Pre-Turn-35 actuals were silently org-global
-- because the column didn't exist; per-company drilldown showed org-wide
-- actuals against per-company plan, producing nonsense variance %.
--
-- Originally applied via `npx prisma db push`; this file is the after-the-
-- fact migration history sync (same pattern as Turn-33 `20260426220000_
-- isautoplanned_default_false`). DB already has the column; this file
-- documents the change to prevent future migrate dev from re-detecting it
-- as drift.

ALTER TABLE "budget_actuals" ADD COLUMN "companyId" TEXT;
CREATE INDEX "budget_actuals_companyId_idx" ON "budget_actuals"("companyId");
ALTER TABLE "budget_actuals" ADD CONSTRAINT "budget_actuals_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
