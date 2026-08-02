-- Phase 13.6 (2026-08-02) — a person can correct a wrong import without
-- destroying the evidence of what the workbook said.
--
-- The owner asked twice: «чтоб потом можно было отредактировать вручную», and
-- «даже если импорт будет неправильным чтоб потом можно было откорректировать».
-- 11.91 made a discrepancy visible; until now someone could see a figure was
-- wrong and had no way to fix it.
--
-- A correction is a NEW ROW, never an edit of an imported one. Editing in
-- place would burn the only faithful copy of what the file contained, make the
-- 11.91 statement check circular (type the workbook's subtotal, watch it
-- "reconcile"), and leave the P&L, the exports and the deck showing the old
-- number while the terminal showed the new one.
--
-- All nullable, no default, no backfill. NULL means "came from a workbook",
-- which is what all 44,173 live rows are.
ALTER TABLE "budget_lines" ADD COLUMN "origin"             TEXT;
ALTER TABLE "budget_lines" ADD COLUMN "correctionReason"   TEXT;
ALTER TABLE "budget_lines" ADD COLUMN "correctionBy"       TEXT;
ALTER TABLE "budget_lines" ADD COLUMN "correctionAt"       TIMESTAMP(3);
ALTER TABLE "budget_lines" ADD COLUMN "correctionReviewAt" TIMESTAMP(3);

-- Two partial indexes, both over a set that is small by construction.
--
-- The first answers "which rows must the import's clean-slate skip?" —
-- consulted on every import, against a handful of rows.
CREATE INDEX "budget_lines_manual_correction_idx"
  ON "budget_lines" ("organizationId", "companyId", "accountId")
  WHERE "origin" = 'manual_correction';

-- The second answers "which corrections has a later import put in doubt?",
-- which is the review queue a human works through. Kept separate so the queue
-- stays a few pages even once corrections accumulate.
CREATE INDEX "budget_lines_correction_review_idx"
  ON "budget_lines" ("organizationId", "correctionReviewAt")
  WHERE "correctionReviewAt" IS NOT NULL;
