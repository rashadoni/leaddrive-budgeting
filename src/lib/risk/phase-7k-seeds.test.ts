/**
 * Per-indicator end-to-end test for the Phase 7.K Phase 5b seed pack.
 *
 * For each of the 23 new indicators we:
 *  1. Verify the seed is present in `phase7kSeeds`
 *  2. Verify its `requiredInputs[]` references real `commodityPrice:*`
 *     aliases registered in the recompute resolver registry
 *  3. Evaluate the seed's `formula` against a fixture context that
 *     simulates realistic IntelDataPoint values for each band
 *     (green / amber / red) and assert the resulting status
 *
 * If any indicator drops out of the pack, breaks its formula, or has
 * an unwired alias, this suite fails with a specific code-level message.
 */
import { describe, it, expect } from "vitest"
import {
  evaluateFormula,
  classifyValue,
  type Thresholds,
} from "./formula-engine"
import { phase7kSeeds } from "./phase-7k-seeds"

/** All Phase 7.K commodityPrice aliases — mirrored from
 *  `COMMODITY_PRICE_ALIASES` in `recompute.ts`. Keep in sync if that
 *  table is edited. */
const PHASE_7K_ALIAS_VARS = new Set<string>([
  // Phase 7.I sugar
  "sugar_price_latest", "sugar_price_mean_12m", "sugar_price_stdev_12m",
  // grains
  "corn_price_latest", "corn_price_mean_12m",
  "wheat_price_latest", "wheat_price_mean_12m",
  "soybean_price_latest", "oats_price_latest", "cotton_price_latest",
  // metals + lumber
  "steel_price_latest", "steel_price_mean_12m",
  "copper_price_latest", "aluminum_price_latest", "lumber_price_latest",
  // energy
  "brent_price_latest", "wti_price_latest", "natgas_price_latest",
  // fuel + shipping
  "baltic_dry_latest", "baltic_dry_mean_12m",
  "diesel_price_latest", "gasoline_price_latest",
  // FX
  "azn_usd_latest", "azn_eur_latest", "azn_rub_latest", "azn_try_latest",
  // FAO food
  "fao_ffpi_latest", "fao_meat_latest", "fao_dairy_latest",
  "fao_cereal_latest", "fao_sugar_latest",
  // AZ CPI
  "az_cpi_all_latest", "az_cpi_food_latest", "az_cpi_housing_latest",
  // USDA poultry
  "broiler_price_latest", "egg_price_latest", "chick_placement_latest",
  // UN Comtrade
  "az_trade_exports_latest", "az_trade_imports_latest", "az_trade_balance_latest",
  // WB Indicators
  "az_tourism_arrivals_latest", "az_tourism_receipts_latest",
  "az_school_enroll_latest", "az_pop_age_0_14_latest",
  // Google Trends
  "az_trend_food_latest", "az_trend_fashion_latest",
  "az_trend_electronics_latest", "az_trend_travel_latest",
])

/** Per-indicator fixture: three sample contexts that should land in
 *  each of the three threshold bands. Keys = formula variables. */
interface BandFixture {
  green: Record<string, number>
  amber: Record<string, number>
  red: Record<string, number>
}

