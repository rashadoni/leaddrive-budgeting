-- Phase 11.1b (2026-07-29) — provenance on budget_actuals.
--
-- Two defects share one root: the actuals reset had no way to tell WHO wrote a
-- row.
--
--   1. An import's clean-slate deleted hand-entered actuals along with its
--      own. budget_actuals has no deletedAt, so that loss is unrecoverable.
--   2. Two BUDGET_ACTUALS sheets for the same company and year inside one
--      workbook run sequentially in ONE transaction, so the second sheet's
--      reset removed the first sheet's inserts — only the last survived.
--      Company scoping (Phase 11.1) cannot fix this: both sheets share the
--      same company.
--
-- NULL = not written by an import. Every pre-existing row is therefore
-- correctly classified as non-import by the default, which is the safe
-- direction: the reset now leaves them alone rather than deleting them.
--
-- Import rows carry the batch's sourceDocument, which doubles as a per-sheet
-- ownership key.

ALTER TABLE "budget_actuals" ADD COLUMN "source" TEXT;

CREATE INDEX "budget_actuals_planId_source_idx"
  ON "budget_actuals" ("planId", "source");
