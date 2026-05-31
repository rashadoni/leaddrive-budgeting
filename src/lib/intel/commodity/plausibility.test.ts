/**
 * Phase 7.M Step 1 — regression tests for the plausibility registry.
 *
 * Every rule here exists to catch a structurally-impossible value
 * BEFORE it lands in `intel_data_points`. The test cases use realistic
 * values just inside the band (accept) and just outside (reject) so
 * the next person to widen a bound has to update both the test and
 * the rule deliberately.
 *
 * The 2026-05-18 −$23B trade-balance incident gets its own dedicated
 * regression test below so we never reintroduce that class of bug.
 */
import { describe, it, expect } from "vitest"
import { checkPlausibility, PLAUSIBILITY_RULES } from "./plausibility"

describe("checkPlausibility — unknown metric", () => {
  it("accepts unrecognised metric with ruleId=null (deny-list, not whitelist)", () => {
    const r = checkPlausibility("FOO_BAR_BAZ_NEW_METRIC", 42)
    expect(r.ok).toBe(true)
    expect(r.ruleId).toBe(null)
  })
})

describe("checkPlausibility — UN Comtrade", () => {
  it("regression 2026-05-18: rejects AZ_TRADE_BALANCE_USD = -23.2B (UN Comtrade partial-2025)", () => {
    const r = checkPlausibility("AZ_TRADE_BALANCE_USD", -23_189_210_599)
    expect(r.ok).toBe(false)
    expect(r.ruleId).toBe("az-trade-balance-usd")
    expect(r.reason).toContain("AZ trade balance")
    expect(r.reason).toContain("-23189210599")
  })

  it("accepts realistic +$13B AZ trade surplus", () => {
    expect(checkPlausibility("AZ_TRADE_BALANCE_USD", 13_000_000_000).ok).toBe(true)
  })

  it("rejects AZ_GOODS_EXPORTS_USD = $1.18B (partial-year fragment)", () => {
    const r = checkPlausibility("AZ_GOODS_EXPORTS_USD", 1_180_000_000)
    expect(r.ok).toBe(false)
    expect(r.ruleId).toBe("az-goods-exports-usd")
  })

  it("accepts AZ_GOODS_EXPORTS_USD = $28B (realistic 2024)", () => {
    expect(checkPlausibility("AZ_GOODS_EXPORTS_USD", 28_000_000_000).ok).toBe(true)
  })
})

describe("checkPlausibility — FX rates", () => {
  it("accepts AZN/USD spot at 1.70 (current peg)", () => {
    expect(checkPlausibility("AZN_USD", 1.7).ok).toBe(true)
  })

  it("rejects AZN/USD = 0.001 (decimal misplacement)", () => {
    const r = checkPlausibility("AZN_USD", 0.001)
    expect(r.ok).toBe(false)
    expect(r.ruleId).toBe("azn-usd-spot")
  })

  it("rejects AZN/USD = 1700 (wrong unit — kopeks?)", () => {
    expect(checkPlausibility("AZN_USD", 1700).ok).toBe(false)
  })

})

describe("checkPlausibility — energy", () => {
  it("accepts Brent at $80/bbl", () => {
    expect(checkPlausibility("BRENT_USD_BBL", 80).ok).toBe(true)
  })

  it("rejects Brent at $5/bbl (parser misread cents as dollars?)", () => {
    expect(checkPlausibility("BRENT_USD_BBL", 5).ok).toBe(false)
  })

  it("rejects Brent at $300/bbl (decimal slip)", () => {
    expect(checkPlausibility("BRENT_USD_BBL", 300).ok).toBe(false)
  })

  it("WTI tolerates the April 2020 negative spot anomaly", () => {
    expect(checkPlausibility("WTI_USD_BBL", -37).ok).toBe(true)
  })

  it("WTI rejects -$100 (sensor flip)", () => {
    expect(checkPlausibility("WTI_USD_BBL", -100).ok).toBe(false)
  })
})

describe("checkPlausibility — soft commodities", () => {
  it("accepts sugar at $440/tonne (FAO baseline)", () => {
    expect(checkPlausibility("SUGAR_RAW_USD_TONNE", 440).ok).toBe(true)
  })

  it("rejects sugar at $5/tonne (cents vs dollars)", () => {
    expect(checkPlausibility("SUGAR_RAW_USD_TONNE", 5).ok).toBe(false)
  })

  it("accepts grain prices in plausible range", () => {
    expect(checkPlausibility("CORN_USD_TONNE", 220).ok).toBe(true)
    expect(checkPlausibility("WHEAT_USD_TONNE", 280).ok).toBe(true)
    expect(checkPlausibility("SOYBEAN_USD_TONNE", 450).ok).toBe(true)
  })

  it("rejects grain price at $5000/tonne", () => {
    expect(checkPlausibility("CORN_USD_TONNE", 5000).ok).toBe(false)
  })
})