const FIXTURES: Record<string, BandFixture> = {
  // ── HOSPITALITY ──────────────────────────────────────────────────
  HOSP_TOURISM_ARRIVALS_SIGNAL: {
    // formula: az_tourism_arrivals_latest / 1000
    // green ≥ 2000, amber ≥ 1500, red < 1500
    green: { az_tourism_arrivals_latest: 2_500_000 }, // → 2500
    amber: { az_tourism_arrivals_latest: 1_700_000 }, // → 1700
    red: { az_tourism_arrivals_latest: 1_000_000 }, // → 1000
  },

  // ── PHARMA ───────────────────────────────────────────────────────
  PHARM_FX_USD_PRESSURE: {
    // formula: azn_usd_latest. green ≤ 1.7, amber ≤ 1.75, red > 1.75
    green: { azn_usd_latest: 1.69 },
    amber: { azn_usd_latest: 1.73 },
    red: { azn_usd_latest: 1.85 },
  },

  // ── REAL ESTATE ──────────────────────────────────────────────────
  RE_HOUSING_CPI_PRESSURE: {
    // formula: az_cpi_housing_latest. green ≥ 105, amber ≥ 100, red < 100
    green: { az_cpi_housing_latest: 108 },
    amber: { az_cpi_housing_latest: 102 },
    red: { az_cpi_housing_latest: 95 },
  },

  // ── INDUSTRIAL ───────────────────────────────────────────────────
  IND_COPPER_PRICE_SIGNAL: {
    // formula: copper_price_latest. green ≤ 9000, amber ≤ 11000, red > 11000
    green: { copper_price_latest: 8500 },
    amber: { copper_price_latest: 10000 },
    red: { copper_price_latest: 12500 },
  },
  IND_NATGAS_PRICE_SIGNAL: {
    // green ≤ 4, amber ≤ 6, red > 6
    green: { natgas_price_latest: 3.5 },
    amber: { natgas_price_latest: 5 },
    red: { natgas_price_latest: 7.5 },
  },

  // ── CONSTRUCTION ─────────────────────────────────────────────────
  CONSTR_STEEL_PRICE_SIGNAL: {
    // green ≤ 700, amber ≤ 900, red > 900
    green: { steel_price_latest: 650 },
    amber: { steel_price_latest: 850 },
    red: { steel_price_latest: 1100 },
  },
  CONSTR_LUMBER_PRICE_SIGNAL: {
    // green ≤ 400, amber ≤ 600, red > 600
    green: { lumber_price_latest: 380 },
    amber: { lumber_price_latest: 550 },
    red: { lumber_price_latest: 750 },
  },

  // ── LOGISTICS ────────────────────────────────────────────────────
  LOG_DIESEL_PRICE_SIGNAL: {
    // green ≤ 0.7, amber ≤ 0.9, red > 0.9
    green: { diesel_price_latest: 0.65 },
    amber: { diesel_price_latest: 0.85 },
    red: { diesel_price_latest: 1.1 },
  },
  LOG_BDI_FREIGHT_SIGNAL: {
    // BDRY ETF scale: green ≥ 20, amber ≥ 10, red < 10
    green: { baltic_dry_latest: 25 },
    amber: { baltic_dry_latest: 15 },
    red: { baltic_dry_latest: 7 },
  },
  LOG_BRENT_OIL_SIGNAL: {
    // green ≤ 80, amber ≤ 100, red > 100
    green: { brent_price_latest: 75 },
    amber: { brent_price_latest: 92 },
    red: { brent_price_latest: 115 },
  },

  // ── POULTRY ──────────────────────────────────────────────────────
  POULT_BROILER_PRICE_SIGNAL: {
    // green ≥ 1.2, amber ≥ 1.0, red < 1.0
    green: { broiler_price_latest: 1.3 },
    amber: { broiler_price_latest: 1.1 },
    red: { broiler_price_latest: 0.85 },
  },
  POULT_FEED_CORN_PRESSURE: {
    // green ≤ 200, amber ≤ 280, red > 280
    green: { corn_price_latest: 180 },
    amber: { corn_price_latest: 250 },
    red: { corn_price_latest: 320 },
  },
  POULT_EGG_PRICE_SIGNAL: {
    // green ≥ 2.0, amber ≥ 1.5, red < 1.5
    green: { egg_price_latest: 2.4 },
    amber: { egg_price_latest: 1.7 },
    red: { egg_price_latest: 1.2 },
  },

  // ── FOOD PROCESSING ──────────────────────────────────────────────
  FP_FAO_FOOD_INDEX_SIGNAL: {
    // green ≤ 120, amber ≤ 140, red > 140
    green: { fao_ffpi_latest: 110 },
    amber: { fao_ffpi_latest: 130 },
    red: { fao_ffpi_latest: 155 },
  },
  FP_WHEAT_PRICE_SIGNAL: {
    // green ≤ 250, amber ≤ 320, red > 320
    green: { wheat_price_latest: 220 },
    amber: { wheat_price_latest: 290 },
    red: { wheat_price_latest: 380 },
  },
  FP_GRAIN_COST_PRESSURE_BLEND: {
    // formula: (corn + wheat) / 2. green ≤ 230, amber ≤ 320, red > 320
    green: { corn_price_latest: 180, wheat_price_latest: 220 }, // → 200
    amber: { corn_price_latest: 250, wheat_price_latest: 320 }, // → 285
    red: { corn_price_latest: 380, wheat_price_latest: 420 }, // → 400
  },

  // ── BEVERAGE ─────────────────────────────────────────────────────
  BEV_FAO_SUGAR_INDEX_SIGNAL: {
    // green ≤ 110, amber ≤ 140, red > 140
    green: { fao_sugar_latest: 100 },
    amber: { fao_sugar_latest: 125 },
    red: { fao_sugar_latest: 160 },
  },

  // ── RETAIL ───────────────────────────────────────────────────────
  RET_AZ_FOOD_CPI_PRESSURE: {
    // green ≤ 105, amber ≤ 115, red > 115
    green: { az_cpi_food_latest: 102 },
    amber: { az_cpi_food_latest: 110 },
    red: { az_cpi_food_latest: 125 },
  },
  RET_TREND_FOOD_SIGNAL: {
    // green ≥ 100, amber ≥ 80, red < 80
    green: { az_trend_food_latest: 110 },
    amber: { az_trend_food_latest: 90 },
    red: { az_trend_food_latest: 65 },
  },

  // ── EDUCATION ────────────────────────────────────────────────────
  EDU_POPULATION_0_14_SIGNAL: {
    // green ≥ 23, amber ≥ 20, red < 20
    green: { az_pop_age_0_14_latest: 24.5 },
    amber: { az_pop_age_0_14_latest: 21 },
    red: { az_pop_age_0_14_latest: 18 },
  },

  // ── ENTERTAINMENT ────────────────────────────────────────────────
  ENT_TRAVEL_DEMAND_SIGNAL: {
    // green ≥ 100, amber ≥ 80, red < 80
    green: { az_trend_travel_latest: 105 },
    amber: { az_trend_travel_latest: 85 },
    red: { az_trend_travel_latest: 60 },
  },

  // ── SERVICES ─────────────────────────────────────────────────────
  SERV_AZ_TRADE_BALANCE_SIGNAL: {
    // green ≥ 10B, amber ≥ 0, red < 0
    green: { az_trade_balance_latest: 15_000_000_000 },
    amber: { az_trade_balance_latest: 3_000_000_000 },
    red: { az_trade_balance_latest: -2_000_000_000 },
  },

  // ── AGRO ─────────────────────────────────────────────────────────
  AGRO_SALYAN_RAINFALL_14D_FCST: {
    // formula uses bare `salyan_rainfall_forecast_14d` (weather:* resolver)
    // green ≥ 30, amber ≥ 10, red < 10
    green: { salyan_rainfall_forecast_14d: 45 },
    amber: { salyan_rainfall_forecast_14d: 20 },
    red: { salyan_rainfall_forecast_14d: 5 },
  },
}

