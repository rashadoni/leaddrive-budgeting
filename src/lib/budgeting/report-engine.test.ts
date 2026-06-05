import { describe, it, expect } from "vitest"
import {
  periodGroupData,
  applyComputedFields,
  getEntityFields,
  getEntityConfigs,
  parseNumOrDate,
  buildWhere,
  type EntityConfig,
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

  it("returns base fields for budgetLines (no dropped Phase-2.1 columns)", () => {
    const fields = getEntityFields("budgetLines")
    const names = fields.map((f) => f.name)
    expect(names).toContain("plannedAmount")
    expect(names).toContain("forecastAmount")
    // `category` was DROPPED from BudgetLine in Phase 2.1 — selecting it made the
    // report engine's findMany throw (blanked the Report Builder). It must not be
    // offered as a column; the account dimension now comes from the accountId FK.
    expect(names).not.toContain("category")
    expect(names).toContain("account.code")
  })

  it("flattens relation fields with dotted notation (plan.name, plan.year)", () => {
    const fields = getEntityFields("budgetLines")
    const names = fields.map((f) => f.name)
    expect(names).toContain("plan.name")
    expect(names).toContain("plan.year")
  })

  it("data-bearing entities expose the account relation, not dropped Phase-2.1 columns", () => {
    // Regression: these scalar columns were dropped in Phase 2.1 (replaced by the
    // accountId FK). Any entity config still offering them makes the engine's
    // Prisma findMany throw -> the Report Builder renders blank. Guard against it.
    for (const entity of ["budgetLines", "cashFlow", "balanceSheet", "cogsBudget"]) {
      const names = getEntityFields(entity).map((f) => f.name)
      expect(names).not.toContain("category")
      expect(names).not.toContain("accountCode")
      expect(names).not.toContain("accountName")
      expect(names).toContain("account.code")
    }
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

  it("budgetActuals (Fakt) reads realized figures from budgetLine, not the empty BudgetActual table", () => {
    // The legacy BudgetActual table is empty (imported actuals land as the
    // actuals-plan's BudgetLines). So "Fakt məlumatlar" reads budgetLine, with
    // plannedAmount surfaced as "Actual Amount". Guards against reverting to the
    // dead `budgetActual` model (which made the Report Builder show "no data").
    const cfg = getEntityConfigs().budgetActuals
    expect(cfg.model).toBe("budgetLine")
    const actualField = cfg.fields.find((f) => f.label === "Actual Amount")
    expect(actualField?.name).toBe("plannedAmount")
  })
})

describe("parseNumOrDate", () => {
  const config: EntityConfig = {
    model: "budgetLine",
    hasPlanId: true,
    hasYearMonth: false,
    fields: [
      { name: "plannedAmount", label: "Planned", type: "number" },
      { name: "createdAt", label: "Created", type: "date" },
      { name: "category", label: "Category", type: "string" },
    ],
  }

  it("coerces value to Date for date-typed fields", () => {
    const result = parseNumOrDate("2026-05-17", "createdAt", config)
    expect(result).toBeInstanceOf(Date)
    expect((result as Date).getFullYear()).toBe(2026)
  })

  it("coerces value to Number for number-typed fields", () => {
    expect(parseNumOrDate("100", "plannedAmount", config)).toBe(100)
    expect(parseNumOrDate("100.5", "plannedAmount", config)).toBe(100.5)
  })

  it("returns raw value for string-typed fields", () => {
    expect(parseNumOrDate("Travel", "category", config)).toBe("Travel")
  })

  it("returns raw value for unknown field (defensive fallthrough)", () => {
    expect(parseNumOrDate("xyz", "nonExistent", config)).toBe("xyz")
  })
})

describe("buildWhere", () => {
  const config: EntityConfig = {
    model: "budgetLine",
    hasPlanId: true,
    hasYearMonth: false,
    fields: [
      { name: "plannedAmount", label: "Planned", type: "number" },
      { name: "category", label: "Category", type: "string" },
      { name: "createdAt", label: "Created", type: "date" },
    ],
  }

  it("always includes organizationId", () => {
    const where = buildWhere("org_1", undefined, config, [])
    expect(where.organizationId).toBe("org_1")
  })

  it("includes planId when entity hasPlanId + planId provided", () => {
    const where = buildWhere("org_1", "plan_5", config, [])
    expect(where.planId).toBe("plan_5")
  })

  it("omits planId when entity hasPlanId but planId undefined", () => {
    const where = buildWhere("org_1", undefined, config, [])
    expect(where.planId).toBeUndefined()
  })

  it("omits planId when entity hasPlanId === false", () => {
    const noPlanConfig: EntityConfig = { ...config, hasPlanId: false }
    const where = buildWhere("org_1", "plan_5", noPlanConfig, [])
    expect(where.planId).toBeUndefined()
  })

  it("translates eq filter to direct field assignment", () => {
    const where = buildWhere("org_1", "p1", config, [
      { field: "category", op: "eq", value: "Rent" },
    ])
    expect(where.category).toBe("Rent")
  })

  it("translates neq filter to { not: value }", () => {
    const where = buildWhere("org_1", "p1", config, [
      { field: "category", op: "neq", value: "Rent" },
    ])
    expect(where.category).toEqual({ not: "Rent" })
  })

  it("translates gt/lt/gte/lte filters with Prisma operators", () => {
    const where = buildWhere("org_1", "p1", config, [
      { field: "plannedAmount", op: "gt", value: "100" },
      { field: "plannedAmount", op: "lte", value: "1000" },
    ])
    // Second filter overwrites first on same field; verify shape
    expect(where.plannedAmount).toEqual({ lte: 1000 })
  })

  it("gt filter coerces value via parseNumOrDate (number field → Number)", () => {
    const where = buildWhere("org_1", "p1", config, [
      { field: "plannedAmount", op: "gte", value: "500" },
    ])
    expect(where.plannedAmount).toEqual({ gte: 500 }) // string "500" coerced to Number
  })

  it("contains filter uses Prisma { contains, mode: insensitive }", () => {
    const where = buildWhere("org_1", "p1", config, [
      { field: "category", op: "contains", value: "travel" },
    ])
    expect(where.category).toEqual({ contains: "travel", mode: "insensitive" })
  })

  it("in filter wraps non-array value into array", () => {
    const w1 = buildWhere("org_1", "p1", config, [
      { field: "category", op: "in", value: ["A", "B"] },
    ])
    expect(w1.category).toEqual({ in: ["A", "B"] })

    const w2 = buildWhere("org_1", "p1", config, [
      { field: "category", op: "in", value: "A" }, // scalar
    ])
    expect(w2.category).toEqual({ in: ["A"] })
  })

  it("between filter requires both from + to (silently drops if missing)", () => {
    const wValid = buildWhere("org_1", "p1", config, [
      { field: "plannedAmount", op: "between", value: { from: "10", to: "100" } },
    ])
    expect(wValid.plannedAmount).toEqual({ gte: 10, lte: 100 })

    // Missing `to` → filter NOT applied
    const wMissing = buildWhere("org_1", "p1", config, [
      { field: "plannedAmount", op: "between", value: { from: "10" } },
    ])
    expect(wMissing.plannedAmount).toBeUndefined()
  })
})
