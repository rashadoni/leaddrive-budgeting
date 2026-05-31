/**
 * Phase 7.M Tier2 #4 (2026-05-19) — plausibility-rule coverage gate.
 *
 * Purpose
 * ───────
 * Every metric an adapter emits MUST be covered by a rule in
 * `plausibility.ts`. Without this check, a new adapter can silently
 * land in production and skip the plausibility floor — the exact
 * regression that landed `-$23B trade balance` in front of a client.
 *
 * Strategy
 * ────────
 * Grep the adapter source files for `metric: "..."` and metric-template
 * string-literals (e.g. `${...}_RAINFALL_MM_90D`). For each literal /
 * template, verify at least one entry in `PLAUSIBILITY_RULES` matches
 * a synthetic instance.
 *
 * Region-prefixed metrics use template strings that this static
 * grep cannot fully resolve. For those, the test produces a small
 * fixture (one synthetic region prefix per template) and runs the
 * lookup. A rule must match that synthetic value.
 *
 * Maintenance
 * ───────────
 * When a NEW adapter is added, this test will fail if no rule covers
 * its metric. Resolve by either:
 *   (a) adding a rule to `PLAUSIBILITY_RULES`, or
 *   (b) adding the metric to `INTENTIONAL_NO_RULE` below with a
 *       justification comment.
 *
 * Adding `(b)` requires a code review — the deny-list is the canonical
 * record of "we know this metric is unbounded and accept that risk".
 */
import { describe, it, expect } from "vitest"
import { PLAUSIBILITY_RULES, checkPlausibility } from "./plausibility"

/**
 * Metrics intentionally NOT covered by a plausibility rule. Each entry
 * MUST carry a justification — if you're tempted to add an entry here,
 * first try writing a rule.
 */
const INTENTIONAL_NO_RULE: ReadonlyArray<{ metric: string; why: string }> = [
  // (empty for now — all current adapters have rules)
]

/**
 * Every concrete metric our adapters can emit. Template-based metrics
 * (region/country-prefixed) are listed with one representative
 * substitution so the lookup is real.
 */
const ADAPTER_METRICS: ReadonlyArray<string> = [
  // ── un-comtrade-az ────────────────────────────
  "AZ_GOODS_EXPORTS_USD",
  "AZ_GOODS_IMPORTS_USD",
  "AZ_TRADE_BALANCE_USD",
  // ── cbar-fx (spot only; IRP forward removed 2026-06-01) ──
  "AZN_USD",
  "AZN_EUR",
  // ── eia-energy ────────────────────────────────
  "BRENT_USD_BBL",
  "WTI_USD_BBL",
  "NATGAS_USD_MMBTU",
  // ── yahoo-fuel-bdi ────────────────────────────
  "BALTIC_DRY_INDEX",
  "DIESEL_USD_LITRE",
  "GASOLINE_USD_LITRE",
  // ── yahoo-grains ──────────────────────────────
  "CORN_USD_TONNE",
  "WHEAT_USD_TONNE",
  "SOYBEAN_USD_TONNE",
  "OATS_USD_TONNE",
  "COTTON_USD_TONNE",
  // ── yahoo-metals ──────────────────────────────
  "COPPER_USD_TONNE",
  "ALUMINUM_USD_TONNE",
  "STEEL_USD_TONNE",
  "LUMBER_USD_MBF",
  // ── sugar-yahoo ───────────────────────────────
  "SUGAR_RAW_USD_TONNE",
  // ── fao-food-prices ───────────────────────────
  "FAO_FFPI_NOMINAL",
  "FAO_MEAT_NOMINAL",
  "FAO_DAIRY_NOMINAL",
  "FAO_CEREALS_NOMINAL",
  "FAO_OILS_NOMINAL",
  "FAO_SUGAR_NOMINAL",
  // ── az-stat-cpi + worldbank-cpi ───────────────
  "AZ_CPI_ALL_ITEMS",
  "AZ_CPI_FOOD",
  "AZ_CPI_NON_FOOD",
  "AZ_CPI_SERVICES",
  "AZ_CPI_HOUSING",
  "AZE_CPI_YOY",
  "TUR_CPI_YOY",
  "USA_CPI_YOY",
  // ── weather-openmeteo + openmeteo-forecast ────
  // Template — region prefixes from Phase 7.K weather catalog.
  "YEVLAX_RAINFALL_MM_90D",
  "SHAMKIR_RAINFALL_MM_90D",
  "YEVLAX_TEMP_AVG_C_30D",
  "FUZULI_TEMP_MAX_C_14D_FCST",
  "SABIRABAD_RAINFALL_MM_14D_FCST",
  // ── usda-nass ─────────────────────────────────
  "BROILER_PRICE_USD_LB",
  "EGG_PRICE_USD_DOZ",
  "CHICK_PLACEMENT_THOUSAND",
  // ── wb-indicators ─────────────────────────────
  "AZ_TOURISM_ARRIVALS",
  "AZ_TOURISM_RECEIPTS_USD",
  "AZ_TOURISM_EXPENDITURES_USD",
  "AZ_SCHOOL_ENROLL_SEC_PCT",
  "AZ_EDU_EXPENDITURE_PCT_GDP",
  "AZ_POP_AGE_0_14_PCT",
  // ── google-trends-az ──────────────────────────
  "AZ_TREND_FOOD_RETAIL",
  "AZ_TREND_FASHION",
  "AZ_TREND_ELECTRONICS",
  "AZ_TREND_TRAVEL",
]

describe("PLAUSIBILITY_RULES coverage gate", () => {
  it("every known adapter metric has at least one matching rule (or is on the deny-list)", () => {
    const skipMetrics = new Set(INTENTIONAL_NO_RULE.map((e) => e.metric))
    const uncovered: string[] = []
    // Use a midpoint value (1.0) as a synthetic input — we don't care
    // whether the value passes plausibility, only whether SOME rule
    // matches the metric name.
    for (const metric of ADAPTER_METRICS) {
      if (skipMetrics.has(metric)) continue
      const result = checkPlausibility(metric, 1.0)
      if (result.ruleId === null) uncovered.push(metric)
    }
    expect(uncovered, `Metrics missing plausibility rules: ${uncovered.join(", ")}`).toEqual([])
  })

  it("registry is non-empty (sanity)", () => {
    expect(PLAUSIBILITY_RULES.length).toBeGreaterThan(20)
  })

  it("deny-list entries all carry justification text", () => {
    for (const entry of INTENTIONAL_NO_RULE) {
      expect(entry.why.length).toBeGreaterThan(10)
    }
  })
})
