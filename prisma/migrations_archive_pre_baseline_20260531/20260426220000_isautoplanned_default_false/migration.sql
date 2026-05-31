-- Turn 29 (Bug #1b): change BudgetLine.isAutoPlanned default from true → false.
-- Auto-planning requires populated cost model + sales/expense forecasts;
-- defaulting every line to "compute me dynamically" was wrong for the
-- dominant case of literal xlsx-sourced imports (AZMADE) which have explicit
-- plannedAmount values that were silently zeroed by getEffectivePlanned when
-- the dynamic-source side returned 0.
--
-- Originally applied via `npx prisma db push` because `migrate dev` refused
-- due to a separate drift on phase7f_audit_log (since resolved Turn 32 by
-- removing a stale failed-attempt row from _prisma_migrations). This file
-- is the after-the-fact migration history sync — DB already has the new
-- default; this file documents the change and prevents future migrate dev
-- from re-detecting it as drift.

ALTER TABLE "budget_lines" ALTER COLUMN "isAutoPlanned" SET DEFAULT false;
