import { describe, it, expect } from "vitest"
import { variance, favorableSign } from "./variance-helpers"

describe("variance", () => {
  it("computes abs and pct for normal case", () => {
    expect(variance(100, 120)).toEqual({ abs: 20, pct: 20 })
    expect(variance(100, 80)).toEqual({ abs: -20, pct: -20 })
  })

  it("handles plan=0 edge case", () => {
    expect(variance(0, 0)).toEqual({ abs: 0, pct: 0 })
    expect(variance(0, 100)).toEqual({ abs: 100, pct: 100 })
    expect(variance(0, -50)).toEqual({ abs: -50, pct: 100 }) // any non-zero actual → 100%
  })

  it("divides by |plan| (negative plan retains positive denominator)", () => {
    // For a revenue contra-account or negative-plan scenario, pct
    // should use the magnitude not the literal value.
    expect(variance(-100, -80)).toEqual({ abs: 20, pct: 20 })
    expect(variance(-100, -120)).toEqual({ abs: -20, pct: -20 })
  })

  it("preserves precision for fractional values", () => {
    const v = variance(1000, 1234)
    expect(v.abs).toBe(234)
    expect(v.pct).toBeCloseTo(23.4, 6)
  })

  it("symmetric: actual=plan → variance zero", () => {
    expect(variance(1500, 1500)).toEqual({ abs: 0, pct: 0 })
  })
})

describe("favorableSign", () => {
  it("returns +1 for revenue accounts", () => {
    expect(favorableSign("revenue")).toBe(1)
  })

  it("returns -1 for expense / cogs / opex / below-ebitda accounts", () => {
    expect(favorableSign("expense")).toBe(-1)
    expect(favorableSign("cogs")).toBe(-1)
    expect(favorableSign("opex")).toBe(-1)
    expect(favorableSign("below-ebitda")).toBe(-1)
  })

  it("defensive default = -1 for unknown / empty / null-like inputs", () => {
    expect(favorableSign("")).toBe(-1)
    expect(favorableSign("unknown")).toBe(-1)
    expect(favorableSign("weird-custom-type")).toBe(-1)
  })

  it("combined with variance: under-spent expense yields +abs after sign", () => {
    // Plan 100K expense, actual 50K (under-spent by 50K).
    // Raw variance.abs = -50K. With expense direction (-1), favorable
    // abs = +50K → green / favorable.
    const v = variance(100_000, 50_000)
    expect(v.abs).toBe(-50_000)
    const sign = favorableSign("expense")
    expect(v.abs * sign).toBe(50_000)
  })

  it("combined with variance: over-realized revenue yields +abs after sign", () => {
    // Plan 1M revenue, actual 1.2M (over-achieved by 200K).
    // Raw variance.abs = +200K. With revenue direction (+1), favorable
    // abs = +200K → green / favorable.
    const v = variance(1_000_000, 1_200_000)
    expect(v.abs).toBe(200_000)
    const sign = favorableSign("revenue")
    expect(v.abs * sign).toBe(200_000)
  })

  it("combined with variance: over-spent expense yields -abs after sign", () => {
    // Plan 100K expense, actual 150K (over-spent by 50K).
    // Raw variance.abs = +50K. With expense direction (-1), favorable
    // abs = -50K → red / unfavorable.
    const v = variance(100_000, 150_000)
    expect(v.abs).toBe(50_000)
    const sign = favorableSign("expense")
    expect(v.abs * sign).toBe(-50_000)
  })
})
