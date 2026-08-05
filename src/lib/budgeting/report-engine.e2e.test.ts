// @vitest-environment node
/**
 * Report Builder — end-to-end pipeline coverage (2026-08-05 audit).
 *
 * Runs the REAL `executeBudgetReport` and the REAL preview/export route
 * handlers against an in-memory Prisma double (`@/test/fake-prisma-report`).
 * Everything between "user clicks a column" and "bytes leave the server"
 * is exercised: where-clause assembly, org + plan scoping, soft-delete
 * filtering, parent-code de-duplication, actuals-plan resolution, period
 * roll-ups, groupBy aggregation, CSV bytes and the xlsx workbook.
 *
 * Existing coverage this complements:
 *   - `report-engine.test.ts` — the 3 pure helpers, no Prisma
 *   - the reports `handler.test.ts` files — routes with the engine stubbed
 * Neither of those ever runs a query, so none of the scoping or
 * de-duplication logic below had a test before this file.
 *
 * Defects found during this audit are pinned separately in
 * `report-engine.bugs.test.ts` — this file asserts only behaviour that is
 * correct today and must stay correct.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import { createFakePrisma, type FakePrismaStore } from "@/test/fake-prisma-report"

const { db } = vi.hoisted(() => ({
  db: { current: null as unknown as Record<string, unknown> },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy(
    {},
    {
      get: (_t, prop: string) =>
        (db.current as Record<string, unknown>)?.[prop],
    },
  ),
}))

import { executeBudgetReport, getEntityFields } from "./report-engine"
import { mockSession, makeRequest } from "@/test/api-harness"

const ORG = "org_audit_2026aaaaaaaaaaa"
const OTHER_ORG = "org_intruder_2026aaaaaaa"
const PLAN_BUDGET = "plan_budget_2026"
const PLAN_ACTUAL = "plan_actual_2026"

/**
 * Fixture shaped like a real imported P&L: SAP-style account codes where a
 * parent ("601") and its children ("601-01", "601-02") both exist as rows,
 * because that is exactly what the client workbooks contain.
 *
 * Budget plan — revenue 1 000 000 = 600 000 + 400 000
 *               expense  500 000 = 300 000 + 200 000
 * Actuals plan — revenue   900 000 = 550 000 + 350 000
 *                expense   480 000 = 280 000 + 200 000
 */
