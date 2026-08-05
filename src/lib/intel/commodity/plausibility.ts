/**
 * Phase 7.M Step 1 (2026-05-18) — universal plausibility floor/ceiling
 * registry for every external commodity / macro feed.
 *
 * Why this file exists
 * ────────────────────
 * On 2026-05-18 the UN Comtrade adapter wrote a 2025-partial-year
 * trade balance of −$23,189,210,599 USD into `intel_data_points`.
 * The classifier dutifully painted that across every services /
 * logistics entity as a red "country exports less than it imports
 * by $23B" signal, and the Top-3 Worst panel in the Risk Terminal
 * surfaced it to the client. That was structurally impossible — AZ
 * has run a structural trade surplus for two decades.
 *
 * The bug had no defence at six independent layers (adapter, storage,
 * recompute, classifier, ranker, UI). This module closes the FIRST
 * layer: every data point that lands in `intel_data_points` is
 * range-checked against a metric-specific [min, max] before persistence.
 * A value outside the band is rejected with an `errors[]` entry the
 * scheduler logs — the bad point is NEVER written.
 *
 * Design choices
 * ──────────────
 *  • Pure module — no I/O, no DB, no Prisma. Pulled in by `ingest.ts`
 *    as a synchronous filter.
 *  • Pattern registry: each entry has a `match` (regex or exact string)
 *    + `min` / `max` + a `reason` template. Region-prefixed metrics
 *    like `YEVLAX_RAINFALL_MM_90D` route through a single
 *    `_RAINFALL_MM_*` regex so we don't redefine bounds per region.
 *  • Tolerant by default — when no rule matches, we accept the value.
 *    Adding a new adapter doesn't require updating this file; only
 *    when the adapter ships do we add a rule. This keeps the registry
 *    a deny-list of *known bad ranges*, not a brittle whitelist.
 *  • Per-rule `reason` so the scheduler log is actionable: it tells
 *    the on-call which adapter / metric / value combo is the offender.
 *
 * Updating the registry
 * ─────────────────────
 * When a finance / FP&A user reports a bogus-looking number on the
 * HeatMap, follow this drill:
 *   1. Identify the `metric` and `value` from the screenshot.
 *   2. Find the rule in `PLAUSIBILITY_RULES` (or add a new one).
 *   3. Tighten the [min, max] band to exclude the bogus value.
 *   4. Add a regression test in `plausibility.test.ts` that locks
 *      the new band ("regression for 2026-05-18 −$23B trade balance"
 *      style).
 *   5. Bounds are deliberately wider than headline-news ranges — the
 *      job here is to catch *structurally impossible* values, not to
 *      second-guess the market. A 20% surprise in Brent is real news;
 *      a −$23B "balance" is a bug.
 */

export interface PlausibilityRule {
  /** Display name for log / test output. */
  id: string
  /** Match either an exact metric string OR a regex pattern. */
  match: string | RegExp
  /** Inclusive lower bound. Use `-Infinity` for one-sided ceilings. */
  min: number
  /** Inclusive upper bound. Use `Infinity` for one-sided floors. */
  max: number
  /** Free-form reason injected into the error log when bounds are
   *  violated. Should explain WHY the bound is what it is so the
   *  on-call doesn't blindly widen it. */
  reason: string
}

export interface PlausibilityCheckResult {
  ok: boolean
  /** Which rule fired (matched or returned no-op). Useful for the
   *  scheduler audit log so an admin can see which rule rejected
   *  the point. */
  ruleId: string | null
  /** Populated only when `ok === false`. */
  reason?: string
}

/**
 * The registry. Order matters: more specific rules first, generic
 * fallback patterns last. The first matching rule wins.
 */
