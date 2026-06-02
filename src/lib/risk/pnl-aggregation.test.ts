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

  it("converts foreign lines at the exchange rate and tags them imported", () => {
    const a = aggregatePnlLines(
      [
        line({ accountType: "cogs", plannedAmount: 100, currencyCode: "USD", exchangeRate: 1.7 }),
        line({ accountType: "expense", plannedAmount: 50, currencyCode: "USD", exchangeRate: 1.7 }),
      ],
      "AZN",
    )
    expect(a.cogs).toBe(170)
    expect(a.imported_cogs).toBe(170)
    expect(a.imported_input_cost).toBe(170)
    expect(a.opex).toBe(85)
    expect(a.imported_opex).toBe(85)
  })

  it("skips foreign lines without a rate (counted, not assumed 1:1)", () => {
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

  it("sums D&A add-back from depreciation account codes (703-11 / 721-11)", () => {
    const a = aggregatePnlLines(
      [
        line({ accountType: "cogs", plannedAmount: 300, accountCode: "703-11" }),
        line({ accountType: "expense", plannedAmount: 200, accountCode: "721-11" }),
        line({ accountType: "expense", plannedAmount: 100, accountCode: "601-01" }),
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
})
