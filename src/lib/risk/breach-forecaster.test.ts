// @vitest-environment node
/**
 * Phase 7.G Turn LXXXXVII (Phase 7.E #3 v2 E.2a) — breach-forecaster tests.
 */

import { describe, it, expect } from "vitest"
import {
  forecastBreach,
  scanForBreaches,
  isWorsening,
  deriveConfidenceBand,
  DEFAULT_BREACH_HORIZON_STEPS,
  MAX_BREACH_HORIZON_STEPS,
  type BreachForecasterInput,
} from "./breach-forecaster"
import type { Thresholds } from "./formula-engine"

// Higher-better thresholds: green ≥80, amber ≥60, red <60
const THRESH_HIGHER_BETTER: Thresholds = {
  green: { op: ">=", value: 80 },
  amber: { op: ">=", value: 60 },
  red: { op: "<", value: 60 },
}

// Lower-better thresholds: green ≤20, amber ≤40, red >40
const THRESH_LOWER_BETTER: Thresholds = {
  green: { op: "<=", value: 20 },
  amber: { op: "<=", value: 40 },
  red: { op: ">", value: 40 },
}

const baseInput = (overrides: Partial<BreachForecasterInput> = {}): BreachForecasterInput => ({
  indicatorCode: "REV_GROWTH",
  companyId: "co_aac",
  period: "2026-Q1",
  sparkline: [90, 85, 82, 79, 76, 73, 70],
  thresholds: THRESH_HIGHER_BETTER,
  currentStatus: "amber",
  ...overrides,
})

describe("isWorsening — transition matrix", () => {
  it("green → amber/red/unknown = worsening", () => {
    expect(isWorsening("green", "amber")).toBe(true)
    expect(isWorsening("green", "red")).toBe(true)
    expect(isWorsening("green", "unknown")).toBe(true)
    expect(isWorsening("green", "green")).toBe(false)
  })

  it("amber → red/unknown = worsening; amber → green = improving", () => {
    expect(isWorsening("amber", "red")).toBe(true)
    expect(isWorsening("amber", "unknown")).toBe(true)
    expect(isWorsening("amber", "green")).toBe(false)
    expect(isWorsening("amber", "amber")).toBe(false)
  })

  it("red → anything = NOT worsening (already at floor)", () => {
    expect(isWorsening("red", "amber")).toBe(false)
    expect(isWorsening("red", "green")).toBe(false)
    expect(isWorsening("red", "red")).toBe(false)
    expect(isWorsening("red", "unknown")).toBe(false)
  })

  it("unknown → anything = NOT worsening (ambiguous baseline)", () => {
    expect(isWorsening("unknown", "red")).toBe(false)
    expect(isWorsening("unknown", "green")).toBe(false)
  })
})

describe("deriveConfidenceBand — horizon-step degrade", () => {
  it("step 1: passes through fit confidence unchanged", () => {
    expect(deriveConfidenceBand("high", 1)).toBe("high")
    expect(deriveConfidenceBand("medium", 1)).toBe("medium")
    expect(deriveConfidenceBand("low", 1)).toBe("low")
  })

  it("step 3: caps high → medium", () => {
    expect(deriveConfidenceBand("high", 3)).toBe("medium")
    expect(deriveConfidenceBand("medium", 3)).toBe("medium")
    expect(deriveConfidenceBand("low", 3)).toBe("low")
  })

  it("step 6: floors all to low", () => {
    expect(deriveConfidenceBand("high", 6)).toBe("low")
    expect(deriveConfidenceBand("medium", 6)).toBe("low")
    expect(deriveConfidenceBand("low", 6)).toBe("low")
  })
})

