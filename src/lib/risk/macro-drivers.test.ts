// @vitest-environment node
/**
 * Phase 7.G Turn CVI (Phase 7.E #3 v2 E.2c slice 2) — macro-drivers tests.
 */

import { describe, it, expect } from "vitest"
import {
  resolveMacroDrivers,
  alignMacroSeriesByIndex,
  getMacroDriverRulesForTests,
} from "./macro-drivers"

describe("resolveMacroDrivers — pattern-matched indicator → macro metric mapping", () => {
  it.each([
    ["IND_REVENUE_TOTAL", ["AZN_USD"]],
    ["IND_HOLDING_REVENUE", ["AZN_USD"]],
    ["HOSP_REVPAR", ["AZN_USD"]],
    ["REV_GROWTH", ["AZN_USD"]],
  ])("revenue-class indicator %s → AZN_USD", (code, expected) => {
    expect(resolveMacroDrivers(code)).toEqual(expected)
  })

  it.each([
    ["IND_GROSS_MARGIN", ["AZN_USD", "BRENT_USD_BBL"]],
    ["IND_NET_MARGIN", ["AZN_USD", "BRENT_USD_BBL"]],
    ["SVC_GROSS_MARGIN", ["AZN_USD", "BRENT_USD_BBL"]],
    ["PHARMA_NET_MARGIN", ["AZN_USD", "BRENT_USD_BBL"]],
  ])("margin-class indicator %s → FX + Brent", (code, expected) => {
    expect(resolveMacroDrivers(code)).toEqual(expected)
  })

  it.each([
    ["IND_OPEX_RATIO", ["AZ_CPI_YOY"]],
    ["SVC_OPEX_RATIO", ["AZ_CPI_YOY"]],
    ["PHARMA_OPEX_RATIO", ["AZ_CPI_YOY"]],
  ])("opex-ratio indicator %s → CPI", (code, expected) => {
    expect(resolveMacroDrivers(code)).toEqual(expected)
  })

  it.each([
    ["HOSP_FX_EXPOSURE", ["AZN_USD"]],
    ["IND_FX_EXPOSURE", ["AZN_USD"]],
  ])("FX exposure indicator %s → FX (direct)", (code, expected) => {
    expect(resolveMacroDrivers(code)).toEqual(expected)
  })

  it.each([
    ["POULTRY_FEED_COST_SHARE", ["AZN_USD", "BRENT_USD_BBL"]],
    ["IND_COGS_RATIO", ["AZN_USD", "BRENT_USD_BBL"]],
  ])("cost-share / COGS indicator %s → FX + Brent", (code, expected) => {
    expect(resolveMacroDrivers(code)).toEqual(expected)
  })

  it("returns empty array for unmatched indicator codes", () => {
    expect(resolveMacroDrivers("HOSP_OCCUPANCY")).toEqual([])
    expect(resolveMacroDrivers("UNKNOWN_INDICATOR")).toEqual([])
    expect(resolveMacroDrivers("")).toEqual([])
  })

  it("ENT_REVENUE_PER_VISIT matches revenue-class (FX-sensitive: foreign tourist USD)", () => {
    // Revenue-per-visit is FX-relevant when foreign tourists pay in USD/EUR.
    // Pattern is (?:^|_)REVENUE so `_REVENUE_` substring matches → AZN_USD.
    expect(resolveMacroDrivers("ENT_REVENUE_PER_VISIT")).toEqual(["AZN_USD"])
  })

  it("doesn't false-match indicators with substring overlap", () => {
    // E.g. an indicator named UNRELATED_NETWORK_GROWTH should NOT match
    // any margin / revenue / opex / FX rule because none of the boundary
    // patterns are present.
    expect(resolveMacroDrivers("UNRELATED_NETWORK_GROWTH")).toEqual([])
  })

  it("rule list is exposed for testing + extension", () => {
    const rules = getMacroDriverRulesForTests()
    expect(rules.length).toBeGreaterThan(0)
    expect(rules[0].drivers.length).toBeGreaterThan(0)
    for (const rule of rules) {
      expect(rule.pattern).toBeInstanceOf(RegExp)
      expect(Array.isArray(rule.drivers)).toBe(true)
    }
  })
})

describe("alignMacroSeriesByIndex — right-align with null pad", () => {
  const dt = (iso: string) => new Date(iso)

  it("returns all-null series of correct length when input is empty", () => {
    expect(alignMacroSeriesByIndex([], 5)).toEqual([null, null, null, null, null])
  })

  it("returns empty array when sparklineLength is 0", () => {
    expect(alignMacroSeriesByIndex([{ datetime: dt("2026-05-01"), value: 1 }], 0)).toEqual([])
  })

  it("right-aligns when input shorter than sparklineLength (front-pads with nulls)", () => {
    const result = alignMacroSeriesByIndex(
      [
        { datetime: dt("2026-04-01"), value: 9.5 },
        { datetime: dt("2026-05-01"), value: 9.7 },
      ],
      5,
    )
    expect(result).toEqual([null, null, null, 9.5, 9.7])
  })

  it("returns input as-is when length equals sparklineLength", () => {
    const result = alignMacroSeriesByIndex(
      [
        { datetime: dt("2026-03-01"), value: 1 },
        { datetime: dt("2026-04-01"), value: 2 },
        { datetime: dt("2026-05-01"), value: 3 },
      ],
      3,
    )
    expect(result).toEqual([1, 2, 3])
  })

  it("caps to last N points when input longer than sparklineLength", () => {
    const result = alignMacroSeriesByIndex(
      [
        { datetime: dt("2026-01-01"), value: 1 },
        { datetime: dt("2026-02-01"), value: 2 },
        { datetime: dt("2026-03-01"), value: 3 },
        { datetime: dt("2026-04-01"), value: 4 },
        { datetime: dt("2026-05-01"), value: 5 },
      ],
      3,
    )
    expect(result).toEqual([3, 4, 5]) // last 3
  })

  it("sorts unsorted input by datetime ascending before slicing", () => {
    const result = alignMacroSeriesByIndex(
      [
        { datetime: dt("2026-05-01"), value: 50 },
        { datetime: dt("2026-01-01"), value: 10 },
        { datetime: dt("2026-03-01"), value: 30 },
      ],
      3,
    )
    expect(result).toEqual([10, 30, 50])
  })

  it("preserves duplicate datetimes (stable on tie)", () => {
    const a = { datetime: dt("2026-05-01"), value: 1 }
    const b = { datetime: dt("2026-05-01"), value: 2 }
    const c = { datetime: dt("2026-05-01"), value: 3 }
    const result = alignMacroSeriesByIndex([a, b, c], 3)
    // Either order is acceptable for ties; check all 3 values present
    expect(result.length).toBe(3)
    expect(new Set(result)).toEqual(new Set([1, 2, 3]))
  })

  it("does NOT mutate the input array", () => {
    const input = [
      { datetime: dt("2026-05-01"), value: 5 },
      { datetime: dt("2026-01-01"), value: 1 },
    ]
    const original = [...input]
    alignMacroSeriesByIndex(input, 3)
    expect(input).toEqual(original)
  })
})
