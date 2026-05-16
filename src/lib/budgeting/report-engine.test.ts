import { describe, it, expect } from "vitest"
import {
  periodGroupData,
  applyComputedFields,
  getEntityFields,
  getEntityConfigs,
} from "./report-engine"

/**
 * Pure-helper coverage for report-engine.ts. `executeBudgetReport`
 * itself is Prisma-bound and exercised through the budgeting reports
 * route handler — not duplicated here.
 *
 * The 3 pure exports drive:
 * - `periodGroupData` — month → quarter → year roll-up math
 * - `applyComputedFields` — variance / execution_pct / margin_pct
 *   post-processing
 * - `getEntityFields` — flatten entity fields + relation fields with
 *   dotted-name notation for the report builder's column picker
 */

describe("periodGroupData", () => {
  const rows = [
    { year: 2026, month: 1, planned: 100, actual: 80 },
    { year: 2026, month: 2, planned: 120, actual: 110 },
    { year: 2026, month: 4, planned: 200, actual: 180 },
    { year: 2025, month: 12, planned: 80, actual: 90 },
  ]

  it("groups by year", () => {
    const grouped = periodGroupData(rows, "year", ["planned", "actual"])
    expect(grouped).toHaveLength(2)
    const y2026 = grouped.find((g) => g.period === "2026")
    expect(y2026?.planned).toBe(420) // 100+120+200
    expect(y2026?.actual).toBe(370) // 80+110+180
    expect(y2026?._count).toBe(3)
    const y2025 = grouped.find((g) => g.period === "2025")
    expect(y2025?.planned).toBe(80)
  })

  it("groups by quarter (Q1=Jan-Mar, Q2=Apr-Jun)", () => {
    const grouped = periodGroupData(rows, "quarter", ["planned"])
    expect(grouped.find((g) => g.period === "2026-Q1")?.planned).toBe(220) // 100+120
    expect(grouped.find((g) => g.period === "2026-Q2")?.planned).toBe(200)
    expect(grouped.find((g) => g.period === "2025-Q4")?.planned).toBe(80)
  })

  it("groups by month with zero-padded keys", () => {
    const grouped = periodGroupData(rows, "month", ["planned"])
    expect(grouped.find((g) => g.period === "2026-01")?.planned).toBe(100)
    expect(grouped.find((g) => g.period === "2026-02")?.planned).toBe(120)
    expect(grouped.find((g) => g.period === "2025-12")?.planned).toBe(80)
  })

  it("returns rows sorted by period ascending", () => {
    const grouped = periodGroupData(rows, "month", ["planned"])
    // Period strings sort lexicographically; YYYY-MM happens to be
    // chronologically correct.
    expect(grouped.map((g) => g.period)).toEqual([
      "2025-12",
      "2026-01",
      "2026-02",
      "2026-04",
    ])
  })

  it("handles empty rows array gracefully", () => {
    expect(periodGroupData([], "month", ["planned"])).toEqual([])
  })

  it("sums missing numeric fields as 0 (no NaN propagation)", () => {
    const sparse = [{ year: 2026, month: 1, planned: 100 }, { year: 2026, month: 1 }]
    const grouped = periodGroupData(sparse, "month", ["planned"])
    expect(grouped[0].planned).toBe(100) // second row has no planned → 0 contribution
    expect(grouped[0]._count).toBe(2)
  })
})

describe("applyComputedFields", () => {
  it("computes variance = plannedAmount - actualAmount", () => {
    const rows = [{ plannedAmount: 100, actualAmount: 80 }]
    const out = applyComputedFields(rows, ["variance"])
    expect(out[0].variance).toBe(20)
  })

  it("computes execution_pct = (actual / planned) * 100", () => {
    const rows = [{ plannedAmount: 100, actualAmount: 80 }]
    const out = applyComputedFields(rows, ["execution_pct"])
    expect(out[0].execution_pct).toBe(80)
  })

  it("execution_pct guards against divide-by-zero (planned=0 → 0)", () => {
    const rows = [{ plannedAmount: 0, actualAmount: 50 }]
    const out = applyComputedFields(rows, ["execution_pct"])
    expect(out[0].execution_pct).toBe(0)
  })

  it("computes margin_pct = (revenue - cost) / revenue × 100", () => {
    // `margin_pct` uses `amount` (revenue) and `totalCost`
    const rows = [{ amount: 1000, totalCost: 600 }]
    const out = applyComputedFields(rows, ["margin_pct"])
    expect(out[0].margin_pct).toBe(40) // (1000-600)/1000 × 100
  })

  it("margin_pct falls back to plannedAmount + actualAmount when amount/totalCost missing", () => {
    // Backward-compat path: plannedAmount as revenue, actualAmount as cost
    const rows = [{ plannedAmount: 1000, actualAmount: 700 }]
    const out = applyComputedFields(rows, ["margin_pct"])
    expect(out[0].margin_pct).toBe(30)
  })

  it("applies multiple computed fields to same row", () => {
    const rows = [{ plannedAmount: 100, actualAmount: 80 }]
    const out = applyComputedFields(rows, ["variance", "execution_pct"])
    expect(out[0].variance).toBe(20)
    expect(out[0].execution_pct).toBe(80)
  })

  it("returns rows by reference (mutates in-place — current contract)", () => {
    const rows = [{ plannedAmount: 100, actualAmount: 80 }]
    const out = applyComputedFields(rows, ["variance"])
    expect(out).toBe(rows)
  })
})

describe("getEntityFields", () => {
  it("returns empty array for unknown entityType", () => {
    expect(getEntityFields("nonExistentEntity")).toEqual([])
  })

  it("returns base fields for budgetLines", () => {
    const fields = getEntityFields("budgetLines")
    // Base fields include category / plannedAmount / forecastAmount
    const names = fields.map((f) => f.name)
    expect(names).toContain("category")
    expect(names).toContain("plannedAmount")
    expect(names).toContain("forecastAmount")
  })

  it("flattens relation fields with dotted notation (plan.name, plan.year)", () => {
    const fields = getEntityFields("budgetLines")
    const names = fields.map((f) => f.name)
    expect(names).toContain("plan.name")
    expect(names).toContain("plan.year")
  })

  it("relation field labels use ' → ' separator (plan → name)", () => {
    const fields = getEntityFields("budgetLines")
    const planName = fields.find((f) => f.name === "plan.name")
    expect(planName?.label).toBe("plan → name")
  })
})

describe("getEntityConfigs", () => {
  it("returns the ENTITY_CONFIGS catalog with all known entity types", () => {
    const configs = getEntityConfigs()
    expect(configs).toHaveProperty("budgetLines")
    expect(configs).toHaveProperty("budgetActuals")
  })
})