describe("forecastBreach — single IV", () => {
  it("declining higher-better trend → emits worsening breach (green→amber)", () => {
    // green→amber boundary at value=80; sparkline 100→95→90→85 trending toward amber
    const input = baseInput({
      sparkline: [100, 95, 90, 85, 82, 80, 78],
      currentStatus: "green",
    })
    const breaches = forecastBreach(input)
    expect(breaches.length).toBeGreaterThan(0)
    expect(breaches[0].currentStatus).toBe("green")
    // Predicted should be < 80 → amber or worse
    for (const b of breaches) {
      expect(["amber", "red", "unknown"]).toContain(b.predictedStatus)
    }
  })

  it("declining higher-better → projects multiple horizon steps (default 3)", () => {
    const input = baseInput({
      sparkline: [100, 95, 90, 85, 82, 80, 78],
      currentStatus: "green",
    })
    const breaches = forecastBreach(input)
    expect(breaches.length).toBeLessThanOrEqual(DEFAULT_BREACH_HORIZON_STEPS)
    // Steps should be unique + ascending
    const steps = breaches.map((b) => b.horizonStep)
    expect(new Set(steps).size).toBe(steps.length)
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]).toBeGreaterThan(steps[i - 1])
    }
  })

  it("stable trend → no breaches (no worsening transition)", () => {
    const input = baseInput({
      sparkline: [85, 86, 85, 84, 86, 85, 85],
      currentStatus: "green",
    })
    const breaches = forecastBreach(input)
    expect(breaches.length).toBe(0)
  })

  it("improving trend → no breaches (improving = not worsening)", () => {
    // currentStatus=amber, climbing back toward green — no breach worth flagging
    const input = baseInput({
      sparkline: [60, 65, 70, 75, 80, 82, 85],
      currentStatus: "amber",
    })
    const breaches = forecastBreach(input)
    expect(breaches.length).toBe(0)
  })

  it("currentStatus='red' → never emits breach (already at floor)", () => {
    const input = baseInput({
      sparkline: [50, 45, 40, 35, 30, 25, 20], // worsening but already red
      currentStatus: "red",
    })
    const breaches = forecastBreach(input)
    expect(breaches.length).toBe(0)
  })

  it("insufficient history (<3 points) → empty result, no throw", () => {
    const input = baseInput({
      sparkline: [80, 75],
      currentStatus: "green",
    })
    const breaches = forecastBreach(input)
    expect(breaches).toEqual([])
  })

  it("custom horizon=1 → at most 1 step", () => {
    const input = baseInput({
      sparkline: [100, 95, 90, 85, 82, 80, 78],
      currentStatus: "green",
    })
    const breaches = forecastBreach(input, { horizonSteps: 1 })
    expect(breaches.length).toBeLessThanOrEqual(1)
  })

  it("rejects horizonSteps out of [1, MAX_BREACH_HORIZON_STEPS]", () => {
    const input = baseInput()
    expect(() => forecastBreach(input, { horizonSteps: 0 })).toThrow(/must be in/)
    expect(() => forecastBreach(input, { horizonSteps: MAX_BREACH_HORIZON_STEPS + 1 })).toThrow(/must be in/)
  })

  it("forecastConfidence is numeric in [0,1]", () => {
    const input = baseInput({
      sparkline: [100, 95, 90, 85, 82, 80, 78],
      currentStatus: "green",
    })
    const breaches = forecastBreach(input)
    for (const b of breaches) {
      expect(b.forecastConfidence).toBeGreaterThanOrEqual(0)
      expect(b.forecastConfidence).toBeLessThanOrEqual(1)
    }
  })

  it("threads drivers through to output (caller-shaped)", () => {
    const input = baseInput({
      sparkline: [100, 95, 90, 85, 82, 80, 78],
      currentStatus: "green",
      drivers: { topDriver: "competitor_pricing", magnitude: 0.8 },
    })
    const breaches = forecastBreach(input)
    expect(breaches[0]?.drivers).toMatchObject({ topDriver: "competitor_pricing", magnitude: 0.8 })
  })
})

describe("forecastBreach — lower-better direction", () => {
  it("rising lower-better → emits breach (green→amber→red)", () => {
    // Indicator like CHURN_RATE: lower is better. Series climbing toward red.
    const input = baseInput({
      sparkline: [10, 15, 18, 22, 28, 35, 42],
      thresholds: THRESH_LOWER_BETTER,
      currentStatus: "amber", // currently in 21-40 range
    })
    const breaches = forecastBreach(input)
    expect(breaches.length).toBeGreaterThan(0)
    for (const b of breaches) {
      expect(b.currentStatus).toBe("amber")
      // Predicted should be >40 → red
      expect(["red"]).toContain(b.predictedStatus)
    }
  })

  it("falling lower-better → no breach (improving)", () => {
    const input = baseInput({
      sparkline: [50, 45, 40, 35, 30, 25, 20],
      thresholds: THRESH_LOWER_BETTER,
      currentStatus: "amber",
    })
    const breaches = forecastBreach(input)
    expect(breaches.length).toBe(0)
  })
})

describe("scanForBreaches — multi-IV aggregation", () => {
  it("aggregates breaches across multiple IVs", () => {
    const inputs: BreachForecasterInput[] = [
      baseInput({
        companyId: "co_a",
        sparkline: [100, 95, 90, 85, 82, 80, 78],
        currentStatus: "green",
      }),
      baseInput({
        companyId: "co_b",
        sparkline: [85, 86, 85, 84, 86, 85, 85], // stable — no breach
        currentStatus: "green",
      }),
      baseInput({
        companyId: "co_c",
        sparkline: [10, 15, 18, 22, 28, 35, 42],
        thresholds: THRESH_LOWER_BETTER,
        currentStatus: "amber",
      }),
    ]
    const result = scanForBreaches(inputs)
    expect(result.stats.ivsScanned).toBe(3)
    expect(result.stats.ivsWithSufficientHistory).toBe(3)
    // co_a + co_c should produce breaches; co_b should not
    const companyIds = new Set(result.breaches.map((b) => b.companyId))
    expect(companyIds.has("co_a")).toBe(true)
    expect(companyIds.has("co_c")).toBe(true)
    expect(companyIds.has("co_b")).toBe(false)
  })

  it("counts IVs without sufficient history correctly", () => {
    const inputs: BreachForecasterInput[] = [
      baseInput({ companyId: "co_a" }),
      baseInput({ companyId: "co_b", sparkline: [80, 75] }), // <3 points
      baseInput({ companyId: "co_c", sparkline: [] }), // empty
    ]
    const result = scanForBreaches(inputs)
    expect(result.stats.ivsScanned).toBe(3)
    expect(result.stats.ivsWithSufficientHistory).toBe(1) // only co_a
  })

  it("zero inputs → zero breaches, zero errors", () => {
    const result = scanForBreaches([])
    expect(result.breaches).toEqual([])
    expect(result.stats.ivsScanned).toBe(0)
    expect(result.stats.errors).toEqual([])
  })

  it("errored IV recorded but doesn't abort scan", () => {
    const inputs: BreachForecasterInput[] = [
      baseInput({ companyId: "co_a" }),
      baseInput({ companyId: "co_b" }),
    ]
    // Force throw via invalid horizonSteps
    const result = scanForBreaches(inputs, { horizonSteps: 99 })
    expect(result.stats.errors.length).toBe(2)
    expect(result.stats.errors[0]).toContain("co_a/REV_GROWTH")
  })
})
