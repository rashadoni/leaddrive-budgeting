/**
 * Phase 7.G Turn CVI (Phase 7.E #3 v2 E.2c slice 2) — macro-driver mapping +
 * sparkline alignment.
 *
 * Bridges the IntelDataPoint commodity layer (D.5b LXXXXV) with the breach-
 * forecaster (E.2a LXXXXVII) via two pure helpers:
 *
 *   1. `resolveMacroDrivers(indicatorCode)` — returns the macro-metric names
 *      that load-bearing-correlate with the indicator. Pattern-matched against
 *      indicator code conventions: REVENUE/REVPAR → FX; MARGIN → FX + Brent;
 *      OPEX_RATIO → CPI; FX_EXPOSURE → FX. Empty array when no rule matches
 *      (caller falls back to univariate forecast).
 *
 *   2. `alignMacroSeriesByIndex(points, sparklineLength)` — right-aligns the
 *      latest N macro datapoints to the sparkline's index range, padding the
 *      front with nulls when fewer than N values are available. Caller treats
 *      the result as a same-length regressor series for `fitMultivariateOLS`.
 *
 * **v1 alignment caveat:** index alignment treats the sparkline as a uniform
 * sequence and assigns the LATEST macro value to the latest sparkline slot.
 * This is correct for monthly indicators with monthly macro data, less correct
 * for quarterly/annual indicators with monthly macro data (over-samples the
 * recent end). v1.1 follow-up: pass `indicatorCadence` + actual datetimes so
 * alignment can bucket by calendar period instead of array index.
 *
 * **No DB dependency:** caller (slice 3 wire) loads IntelDataPoint rows (via
 * `getInMemoryDataPoints` or Prisma) and passes them in. This module just
 * does the math.
 */

/** Pattern → drivers mapping. Order matters: first match wins. Patterns
 *  are word-boundary aware (case-sensitive — indicator codes are uppercase). */
const MACRO_DRIVER_RULES: Array<{ pattern: RegExp; drivers: string[] }> = [
  // FX-sensitive: USD-denominated revenue / hard-currency contracts / hospitality
  // (tourist + foreign-business clients pay in USD/EUR).
  { pattern: /(?:^|_)(?:REVENUE|REVPAR|REV_GROWTH|HOLDING_REVENUE|REVENUE_TOTAL)/, drivers: ["AZN_USD"] },
  // Margins compress from FX (imported COGS) + Brent (transport + utilities).
  { pattern: /(?:^|_)(?:GROSS_MARGIN|NET_MARGIN)/, drivers: ["AZN_USD", "BRENT_USD_BBL"] },
  // OpEx (rent, salaries, utilities) inflates with CPI.
  { pattern: /(?:^|_)OPEX_RATIO/, drivers: ["AZ_CPI_YOY"] },
  // FX exposure indicator literally tracks FX delta.
  { pattern: /(?:^|_)FX_EXPOSURE/, drivers: ["AZN_USD"] },
  // COGS share / cost ratio — sensitive to commodity input cost.
  { pattern: /(?:^|_)(?:COGS|FEED_COST_SHARE)/, drivers: ["AZN_USD", "BRENT_USD_BBL"] },
]

/**
 * Resolve the macro metric names that pair with this indicator. Returns
 * an empty array when no rule matches — caller should treat empty as
 * "no macro overlay; use univariate forecast".
 */
export function resolveMacroDrivers(indicatorCode: string): string[] {
  for (const rule of MACRO_DRIVER_RULES) {
    if (rule.pattern.test(indicatorCode)) return rule.drivers
  }
  return []
}

/** Test seam — exposes the rule list for assertion + extension scenarios. */
export function getMacroDriverRulesForTests(): typeof MACRO_DRIVER_RULES {
  return MACRO_DRIVER_RULES
}

export interface MacroDataPoint {
  /** Observation datetime (UTC). */
  datetime: Date
  /** Numeric value at this datetime. */
  value: number
}

/**
 * Right-align the latest N macro datapoints into a series of the given
 * length, padding the front with nulls when fewer than N values exist.
 * Returns a `(number|null)[]` ready for use as a regressor series in
 * `fitMultivariateOLS`.
 *
 * **Alignment rule:** sorts ascending by datetime, takes the last
 * `sparklineLength` points, places them at indices
 * `[sparklineLength - tail.length, ..., sparklineLength - 1]`. Front-pads
 * with nulls for the remaining positions.
 *
 * **Edge cases:**
 *   - empty input → all-null series of length `sparklineLength`
 *   - sparklineLength = 0 → empty series
 *   - tail.length > sparklineLength → handled by `slice(-sparklineLength)` cap
 *   - duplicate datetimes → preserved (stable sort)
 *   - non-finite values → kept as-is (caller's `fitMultivariateOLS` drops
 *     non-finite rows downstream)
 */
export function alignMacroSeriesByIndex(
  points: ReadonlyArray<MacroDataPoint>,
  sparklineLength: number,
): Array<number | null> {
  if (sparklineLength <= 0) return []
  const series: Array<number | null> = new Array<number | null>(sparklineLength).fill(null)
  if (points.length === 0) return series
  const sorted = [...points].sort((a, b) => a.datetime.getTime() - b.datetime.getTime())
  const tail = sorted.slice(-sparklineLength)
  const offset = sparklineLength - tail.length
  for (let i = 0; i < tail.length; i++) {
    series[offset + i] = tail[i].value
  }
  return series
}
