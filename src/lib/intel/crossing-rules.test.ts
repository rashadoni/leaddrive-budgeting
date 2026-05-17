/**
 * Phase 7.L — crossing-rules engine + default-pack unit tests.
 *
 * Locks the 5 default rules semantics:
 *   - FAO > 130 → warning
 *   - Brent > $100 → warning
 *   - Brent < $60 → warning
 *   - AZN/USD 7d shift > 2% → critical
 *   - AZ Food CPI YoY > 107 → warning
 *
 * No I/O — pure fixture-driven.
 */
import { describe, it, expect } from "vitest"
import {
  evaluateCrossingRules,
  getSeries,
  pointAtLookback,
  type CrossingContext,
  type CrossingDataPoint,
} from "./crossing-rules"
import { DEFAULT_CROSSING_RULES } from "./crossing-rules-default-pack"

const ORG = "org_test"

function makePoint(
  sourceCode: string,
  metric: string,
  value: number,
  daysAgo = 0,
): CrossingDataPoint {
  const dt = new Date()
  dt.setUTCHours(0, 0, 0, 0)
  dt.setUTCDate(dt.getUTCDate() - daysAgo)
  return { sourceCode, metric, datetime: dt, value }
}

function makeCtx(points: CrossingDataPoint[]): CrossingContext {
  return { organizationId: ORG, points }
}

describe("getSeries", () => {
  it("returns newest-first sorted points filtered by (source, metric)", () => {
    const ctx = makeCtx([
      makePoint("fao-food-prices", "FAO_FFPI_NOMINAL", 125, 2),
      makePoint("fao-food-prices", "FAO_FFPI_NOMINAL", 130, 0),
      makePoint("fao-food-prices", "FAO_FFPI_NOMINAL", 128, 1),
      makePoint("eia-energy", "BRENT_USD_BBL", 95, 0), // different metric — filtered out
    ])
    const series = getSeries(ctx, "fao-food-prices", "FAO_FFPI_NOMINAL")
    expect(series.length).toBe(3)
    expect(series[0].value).toBe(130) // newest first
    expect(series[1].value).toBe(128)
    expect(series[2].value).toBe(125)
  })

  it("returns empty array for unknown source/metric pair", () => {
    const ctx = makeCtx([makePoint("fao-food-prices", "FAO_FFPI_NOMINAL", 130)])
    expect(getSeries(ctx, "eia-energy", "BRENT_USD_BBL")).toEqual([])
  })
})

describe("pointAtLookback", () => {
  it("finds point ~7 days ago within tolerance", () => {
    const latest = makePoint("cbar-official-fx", "AZN_USD", 1.74, 0)
    const series = [
      latest,
      makePoint("cbar-official-fx", "AZN_USD", 1.72, 1),
      makePoint("cbar-official-fx", "AZN_USD", 1.70, 7),
      makePoint("cbar-official-fx", "AZN_USD", 1.69, 14),
    ]
    const prior = pointAtLookback(series, latest, 7, 2)
    expect(prior).toBeTruthy()
    expect(prior!.value).toBe(1.70)
  })

  it("returns null when series too sparse", () => {
    const latest = makePoint("cbar-official-fx", "AZN_USD", 1.74, 0)
    const series = [latest]
    expect(pointAtLookback(series, latest, 7, 2)).toBeNull()
  })

  it("returns null when no point within tolerance window", () => {
    const latest = makePoint("cbar-official-fx", "AZN_USD", 1.74, 0)
    const series = [
      latest,
      makePoint("cbar-official-fx", "AZN_USD", 1.69, 14), // 14d ago, tolerance only 2d
    ]
    expect(pointAtLookback(series, latest, 7, 2)).toBeNull()
  })
})

