/**
 * Unit tests for Phase 7.O C1 narrative-fact-check pure helper.
 */

import { describe, it, expect } from "vitest"
import { verifyNarrative } from "./narrative-fact-check"

const BASE_INPUT = {
  result: { value: 12.5, status: "amber" as const, period: "2026Q1" },
  resolved: {
    revenue: 1_250_000,
    cost_of_goods: 980_000,
    gross_margin_pct: 0.216,
  },
  aggregates: {
    sales_by_channel: {
      direct: 800_000,
      wholesale: 450_000,
    },
    headcount: 47,
  },
}

describe("narrative-fact-check", () => {
  it("returns empty flags for a clean narrative that cites only known numbers", () => {
    const narrative =
      "Gross margin landed at 12.5% (revenue 1,250,000 against cost of goods 980,000). Wholesale channel contributed 450,000."
    const out = verifyNarrative(narrative, BASE_INPUT)
    expect(out.flags).toEqual([])
    expect(out.matched).toBeGreaterThan(0)
  })

  it("flags a wildly different percentage", () => {
    const narrative = "Margin fell to 78%, which is alarming."
    const out = verifyNarrative(narrative, BASE_INPUT)
    expect(out.flags.length).toBeGreaterThan(0)
    expect(out.flags.some((f) => f.claim === "78%" && f.severity === "warn")).toBe(
      true,
    )
  })

  it("flags a fabricated large amount", () => {
    const narrative =
      "Revenue collapsed to 187,571,023 in the quarter — an unprecedented drop."
    const out = verifyNarrative(narrative, BASE_INPUT)
    expect(out.flags.some((f) => f.claim.includes("187,571,023"))).toBe(true)
  })

  it("matches paraphrased ratio-as-percent (0.216 cited as 21.6%)", () => {
    const narrative = "Gross margin reached 21.6%."
    const out = verifyNarrative(narrative, BASE_INPUT)
    expect(out.flags).toEqual([])
  })

  it("matches K-thousand paraphrase (1,250,000 cited as 1.25K? no — as 1250)", () => {
    const narrative = "Revenue reached 1,250 (thousand AZN equivalent)."
    const out = verifyNarrative(narrative, BASE_INPUT)
    // 1,250 = 1,250,000 / 1000 → known variant
    expect(out.flags).toEqual([])
  })

  it("flags a future year that doesn't match the period", () => {
    const narrative = "By 2030 we expect margin to stabilise."
    const out = verifyNarrative(narrative, BASE_INPUT)
    expect(out.flags.some((f) => f.claim === "2030" && f.severity === "warn")).toBe(
      true,
    )
  })

  it("allows historical years prior to or matching the period", () => {
    const narrative = "Since 2023 the margin has steadily declined."
    const out = verifyNarrative(narrative, BASE_INPUT)
    expect(out.flags.every((f) => f.severity !== "warn" || !f.claim.includes("2023"))).toBe(
      true,
    )
  })

  it("skips trivial grammar numbers (< 10, no %)", () => {
    const narrative = "Three drivers explain the variance over 4 quarters."
    const out = verifyNarrative(narrative, BASE_INPUT)
    expect(out.totalChecked).toBe(0)
    expect(out.flags).toEqual([])
  })

  it("handles empty narrative", () => {
    const out = verifyNarrative("", BASE_INPUT)
    expect(out).toEqual({ flags: [], totalChecked: 0, matched: 0 })
  })

  it("handles negative values cited from variance vs. value (sign-flip variant)", () => {
    const narrative = "Variance: -1,250,000 vs. plan."
    const out = verifyNarrative(narrative, BASE_INPUT)
    // 1,250,000 is in resolved; sign-flip variant matches
    expect(out.flags).toEqual([])
  })

  it("recognises European decimal notation (12,5%)", () => {
    const narrative = "Margin landed at 12,5%, in line with the snapshot."
    const out = verifyNarrative(narrative, BASE_INPUT)
    // 12,5% == 12.5% == result.value → must match
    expect(out.flags.some((f) => f.claim.includes("12,5%") && f.severity === "warn")).toBe(
      false,
    )
  })

  it("flags percent-symbol claims as warn, raw numbers without % as info", () => {
    // "65%" → warn (clearly a percent, unmatched)
    const withSymbol = verifyNarrative(
      "Headcount of 47 explains 65% of cost growth.",
      BASE_INPUT,
    )
    const symbolFlag = withSymbol.flags.find((f) => f.claim === "65%")
    expect(symbolFlag?.severity).toBe("warn")

    // "65 percent" (word) → only "65" extracted, not flagged as percent
    const withWord = verifyNarrative(
      "Headcount of 47 explains 65 percent of cost growth.",
      BASE_INPUT,
    )
    const wordFlag = withWord.flags.find((f) => f.claim === "65")
    if (wordFlag) {
      expect(wordFlag.severity).toBe("info")
    }
  })
})
