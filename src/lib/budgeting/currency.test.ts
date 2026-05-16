import { describe, it, expect } from "vitest"
import { convertToBase } from "./currency"

/**
 * Pure-helper coverage for currency.ts. The other exports
 * (`getRate`, `getBaseCurrency`, `processCurrencyFields`) require
 * Prisma mocks; those are exercised indirectly through route handler
 * tests (lines/actuals POST routes).
 *
 * `convertToBase` is the only pure function — and it's the value-
 * critical one: every plan / actual amount in a foreign currency
 * routes through it before persistence. A regression here would
 * silently corrupt financial totals.
 */
describe("convertToBase", () => {
  it("converts foreign amount × exchange rate", () => {
    // 100 USD × 1.70 AZN/USD → 170 AZN
    expect(convertToBase(100, 1.70)).toBe(170)
    // 50000 × 0.034 has IEEE-754 noise (1700.0000000000002).
    // Use closeTo so the spec tolerates standard JS floating-point.
    expect(convertToBase(50_000, 0.034)).toBeCloseTo(1700, 4)
  })

  it("returns amount unchanged when rate is null", () => {
    expect(convertToBase(100, null)).toBe(100)
    expect(convertToBase(50_000, null)).toBe(50_000)
  })

  it("returns amount unchanged when rate is undefined", () => {
    expect(convertToBase(100, undefined)).toBe(100)
  })

  it("returns amount unchanged when rate === 1 (shortcut, identical numeric result)", () => {
    expect(convertToBase(100, 1)).toBe(100)
    expect(convertToBase(50_000.555, 1)).toBe(50_000.555)
  })

  it("returns amount unchanged when rate is 0 (falsy guard, treated as no rate)", () => {
    // 0 is falsy → caller likely didn't fetch a real rate → safest
    // behaviour is "no-op" rather than zeroing the amount.
    expect(convertToBase(100, 0)).toBe(100)
  })

  it("handles zero amount cleanly (× any non-1 rate is 0)", () => {
    expect(convertToBase(0, 1.70)).toBe(0)
    expect(convertToBase(0, 0.034)).toBe(0)
  })

  it("handles negative amounts (refunds / credit notes)", () => {
    // 100 USD refund × 1.70 → -170 AZN
    expect(convertToBase(-100, 1.70)).toBe(-170)
  })

  it("preserves precision for fractional amounts + rates", () => {
    // 1234.56 EUR × 1.875 AZN/EUR → 2314.8
    expect(convertToBase(1234.56, 1.875)).toBeCloseTo(2314.8, 4)
  })
})
