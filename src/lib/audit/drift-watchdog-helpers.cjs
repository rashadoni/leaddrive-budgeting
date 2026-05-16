/**
 * Pure helpers extracted from `scripts/drift-watchdog.cjs` (F2 closure).
 *
 * The watchdog is a long-running CLI orchestrator (forks audit-company.cjs
 * per registry entry, diffs IndicatorValue rows before/after). The pure
 * pieces — drift comparison and the threshold — live here so they can be
 * unit-tested without spawning the child process or hitting Postgres.
 */

const DRIFT_THRESHOLD_PCT = 0.5;

/**
 * Compare two indicator snapshots and produce a drifts[] list.
 *
 * @param {Map<string, {sanityBand: string|null, value: number}>} beforeMap
 *        Snapshot keyed by indicator code, taken before the audit run.
 * @param {Array<{indicator: {code: string}, sanityBand: string|null, value: number | string}>} ivsAfter
 *        Raw IV rows fetched after the audit run.
 * @param {number} thresholdPct
 *        Value-delta threshold (default 0.5%). Any value drift above this
 *        OR any sanityBand change is emitted as a drift entry.
 * @returns {Array<{
 *   indicatorCode: string,
 *   beforeBand: string|null,
 *   afterBand: string|null,
 *   beforeValue: number,
 *   afterValue: number,
 *   valueDriftPct: number,
 *   bandChanged: boolean,
 * }>}
 */
function computeDrifts(beforeMap, ivsAfter, thresholdPct = DRIFT_THRESHOLD_PCT) {
  const drifts = [];
  for (const iv of ivsAfter) {
    const before = beforeMap.get(iv.indicator.code);
    if (!before) continue;
    const beforeValue = Number(before.value);
    const afterValue = Number(iv.value);
    const bandChanged = before.sanityBand !== iv.sanityBand;
    // Denominator is `max(|before|, 1)` so a flip from 0 → 5 doesn't divide
    // by zero and stays bounded. Matches the original watchdog semantics.
    const valueDrift =
      (Math.abs(afterValue - beforeValue) / Math.max(Math.abs(beforeValue), 1)) * 100;
    if (bandChanged || valueDrift > thresholdPct) {
      drifts.push({
        indicatorCode: iv.indicator.code,
        beforeBand: before.sanityBand,
        afterBand: iv.sanityBand,
        beforeValue,
        afterValue,
        valueDriftPct: valueDrift,
        bandChanged,
      });
    }
  }
  return drifts;
}

/**
 * Build the before-map used by `computeDrifts` from a raw IV array.
 * Extracted so callers don't have to remember the shape (`indicator.code`).
 */
function buildBeforeMap(ivsBefore) {
  return new Map(ivsBefore.map((iv) => [iv.indicator.code, iv]));
}

module.exports = {
  DRIFT_THRESHOLD_PCT,
  computeDrifts,
  buildBeforeMap,
};
