-- Phase 13.7 (2026-08-02) — a difference somebody signed for.
--
-- 11.91 makes a disagreement with the client's own statement impossible to
-- ignore. Sometimes the platform is right and the workbook is stale, and then
-- the marker can never be cleared by fixing our data. AZSF 2025 is the live
-- case: that block does not cross-foot in EITHER direction — −95,053 with
-- `PLF.08.*`, +79,438 without, the difference being exactly `PLF.08.01` =
-- 174,491. The workbook disagrees with itself.
--
-- Without this, the only way to silence that marker is to falsify a row. The
-- feature would have created the exact behaviour it exists to prevent.
--
-- `reconStatus = 'accepted'` is a THIRD state, rendered as accepted and never
-- as matched, and `lastReconciledAt` stays unwritten: an accepted difference is
-- a decision about a disagreement, not the absence of one, and the
-- decision-grade gate must keep seeing it that way.
--
-- `reconAcceptedDelta` is what makes this safe rather than a mute button. It
-- records the gap that was signed for; the next check compares the CURRENT gap
-- against it, and if the number has moved the signature no longer covers what
-- is on screen, so the value returns to `mismatched`. A blanket "ignore this
-- cell" would also silence tomorrow's different error.
ALTER TABLE "indicator_values" ADD COLUMN "reconAcceptedBy"     TEXT;
ALTER TABLE "indicator_values" ADD COLUMN "reconAcceptedReason" TEXT;
ALTER TABLE "indicator_values" ADD COLUMN "reconAcceptedAt"     TIMESTAMP(3);
ALTER TABLE "indicator_values" ADD COLUMN "reconAcceptedDelta"  DOUBLE PRECISION;
