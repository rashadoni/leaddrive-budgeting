/**
 * Unit tests for TodayBrief pure-function helpers.
 * Focus: Fix A (extreme % artifact filter) + Fix C (macro signal prefix filter).
 */
import { describe, it, expect } from "vitest"
import { pickTopWorstDiversified, detectBroadcastIndicators } from "./TodayBrief"

const entry = (
  companyCode: string,
  indicatorCode: string,
  value: number,
  unit = "%",
) => ({ companyCode, indicatorCode, indicatorName: indicatorCode, value, unit })

describe("pickTopWorstDiversified", () => {
  it("Fix A: excludes |%| > 300 artifacts (e.g. EBITDA -3188%)", () => {
    const items = [
      entry("EDEN", "IND_EBITDA_MARGIN", -3188.1, "%"),
      entry("MALT", "IND_OPEX_RATIO", 114.9, "%"),
    ]
    const result = pickTopWorstDiversified(items, 5)
    expect(result.map((r) => r.companyCode)).not.toContain("EDEN")
    expect(result.map((r) => r.companyCode)).toContain("MALT")
  })

  it("Fix A: keeps |%| <= 300 (legitimate problem, not artifact)", () => {
    const items = [entry("MALT", "IND_OPEX_RATIO", -299.9, "%")]
    const result = pickTopWorstDiversified(items, 5)
    expect(result).toHaveLength(1)
  })

  it("Fix A: non-% units are never filtered by the % rule", () => {
    const items = [entry("HORIZON", "SERV_AZ_TRADE_BAL", -23_000_000_000, "USD")]
    // Excluded by Fix C (SERV_AZ_ prefix), not Fix A
    const result = pickTopWorstDiversified(items, 5)
    expect(result).toHaveLength(0) // caught by C
  })

  it("Fix C: excludes SERV_AZ_ macro signal prefix", () => {
    const items = [
      entry("HORIZON", "SERV_AZ_TRADE_BALANCE_SIGNAL", -23_000_000_000, "USD"),
      entry("MALT", "IND_OPEX_RATIO", 114.9, "%"),
    ]
    const result = pickTopWorstDiversified(items, 5)
    expect(result.map((r) => r.indicatorCode)).not.toContain(
      "SERV_AZ_TRADE_BALANCE_SIGNAL",
    )
    expect(result.map((r) => r.companyCode)).toContain("MALT")
  })

  it("Fix C: excludes AZ_MACRO_ and COUNTRY_ prefixes", () => {
    const items = [
      entry("CO1", "AZ_MACRO_CPI", -5, "%"),
      entry("CO2", "COUNTRY_RISK_SCORE", -80, "score"),
      entry("MALT", "IND_NET_MARGIN", -12, "%"),
    ]
    const result = pickTopWorstDiversified(items, 5)
    const codes = result.map((r) => r.indicatorCode)
    expect(codes).not.toContain("AZ_MACRO_CPI")
    expect(codes).not.toContain("COUNTRY_RISK_SCORE")
    expect(codes).toContain("IND_NET_MARGIN")
  })

  it("broadcast set filter still works alongside new filters", () => {
    const items = [
      entry("CO1", "BROADCAST_IND", -50, "%"),
      entry("CO2", "BROADCAST_IND", -50, "%"),
      entry("MALT", "IND_OPEX_RATIO", 114.9, "%"),
    ]
    const broadcast = new Set(["BROADCAST_IND"])
    const result = pickTopWorstDiversified(items, 5, broadcast)
    expect(result.map((r) => r.indicatorCode)).not.toContain("BROADCAST_IND")
    expect(result).toHaveLength(1)
  })
})

describe("detectBroadcastIndicators", () => {
  it("flags indicator when same value appears in >= 3 companies", () => {
    const cells = [
      { indicatorId: "i1", value: -23_000_000_000 },
      { indicatorId: "i1", value: -23_000_000_000 },
      { indicatorId: "i1", value: -23_000_000_000 },
    ]
    const indicators = [{ id: "i1", code: "TRADE_BALANCE" }]
    const result = detectBroadcastIndicators(cells, indicators)
    expect(result.has("TRADE_BALANCE")).toBe(true)
  })

  it("does NOT flag indicator unique to < 3 companies", () => {
    const cells = [
      { indicatorId: "i1", value: 100 },
      { indicatorId: "i1", value: 200 }, // different values, 2 companies
    ]
    const indicators = [{ id: "i1", code: "COMPANY_SPECIFIC" }]
    const result = detectBroadcastIndicators(cells, indicators)
    expect(result.has("COMPANY_SPECIFIC")).toBe(false)
  })
})
