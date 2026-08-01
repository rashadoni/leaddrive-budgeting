import { describe, it, expect } from "vitest"
import {
  computeEbitda,
  aggregateRowsForEbitda,
  computeActualEbitda,
} from "./ebitda"

describe("computeEbitda — pure math", () => {
  it("returns all zeros for an empty period (no revenue)", () => {
    const r = computeEbitda({
      totalRevenue: 0,
      totalCogs: 0,
      totalOpex: 0,
      totalBelowEbitda: 0,
      daInCogs: 0,
      daInOpex: 0,
    })
    expect(r.grossProfit).toBe(0)
    expect(r.ebit).toBe(0)
    expect(r.ebitda).toBe(0)
    expect(r.ebitdaMargin).toBe(0) // div-by-zero guard
    expect(r.netProfit).toBe(0)
    expect(r.netMargin).toBe(0)
  })

  it("returns 100% gross margin and 100% EBITDA margin for revenue-only period", () => {
    const r = computeEbitda({
      totalRevenue: 1000,
      totalCogs: 0,
      totalOpex: 0,
      totalBelowEbitda: 0,
      daInCogs: 0,
      daInOpex: 0,
    })
    expect(r.grossProfit).toBe(1000)
    expect(r.grossMargin).toBe(100)
    expect(r.ebit).toBe(1000)
    expect(r.ebitda).toBe(1000)
    expect(r.ebitdaMargin).toBe(100)
    expect(r.netProfit).toBe(1000)
  })

  it("basic profitable case without D&A: EBIT === EBITDA", () => {
    const r = computeEbitda({
      totalRevenue: 1000,
      totalCogs: 400,
      totalOpex: 200,
      totalBelowEbitda: 0,
      daInCogs: 0,
      daInOpex: 0,
    })
    expect(r.grossProfit).toBe(600)
    expect(r.grossMargin).toBe(60)
    expect(r.ebit).toBe(400)
    expect(r.ebitda).toBe(400) // no D&A → EBITDA collapses to EBIT
    expect(r.ebitdaMargin).toBe(40)
    expect(r.netProfit).toBe(400)
  })

  it("adds D&A back: ebitda = ebit + daInCogs + daInOpex", () => {
    const r = computeEbitda({
      totalRevenue: 1000,
      totalCogs: 400, // includes 50 of D&A (703-11 lines)
      totalOpex: 200, // includes 30 of D&A (721-11 lines)
      totalBelowEbitda: 0,
      daInCogs: 50,
      daInOpex: 30,
    })
    expect(r.ebit).toBe(400) // 600 GP − 200 OpEx
    expect(r.totalDa).toBe(80)
    expect(r.ebitda).toBe(480) // EBIT + D&A
    expect(r.ebitdaMargin).toBeCloseTo(48, 5)
  })

  it("loss case: EBITDA negative when COGS exceeds revenue", () => {
    const r = computeEbitda({
      totalRevenue: 500,
      totalCogs: 600,
      totalOpex: 100,
      totalBelowEbitda: 0,
      daInCogs: 0,
      daInOpex: 0,
    })
    expect(r.grossProfit).toBe(-100)
    expect(r.ebit).toBe(-200)
    expect(r.ebitda).toBe(-200)
    expect(r.ebitdaMargin).toBe(-40)
    expect(r.netProfit).toBe(-200)
  })

  it("netProfit subtracts belowEbitda from EBIT (NOT from EBITDA — D&A stays in net flow)", () => {
    const r = computeEbitda({
      totalRevenue: 1000,
      totalCogs: 400,
      totalOpex: 200,
      totalBelowEbitda: 80,
      daInCogs: 50,
      daInOpex: 30,
    })
    expect(r.ebitda).toBe(480)
    // grossProfit (600) − opex (200) − belowEbitda (80) = 320
    // (D&A NOT added back at net level — it's a real cash-equivalent
    // accrual that must reduce net profit by full amount.)
    expect(r.netProfit).toBe(320)
    expect(r.netMargin).toBeCloseTo(32, 5)
  })
})

