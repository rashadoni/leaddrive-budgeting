import { describe, expect, it } from "vitest"
import {
  assertParsedLinesCurrencyEvidence,
  assertReportingCurrencyMatchesBase,
  normalizeCurrencyEvidence,
} from "./currency-evidence"

describe("normalizeCurrencyEvidence", () => {
  it("preserves base and untagged rows without a rate", () => {
    expect(normalizeCurrencyEvidence({ plannedAmount: 170, baseCurrencyCode: "AZN" })).toEqual({
      plannedAmount: 170,
      currencyCode: "AZN",
      originalAmount: null,
      exchangeRate: null,
    })
    expect(normalizeCurrencyEvidence({
      plannedAmount: 170,
      baseCurrencyCode: "AZN",
      currencyCode: "azn",
      exchangeRate: null,
    })).toMatchObject({ currencyCode: "AZN", originalAmount: null, exchangeRate: null })
  })

  it("keeps foreign source amount separately from reported base amount", () => {
    expect(normalizeCurrencyEvidence({
      plannedAmount: 170,
      baseCurrencyCode: "AZN",
      currencyCode: "USD",
      originalAmount: 100,
      exchangeRate: 1.7,
    })).toEqual({
      plannedAmount: 170,
      currencyCode: "USD",
      originalAmount: 100,
      exchangeRate: 1.7,
    })
  })

  it("fails closed for missing/invalid foreign evidence and source-base mismatch", () => {
    const base = { plannedAmount: 170, baseCurrencyCode: "AZN", currencyCode: "USD" }
    expect(() => normalizeCurrencyEvidence(base)).toThrow(/source amount/i)
    expect(() => normalizeCurrencyEvidence({ ...base, originalAmount: 100, exchangeRate: 0 })).toThrow(/positive historical/i)
    expect(() => normalizeCurrencyEvidence({ ...base, originalAmount: 100, exchangeRate: Number.NaN })).toThrow(/positive historical/i)
    expect(() => normalizeCurrencyEvidence({ ...base, originalAmount: 100, exchangeRate: 1.6 })).toThrow(/does not tie/i)
  })

  it("rejects source amount or rate evidence without an explicit source currency", () => {
    expect(() => normalizeCurrencyEvidence({
      plannedAmount: 170,
      baseCurrencyCode: "AZN",
      originalAmount: 100,
      exchangeRate: 1.7,
    })).toThrow(/explicit source currency/i)
  })
})

describe("assertReportingCurrencyMatchesBase", () => {
  it("accepts untagged or matching reporting columns", () => {
    expect(() => assertReportingCurrencyMatchesBase(undefined, "AZN")).not.toThrow()
    expect(() => assertReportingCurrencyMatchesBase("azn", "AZN")).not.toThrow()
  })

  it("rejects a foreign selected amount column instead of relabelling it as base", () => {
    expect(() => assertReportingCurrencyMatchesBase("USD", "AZN")).toThrow(
      /must equal company base currency/i,
    )
  })
})

describe("assertParsedLinesCurrencyEvidence", () => {
  it("accepts an untagged domestic row from a mixed sheet with blank source cells", () => {
    expect(() => assertParsedLinesCurrencyEvidence([
      {
        perMonth: Array(12).fill(50),
        currencyEvidence: {
          currencyCode: null,
          exchangeRate: null,
          originalPerMonth: Array<number | null>(12).fill(null),
        },
      },
    ], "AZN")).not.toThrow()
  })
})
