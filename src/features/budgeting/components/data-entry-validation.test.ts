import { describe, it, expect } from "vitest"
import { checkMetricValue } from "./data-entry-validation"
import type { MetricValidationRule } from "@/lib/risk/metric-validation-rules"

const rule = (over: Partial<MetricValidationRule> = {}): MetricValidationRule => ({
  metric: "yield_per_ha",
  unit: "tons/ha",
  min: 0,
  max: 200,
  warnMin: 5,
  warnMax: 100,
  anomalyDeltaPct: 100,
  sector: "agro",
  labelEn: "Yield",
  labelRu: "Урожайность",
  labelAz: "Məhsuldarlıq",
  ...over,
})

describe("checkMetricValue", () => {
  it("empty / whitespace → empty (no feedback shown)", () => {
    expect(checkMetricValue(rule(), "")).toEqual({ state: "empty" })
    expect(checkMetricValue(rule(), "   ")).toEqual({ state: "empty" })
  })

  it("non-numeric → nan", () => {
    expect(checkMetricValue(rule(), "abc")).toEqual({ state: "nan" })
  })

  it("within the typical band → ok", () => {
    expect(checkMetricValue(rule(), "50")).toEqual({ state: "ok" })
  })

  it("below the hard min → error (low)", () => {
    expect(checkMetricValue(rule(), "-1")).toEqual({
      state: "error",
      bound: 0,
      dir: "low",
    })
  })

  it("above the hard max → error (high)", () => {
    expect(checkMetricValue(rule(), "250")).toEqual({
      state: "error",
      bound: 200,
      dir: "high",
    })
  })

  it("below the soft warn min → warn (low)", () => {
    expect(checkMetricValue(rule(), "3")).toEqual({
      state: "warn",
      bound: 5,
      dir: "low",
    })
  })

  it("above the soft warn max → warn (high)", () => {
    expect(checkMetricValue(rule(), "150")).toEqual({
      state: "warn",
      bound: 100,
      dir: "high",
    })
  })

  it("no soft bounds → ok anywhere within hard bounds", () => {
    const r = rule({ warnMin: null, warnMax: null })
    expect(checkMetricValue(r, "3")).toEqual({ state: "ok" })
    expect(checkMetricValue(r, "150")).toEqual({ state: "ok" })
  })

  it("hard bound takes priority over soft bound", () => {
    // 7 is inside [warnMin 5, warnMax 100] but below hard min 10 → error, not warn
    expect(checkMetricValue(rule({ min: 10 }), "7")).toEqual({
      state: "error",
      bound: 10,
      dir: "low",
    })
  })
})