describe("aggregateRowsForEbitda — row classification", () => {
  it("classifies AZMADE SAP codes into opex/belowEbitda by role + extracts D&A buckets", () => {
    const rows = [
      // revenue rows are ignored by this aggregator — totalRevenue passed in
      { accountCode: "601-01", accountType: "revenue", total: 1000 },
      // cogs row with D&A buried (703-11)
      { accountCode: "703-11-001", accountType: "cogs", total: 50 },
      // cogs row without D&A — ignored by this fn (not expense type, not da)
      { accountCode: "701-01", accountType: "cogs", total: 350 },
      // opex rows
      { accountCode: "711-01", accountType: "expense", total: 100 },
      { accountCode: "721-11-001", accountType: "expense", total: 30 }, // D&A in opex
      // below-EBITDA rows
      { accountCode: "731-01", accountType: "expense", total: 25 }, // finance
      { accountCode: "751-01", accountType: "expense", total: 15 }, // non-operating
      { accountCode: "801-01", accountType: "expense", total: 40 }, // income tax
      // zero-total expense — filtered out
      { accountCode: "711-99", accountType: "expense", total: 0 },
    ]
    const out = aggregateRowsForEbitda({ rows, totalRevenue: 1000, totalCogs: 400 })
    expect(out.totals.totalOpex).toBe(130) // 100 + 30 (D&A still inside)
    expect(out.totals.daInOpex).toBe(30)
    expect(out.totals.daInCogs).toBe(50)
    expect(out.totals.totalBelowEbitda).toBe(80) // 25 + 15 + 40
    expect(out.opexRows.length).toBe(2)
    expect(out.daRowsInOpex.length).toBe(1)
    expect(out.daRowsInCogs.length).toBe(1)
    expect(out.belowEbitdaRows.length).toBe(3)
  })

  it("treats unmatched-prefix expense rows as opex (legacy fallback)", () => {
    const rows = [
      // 999-xx is not in the deriveRoleFromCode map → "unknown" → null section → opex bucket
      { accountCode: "999-01", accountType: "expense", total: 75 },
    ]
    const out = aggregateRowsForEbitda({ rows, totalRevenue: 1000, totalCogs: 0 })
    expect(out.totals.totalOpex).toBe(75)
    expect(out.totals.daInOpex).toBe(0)
    expect(out.opexRows.length).toBe(1)
  })

  it("AzerSheker sign-flip scenario: negative-signed expense rows → Math.abs canonical totals", () => {
    // Per CARRYOVER CXLIX: AzerSheker xlsx stored cogs/expense as NEGATIVE
    // (additive convention). After the sign-flip fix the parser took
    // Math.abs(); but downstream aggregation must also be sign-robust.
    const rows = [
      { accountCode: "703-11-001", accountType: "cogs", total: -50 }, // D&A in COGS, negative
      { accountCode: "711-01", accountType: "expense", total: -100 }, // OpEx, negative
      { accountCode: "721-11-001", accountType: "expense", total: -30 }, // D&A in OpEx, negative
    ]
    const out = aggregateRowsForEbitda({ rows, totalRevenue: 1000, totalCogs: 400 })
    expect(out.totals.totalOpex).toBe(130) // |−100 + −30|
    expect(out.totals.daInOpex).toBe(30) // |−30|
    expect(out.totals.daInCogs).toBe(50) // |−50|
  })
})

describe("computeActualEbitda — actuals path", () => {
  it("extracts D&A from actualByKey via isDaCode and adds it back to EBIT", () => {
    const r = computeActualEbitda({
      sectionActuals: { revenue: 800, cogs: 300, opex: 250, belowEbitda: 0 },
      actualByKey: {
        "703-11-001::DA in COGS": 40,
        "721-11-001::DA in OpEx": 20,
        "711-01::Marketing": 100, // not D&A — must not contribute
        "601-01::Sales": -800, // revenue key, not D&A
      },
    })
    expect(r.grossProfit).toBe(500) // 800 − 300
    expect(r.ebit).toBe(250) // 500 − 250 opex
    expect(r.totalDa).toBe(60) // 40 + 20 (both isDaCode)
    expect(r.ebitda).toBe(310) // EBIT + D&A
    expect(r.ebitdaMargin).toBeCloseTo(38.75, 2)
  })

  it("handles negative-signed D&A values in actuals (Math.abs)", () => {
    const r = computeActualEbitda({
      sectionActuals: { revenue: 500, cogs: 200, opex: 150, belowEbitda: 0 },
      actualByKey: {
        "703-11-001::DA in COGS": -25, // negative — must contribute |25|
      },
    })
    expect(r.ebit).toBe(150)
    expect(r.ebitda).toBe(175)
  })
})

