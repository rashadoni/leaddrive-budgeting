import { describe, it, expect } from "vitest"
import { coverageOf, coverageNotice } from "./period-coverage"

const M = (n: number) => `M${n}`
/** 1-based months → a 12-slot series. */
const series = (...months: number[]) =>
  Array.from({ length: 12 }, (_, i) => (months.includes(i + 1) ? 100 : 0))

describe("coverageOf", () => {
  it("reads the real shape: a full-year budget beside a five-month actual", () => {
    // The case that prompted this. `PLF Budget 2026` runs Jan–Dec;
    // `PLF Actual 2026` stops at May, measured on the client's workbook
    // 2026-08-02. The page subtracted one from the other and called the
    // remainder a variance.
    const budget = coverageOf([series(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12)])
    const actual = coverageOf([series(1, 2, 3, 4, 5)])
    expect(budget.full).toBe(true)
    expect(actual.full).toBe(false)
    expect(actual.count).toBe(5)
    expect(actual.contiguous).toBe(true)
  })

  it("counts a month covered when ANY series has it", () => {
    // Revenue in June with no COGS booked yet is still June.
    const c = coverageOf([series(6), series(1, 2)])
    expect(c.months).toEqual([1, 2, 6])
  })

  it("reads zero as absent, because in these maps it is indistinguishable", () => {
    // The monthly maps are dense and zero-filled, so presence proves nothing.
    // Erring this way can only add a caveat, never suppress one.
    expect(coverageOf([Array(12).fill(0)]).count).toBe(0)
  })

  it("refuses to call a year with a hole in it a range", () => {
    const c = coverageOf([series(1, 2, 4, 5)])
    expect(c.count).toBe(4)
    expect(c.contiguous).toBe(false)
  })

  it("survives a short or ragged series without inventing months", () => {
    expect(coverageOf([[1, 2]]).months).toEqual([1, 2])
    expect(coverageOf([[NaN, 5]]).months).toEqual([2])
    expect(coverageOf([]).count).toBe(0)
  })
})

describe("coverageNotice", () => {
  it("says Jan–May, five of twelve", () => {
    const n = coverageNotice(coverageOf([series(1, 2, 3, 4, 5)]), M)
    expect(n).toEqual({
      key: "coverage.partialRange",
      params: { from: "M1", to: "M5", count: 5 },
    })
  })

  it("names every month when there is a gap, rather than smoothing it", () => {
    const n = coverageNotice(coverageOf([series(1, 2, 4)]), M)
    expect(n?.key).toBe("coverage.partialMonths")
    expect(n?.params.months).toBe("M1, M2, M4")
  })

  it("stays silent on a full year — a caveat on every page is a caveat nobody reads", () => {
    expect(coverageNotice(coverageOf([series(...Array.from({ length: 12 }, (_, i) => i + 1))]), M))
      .toBeNull()
  })

  it("stays silent on an empty year, which the no-data notices already own", () => {
    expect(coverageNotice(coverageOf([Array(12).fill(0)]), M)).toBeNull()
  })
})