export const PLAUSIBILITY_RULES: ReadonlyArray<PlausibilityRule> = [
  // ── UN Comtrade (AZ trade) ─────────────────────────────────────
  // AZ total annual goods trade has run $25B-$45B for the past decade.
  // Anything under $5B is partial-year (Comtrade publishes mid-year
  // for the previous year, so Jan-Feb publication for last year is
  // genuinely missing months).
  {
    id: "az-goods-exports-usd",
    match: "AZ_GOODS_EXPORTS_USD",
    min: 5_000_000_000,
    max: 100_000_000_000,
    reason:
      "AZ annual goods exports historically $25B-$45B; <$5B = partial-year report, >$100B = unit-of-measure error",
  },
  {
    id: "az-goods-imports-usd",
    match: "AZ_GOODS_IMPORTS_USD",
    min: 5_000_000_000,
    max: 100_000_000_000,
    reason:
      "AZ annual goods imports historically $10B-$20B; outside $5B-$100B is structurally implausible",
  },
  {
    id: "az-trade-balance-usd",
    match: "AZ_TRADE_BALANCE_USD",
    min: -15_000_000_000,
    max: 50_000_000_000,
    reason:
      "AZ trade balance historically -$5B to +$25B (oil-driven surplus); outside [-15B, 50B] = adapter bug (e.g. the 2026-05-18 −$23B partial-year regression)",
  },

  // ── FX rates (CBAR + forward curve) ─────────────────────────────
  // AZN/USD has been pegged at 1.70 since 2017. Soviet-era and pre-
  // peg history shows 0.7-2.0. Even Black Swan devaluations don't
  // breach 0.5 or 5.0.
  {
    id: "azn-usd-spot",
    match: /^AZN_USD$/,
    min: 0.5,
    max: 5.0,
    reason:
      "AZN/USD pegged at 1.70 since 2017; outside [0.5, 5.0] = decimal error or wrong currency pair",
  },
  {
    id: "azn-eur-spot",
    match: /^AZN_EUR$/,
    min: 0.5,
    max: 5.0,
    reason:
      "AZN/EUR has tracked AZN/USD × EUR/USD historically 1.6-2.2; outside [0.5, 5.0] = bug",
  },

  // ── Energy (EIA + Yahoo) ────────────────────────────────────────
  {
    id: "brent-usd-bbl",
    match: "BRENT_USD_BBL",
    min: 10,
    max: 250,
    reason:
      "Brent historical range $10-$150/bbl across 40-year history; outside [10, 250] = adapter bug",
  },
  {
    id: "wti-usd-bbl",
    match: "WTI_USD_BBL",
    min: -50, // April 2020 saw negative WTI; allow but flag absurd negatives
    max: 250,
    reason:
      "WTI historical range -$40/bbl (Apr 2020 anomaly) to $150/bbl; abs >$250 = bug",
  },
  {
    id: "natgas-usd-mmbtu",
    match: "NATGAS_USD_MMBTU",
    min: 0.5,
    max: 50,
    reason:
      "Henry Hub natural gas $1-$15/mmbtu historical; outside [0.5, 50] = bug",
  },
  {
    id: "diesel-litre",
    match: /^DIESEL_USD_LITRE$|^GASOLINE_USD_LITRE$/,
    min: 0.2,
    max: 5.0,
    reason:
      "Diesel / gasoline retail wholesale typically $0.5-$2.0/L; outside [0.2, 5.0] = bug",
  },

  // ── Soft commodities ────────────────────────────────────────────
  {
    id: "sugar-usd-tonne",
    match: "SUGAR_RAW_USD_TONNE",
    min: 100,
    max: 2000,
    reason:
      "ICE No. 11 raw sugar historical $150-$900/tonne; outside [100, 2000] = bug",
  },
  {
    id: "grains-usd-tonne",
    // CORN / WHEAT / SOYBEAN / OATS / BARLEY / COTTON / RICE etc.
    match: /^(CORN|WHEAT|SOYBEAN|OATS|BARLEY|RICE)_USD_TONNE$/,
    min: 50,
    max: 2000,
    reason:
      "Grain futures historically $100-$700/tonne; outside [50, 2000] = bug",
  },
  {
    id: "cotton-usd-tonne",
    match: "COTTON_USD_TONNE",
    min: 500,
    max: 6000,
    reason:
      "Cotton (ICE) historically $1.2k-$3k/tonne; outside [500, 6000] = bug",
  },

  // ── Industrial metals ──────────────────────────────────────────
  {
    id: "copper-aluminum-steel-usd-tonne",
    match: /^(COPPER|ALUMINUM|STEEL)_USD_TONNE$/,
    min: 500,
    max: 25_000,
    reason:
      "Copper / aluminum / steel historical $1k-$12k/tonne; outside [500, 25k] = bug",
  },
  {
    id: "lumber-usd-mbf",
    match: "LUMBER_USD_MBF",
    min: 100,
    max: 2500,
    reason:
      "CME lumber futures historically $300-$1500/MBF (2021 spike $1700); outside [100, 2500] = bug",
  },

  // ── Shipping ───────────────────────────────────────────────────
  {
    id: "baltic-dry-index",
    match: "BALTIC_DRY_INDEX",
    // 2026-08-04 — this band used to be [50, 20000], the range of the Baltic
    // Dry Index itself, and it rejected every value the feed has ever
    // produced: 19 of the 24 errors on the scheduled run were this rule
    // refusing readings of 7.51 … 12.07.
    //
    // The band was measuring the wrong instrument. `yahoo-fuel-bdi` cannot
    // fetch the index — Yahoo's public chart API 404s on `^BDIY` — so it
    // deliberately emits BDRY, the Breakwave Dry Bulk Shipping ETF built to
    // track the BDI through 3-month freight futures, priced in USD/share.
    // The adapter says so, and the indicator thresholds were calibrated for
    // ETF scale (green ≥ 20, amber ≥ 10, red < 10). Only this rule never got
    // the memo, so the sanity check and the data disagreed about what the
    // metric even is — and the sanity check won, silently, for months.
    //
    // Bounds are the ETF's: BDRY has traded roughly $4-$40 since its 2018
    // launch. [1, 200] leaves room for a genuine freight spike while still
    // catching the two failures worth catching — a zero/negative price, and
    // an index-scale number arriving here (e.g. 1500), which would mean
    // someone repointed the adapter at the real index without revisiting the
    // downstream thresholds.
    min: 1,
    max: 200,
    reason:
      "BDRY (Breakwave Dry Bulk ETF, USD/share, proxy for the BDI) has traded $4-40 since 2018; outside [1, 200] = bug — an index-scale value here means the adapter changed instrument",
  },

  // ── FAO ────────────────────────────────────────────────────────
  {
    id: "fao-ffpi",
    match: /^FAO_(FFPI|MEAT|DAIRY|CEREALS|OILS|SUGAR)_(NOMINAL|REAL)$/,
    min: 40,
    max: 400,
    reason:
      "FAO indices (2014-16 base = 100) historically 60-180; outside [40, 400] = bug",
  },

  // ── CPI ────────────────────────────────────────────────────────
  {
    id: "cpi-yoy-pct",
    match: /_CPI_(YOY|ALL_ITEMS|FOOD|NON_FOOD|SERVICES|HOUSING)$/,
    min: -20,
    max: 200,
    reason:
      "CPI YoY% typically -5 to +25; hyperinflation cap 200; outside = bug",
  },

  // ── Weather ────────────────────────────────────────────────────
  {
    id: "rainfall-mm",
    match: /_RAINFALL_MM(?:_90D|_14D_FCST)?$/,
    min: 0,
    max: 3000,
    reason:
      "Rainfall mm cannot be negative; >3000mm/90d would be Bangladeshi monsoon — not Caspian basin",
  },
  {
    id: "temperature-celsius",
    match: /_TEMP_(AVG|MAX|MIN)_C(?:_30D|_14D_FCST)?$/,
    min: -50,
    max: 60,
    reason:
      "Surface temperature outside [-50, +60] °C = sensor / unit-conversion bug",
  },

  // ── USDA poultry ───────────────────────────────────────────────
  {
    id: "broiler-price",
    match: "BROILER_PRICE_USD_LB",
    min: 0.1,
    max: 10,
    reason:
      "USDA broiler $0.5-$3/lb historical; outside [0.1, 10] = bug",
  },
  {
    id: "egg-price",
    match: "EGG_PRICE_USD_DOZ",
    min: 0.3,
    max: 20,
    reason:
      "USDA wholesale eggs $1-$8/dozen historical; outside [0.3, 20] = bug",
  },
  {
    id: "chick-placement",
    match: "CHICK_PLACEMENT_THOUSAND",
    min: 1_000,
    max: 500_000,
    reason:
      "USDA weekly chick placements 100k-300k typical; outside [1k, 500k] = bug",
  },

  // ── World Bank development indicators ──────────────────────────
  {
    id: "tourism-arrivals",
    match: "AZ_TOURISM_ARRIVALS",
    min: 0,
    max: 100_000_000,
    reason:
      "AZ tourism arrivals 1M-3M typical; outside [0, 100M] = bug",
  },
  {
    id: "tourism-receipts-usd",
    match: /^AZ_TOURISM_(RECEIPTS|EXPENDITURES)_USD$/,
    min: 0,
    max: 50_000_000_000,
    reason:
      "AZ tourism receipts $0.5B-$3B typical; outside [0, $50B] = bug",
  },
  {
    id: "school-enrollment-pct",
    match: /^AZ_SCHOOL_ENROLL_.*_PCT$/,
    min: 0,
    max: 110, // gross enrollment can exceed 100% due to over-age students
    reason:
      "School enrollment % must be 0-110 (gross enrollment can mildly exceed 100)",
  },
  {
    id: "edu-expenditure-pct-gdp",
    match: "AZ_EDU_EXPENDITURE_PCT_GDP",
    min: 0,
    max: 25,
    reason:
      "Education expenditure % of GDP typically 2-8; outside [0, 25] = bug",
  },
  {
    id: "pop-age-pct",
    match: /^AZ_POP_AGE_.*_PCT$/,
    min: 0,
    max: 100,
    reason:
      "Population % of age band must be 0-100",
  },

  // ── Google Trends ──────────────────────────────────────────────
  {
    id: "google-trends-normalized",
    match: /^AZ_TREND_/,
    min: 0,
    max: 100,
    reason:
      "Google Trends normalized index is bounded 0-100 by definition",
  },
]

/**
 * Find the first matching rule for a metric and validate the value
 * against its bounds. When no rule matches, returns `{ ok: true,
 * ruleId: null }` — unknown metrics are accepted by default.
 *
 * Designed to be called once per data-point in the persistence loop;
 * the cost is O(rules) per call, well under a microsecond at the
 * registry size we expect (<200 rules).
 */
export function checkPlausibility(
  metric: string,
  value: number,
): PlausibilityCheckResult {
  for (const rule of PLAUSIBILITY_RULES) {
    const matches =
      typeof rule.match === "string"
        ? rule.match === metric
        : rule.match.test(metric)
    if (!matches) continue
    if (value < rule.min || value > rule.max) {
      return {
        ok: false,
        ruleId: rule.id,
        reason: `${rule.reason} (got ${value})`,
      }
    }
    return { ok: true, ruleId: rule.id }
  }
  return { ok: true, ruleId: null }
}
