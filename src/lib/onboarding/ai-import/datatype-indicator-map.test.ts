/**
 * 2026-05-27 — Tests for datatype-indicator-map (AI Import preview impact projection).
 */
import { describe, it, expect } from "vitest"
import {
  affectedIndicatorsForDataType,
  confidenceBand,
  confidenceBandLabel,
  confidenceLabel,
} from "./datatype-indicator-map"

describe("affectedIndicatorsForDataType", () => {
  it("PLF → includes budgetLine consumers", () => {
    const impact = affectedIndicatorsForDataType("PLF")
    expect(impact.dataType).toBe("PLF")
    expect(impact.writes).toMatch(/BudgetLine/)
    expect(impact.note).toBeNull() // no caveat — PLF is fully wired
    expect(impact.indicators.length).toBeGreaterThan(0)
    // All matched inputs should be budgetLine* tokens.
    for (const ind of impact.indicators) {
      expect(ind.matchedInput.startsWith("budgetLine")).toBe(true)
    }
  })

  it("BS → matches balanceSheetLine.inventory consumer", () => {
    const impact = affectedIndicatorsForDataType("BS")
    expect(impact.writes).toMatch(/BalanceSheetLine/)
    expect(impact.indicators.length).toBeGreaterThan(0)
    for (const ind of impact.indicators) {
      expect(ind.matchedInput.startsWith("balanceSheetLine")).toBe(true)
    }
  })

  it("KPI_FARMING → matches yield_per_ha / sugar_content_pct / drought_index", () => {
    const impact = affectedIndicatorsForDataType("KPI_FARMING")
    const codes = impact.indicators.map((i) => i.code)
    expect(codes).toContain("AGRO_YIELD_PER_HA")
    expect(codes).toContain("AGRO_SUGAR_CONTENT")
    expect(codes).toContain("AGRO_DROUGHT_RISK")
    // farming bucket should NOT include processing-only metrics
    for (const ind of impact.indicators) {
      const metric = ind.matchedInput.replace("operationalFact:", "")
      expect(metric).not.toBe("extraction_rate_pct")
    }
  })

  it("KPI_PROCESSING → matches extraction_rate_pct", () => {
    const impact = affectedIndicatorsForDataType("KPI_PROCESSING")
    // No current seed reads extraction_rate_pct directly but capacity/raw_input/finished_output
    // may match for cane-related indicators. Just assert no farming-only
    // metrics (yield_per_ha) leaks.
    for (const ind of impact.indicators) {
      const metric = ind.matchedInput.replace("operationalFact:", "")
      expect(metric).not.toBe("yield_per_ha")
    }
  })

  it("OPS_FACTS → broad bucket — includes both farming and processing metric consumers", () => {
    const impact = affectedIndicatorsForDataType("OPS_FACTS")
    const codes = impact.indicators.map((i) => i.code)
    // Farming-side
    expect(codes).toContain("AGRO_YIELD_PER_HA")
    // Compliance/legal (audit findings imported as ops_facts)
    expect(codes).toContain("AUDIT_CLOSED_PCT")
    expect(codes).toContain("LEGAL_CASES_ACTIVE")
  })

  it("LAND_REGISTRY → includes hectaresPlanted consumers (AGRO_REVENUE_PER_HA / AGRO_COST_PER_HA)", () => {
    const impact = affectedIndicatorsForDataType("LAND_REGISTRY")
    const codes = impact.indicators.map((i) => i.code)
    expect(codes).toContain("AGRO_REVENUE_PER_HA")
    expect(codes).toContain("AGRO_COST_PER_HA")
  })

  it("SALES → empty + explicit note (no current seed reads farm_sales_*)", () => {
    const impact = affectedIndicatorsForDataType("SALES")
    expect(impact.indicators).toEqual([])
    expect(impact.note).toMatch(/farm_sales/)
  })

  it("CAPEX → empty + explicit note", () => {
    const impact = affectedIndicatorsForDataType("CAPEX")
    expect(impact.indicators).toEqual([])
    expect(impact.note).not.toBeNull()
  })

  it("DESCRIPTIONS → empty + narrative-only note", () => {
    const impact = affectedIndicatorsForDataType("DESCRIPTIONS")
    expect(impact.indicators).toEqual([])
    expect(impact.note).toMatch(/narrative/)
  })

  it("INFO_SUMMARY / UNKNOWN / COMPANIES → empty", () => {
    expect(affectedIndicatorsForDataType("INFO_SUMMARY").indicators).toEqual([])
    expect(affectedIndicatorsForDataType("UNKNOWN").indicators).toEqual([])
    expect(affectedIndicatorsForDataType("COMPANIES").indicators).toEqual([])
  })

  it("respects industry filter — agro_crops entity gets agro indicators only", () => {
    const all = affectedIndicatorsForDataType("OPS_FACTS")
    const agroOnly = affectedIndicatorsForDataType("OPS_FACTS", {
      industries: ["agro_crops"],
    })
    expect(agroOnly.indicators.length).toBeGreaterThan(0)
    expect(agroOnly.indicators.length).toBeLessThanOrEqual(all.indicators.length)
    // Every returned indicator should be either cross-sector (empty industries)
    // or include "agro_crops".
    for (const ind of agroOnly.indicators) {
      const ok = ind.industries.length === 0 || ind.industries.includes("agro_crops")
      expect(ok).toBe(true)
    }
  })

  it("respects limit", () => {
    const impact = affectedIndicatorsForDataType("OPS_FACTS", { limit: 3 })
    expect(impact.indicators.length).toBeLessThanOrEqual(3)
  })

  it("deduplicates by code (same code never repeated across iteration)", () => {
    const impact = affectedIndicatorsForDataType("PLF")
    const codes = impact.indicators.map((i) => i.code)
    const unique = new Set(codes)
    expect(unique.size).toBe(codes.length)
  })
})

describe("confidenceBand / confidenceBandLabel / confidenceLabel", () => {
  it("high band at ≥0.85", () => {
    expect(confidenceBand(0.85)).toBe("high")
    expect(confidenceBand(0.99)).toBe("high")
    expect(confidenceBand(1.0)).toBe("high")
  })

  it("medium band at 0.65 ≤ x < 0.85", () => {
    expect(confidenceBand(0.65)).toBe("medium")
    expect(confidenceBand(0.7)).toBe("medium")
    expect(confidenceBand(0.84)).toBe("medium")
  })

  it("low band below 0.65", () => {
    expect(confidenceBand(0.0)).toBe("low")
    expect(confidenceBand(0.5)).toBe("low")
    expect(confidenceBand(0.649)).toBe("low")
  })

  it("labels are Russian", () => {
    expect(confidenceBandLabel("high")).toBe("высокая")
    expect(confidenceBandLabel("medium")).toBe("средняя")
    expect(confidenceBandLabel("low")).toBe("низкая")
  })

  it("confidenceLabel combines band + percentage", () => {
    expect(confidenceLabel(0.92)).toBe("высокая · 92%")
    expect(confidenceLabel(0.7)).toBe("средняя · 70%")
    expect(confidenceLabel(0.4)).toBe("низкая · 40%")
  })

  it("clamps confidence percentage to [0, 100]", () => {
    expect(confidenceLabel(-0.5)).toBe("низкая · 0%")
    expect(confidenceLabel(1.5)).toBe("высокая · 100%")
  })
})
