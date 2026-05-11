import { describe, it, expect } from "vitest"
import { computePeerBenchmark } from "./peer-benchmark"

const PERIODS = ["2026-01", "2026-02", "2026-03"]

describe("computePeerBenchmark — Phase 7.H Feature 3", () => {
  it("flags insufficientPeers when cohort < 3", () => {
    const out = computePeerBenchmark({
      ownSeries: PERIODS.map((p) => ({ period: p, value: 10 })),
      cohortSeries: [
        { companyId: "c1", values: [12, 13, 14] },
        { companyId: "c2", values: [11, 12, 13] },
      ],
      periods: PERIODS,
      direction: "higher_better",
    })
    expect(out.insufficientPeers).toBe(true)
    expect(out.rank).toBeNull()
    expect(out.medianSeries.every((p) => p.value === null)).toBe(true)
  })

  it("computes median + p75 across cohort per period", () => {
    const out = computePeerBenchmark({
      ownSeries: PERIODS.map((p) => ({ period: p, value: 10 })),
      cohortSeries: [
        { companyId: "c1", values: [10, 20, 30] },
        { companyId: "c2", values: [20, 30, 40] },
        { companyId: "c3", values: [30, 40, 50] },
        { companyId: "c4", values: [40, 50, 60] },
      ],
      periods: PERIODS,
      direction: "higher_better",
    })
    expect(out.insufficientPeers).toBe(false)
    // Sorted [10,20,30,40] → median = 25, p75 = 32.5
    expect(out.medianSeries[0].value).toBeCloseTo(25)
    expect(out.p75Series[0].value).toBeCloseTo(32.5)
  })

  it("ranks own at last period — higher_better → 1 = highest value", () => {
    const out = computePeerBenchmark({
      ownSeries: [
        { period: "2026-01", value: 5 },
        { period: "2026-02", value: 5 },
        { period: "2026-03", value: 50 }, // own = top
      ],
      cohortSeries: [
        { companyId: "c1", values: [10, 10, 10] },
        { companyId: "c2", values: [20, 20, 20] },
        { companyId: "c3", values: [30, 30, 30] },
      ],
      periods: PERIODS,
      direction: "higher_better",
    })
    expect(out.rank).toEqual({ position: 1, total: 4 })
  })

  it("ranks own at last period — lower_better → 1 = lowest value", () => {
    const out = computePeerBenchmark({
      ownSeries: [
        { period: "2026-01", value: 5 },
        { period: "2026-02", value: 5 },
        { period: "2026-03", value: 5 }, // own = lowest = best for lower_better
      ],
      cohortSeries: [
        { companyId: "c1", values: [10, 10, 10] },
        { companyId: "c2", values: [20, 20, 20] },
        { companyId: "c3", values: [30, 30, 30] },
      ],
      periods: PERIODS,
      direction: "lower_better",
    })
    expect(out.rank).toEqual({ position: 1, total: 4 })
  })

  it("returns null rank when own value is null at last period", () => {
    const out = computePeerBenchmark({
      ownSeries: [
        { period: "2026-01", value: 10 },
        { period: "2026-02", value: 10 },
        { period: "2026-03", value: null },
      ],
      cohortSeries: [
        { companyId: "c1", values: [10, 10, 10] },
        { companyId: "c2", values: [20, 20, 20] },
        { companyId: "c3", values: [30, 30, 30] },
      ],
      periods: PERIODS,
      direction: "higher_better",
    })
    expect(out.rank).toBeNull()
  })

  it("median falls back to null when no cohort values for a period", () => {
    const out = computePeerBenchmark({
      ownSeries: PERIODS.map((p) => ({ period: p, value: 10 })),
      cohortSeries: [
        { companyId: "c1", values: [null, 20, 30] },
        { companyId: "c2", values: [null, 30, 40] },
        { companyId: "c3", values: [null, 40, 50] },
      ],
      periods: PERIODS,
      direction: "higher_better",
    })
    expect(out.medianSeries[0].value).toBeNull()
    expect(out.medianSeries[1].value).not.toBeNull()
  })
})
