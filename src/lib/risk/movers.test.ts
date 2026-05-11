import { describe, it, expect } from "vitest"
import { computeTopMovers, groupBySector } from "./movers"

const COMPANIES = [
  { id: "c1", code: "AAC", industry: "industrial" },
  { id: "c2", code: "ATL", industry: "industrial" },
  { id: "c3", code: "EDEN", industry: "agro" },
  { id: "c4", code: "HORIZON", industry: null },
]

const INDICATORS = [
  { id: "i1", code: "IND_GROSS_MARGIN" },
  { id: "i2", code: "IND_OPEX_RATIO" },
]

describe("computeTopMovers — Phase 7.H Feature 2", () => {
  it("returns empty when cells empty", () => {
    expect(computeTopMovers([], COMPANIES, INDICATORS)).toEqual([])
  })

  it("requires sparkline ≥ 2 numeric values", () => {
    const cells = [
      { companyId: "c1", indicatorId: "i1", status: "amber" as const, value: 10, sparkline: [10] },
      { companyId: "c1", indicatorId: "i2", status: "amber" as const, value: 10 },
      { companyId: "c2", indicatorId: "i1", status: "green" as const, value: 20, sparkline: [10, null, 20] },
    ]
    const out = computeTopMovers(cells, COMPANIES, INDICATORS)
    expect(out.length).toBe(1)
    expect(out[0].companyCode).toBe("ATL")
    expect(out[0].deltaPct).toBeCloseTo(100)
  })

  it("ranks by absolute deltaPct descending", () => {
    const cells = [
      { companyId: "c1", indicatorId: "i1", status: "amber" as const, value: 12, sparkline: [10, 12] }, // +20%
      { companyId: "c2", indicatorId: "i1", status: "red" as const, value: 5, sparkline: [10, 5] },     // -50%
      { companyId: "c3", indicatorId: "i2", status: "green" as const, value: 11, sparkline: [10, 11] }, // +10%
    ]
    const out = computeTopMovers(cells, COMPANIES, INDICATORS)
    expect(out.map((m) => m.companyCode)).toEqual(["ATL", "AAC", "EDEN"])
  })

  it("respects topN option", () => {
    const cells = Array.from({ length: 8 }, (_, i) => ({
      companyId: "c1",
      indicatorId: i % 2 === 0 ? "i1" : "i2",
      status: "amber" as const,
      value: 100 + i,
      sparkline: [100, 100 + i * 5],
    }))
    expect(computeTopMovers(cells, COMPANIES, INDICATORS, { topN: 3 }).length).toBe(3)
  })

  it("drops sub-threshold noise (< minPctMagnitude)", () => {
    const cells = [
      { companyId: "c1", indicatorId: "i1", status: "green" as const, value: 100.1, sparkline: [100, 100.1] }, // +0.1%
      { companyId: "c2", indicatorId: "i1", status: "amber" as const, value: 110, sparkline: [100, 110] },     // +10%
    ]
    const out = computeTopMovers(cells, COMPANIES, INDICATORS, { minPctMagnitude: 0.5 })
    expect(out.length).toBe(1)
    expect(out[0].companyCode).toBe("ATL")
  })

  it("'missing' status collapses to 'unknown'", () => {
    const cells = [
      { companyId: "c1", indicatorId: "i1", status: "missing" as const, value: 10, sparkline: [10, 20] },
    ]
    const out = computeTopMovers(cells, COMPANIES, INDICATORS)
    expect(out[0].status).toBe("unknown")
  })

  it("uses '—' for null industry", () => {
    const cells = [
      { companyId: "c4", indicatorId: "i1", status: "amber" as const, value: 110, sparkline: [100, 110] },
    ]
    const out = computeTopMovers(cells, COMPANIES, INDICATORS)
    expect(out[0].sector).toBe("—")
  })

  it("groupBySector preserves rank within each group", () => {
    const cells = [
      { companyId: "c1", indicatorId: "i1", status: "amber" as const, value: 200, sparkline: [100, 200] }, // industrial +100%
      { companyId: "c3", indicatorId: "i1", status: "red" as const, value: 30, sparkline: [100, 30] },     // agro -70%
      { companyId: "c2", indicatorId: "i2", status: "amber" as const, value: 150, sparkline: [100, 150] }, // industrial +50%
    ]
    const movers = computeTopMovers(cells, COMPANIES, INDICATORS)
    const grouped = groupBySector(movers)
    expect(grouped.get("industrial")?.map((m) => m.companyCode)).toEqual(["AAC", "ATL"])
    expect(grouped.get("agro")?.length).toBe(1)
  })
})
