-- Phase 11.7b (2026-07-29) — separate freshness for the sparkline series.
--
-- `computedAt` belongs to `value` and is correctly bumped on every recompute.
-- But bulk recomputes deliberately omit `withSparkline` (12x the runtime at
-- Phase F scale), and the writer therefore leaves an existing `sparkline`
-- untouched — correct, because the offline compute-sparklines worker owns that
-- column. The side effect: any freshness check reading `computedAt` reported a
-- genuinely stale 12-slot series as fresh.
--
-- NULL = never computed, or computed before this column existed. Deliberately
-- NOT backfilled from `computedAt`: that would assert a freshness nobody
-- measured, which is the exact dishonesty this column exists to remove.

ALTER TABLE "indicator_values" ADD COLUMN "sparklineComputedAt" TIMESTAMP(3);