function seed(): FakePrismaStore {
  const line = (
    id: string,
    planId: string,
    department: string,
    lineType: string,
    plannedAmount: number,
    extra: Record<string, unknown> = {},
  ) => ({
    id,
    organizationId: ORG,
    planId,
    department,
    lineType,
    lineSubtype: null,
    plannedAmount,
    forecastAmount: null,
    unitPrice: null,
    unitCost: null,
    quantity: null,
    costModelKey: null,
    notes: null,
    sortOrder: 0,
    accountId: "acc_601",
    costTypeId: null,
    departmentId: null,
    companyId: "co_1",
    monthIndex: null,
    deletedAt: null,
    deletedBy: null,
    ...extra,
  })

  return {
    budgetPlan: [
      { id: PLAN_BUDGET, organizationId: ORG, name: "Budget 2026", year: 2026, kind: "budget", status: "approved", deletedAt: null, createdAt: new Date("2026-01-01") },
      { id: PLAN_ACTUAL, organizationId: ORG, name: "Actuals 2026", year: 2026, kind: "actual", status: "approved", deletedAt: null, createdAt: new Date("2026-01-02") },
      { id: "plan_budget_2025", organizationId: ORG, name: "Budget 2025", year: 2025, kind: "budget", status: "approved", deletedAt: null, createdAt: new Date("2025-01-01") },
    ],
    chartOfAccount: [
      { id: "acc_601", organizationId: ORG, code: "601", name: "Revenue" },
      { id: "acc_701", organizationId: ORG, code: "701", name: "Operating expenses" },
    ],
    productLine: [
      { id: "pl_a", organizationId: ORG, code: "PL-A", name: "Product A", unit: "ton" },
      { id: "pl_b", organizationId: ORG, code: "PL-B", name: "Product B", unit: "ton" },
    ],
    budgetCostType: [{ id: "ct_1", organizationId: ORG, key: "fixed", label: "Fixed" }],
    budgetDepartment: [{ id: "dep_1", organizationId: ORG, key: "ops", label: "Operations" }],
    company: [
      { id: "co_1", organizationId: ORG, code: "CPC", name: "Caspian Products", level: 2, role: "operational", isActive: true },
      { id: "co_2", organizationId: ORG, code: "EDEN", name: "Eden Agro", level: 2, role: "operational", isActive: true },
    ],

    budgetLine: [
      // ── Budget plan: parents + children, as imported ──
      line("bl_601", PLAN_BUDGET, "601", "revenue", 1_000_000),
      line("bl_601_01", PLAN_BUDGET, "601-01", "revenue", 600_000, { notes: "Domestic, wholesale", companyId: "co_1", monthIndex: 0 }),
      line("bl_601_02", PLAN_BUDGET, "601-02", "revenue", 400_000, { companyId: "co_2", monthIndex: 1 }),
      line("bl_701", PLAN_BUDGET, "701", "expense", 500_000, { accountId: "acc_701" }),
      line("bl_701_01", PLAN_BUDGET, "701-01", "expense", 300_000, { accountId: "acc_701", companyId: "co_1", monthIndex: 0 }),
      line("bl_701_02", PLAN_BUDGET, "701-02", "expense", 200_000, { accountId: "acc_701", companyId: null, monthIndex: null }),
      // ── Archived by a re-import: must never be counted ──
      line("bl_archived", PLAN_BUDGET, "601-01", "revenue", 999_999, {
        deletedAt: new Date("2026-03-01"),
        deletedBy: "u_import",
      }),
      // ── Another tenant's data: must never be visible ──
      { ...line("bl_other", PLAN_BUDGET, "601-01", "revenue", 777_777), organizationId: OTHER_ORG },
      // ── Actuals plan ──
      line("al_601", PLAN_ACTUAL, "601", "revenue", 900_000),
      line("al_601_01", PLAN_ACTUAL, "601-01", "revenue", 550_000),
      line("al_601_02", PLAN_ACTUAL, "601-02", "revenue", 350_000),
      line("al_701", PLAN_ACTUAL, "701", "expense", 480_000, { accountId: "acc_701" }),
      line("al_701_01", PLAN_ACTUAL, "701-01", "expense", 280_000, { accountId: "acc_701" }),
      line("al_701_02", PLAN_ACTUAL, "701-02", "expense", 200_000, { accountId: "acc_701" }),
    ],

    salesBudgetLine: [
      { id: "sb1", organizationId: ORG, planId: PLAN_BUDGET, productLineId: "pl_a", year: 2026, month: 1, quantity: 10, unitPrice: 100, amount: 1_000, notes: null },
      { id: "sb2", organizationId: ORG, planId: PLAN_BUDGET, productLineId: "pl_a", year: 2026, month: 2, quantity: 20, unitPrice: 100, amount: 2_000, notes: null },
      { id: "sb3", organizationId: ORG, planId: PLAN_BUDGET, productLineId: "pl_b", year: 2026, month: 3, quantity: 5, unitPrice: 200, amount: 1_000, notes: null },
      { id: "sb4", organizationId: ORG, planId: PLAN_BUDGET, productLineId: "pl_b", year: 2026, month: 4, quantity: 15, unitPrice: 200, amount: 3_000, notes: null },
      { id: "sb5", organizationId: ORG, planId: PLAN_BUDGET, productLineId: "pl_a", year: 2025, month: 12, quantity: 8, unitPrice: 100, amount: 800, notes: null },
      { id: "sb_other", organizationId: OTHER_ORG, planId: PLAN_BUDGET, productLineId: "pl_a", year: 2026, month: 1, quantity: 99, unitPrice: 999, amount: 98_901, notes: null },
    ],

    cOGSBudgetLine: [
      { id: "cg1", organizationId: ORG, planId: PLAN_BUDGET, productLineId: "pl_a", accountId: "acc_701", year: 2026, month: 1, productionQty: 10, totalCost: 600, notes: null },
      { id: "cg2", organizationId: ORG, planId: PLAN_BUDGET, productLineId: "pl_b", accountId: "acc_701", year: 2026, month: 1, productionQty: 5, totalCost: 400, notes: null },
    ],

    cashFlowEntry: [
      { id: "cf1", organizationId: ORG, year: 2026, month: 1, entryType: "inflow", source: "sales", amount: 5_000, description: "Customer receipts", activityType: "operating", isProjected: false, plannedAmount: 4_800, accountId: "acc_601", companyId: "co_1", createdAt: new Date("2026-01-31"), deletedAt: null },
      { id: "cf2", organizationId: ORG, year: 2026, month: 1, entryType: "outflow", source: "payroll", amount: 3_000, description: "Salaries", activityType: "operating", isProjected: false, plannedAmount: 3_100, accountId: "acc_701", companyId: "co_1", createdAt: new Date("2026-01-31"), deletedAt: null },
      { id: "cf_archived", organizationId: ORG, year: 2026, month: 1, entryType: "inflow", source: "sales", amount: 111_111, description: "Re-imported", activityType: "operating", isProjected: false, plannedAmount: 0, accountId: "acc_601", companyId: "co_1", createdAt: new Date("2026-01-31"), deletedAt: new Date("2026-02-01") },
    ],

    balanceSheetLine: [
      { id: "bs1", organizationId: ORG, planId: PLAN_ACTUAL, companyId: "co_1", isElimination: false, accountId: "acc_601", lineType: "asset", subType: "current", year: 2026, month: 12, amount: 10_000, notes: null, deletedAt: null },
      { id: "bs2", organizationId: ORG, planId: PLAN_ACTUAL, companyId: "co_1", isElimination: false, accountId: "acc_701", lineType: "liability", subType: "short_term", year: 2026, month: 12, amount: 4_000, notes: null, deletedAt: null },
      { id: "bs3", organizationId: ORG, planId: PLAN_ACTUAL, companyId: null, isElimination: true, accountId: "acc_601", lineType: "asset", subType: "current", year: 2026, month: 12, amount: -1_000, notes: "EJE", deletedAt: null },
    ],

    budgetForecastEntry: [],
    budgetAssumption: [
      { id: "as1", organizationId: ORG, planId: PLAN_BUDGET, category: "transport", key: "fuel_price", label: "Fuel price", value: 1.25, unit: "AZN", period: "monthly", notes: null, sortOrder: 1 },
    ],
  }
}

