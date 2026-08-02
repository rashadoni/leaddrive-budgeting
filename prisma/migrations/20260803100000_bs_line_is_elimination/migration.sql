-- Phase 14.8 (2026-08-03) — intragroup eliminations get a home that is not a company.
--
-- The client's `BS Actual 2026` ships five blocks: four legal entities and an
-- `EJE` INTRAGROUP ELIMINATIONS block that nets ~119M of intercompany
-- holdings and receivables out of the group. The four entities are imported;
-- EJE is dropped, so the product has no consolidated balance sheet at all —
-- every group figure it can show is the four entities added together, and the
-- tab, the AI panel and the export all say so because none of them can do
-- better.
--
-- The rows cannot belong to a company: an elimination cancels balances
-- BETWEEN group members and is nobody's standalone position. Nor can it be a
-- pseudo-entity — that Company row would appear in the tree and the heat map
-- as a business with no revenue, which is the same objection that kept AJE
-- from getting one in 11.83.
--
-- So: companyId stays NULL and this flag says why it is null. That
-- distinction is load-bearing on the READ side. `resolveBalanceSheetScope`
-- already counts a null-companyId row as its own contributor, because legacy
-- unscoped rows mixed with per-entity rows are exactly when a sum is
-- suspect. Without a marker, elimination rows would be indistinguishable from
-- those and would push the group view further into "sum_of_entities" instead
-- of out of it.
--
-- NOT NULL DEFAULT false: every existing row is entity data, and there is no
-- state in which that is unknown.
ALTER TABLE "balance_sheet_lines"
  ADD COLUMN "isElimination" BOOLEAN NOT NULL DEFAULT false;

-- The group read is "every live row for this plan, entities and eliminations
-- together"; the per-company read must exclude eliminations. Both filter on
-- this column beside planId, and the index keeps the elimination rows (a few
-- dozen per plan against thousands of entity rows) cheap to isolate.
--
-- Deliberately NOT partial on `deletedAt IS NULL`, even though every read here
-- carries that filter. Prisma cannot express a predicate, so a partial index
-- has to live outside the schema — and one that shares a NAME with an
-- `@@index` while differing in definition is permanent drift that the next
-- `migrate dev` would try to correct. The predicate is worth little on a few
-- dozen rows; matching the schema exactly is worth more.
CREATE INDEX "balance_sheet_lines_planId_isElimination_idx"
  ON "balance_sheet_lines" ("planId", "isElimination");
