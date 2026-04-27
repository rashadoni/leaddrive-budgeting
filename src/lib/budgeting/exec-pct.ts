/**
 * Pure helper extracted from `/budgeting/page.tsx` PLTab's `execPct`.
 *
 * Computes the "execution %" KPI shown on cards and section bars:
 * how close `actual` came to `planned`, returned as 0–200 (clamped).
 *
 * Contract:
 *   - planned === 0 → 0  (no plan to compare against)
 *   - planned  >  0 → round(actual / planned * 100), clamped to [0, 200]
 *   - planned  <  0 → sign-aware branch (loss expected, e.g. EBITDA at -2M):
 *       favorable = actual - planned  (positive when actual is closer to zero)
 *       result = 100 + favorable / |planned| * 100, clamped to [0, 200]
 *       100% = on plan; >100% = smaller loss (better);
 *       <100% = bigger loss (worse).
 *
 * The negative-planned branch fixes the Turn-36 audit bug where plan = -2M /
 * actual = -2.7M (objectively worse) reported as 135% via Math.abs(actual)
 * / Math.abs(planned), falsely reading as "over-achieved." Callers must
 * NOT pre-strip sign with Math.abs() — the sign-aware branch needs raw
 * signed values.
 */

const MAX_PCT_CLAMP = 200;

export function execPct(actual: number, planned: number): number {
  if (planned === 0) return 0;
  if (planned < 0) {
    const favorable = actual - planned;
    return Math.max(
      0,
      Math.min(Math.round(100 + (favorable / Math.abs(planned)) * 100), MAX_PCT_CLAMP),
    );
  }
  return Math.min(Math.round((actual / planned) * 100), MAX_PCT_CLAMP);
}