/** Every Phase 7.K seed must have a fixture so we don't ship a seed
 *  without a regression-test cover. */
describe("Phase 7.K seed pack — coverage", () => {
  it("23 seeds in the pack", () => {
    expect(phase7kSeeds.length).toBe(23)
  })

  it("every seed has a band-fixture (no untested seeds)", () => {
    for (const seed of phase7kSeeds) {
      expect(FIXTURES[seed.code], `missing FIXTURES entry for ${seed.code}`).toBeDefined()
    }
  })

  it("every seed code is unique within the pack", () => {
    const codes = new Set(phase7kSeeds.map((s) => s.code))
    expect(codes.size).toBe(phase7kSeeds.length)
  })

  it("every commodityPrice:* requiredInput maps to a known alias", () => {
    for (const seed of phase7kSeeds) {
      for (const input of seed.requiredInputs) {
        if (!input.startsWith("commodityPrice:")) continue
        const varName = input.slice("commodityPrice:".length)
        expect(
          PHASE_7K_ALIAS_VARS.has(varName),
          `${seed.code}.requiredInputs has unwired alias "${varName}"`,
        ).toBe(true)
      }
    }
  })
})

/** Per-indicator: confirm formula + thresholds classify each fixture
 *  to the expected band. Runs once per seed — 23 nested `it()` blocks
 *  so a single broken formula reports specifically.
 *
 *  This is the "test each connected indicator" pass the user asked
 *  for: every new indicator gets exercised individually. */
describe.each(phase7kSeeds.map((s) => [s.code, s]))(
  "indicator → %s",
  (_code, seed) => {
    const fixture = FIXTURES[seed.code]
    const thresholds = seed.thresholds as Thresholds

    if (!fixture) {
      it.skip("no fixture defined — skipping band tests", () => {})
      return
    }

    it("green-band fixture evaluates to status='green'", () => {
      const value = evaluateFormula(seed.formula, fixture.green)
      expect(Number.isFinite(value)).toBe(true)
      const status = classifyValue(value, thresholds)
      expect(status, `${seed.code} green fixture → ${value} → expected 'green'`).toBe("green")
    })

    it("amber-band fixture evaluates to status='amber'", () => {
      const value = evaluateFormula(seed.formula, fixture.amber)
      expect(Number.isFinite(value)).toBe(true)
      const status = classifyValue(value, thresholds)
      expect(status, `${seed.code} amber fixture → ${value} → expected 'amber'`).toBe("amber")
    })

    it("red-band fixture evaluates to status='red'", () => {
      const value = evaluateFormula(seed.formula, fixture.red)
      expect(Number.isFinite(value)).toBe(true)
      const status = classifyValue(value, thresholds)
      expect(status, `${seed.code} red fixture → ${value} → expected 'red'`).toBe("red")
    })
  },
)