beforeEach(() => {
  db.current = createFakePrisma(seed()) as unknown as Record<string, unknown>
})

const sum = (rows: Array<Record<string, unknown>>, field: string) =>
  rows.reduce((s, r) => s + (typeof r[field] === "number" ? (r[field] as number) : 0), 0)

// ─────────────────────────────────────────────────────────────
describe("E2E — flat query path (budgetLines)", () => {
  const baseCols = [{ field: "department" }, { field: "lineType" }, { field: "plannedAmount" }]

  it("scopes to the caller's organization — another tenant's line never appears", async () => {
    const res = await executeBudgetReport(ORG, {
      entityType: "budgetLines",
      planId: PLAN_BUDGET,
      columns: baseCols,
      filters: [],
    })
    expect(res.data.every((r) => r.plannedAmount !== 777_777)).toBe(true)
  })

  it("scopes to the selected plan — actuals-plan lines stay out of a budget report", async () => {
    const res = await executeBudgetReport(ORG, {
      entityType: "budgetLines",
      planId: PLAN_BUDGET,
      columns: baseCols,
      filters: [],
    })
    expect(res.data.some((r) => r.plannedAmount === 550_000)).toBe(false)
  })

  it("excludes soft-deleted lines — a re-import cannot double-count", async () => {
    const res = await executeBudgetReport(ORG, {
      entityType: "budgetLines",
      planId: PLAN_BUDGET,
      columns: baseCols,
      filters: [],
    })
    expect(res.data.some((r) => r.plannedAmount === 999_999)).toBe(false)
  })

  it("excludes parent SAP codes so revenue is counted once, not twice", async () => {
    const res = await executeBudgetReport(ORG, {
      entityType: "budgetLines",
      planId: PLAN_BUDGET,
      columns: baseCols,
      filters: [],
    })
    const depts = res.data.map((r) => r.department)
    expect(depts).not.toContain("601")
    expect(depts).not.toContain("701")
    expect(depts).toEqual(expect.arrayContaining(["601-01", "601-02", "701-01", "701-02"]))
  })

  it("cross-foots: revenue total ties to the workbook (1 000 000, not 2 000 000)", async () => {
    const res = await executeBudgetReport(ORG, {
      entityType: "budgetLines",
      planId: PLAN_BUDGET,
      columns: baseCols,
      filters: [{ field: "lineType", op: "eq", value: "revenue" }],
    })
    expect(sum(res.data, "plannedAmount")).toBe(1_000_000)
  })

  it("cross-foots: expense total ties to the workbook (500 000)", async () => {
    const res = await executeBudgetReport(ORG, {
      entityType: "budgetLines",
      planId: PLAN_BUDGET,
      columns: baseCols,
      filters: [{ field: "lineType", op: "eq", value: "expense" }],
    })
    expect(sum(res.data, "plannedAmount")).toBe(500_000)
  })

  it("projects relation columns through the include path (account.code)", async () => {
    const res = await executeBudgetReport(ORG, {
      entityType: "budgetLines",
      planId: PLAN_BUDGET,
      columns: [{ field: "department" }, { field: "account.code" }, { field: "account.name" }],
      filters: [{ field: "lineType", op: "eq", value: "expense" }],
    })
    expect(res.data[0].account).toEqual({ code: "701", name: "Operating expenses" })
  })

  it("honours a numeric filter with string input (gte coerces via parseNumOrDate)", async () => {
    const res = await executeBudgetReport(ORG, {
      entityType: "budgetLines",
      planId: PLAN_BUDGET,
      columns: baseCols,
      filters: [{ field: "plannedAmount", op: "gte", value: "250000" }],
    })
    // 600k + 400k + 300k — the string "250000" was coerced, so 200 000 is out.
    // (A tighter threshold also strips a child and re-promotes its parent —
    // see BUG-04 in report-engine.bugs.test.ts.)
    expect(res.data.map((r) => r.department).sort()).toEqual(["601-01", "601-02", "701-01"])
  })

  it("honours a case-insensitive contains filter", async () => {
    const res = await executeBudgetReport(ORG, {
      entityType: "budgetLines",
      planId: PLAN_BUDGET,
      columns: [...baseCols, { field: "notes" }],
      filters: [{ field: "notes", op: "contains", value: "WHOLESALE" }],
    })
    expect(res.data).toHaveLength(1)
    expect(res.data[0].department).toBe("601-01")
  })

  it("sorts and limits", async () => {
    const res = await executeBudgetReport(ORG, {
      entityType: "budgetLines",
      planId: PLAN_BUDGET,
      columns: baseCols,
      filters: [],
      sortBy: "plannedAmount",
      sortOrder: "desc",
      limit: 2,
    })
    expect(res.data.map((r) => r.plannedAmount)).toEqual([600_000, 400_000])
  })

  it("computes flat aggregates for numeric columns", async () => {
    const res = await executeBudgetReport(ORG, {
      entityType: "budgetLines",
      planId: PLAN_BUDGET,
      columns: [{ field: "plannedAmount", aggregate: "sum" }],
      filters: [{ field: "lineType", op: "eq", value: "revenue" }],
    })
    expect(res.type).toBe("flat")
    if (res.type === "flat") {
      expect(res.aggregates?.plannedAmount_sum).toBe(1_000_000)
    }
  })
})

