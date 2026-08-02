-- Phase 11.91 (2026-08-02) — record the verdict of checking an indicator
-- against the client's own statement, including when it FAILS.
--
-- Why three columns and not one
-- ─────────────────────────────
-- `lastReconciledAt` already existed and stays exactly what it was: the last
-- time this value PASSED. `decision-grade.ts` reads it as evidence, so setting
-- it on a failed check would certify the very values the check exists to
-- catch — the false green that module was written to prevent.
--
-- So a failure needed somewhere else to live, and until now it had nowhere.
-- The import found a mismatch, formatted it into a warning string, and the
-- string scrolled away. The screen went on showing the number with nothing to
-- say against it, which is the whole complaint: a discrepancy that is known
-- and invisible is worse than one nobody looked for.
--
--   reconStatus     'matched' | 'mismatched'. NULL means never checked, which
--                   is not the same as checked-and-fine and must never render
--                   as such — every consumer treats NULL as "no claim".
--   reconExpected   what the statement says the quantity is. The delta is
--                   `value - reconExpected`, derived at every read: two
--                   columns that must agree are one column and a bug.
--   reconCheckedAt  when the check last RAN, pass or fail. A value that failed
--                   this morning and a value nobody has looked at since March
--                   are different problems and must not share a timestamp.
--
-- All nullable, no default, no backfill. Every one of the existing rows was
-- genuinely never checked against a statement, and inventing 'matched' for
-- them is the exact lie this is built to expose. They read NULL and the
-- surfaces say "not checked".
ALTER TABLE "indicator_values" ADD COLUMN "reconStatus" TEXT;
ALTER TABLE "indicator_values" ADD COLUMN "reconExpected" DOUBLE PRECISION;
ALTER TABLE "indicator_values" ADD COLUMN "reconCheckedAt" TIMESTAMP(3);

-- Partial index: the mismatch surfaces ask "which values disagree?" across a
-- whole org, and that is a small set by construction. Indexing only the rows
-- that answer keeps it a few pages rather than one entry per indicator value.
CREATE INDEX "indicator_values_recon_mismatched_idx"
  ON "indicator_values" ("organizationId", "period")
  WHERE "reconStatus" = 'mismatched';
