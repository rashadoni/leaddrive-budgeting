import { describe, it, expect } from "vitest"
import { aggregatePnlLines, type PnlLineInput } from "./pnl-aggregation"

function line(over: Partial<PnlLineInput>): PnlLineInput {
  return {
    plannedAmount: 0,
    currencyCode: null,
    exchangeRate: null,
    accountType: "expense",
    accountCode: null,
    ...over,
  }
}

describe("aggregatePnlLines", () => {
  it("classifies revenue/cogs/opex and derives totals (all base currency)", () => {
    const a = aggregatePnlLines(
      [
        line({ accountType: "revenue", plannedAmount: 1000 }),
        line({ accountType: "cogs", plannedAmount: 400 }),
        line({ accountType: "expense", plannedAmount: 250 }),
      ],
      "AZN",
    )
    expect(a.revenue).toBe(1000)
    expect(a.cogs).toBe(400)
    expect(a.opex).toBe(250)
    expect(a.below_ebitda).toBe(0)
    expect(a.gross_profit).toBe(600)
    expect(a.net_income).toBe(350)
    expect(a.total_cost).toBe(650)
    expect(a.total_input_cost).toBe(400)
    // all domestic
    expect(a.imported_cogs).toBe(0)
    expect(a.domestic_cogs).toBe(400)
    expect(a.missing_rate_count).toBe(0)
  })

  it("treats a line tagged with the base currency as base, not foreign", () => {
    const a = aggregatePnlLines([line({ accountType: "cogs", plannedAmount: 100, currencyCode: "AZN" })], "AZN")
    expect(a.cogs).toBe(100)
    expect(a.imported_cogs).toBe(0)
    expect(a.domestic_cogs).toBe(100)
  })

  it("uses foreign source evidence but keeps already-base planned amounts unchanged", () => {
    const a = aggregatePnlLines(
      [
        line({
          accountType: "cogs",
          plannedAmount: 170,
          originalAmount: 100,
          currencyCode: "USD",
          exchangeRate: 1.7,
        }),
        line({
          accountType: "expense",
          plannedAmount: 85,
          originalAmount: 50,
          currencyCode: "USD",
          exchangeRate: 1.7,
        }),
      ],
      "AZN",
    )
    expect(a.cogs).toBe(170)
    expect(a.imported_cogs).toBe(170)
    expect(a.imported_input_cost).toBe(170)
    expect(a.opex).toBe(85)
    expect(a.imported_opex).toBe(85)
  })

  it("skips foreign lines without a finite positive rate (counted, not assumed 1:1)", () => {
    const a = aggregatePnlLines(
      [
        line({ accountType: "revenue", plannedAmount: 1000, currencyCode: "AZN" }),
        line({ accountType: "cogs", plannedAmount: 999, currencyCode: "USD", exchangeRate: null }),
      ],
      "AZN",
    )
    expect(a.revenue).toBe(1000)
    expect(a.cogs).toBe(0) // the rate-less foreign cogs line was skipped
    expect(a.missing_rate_count).toBe(1)
  })

  it("fails closed for non-positive and non-finite foreign rates, while base AZN accepts null", () => {
    const a = aggregatePnlLines(
      [
        line({ accountType: "cogs", plannedAmount: 200, currencyCode: "AZN", exchangeRate: null }),
        line({ accountType: "cogs", plannedAmount: 170, currencyCode: "USD", exchangeRate: 0 }),
        line({ accountType: "cogs", plannedAmount: 170, currencyCode: "USD", exchangeRate: Number.NaN }),
        line({ accountType: "cogs", plannedAmount: 170, currencyCode: "USD", exchangeRate: Number.POSITIVE_INFINITY }),
      ],
      "AZN",
    )
    expect(a.cogs).toBe(200)
    expect(a.missing_rate_count).toBe(3)
  })

  it("sums D&A add-back from depreciation account codes (703-11 / 721-11)", () => {
    const a = aggregatePnlLines(
      [
        line({ accountType: "cogs", plannedAmount: 300, accountCode: "703-11" }),
        line({ accountType: "expense", plannedAmount: 200, accountCode: "721-11" }),
        line({ accountType: "expense", plannedAmount: 100, accountCode: "720-01" }),
      ],
      "AZN",
    )
    expect(a.da_total).toBe(500)
    expect(a.cogs).toBe(300)
    expect(a.opex).toBe(300)
  })

  it("ignores asset/liability/equity rows for the P&L shape", () => {
    const a = aggregatePnlLines(
      [
        line({ accountType: "asset", plannedAmount: 9999 }),
        line({ accountType: "revenue", plannedAmount: 100 }),
      ],
      "AZN",
    )
    expect(a.revenue).toBe(100)
    expect(a.cogs).toBe(0)
    expect(a.opex).toBe(0)
  })

  it("keeps EDEN-shaped PLF.07 out of revenue and puts it above EBITDA", () => {
    // Was: income arrived NEGATIVE with lineType=expense and was flipped into
    // REVENUE, while PLF.07.03 was pushed below the EBITDA line. Revenue read
    // 3,385,000 for a company whose sales were 266,000. Both are now stored
    // under their own nature and land on their own line.
    const a = aggregatePnlLines(
      [
        line({
          accountType: "revenue", lineType: "revenue",
          accountCode: "PLF.01.02.01", plannedAmount: 266_000,
        }),
        line({
          accountType: "revenue", lineType: "revenue",
          accountCode: "PLF.07.02.02", plannedAmount: 3_011_000,
        }),
        line({
          accountType: "revenue", lineType: "revenue",
          accountCode: "PLF.07.01", plannedAmount: 108_000,
        }),
        line({
          accountType: "expense", lineType: "expense",
          accountCode: "PLF.07.03.01", plannedAmount: 75_000,
        }),
        // Below-EBITDA finance/tax costs must not leak into operating OpEx.
        line({
          accountType: "expense", lineType: "expense",
          accountCode: "731-01", plannedAmount: 40_000,
        }),
        line({
          accountType: "expense", lineType: "expense",
          accountCode: "801-01", plannedAmount: 10_000,
        }),
      ],
      "AZN",
    )
    expect(a.revenue).toBe(266_000)
    expect(a.gross_profit).toBe(266_000)
    expect(a.other_operating).toBe(3_011_000 + 108_000 - 75_000)
    expect(a.opex).toBe(0)
    expect(a.below_ebitda).toBe(50_000)
    // The bottom line is the one number the old compensation got right, and
    // it must not move: 266,000 + 3,044,000 − 50,000.
    expect(a.net_income).toBe(3_260_000)
  })

  it("gives PLF.08.01 — Shareholders' expense — a below-EBITDA line", () => {
    // 174,491 AZN of AZSF 2025 actuals. It imported, and then reached no P&L
    // line at all because the section mapper returned null for all of PLF.08.
    const a = aggregatePnlLines(
      [line({
        accountType: "expense", lineType: "expense",
        accountCode: "PLF.08.01", plannedAmount: 174_491,
      })],
      "AZN",
    )
    expect(a.below_ebitda).toBe(174_491)
    expect(a.opex).toBe(0)
    expect(a.net_income).toBe(-174_491)
  })

  it("preserves ordinary revenue sign when legacy rows have no lineType", () => {
    const a = aggregatePnlLines(
      [line({ accountType: "revenue", accountCode: "611", plannedAmount: 500 })],
      "AZN",
    )
    expect(a.revenue).toBe(500)
  })

  it("applies the canonical contra-revenue storage convention", () => {
    const a = aggregatePnlLines(
      [line({
        accountType: "revenue", lineType: "revenue",
        accountCode: "602-01", plannedAmount: 5_000,
      })],
      "AZN",
    )
    expect(a.revenue).toBe(-5_000)
  })

  it("does not double-convert a foreign base amount before bucketing PLF.07 income", () => {
    const a = aggregatePnlLines(
      [line({
        accountType: "revenue", lineType: "revenue",
        accountCode: "PLF.07.02.02", plannedAmount: 170,
        originalAmount: 100, currencyCode: "USD", exchangeRate: 1.7,
      })],
      "AZN",
    )
    expect(a.other_operating).toBeCloseTo(170, 8)
    expect(a.revenue).toBe(0)
  })
})