describe("other operating income/(expense) — above EBITDA, outside gross profit", () => {
  // The four numbers are the `PLF Budget 2026` totals for the four imported
  // entities, and each derived figure equals the workbook's own subtotal row:
  // PLF.03 = 20,180,179.07 · PLF.08 = 15,890,431.51 · PLF.10 = 3,829,841.70.
  const FO_2026 = {
    totalRevenue: 58_880_102.23,
    totalCogs: 38_699_923.16,
    totalOpex: 17_366_026.69,
    totalOtherOperating: 13_076_279.14,
    totalBelowEbitda: 12_060_589.81,
    daInCogs: 0,
    daInOpex: 0,
  }

  it("leaves gross profit untouched by the 13.45M of subsidies", () => {
    const r = computeEbitda(FO_2026)
    // The client was shown 33,633,277 here, because PLF.07 income was revenue.
    expect(r.grossProfit).toBeCloseTo(20_180_179.07, 2)
  })

  it("adds it to EBITDA", () => {
    const r = computeEbitda(FO_2026)
    expect(r.ebitda).toBeCloseTo(15_890_431.52, 2)
  })

  it("leaves net profit where it already was", () => {
    const r = computeEbitda(FO_2026)
    expect(r.netProfit).toBeCloseTo(3_829_841.71, 2)
  })

  it("is absent-safe: a chart without the line behaves exactly as before", () => {
    const withField = computeEbitda({
      totalRevenue: 1000, totalCogs: 400, totalOpex: 250,
      totalOtherOperating: 0, totalBelowEbitda: 50, daInCogs: 0, daInOpex: 0,
    })
    const withoutField = computeEbitda({
      totalRevenue: 1000, totalCogs: 400, totalOpex: 250,
      totalBelowEbitda: 50, daInCogs: 0, daInOpex: 0,
    })
    expect(withoutField).toEqual(withField)
  })

  it("buckets both natures of PLF.07 despite their opposite accountTypes", () => {
    // The income half is `revenue`-typed and the expense half `expense`-typed.
    // A filter on `accountType === "expense"` — which is how opex and
    // below-EBITDA are collected — would drop the income and lose 13.45M.
    const rows = [
      { accountCode: "PLF.01.01.01", accountType: "revenue", total: 15_836_740 },
      { accountCode: "PLF.07.02.04", accountType: "revenue", total: 9_231_957 },
      { accountCode: "PLF.07.01.01", accountType: "revenue", total: 300_000 },
      { accountCode: "PLF.07.03.01", accountType: "expense", total: 376_818.97 },
      { accountCode: "PLF.05.01.01", accountType: "expense", total: 1_000_000 },
      { accountCode: "PLF.09.03.98", accountType: "expense", total: 9_060_558.81 },
    ]
    const out = aggregateRowsForEbitda({ rows, totalRevenue: 15_836_740, totalCogs: 0 })
    expect(out.otherOperatingRows.map((r) => r.accountCode).sort()).toEqual([
      "PLF.07.01.01",
      "PLF.07.02.04",
      "PLF.07.03.01",
    ])
    expect(out.totals.totalOtherOperating).toBeCloseTo(9_155_138.03, 2)
    // ...and PLF.07.03 no longer leaks into the below-EBITDA bucket.
    expect(out.belowEbitdaRows.map((r) => r.accountCode)).toEqual(["PLF.09.03.98"])
    expect(out.totals.totalOpex).toBe(1_000_000)
  })

  it("carries the actuals bucket through computeActualEbitda", () => {
    const r = computeActualEbitda({
      sectionActuals: { revenue: 800, cogs: 300, opex: 250, otherOperating: 100, belowEbitda: 40 },
      actualByKey: {},
    })
    expect(r.grossProfit).toBe(500)
    expect(r.ebitda).toBe(350) // 500 − 250 + 100
    expect(r.netProfit).toBe(310) // 350 − 40
  })
})