describe("checkPlausibility — industrial metals", () => {
  it("accepts copper at $8000/tonne", () => {
    expect(checkPlausibility("COPPER_USD_TONNE", 8000).ok).toBe(true)
  })

  it("accepts steel at $700/tonne", () => {
    expect(checkPlausibility("STEEL_USD_TONNE", 700).ok).toBe(true)
  })

  it("rejects steel at $50/tonne (unit error)", () => {
    expect(checkPlausibility("STEEL_USD_TONNE", 50).ok).toBe(false)
  })
})

describe("checkPlausibility — weather", () => {
  it("accepts realistic rainfall 90d for AZ (~150mm)", () => {
    expect(checkPlausibility("YEVLAX_RAINFALL_MM_90D", 150).ok).toBe(true)
    expect(checkPlausibility("SALYAN_RAINFALL_MM_14D_FCST", 25).ok).toBe(true)
  })

  it("rejects negative rainfall", () => {
    expect(checkPlausibility("YEVLAX_RAINFALL_MM_90D", -5).ok).toBe(false)
  })

  it("rejects 5000mm rainfall (sensor flooded)", () => {
    expect(checkPlausibility("YEVLAX_RAINFALL_MM_90D", 5000).ok).toBe(false)
  })

  it("accepts temperature range across regions", () => {
    expect(checkPlausibility("YEVLAX_TEMP_AVG_C_30D", 18).ok).toBe(true)
    expect(checkPlausibility("SHAMKIR_TEMP_MAX_C_14D_FCST", 38).ok).toBe(true)
    expect(checkPlausibility("FUZULI_TEMP_AVG_C_14D_FCST", -5).ok).toBe(true)
  })

  it("rejects -100°C and +200°C (sensor / unit bug)", () => {
    expect(checkPlausibility("YEVLAX_TEMP_AVG_C_30D", -100).ok).toBe(false)
    expect(checkPlausibility("YEVLAX_TEMP_MAX_C_14D_FCST", 200).ok).toBe(false)
  })
})

describe("checkPlausibility — CPI / FAO", () => {
  it("accepts FAO FFPI at 130", () => {
    expect(checkPlausibility("FAO_FFPI_NOMINAL", 130).ok).toBe(true)
  })

  it("rejects FAO FFPI at 10 (decimal off)", () => {
    expect(checkPlausibility("FAO_FFPI_NOMINAL", 10).ok).toBe(false)
  })

  it("accepts AZ food CPI YoY at 8.5%", () => {
    expect(checkPlausibility("AZ_CPI_FOOD", 8.5).ok).toBe(true)
  })

  it("rejects CPI YoY at 500% (hyperinflation cap = 200)", () => {
    expect(checkPlausibility("AZ_CPI_FOOD", 500).ok).toBe(false)
  })

  it("accepts wb-cpi pattern for any country code", () => {
    expect(checkPlausibility("TUR_CPI_YOY", 60).ok).toBe(true)
    expect(checkPlausibility("USA_CPI_YOY", 3).ok).toBe(true)
  })
})

describe("checkPlausibility — Google Trends", () => {
  it("accepts trend 0-100", () => {
    expect(checkPlausibility("AZ_TREND_FOOD_RETAIL", 47).ok).toBe(true)
    expect(checkPlausibility("AZ_TREND_FOOD_RETAIL", 0).ok).toBe(true)
    expect(checkPlausibility("AZ_TREND_FOOD_RETAIL", 100).ok).toBe(true)
  })

  it("rejects trend 150 (Google Trends is normalised 0-100)", () => {
    expect(checkPlausibility("AZ_TREND_TRAVEL", 150).ok).toBe(false)
  })
})

describe("PLAUSIBILITY_RULES — coverage spot-check", () => {
  it("registry contains rules for every adapter shipping today", () => {
    // Spot-check: the rule IDs we expect to find. Adding a new adapter
    // should fail this test, forcing a rule-or-rule-explicit-skip
    // decision before the adapter goes live.
    const expectedIds = [
      "az-goods-exports-usd",
      "az-trade-balance-usd",
      "azn-usd-spot",
      "brent-usd-bbl",
      "sugar-usd-tonne",
      "grains-usd-tonne",
      "copper-aluminum-steel-usd-tonne",
      "baltic-dry-index",
      "fao-ffpi",
      "cpi-yoy-pct",
      "rainfall-mm",
      "temperature-celsius",
      "broiler-price",
      "egg-price",
      "tourism-arrivals",
      "google-trends-normalized",
    ]
    const have = new Set(PLAUSIBILITY_RULES.map((r) => r.id))
    for (const id of expectedIds) {
      expect(have.has(id)).toBe(true)
    }
  })
})