describe("evaluateCrossingRules — DEFAULT_CROSSING_RULES", () => {
  it("FAO above 130 triggers warning", () => {
    const ctx = makeCtx([
      makePoint("fao-food-prices", "FAO_FFPI_NOMINAL", 132, 0),
      makePoint("fao-food-prices", "FAO_FFPI_NOMINAL", 125, 30),
    ])
    const matches = evaluateCrossingRules(DEFAULT_CROSSING_RULES, ctx)
    const fao = matches.find((m) => m.ruleId === "fao-above-130")
    expect(fao).toBeTruthy()
    expect(fao!.severity).toBe("warning")
    expect(fao!.triggerValue).toBe(132)
    expect(fao!.baselineValue).toBe(125)
  })

  it("FAO at 128 does NOT trigger (below 130 threshold)", () => {
    const ctx = makeCtx([
      makePoint("fao-food-prices", "FAO_FFPI_NOMINAL", 128, 0),
    ])
    const matches = evaluateCrossingRules(DEFAULT_CROSSING_RULES, ctx)
    expect(matches.find((m) => m.ruleId === "fao-above-130")).toBeUndefined()
  })

  it("Brent above $100 triggers warning", () => {
    const ctx = makeCtx([
      makePoint("eia-energy", "BRENT_USD_BBL", 105.88, 0),
      makePoint("eia-energy", "BRENT_USD_BBL", 92.0, 30),
    ])
    const matches = evaluateCrossingRules(DEFAULT_CROSSING_RULES, ctx)
    const brent = matches.find((m) => m.ruleId === "brent-above-100")
    expect(brent).toBeTruthy()
    expect(brent!.triggerValue).toBe(105.88)
  })

  it("Brent below $60 triggers warning (inverse signal)", () => {
    const ctx = makeCtx([
      makePoint("eia-energy", "BRENT_USD_BBL", 55, 0),
      makePoint("eia-energy", "BRENT_USD_BBL", 75, 30),
    ])
    const matches = evaluateCrossingRules(DEFAULT_CROSSING_RULES, ctx)
    const low = matches.find((m) => m.ruleId === "brent-below-60")
    expect(low).toBeTruthy()
  })

  it("Brent at $80 — neither above-100 nor below-60 fires", () => {
    const ctx = makeCtx([makePoint("eia-energy", "BRENT_USD_BBL", 80, 0)])
    const matches = evaluateCrossingRules(DEFAULT_CROSSING_RULES, ctx)
    expect(matches.filter((m) => m.metric === "BRENT_USD_BBL")).toHaveLength(0)
  })

  it("AZN/USD shift > 2% over 7 days triggers critical", () => {
    const ctx = makeCtx([
      makePoint("cbar-official-fx", "AZN_USD", 1.74, 0),
      makePoint("cbar-official-fx", "AZN_USD", 1.70, 7),
    ])
    const matches = evaluateCrossingRules(DEFAULT_CROSSING_RULES, ctx)
    const fx = matches.find((m) => m.ruleId === "azn-usd-7d-shift-2pct")
    expect(fx).toBeTruthy()
    expect(fx!.severity).toBe("critical")
    expect(fx!.deltaPct).toBeCloseTo(2.35, 1)
  })

  it("AZN/USD shift of 1% does NOT trigger", () => {
    const ctx = makeCtx([
      makePoint("cbar-official-fx", "AZN_USD", 1.717, 0),
      makePoint("cbar-official-fx", "AZN_USD", 1.70, 7),
    ])
    const matches = evaluateCrossingRules(DEFAULT_CROSSING_RULES, ctx)
    expect(matches.find((m) => m.ruleId === "azn-usd-7d-shift-2pct")).toBeUndefined()
  })

  it("AZ Food CPI YoY > 107 triggers warning", () => {
    const ctx = makeCtx([
      makePoint("az-stat-cpi", "AZ_CPI_FOOD", 108.5, 0),
      makePoint("az-stat-cpi", "AZ_CPI_FOOD", 105.5, 30),
    ])
    const matches = evaluateCrossingRules(DEFAULT_CROSSING_RULES, ctx)
    expect(matches.find((m) => m.ruleId === "az-cpi-food-yoy-above-7pct")).toBeTruthy()
  })

  it("Empty context — zero matches", () => {
    expect(evaluateCrossingRules(DEFAULT_CROSSING_RULES, makeCtx([]))).toEqual([])
  })

  it("Multiple breaches — sorted by severity then priority", () => {
    const ctx = makeCtx([
      makePoint("cbar-official-fx", "AZN_USD", 1.74, 0),
      makePoint("cbar-official-fx", "AZN_USD", 1.70, 7),
      makePoint("fao-food-prices", "FAO_FFPI_NOMINAL", 132, 0),
      makePoint("eia-energy", "BRENT_USD_BBL", 110, 0),
    ])
    const matches = evaluateCrossingRules(DEFAULT_CROSSING_RULES, ctx)
    expect(matches.length).toBe(3)
    // critical (FX shift) first, then warnings in priority order (FAO p20, Brent p30)
    expect(matches[0].severity).toBe("critical")
    expect(matches[0].ruleId).toBe("azn-usd-7d-shift-2pct")
    expect(matches[1].ruleId).toBe("fao-above-130")
    expect(matches[2].ruleId).toBe("brent-above-100")
  })

  it("Message + messageParams shape consistent", () => {
    const ctx = makeCtx([
      makePoint("fao-food-prices", "FAO_FFPI_NOMINAL", 132, 0),
    ])
    const matches = evaluateCrossingRules(DEFAULT_CROSSING_RULES, ctx)
    const m = matches[0]
    expect(m.message).toContain("132")
    expect(m.messageKey).toBe("fao-above-130")
    expect(m.messageParams.value).toBe("132.0")
  })
})
