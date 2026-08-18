-- 2026-08-18 — the P&L half of intragroup eliminations.
--
-- Phase 14.8 gave the client's own `EJE` block a home on the BALANCE SHEET and
-- deliberately left the P&L half open. The consequence is visible on the
-- dashboard: consolidated EBITDA reads 271,160 while the client's own
-- `PLF Actual 2026` bottom line says 255,942, because the group figure is the
-- four operating entities added together and the elimination block that nets
-- 15,218 of intercompany result out of them is dropped at the splitter.
--
-- Measured on `actual-budget-v1.xlsx`: the EJE fact block carries eight
-- posting rows (revenue -337,016 against cost +321,798) summing to exactly the
-- -15,217.94 its own PLF.08 and PLF.10 state. It parses cleanly today; it has
-- simply had nowhere to go.
--
-- Same shape as `balance_sheet_lines.isElimination` (20260803100000), and for
-- the same reasons: the rows cannot belong to a company, because an
-- elimination cancels result BETWEEN group members and is nobody's standalone
-- P&L; and it cannot be a pseudo-entity, which would show up in the company
-- tree as a business with no revenue.
--
-- NOT NULL DEFAULT false: every existing row is entity data, and there is no
-- state in which that is unknown.
ALTER TABLE "budget_lines"
  ADD COLUMN "isElimination" BOOLEAN NOT NULL DEFAULT false;

-- Two readers need it. The IMPORT scopes an elimination batch's clean-slate on
-- this column instead of on a company (they are disjoint, and a null-company
-- scope would archive nothing and let a re-import double the block). The P&L
-- READ takes eliminations only at group level: a per-company query filters on
-- companyId and therefore excludes them by construction, which is the
-- behaviour we want and now also the behaviour we can state.
--
-- Deliberately NOT partial on `deletedAt IS NULL`, matching the balance-sheet
-- index: Prisma cannot express a predicate, and an index that shares a name
-- with an `@@index` while differing in definition is permanent drift.
CREATE INDEX "budget_lines_planId_isElimination_idx"
  ON "budget_lines" ("planId", "isElimination");
