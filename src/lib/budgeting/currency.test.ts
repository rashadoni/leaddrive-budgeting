import { describe, it, expect, vi, beforeEach } from "vitest"
import { convertToBase, getRate, getBaseCurrency, processCurrencyFields } from "./currency"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    currencyRateHistory: {
      findFirst: vi.fn(),
    },
    currency: {
      findFirst: vi.fn(),
    },
  },
}))

import { prisma } from "@/lib/prisma"

type MockFn = { mockResolvedValue: (v: unknown) => void; mockReset: () => void }

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

  it("rejects null or undefined rate instead of fabricating a 1:1 conversion", () => {
    expect(() => convertToBase(100, null)).toThrow(/finite positive exchange rate/i)
    expect(() => convertToBase(100, undefined)).toThrow(/finite positive exchange rate/i)
  })

  it("returns amount unchanged when rate === 1 (shortcut, identical numeric result)", () => {
    expect(convertToBase(100, 1)).toBe(100)
    expect(convertToBase(50_000.555, 1)).toBe(50_000.555)
  })

  it("rejects non-positive and non-finite rates", () => {
    expect(() => convertToBase(100, 0)).toThrow(/finite positive exchange rate/i)
    expect(() => convertToBase(100, -1)).toThrow(/finite positive exchange rate/i)
    expect(() => convertToBase(100, Number.NaN)).toThrow(/finite positive exchange rate/i)
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

describe("getRate (Prisma-bound)", () => {
  beforeEach(() => {
    ;(prisma.currencyRateHistory.findFirst as unknown as MockFn).mockReset()
    ;(prisma.currency.findFirst as unknown as MockFn).mockReset()
  })

  it("returns latest history rate when present", async () => {
    ;(prisma.currencyRateHistory.findFirst as unknown as MockFn).mockResolvedValue({ rate: 1.72 })
    expect(await getRate("org1", "USD")).toBe(1.72)
    // Falls through to currency table only if history is empty
    expect(prisma.currency.findFirst).not.toHaveBeenCalled()
  })

  it("returns null when no historical rate exists (does not use Currency table fallback)", async () => {
    ;(prisma.currencyRateHistory.findFirst as unknown as MockFn).mockResolvedValue(null)
    ;(prisma.currency.findFirst as unknown as MockFn).mockResolvedValue({ exchangeRate: 1.65 })
    expect(await getRate("org1", "EUR")).toBeNull()
    expect(prisma.currency.findFirst).not.toHaveBeenCalled()
  })

  it("returns null for an invalid historical rate", async () => {
    ;(prisma.currencyRateHistory.findFirst as unknown as MockFn).mockResolvedValue({ rate: 0 })
    expect(await getRate("org1", "XYZ")).toBeNull()
  })

  it("returns null when no rate record exists", async () => {
    ;(prisma.currencyRateHistory.findFirst as unknown as MockFn).mockResolvedValue(null)
    expect(await getRate("org1", "XYZ")).toBeNull()
  })
})

describe("getBaseCurrency (Prisma-bound)", () => {
  beforeEach(() => {
    ;(prisma.currency.findFirst as unknown as MockFn).mockReset()
  })

  it("returns base currency code from Currency table", async () => {
    ;(prisma.currency.findFirst as unknown as MockFn).mockResolvedValue({ code: "USD" })
    expect(await getBaseCurrency("org1")).toBe("USD")
  })

  it("defaults to AZN when no base currency set", async () => {
    ;(prisma.currency.findFirst as unknown as MockFn).mockResolvedValue(null)
    expect(await getBaseCurrency("org1")).toBe("AZN")
  })
})

describe("processCurrencyFields (Prisma-bound)", () => {
  beforeEach(() => {
    ;(prisma.currencyRateHistory.findFirst as unknown as MockFn).mockReset()
    ;(prisma.currency.findFirst as unknown as MockFn).mockReset()
  })

  it("returns unchanged shape when currencyCode is null/undefined", async () => {
    const out = await processCurrencyFields("org1", 100, null)
    expect(out).toEqual({
      plannedAmount: 100,
      currencyCode: null,
      exchangeRate: null,
      originalAmount: null,
    })
  })

  it("returns unchanged shape when currencyCode matches base currency", async () => {
    ;(prisma.currency.findFirst as unknown as MockFn).mockResolvedValue({ code: "AZN" })
    const out = await processCurrencyFields("org1", 100, "AZN")
    expect(out).toEqual({
      plannedAmount: 100,
      currencyCode: null,
      exchangeRate: null,
      originalAmount: null,
    })
  })

  it("uses provided exchangeRate without looking up", async () => {
    ;(prisma.currency.findFirst as unknown as MockFn).mockResolvedValue({ code: "AZN" }) // base
    const out = await processCurrencyFields("org1", 100, "USD", 1.85)
    expect(out.plannedAmount).toBe(185) // 100 USD × 1.85
    expect(out.exchangeRate).toBe(1.85)
    expect(out.originalAmount).toBe(100)
    expect(out.currencyCode).toBe("USD")
    expect(prisma.currencyRateHistory.findFirst).not.toHaveBeenCalled()
  })

  it("looks up rate when exchangeRate is not provided", async () => {
    ;(prisma.currency.findFirst as unknown as MockFn).mockResolvedValue({ code: "AZN" }) // base
    ;(prisma.currencyRateHistory.findFirst as unknown as MockFn).mockResolvedValue({ rate: 1.70 })
    const out = await processCurrencyFields("org1", 100, "USD")
    expect(out.plannedAmount).toBe(170)
    expect(out.exchangeRate).toBe(1.70)
    expect(out.originalAmount).toBe(100)
  })

  it("fails closed when foreign currency has no valid historical rate", async () => {
    ;(prisma.currency.findFirst as unknown as MockFn).mockResolvedValue({ code: "AZN" })
    ;(prisma.currencyRateHistory.findFirst as unknown as MockFn).mockResolvedValue(null)
    await expect(processCurrencyFields("org1", 100, "USD")).rejects.toThrow(
      /finite positive historical exchange rate/i,
    )
  })

  it("fails closed when a caller supplies a zero foreign rate", async () => {
    ;(prisma.currency.findFirst as unknown as MockFn).mockResolvedValue({ code: "AZN" })
    await expect(processCurrencyFields("org1", 100, "USD", 0)).rejects.toThrow(
      /finite positive historical exchange rate/i,
    )
  })
})