// ─────────────────────────────────────────────────────────────
describe("E2E — actuals-plan resolution (Fakt məlumatlar)", () => {
  it("a BUDGET plan id resolves to the matching-year ACTUALS plan", async () => {
    const res = await executeBudgetReport(ORG, {
      entityType: "budgetActuals",
      planId: PLAN_BUDGET,
      columns: [{ field: "department" }, { field: "plannedAmount" }],
      filters: [{ field: "department", op: "eq", value: "601-01" }],
    })
    expect(res.data).toHaveLength(1)
    expect(res.data[0].plannedAmount).toBe(550_000) // actuals, not the 600 000 budget
  })

  it("an ACTUALS plan id resolves to itself", async () => {
    const res = await executeBudgetReport(ORG, {
      entityType: "budgetActuals",
      planId: PLAN_ACTUAL,
      columns: [{ field: "department" }, { field: "plannedAmount" }],
      filters: [{ field: "department", op: "eq", value: "601-01" }],
    })
    expect(res.data[0].plannedAmount).toBe(550_000)
  })

  it("falls back to the requested plan when the year has no actuals plan", async () => {
    const res = await executeBudgetReport(ORG, {
      entityType: "budgetActuals",
      planId: "plan_budget_2025",
      columns: [{ field: "department" }, { field: "plannedAmount" }],
      filters: [],
    })
    expect(res.data).toEqual([]) // 2025 plan has no lines; no cross-year bleed
  })

  it("never resolves across organizations", async () => {
    const res = await executeBudgetReport(OTHER_ORG, {
      entityType: "budgetActuals",
      planId: PLAN_BUDGET,
      columns: [{ field: "department" }, { field: "plannedAmount" }],
      filters: [],
    })
    expect(res.data.every((r) => r.plannedAmount !== 550_000)).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────
describe("E2E — period roll-up path (salesBudget)", () => {
  const cols = [{ field: "year" }, { field: "month" }, { field: "amount" }]

  it("rolls up by month, one bucket per year-month, zero-padded key", async () => {
    const res = await executeBudgetReport(ORG, {
      entityType: "salesBudget",
      planId: PLAN_BUDGET,
      columns: cols,
      filters: [],
      periodGroupBy: "month",
    })
    expect(res.type).toBe("period")
    const byPeriod = Object.fromEntries(res.data.map((r) => [r.period, r.amount]))
    expect(byPeriod["2026-01"]).toBe(1_000)
    expect(byPeriod["2026-02"]).toBe(2_000)
    expect(byPeriod["2025-12"]).toBe(800)
  })

  it("rolls up by quarter on calendar boundaries (Q1 Jan-Mar, Q2 Apr-Jun)", async () => {
    const res = await executeBudgetReport(ORG, {
      entityType: "salesBudget",
      planId: PLAN_BUDGET,
      columns: cols,
      filters: [],
      periodGroupBy: "quarter",
    })
    const byPeriod = Object.fromEntries(res.data.map((r) => [r.period, r.amount]))
    expect(byPeriod["2026-Q1"]).toBe(4_000) // 1 000 + 2 000 + 1 000
    expect(byPeriod["2026-Q2"]).toBe(3_000)
    expect(byPeriod["2025-Q4"]).toBe(800)
  })

  it("rolls up by year and the year total equals the sum of its quarters", async () => {
    const byYear = await executeBudgetReport(ORG, {
      entityType: "salesBudget", planId: PLAN_BUDGET, columns: cols, filters: [], periodGroupBy: "year",
    })
    const byQuarter = await executeBudgetReport(ORG, {
      entityType: "salesBudget", planId: PLAN_BUDGET, columns: cols, filters: [], periodGroupBy: "quarter",
    })
    const y2026 = byYear.data.find((r) => r.period === "2026")
    const q2026 = byQuarter.data.filter((r) => String(r.period).startsWith("2026"))
    expect(y2026?.amount).toBe(sum(q2026, "amount"))
    expect(y2026?.amount).toBe(7_000)
  })

  it("returns periods in ascending chronological order", async () => {
    const res = await executeBudgetReport(ORG, {
      entityType: "salesBudget", planId: PLAN_BUDGET, columns: cols, filters: [], periodGroupBy: "month",
    })
    expect(res.data.map((r) => r.period)).toEqual(["2025-12", "2026-01", "2026-02", "2026-03", "2026-04"])
  })

  it("keeps another tenant's rows out of every bucket", async () => {
    const res = await executeBudgetReport(ORG, {
      entityType: "salesBudget", planId: PLAN_BUDGET, columns: cols, filters: [], periodGroupBy: "year",
    })
    expect(sum(res.data, "amount")).toBe(7_800) // 7 000 (2026) + 800 (2025), no 98 901
  })
})

// ─────────────────────────────────────────────────────────────
describe("E2E — groupBy path", () => {
  it("sums each group and counts its rows", async () => {
    const res = await executeBudgetReport(ORG, {
      entityType: "budgetLines",
      planId: PLAN_BUDGET,
      columns: [{ field: "plannedAmount", aggregate: "sum" }],
      filters: [],
      groupBy: "lineType",
    })
    expect(res.type).toBe("grouped")
    const byType = Object.fromEntries(res.data.map((r) => [r.lineType, r]))
    expect(byType.revenue.plannedAmount).toBe(1_000_000)
    expect(byType.revenue.count).toBe(2)
    expect(byType.expense.plannedAmount).toBe(500_000)
    expect(byType.expense.count).toBe(2)
  })

  it("group totals reconcile with the flat total for the same filter", async () => {
    const grouped = await executeBudgetReport(ORG, {
      entityType: "budgetLines", planId: PLAN_BUDGET,
      columns: [{ field: "plannedAmount", aggregate: "sum" }], filters: [], groupBy: "lineType",
    })
    const flat = await executeBudgetReport(ORG, {
      entityType: "budgetLines", planId: PLAN_BUDGET,
      columns: [{ field: "plannedAmount" }], filters: [],
    })
    expect(sum(grouped.data, "plannedAmount")).toBe(sum(flat.data, "plannedAmount"))
  })

  it("sorts groups by the requested numeric field descending", async () => {
    const res = await executeBudgetReport(ORG, {
      entityType: "budgetLines", planId: PLAN_BUDGET,
      columns: [{ field: "plannedAmount", aggregate: "sum" }], filters: [],
      groupBy: "lineType", sortBy: "plannedAmount", sortOrder: "desc",
    })
    expect(res.data.map((r) => r.lineType)).toEqual(["revenue", "expense"])
  })

  it("drops the raw Prisma _sum / _count envelope from the response rows", async () => {
    const res = await executeBudgetReport(ORG, {
      entityType: "budgetLines", planId: PLAN_BUDGET,
      columns: [{ field: "plannedAmount", aggregate: "sum" }], filters: [], groupBy: "lineType",
    })
    expect(res.data[0]).not.toHaveProperty("_sum")
    expect(res.data[0]).not.toHaveProperty("_count")
  })
})

// ─────────────────────────────────────────────────────────────
describe("E2E — company dimension (Phase 15.10)", () => {
  /**
   * `companyId` is on budgetLine, budgetActual, balanceSheetLine and
   * cashFlowEntry, and no entity exposed it — so a ~60-company holding could
   * not ask for one company's P&L, and every report was a group total.
   *
   * The fixture attributes: 601-01 and 701-01 to CPC, 601-02 to EDEN, and
   * leaves 701-02 with no company at all (holding-level / legacy rows are a
   * real case — they must stay countable, not disappear).
   */
  const cols = [{ field: "department" }, { field: "plannedAmount" }]

  it("filters to one company through the relation", async () => {
    const res = await executeBudgetReport(ORG, {
      entityType: "budgetLines", planId: PLAN_BUDGET, columns: cols,
      filters: [{ field: "company.code", op: "eq", value: "CPC" }],
    })
    expect(res.data.map((r) => r.department).sort()).toEqual(["601-01", "701-01"])
    expect(sum(res.data, "plannedAmount")).toBe(900_000)
  })

  it("filters by company name, case-insensitively", async () => {
    const res = await executeBudgetReport(ORG, {
      entityType: "budgetLines", planId: PLAN_BUDGET, columns: cols,
      filters: [{ field: "company.name", op: "contains", value: "eden" }],
    })
    expect(res.data.map((r) => r.department)).toEqual(["601-02"])
  })

  it("projects the company as a column", async () => {
    const res = await executeBudgetReport(ORG, {
      entityType: "budgetLines", planId: PLAN_BUDGET,
      columns: [{ field: "department" }, { field: "company.code" }, { field: "company.name" }],
      filters: [{ field: "department", op: "eq", value: "601-02" }],
    })
    expect(res.data[0].company).toEqual({ code: "EDEN", name: "Eden Agro" })
  })

  it("groups by company and resolves cuids to names", async () => {
    const res = await executeBudgetReport(ORG, {
      entityType: "budgetLines", planId: PLAN_BUDGET,
      columns: [{ field: "plannedAmount", aggregate: "sum" }], filters: [],
      groupBy: "companyId",
    })
    expect(res.type).toBe("grouped")
    expect(res.groupLabelField).toBe("companyLabel")
    const byLabel = Object.fromEntries(res.data.map((r) => [r.companyLabel, r.plannedAmount]))
    expect(byLabel["Caspian Products"]).toBe(900_000)
    expect(byLabel["Eden Agro"]).toBe(400_000)
  })

  it("a row with no company keeps its own group with a null label, never a fake one", async () => {
    const res = await executeBudgetReport(ORG, {
      entityType: "budgetLines", planId: PLAN_BUDGET,
      columns: [{ field: "plannedAmount", aggregate: "sum" }], filters: [],
      groupBy: "companyId",
    })
    const unscoped = res.data.find((r) => r.companyId === null)!
    expect(unscoped.companyLabel).toBeNull()
    expect(unscoped.plannedAmount).toBe(200_000)
  })

  it("company groups cross-foot to the ungrouped total", async () => {
    const grouped = await executeBudgetReport(ORG, {
      entityType: "budgetLines", planId: PLAN_BUDGET,
      columns: [{ field: "plannedAmount", aggregate: "sum" }], filters: [], groupBy: "companyId",
    })
    const flat = await executeBudgetReport(ORG, {
      entityType: "budgetLines", planId: PLAN_BUDGET, columns: cols, filters: [],
    })
    expect(sum(grouped.data, "plannedAmount")).toBe(sum(flat.data, "plannedAmount"))
    expect(sum(grouped.data, "plannedAmount")).toBe(1_500_000)
  })

  it("the label lookup is org-scoped — a company id from elsewhere resolves to null", async () => {
    const store = seed()
    store.company = [{ id: "co_1", organizationId: OTHER_ORG, code: "X", name: "Not yours", level: 2, role: "operational", isActive: true }]
    db.current = createFakePrisma(store) as unknown as Record<string, unknown>
    const res = await executeBudgetReport(ORG, {
      entityType: "budgetLines", planId: PLAN_BUDGET,
      columns: [{ field: "plannedAmount", aggregate: "sum" }], filters: [], groupBy: "companyId",
    })
    expect(res.data.every((r) => r.companyLabel === null)).toBe(true)
  })

  it("cash flow and balance sheet carry the same dimension", async () => {
    const cf = await executeBudgetReport(ORG, {
      entityType: "cashFlow", columns: [{ field: "amount" }, { field: "company.code" }],
      filters: [{ field: "company.code", op: "eq", value: "CPC" }],
    })
    expect(cf.data).toHaveLength(2)

    const bs = await executeBudgetReport(ORG, {
      entityType: "balanceSheet", planId: PLAN_ACTUAL,
      columns: [{ field: "lineType" }, { field: "amount" }],
      filters: [{ field: "company.code", op: "eq", value: "CPC" }],
    })
    // The elimination row has no company, so a per-company read excludes it.
    expect(bs.data).toHaveLength(2)
    expect(sum(bs.data, "amount")).toBe(14_000)
  })

  it("an entity without the column does not offer it", () => {
    for (const entity of ["salesBudget", "cogsBudget", "forecasts", "assumptions"]) {
      const names = getEntityFields(entity).map((f) => f.name)
      expect(names).not.toContain("companyId")
      expect(names).not.toContain("company.code")
    }
  })
})

// ─────────────────────────────────────────────────────────────
describe("E2E — monthly P&L from monthIndex (Phase 15.10)", () => {
  /**
   * BudgetLine has no year/month columns: the month is `monthIndex` (0-11)
   * and the year comes from the plan, so `hasYearMonth: false` hid the period
   * control and a monthly P&L was not buildable at all.
   *
   * Fixture: 601-01 and 701-01 in January, 601-02 in February, 701-02 with no
   * month — the nullable-by-design case (legacy, annual and rollup-derived
   * rows all carry null).
   */
  const cols = [{ field: "department" }, { field: "plannedAmount" }]

  it("buckets by month, taking the year from the plan", async () => {
    const res = await executeBudgetReport(ORG, {
      entityType: "budgetLines", planId: PLAN_BUDGET, columns: cols,
      filters: [], periodGroupBy: "month",
    })
    expect(res.type).toBe("period")
    const byPeriod = Object.fromEntries(res.data.map((r) => [r.period, r.plannedAmount]))
    expect(byPeriod["2026-01"]).toBe(900_000) // 600 000 + 300 000
    expect(byPeriod["2026-02"]).toBe(400_000)
  })

  it("monthIndex 0 is January, not December", async () => {
    const res = await executeBudgetReport(ORG, {
      entityType: "budgetLines", planId: PLAN_BUDGET, columns: cols,
      filters: [{ field: "department", op: "eq", value: "601-01" }],
      periodGroupBy: "month",
    })
    expect(res.data[0].period).toBe("2026-01")
  })

  it("rows with no month go to an explicit bucket, counted and reported", async () => {
    const res = await executeBudgetReport(ORG, {
      entityType: "budgetLines", planId: PLAN_BUDGET, columns: cols,
      filters: [], periodGroupBy: "month",
    })
    const unknown = res.data.find((r) => r.period === "unknown")!
    expect(unknown.plannedAmount).toBe(200_000)
    expect(res.rowsWithoutPeriod).toBe(1)
  })

  it("the unresolved bucket sorts last, not into the middle of the year", async () => {
    const res = await executeBudgetReport(ORG, {
      entityType: "budgetLines", planId: PLAN_BUDGET, columns: cols,
      filters: [], periodGroupBy: "month",
    })
    expect(res.data.map((r) => r.period)).toEqual(["2026-01", "2026-02", "unknown"])
  })

  it("the monthly total still cross-foots to the same report ungrouped", async () => {
    const monthly = await executeBudgetReport(ORG, {
      entityType: "budgetLines", planId: PLAN_BUDGET, columns: cols, filters: [], periodGroupBy: "month",
    })
    const flat = await executeBudgetReport(ORG, {
      entityType: "budgetLines", planId: PLAN_BUDGET, columns: cols, filters: [],
    })
    // This is the property that makes the unknown bucket worth having: drop
    // those rows and the monthly view quietly under-reports by 200 000.
    expect(sum(monthly.data, "plannedAmount")).toBe(sum(flat.data, "plannedAmount"))
  })

  it("quarters roll the synthesized months up correctly", async () => {
    const res = await executeBudgetReport(ORG, {
      entityType: "budgetLines", planId: PLAN_BUDGET, columns: cols, filters: [], periodGroupBy: "quarter",
    })
    expect(res.data.find((r) => r.period === "2026-Q1")?.plannedAmount).toBe(1_300_000)
  })

  it("the yearly bucket keeps rows that have a year but no month", async () => {
    const res = await executeBudgetReport(ORG, {
      entityType: "budgetLines", planId: PLAN_BUDGET, columns: cols, filters: [], periodGroupBy: "year",
    })
    // Year comes from the plan, so a null monthIndex is no obstacle here.
    expect(res.data.find((r) => r.period === "2026")?.plannedAmount).toBe(1_500_000)
    expect(res.data.some((r) => r.period === "unknown")).toBe(false)
  })

  it("does not sum rates or ordinals into a period bucket", async () => {
    const res = await executeBudgetReport(ORG, {
      entityType: "budgetLines", planId: PLAN_BUDGET, columns: cols, filters: [], periodGroupBy: "month",
    })
    expect(res.data[0].unitPrice).toBeUndefined()
    expect(res.data[0].sortOrder).toBeUndefined()
  })

  it("entities with real year/month columns are untouched by the synthesis", async () => {
    const res = await executeBudgetReport(ORG, {
      entityType: "salesBudget", planId: PLAN_BUDGET,
      columns: [{ field: "year" }, { field: "month" }, { field: "amount" }],
      filters: [], periodGroupBy: "month",
    })
    expect(res.data.map((r) => r.period)).toEqual(["2025-12", "2026-01", "2026-02", "2026-03", "2026-04"])
    expect(res.rowsWithoutPeriod).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────
describe("E2E — soft-delete coverage per entity", () => {
  it("cashFlow excludes archived entries", async () => {
    const res = await executeBudgetReport(ORG, {
      entityType: "cashFlow",
      columns: [{ field: "amount" }, { field: "entryType" }],
      filters: [],
    })
    expect(res.data.some((r) => r.amount === 111_111)).toBe(false)
    expect(res.data).toHaveLength(2)
  })

  it("balanceSheet returns live rows including intragroup eliminations", async () => {
    const res = await executeBudgetReport(ORG, {
      entityType: "balanceSheet",
      planId: PLAN_ACTUAL,
      columns: [{ field: "lineType" }, { field: "amount" }],
      filters: [],
    })
    expect(res.data).toHaveLength(3)
    expect(sum(res.data, "amount")).toBe(13_000) // 10 000 - 1 000 + 4 000
  })
})

// ─────────────────────────────────────────────────────────────
describe("E2E — /api/budgeting/reports/preview with the real engine", () => {
  it("401 without a session", async () => {
    const { POST } = await import("@/app/api/budgeting/reports/preview/route")
    await mockSession(null)
    const res = await POST(
      makeRequest("/api/budgeting/reports/preview", {
        method: "POST",
        json: { entityType: "budgetLines" },
      }),
    )
    expect(res.status).toBe(401)
  })

  it("400 for an unknown data source, and lists the valid ones", async () => {
    const { POST } = await import("@/app/api/budgeting/reports/preview/route")
    await mockSession({ orgId: ORG, userId: "u1", role: "viewer" })
    const res = await POST(
      makeRequest("/api/budgeting/reports/preview", {
        method: "POST",
        json: { entityType: "generalLedger" },
      }),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.available).toContain("budgetLines")
  })

  it("returns de-duplicated, org-scoped rows end to end", async () => {
    const { POST } = await import("@/app/api/budgeting/reports/preview/route")
    await mockSession({ orgId: ORG, userId: "u1", role: "viewer" })
    const res = await POST(
      makeRequest("/api/budgeting/reports/preview", {
        method: "POST",
        json: {
          entityType: "budgetLines",
          planId: PLAN_BUDGET,
          columns: [{ field: "department" }, { field: "plannedAmount" }],
          filters: [{ field: "lineType", op: "eq", value: "revenue" }],
        },
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(sum(body.data, "plannedAmount")).toBe(1_000_000)
  })
})

// ─────────────────────────────────────────────────────────────
describe("E2E — /api/budgeting/reports/export", () => {
  async function exportPost(json: Record<string, unknown>) {
    const { POST } = await import("@/app/api/budgeting/reports/export/route")
    await mockSession({ orgId: ORG, userId: "u1", role: "editor" })
    return POST(makeRequest("/api/budgeting/reports/export", { method: "POST", json }))
  }

  it("CSV: header labels come from the entity config, values from the rows", async () => {
    const res = await exportPost({
      format: "csv",
      entityType: "budgetLines",
      planId: PLAN_BUDGET,
      columns: [{ field: "department" }, { field: "plannedAmount" }],
      filters: [{ field: "lineType", op: "eq", value: "revenue" }],
      sortBy: "plannedAmount",
      sortOrder: "desc",
    })
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toContain("text/csv")
    const csv = await res.text()
    const lines = csv.split("\n")
    expect(lines[0]).toBe("Department,Planned Amount")
    expect(lines[1]).toBe("601-01,600000")
    expect(lines[2]).toBe("601-02,400000")
  })

  it("CSV: quotes a value containing a comma", async () => {
    const res = await exportPost({
      format: "csv",
      entityType: "budgetLines",
      planId: PLAN_BUDGET,
      columns: [{ field: "department" }, { field: "notes" }],
      filters: [{ field: "notes", op: "contains", value: "wholesale" }],
    })
    const csv = await res.text()
    expect(csv.split("\n")[1]).toBe('601-01,"Domestic, wholesale"')
  })

  it("CSV: flattens relation columns to dotted keys", async () => {
    const res = await exportPost({
      format: "csv",
      entityType: "budgetLines",
      planId: PLAN_BUDGET,
      columns: [{ field: "department" }, { field: "account.code" }],
      filters: [{ field: "lineType", op: "eq", value: "expense" }],
      sortBy: "plannedAmount",
      sortOrder: "desc",
    })
    const csv = await res.text()
    expect(csv.split("\n")[1]).toBe("701-01,701")
  })

  it("404 when the configuration matches no rows", async () => {
    const res = await exportPost({
      format: "csv",
      entityType: "budgetLines",
      planId: PLAN_BUDGET,
      columns: [{ field: "department" }],
      filters: [{ field: "department", op: "eq", value: "does-not-exist" }],
    })
    expect(res.status).toBe(404)
  })

  it("400 for an unsupported format", async () => {
    const res = await exportPost({ format: "pdf", entityType: "budgetLines" })
    expect(res.status).toBe(400)
  })

  it("XLSX: workbook carries a header row, the data, and a SUM total row", async () => {
    const res = await exportPost({
      format: "xlsx",
      entityType: "budgetLines",
      planId: PLAN_BUDGET,
      columns: [{ field: "department" }, { field: "plannedAmount" }],
      filters: [{ field: "lineType", op: "eq", value: "revenue" }],
      sortBy: "plannedAmount",
      sortOrder: "desc",
    })
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toContain("spreadsheetml")

    const ExcelJS = await import("exceljs")
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await res.arrayBuffer())
    const sheet = wb.worksheets[0]

    expect(sheet.getRow(1).getCell(1).value).toBe("Department")
    expect(sheet.getRow(2).getCell(1).value).toBe("601-01")
    expect(sheet.getRow(2).getCell(2).value).toBe(600_000)
    // Row 4 = 2 data rows + header, i.e. the TOTAL row
    expect(sheet.getRow(4).getCell(1).value).toBe("TOTAL")
    const totalCell = sheet.getRow(4).getCell(2).value as { formula?: string }
    expect(totalCell.formula).toBe("SUM(B2:B3)")
  })

  it("XLSX: numeric columns are right-aligned with a thousands format", async () => {
    const res = await exportPost({
      format: "xlsx",
      entityType: "budgetLines",
      planId: PLAN_BUDGET,
      columns: [{ field: "department" }, { field: "plannedAmount" }],
      filters: [{ field: "lineType", op: "eq", value: "revenue" }],
    })
    const ExcelJS = await import("exceljs")
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await res.arrayBuffer())
    const sheet = wb.worksheets[0]
    expect(sheet.getColumn(2).numFmt).toBe("#,##0.00")
    expect(sheet.getColumn(2).alignment?.horizontal).toBe("right")
  })
})
