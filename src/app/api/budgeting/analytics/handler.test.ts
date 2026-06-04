// @vitest-environment node
/**
 * Smoke handler test for `/api/budgeting/analytics` (GET).
 *
 * The full analytics aggregator is ~692 LOC with many Prisma + cost-
 * model dependencies. This file locks the auth + early-return envelope
 * — the most regression-prone surface. Aggregation correctness is
 * exercised through the lib-level unit tests for the pure helpers
 * (elapsed-months, cost-model-map, etc.).
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    budgetPlan: { findFirst: vi.fn() },
    budgetLine: { findMany: vi.fn() },
    budgetActual: { findMany: vi.fn() },
    budgetCostType: { findMany: vi.fn() },
    budgetDepartment: { findMany: vi.fn() },
    budgetForecastEntry: { findMany: vi.fn() },
    salesForecast: { findMany: vi.fn() },
    expenseForecast: { findMany: vi.fn() },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/cost-model/db", () => ({
  loadAndCompute: vi.fn().mockResolvedValue(null),
}))
vi.mock("@/lib/budgeting/company-filter", () => ({
  resolveCompanyFilter: vi.fn(),
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { resolveCompanyFilter } from "@/lib/budgeting/company-filter"
import { GET } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  Object.values(prismaMock).forEach((model) => {
    Object.values(model).forEach((fn) => {
      if (typeof (fn as { mockReset?: () => void }).mockReset === "function") {
        ;(fn as { mockReset: () => void }).mockReset()
      }
    })
  })
  prismaMock.budgetLine.findMany.mockResolvedValue([])
  prismaMock.budgetActual.findMany.mockResolvedValue([])
  prismaMock.budgetCostType.findMany.mockResolvedValue([])
  prismaMock.budgetDepartment.findMany.mockResolvedValue([])
  prismaMock.budgetForecastEntry.findMany.mockResolvedValue([])
  prismaMock.salesForecast.findMany.mockResolvedValue([])
  prismaMock.expenseForecast.findMany.mockResolvedValue([])
  ;(resolveCompanyFilter as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue({ kind: "all" })
})

describe("GET /api/budgeting/analytics — auth + early returns", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(makeRequest("/api/budgeting/analytics?planId=p1"))
    expect(res.status).toBe(401)
  })

  it("400 missing planId", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await GET(makeRequest("/api/budgeting/analytics"))
    expect(res.status).toBe(400)
  })

  it("404 cross-tenant companyId (resolveCompanyFilter → not_found)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    ;(resolveCompanyFilter as ReturnType<typeof vi.fn>).mockResolvedValue({ kind: "not_found" })
    const res = await GET(
      makeRequest("/api/budgeting/analytics?planId=p1&companyId=other-org-co"),
    )
    expect(res.status).toBe(404)
  })

  it("200 with empty-subgroup sentinel when sub-group has no children", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    ;(resolveCompanyFilter as ReturnType<typeof vi.fn>).mockResolvedValue({
      kind: "single",
      companyIds: [],
    })
    const res = await GET(
      makeRequest("/api/budgeting/analytics?planId=p1&companyId=empty-sub-group"),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data._emptyReason).toBe("subgroup_no_children")
    expect(body.data.byCategory).toEqual([])
    // Bail early — no expensive aggregation calls
    expect(prismaMock.budgetLine.findMany).not.toHaveBeenCalled()
  })

  it("404 plan not found (planId exists in URL but missing in org)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    ;(resolveCompanyFilter as ReturnType<typeof vi.fn>).mockResolvedValue({ kind: "all" })
    prismaMock.budgetPlan.findFirst.mockResolvedValue(null) // plan absent
    const res = await GET(makeRequest("/api/budgeting/analytics?planId=p-bogus"))
    expect(res.status).toBe(404)
  })

  it("actuals plan surfaces its own lines as the ACTUAL side (not 0)", async () => {
    // Fix (2026-06-04): an actuals plan IS the realized P&L — its own lines
    // must show as the actual headline (39.4M), not 0. Without the fix the
    // actual column read 0 (no BudgetActual rows; Y4 fallback is budget-only).
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    ;(resolveCompanyFilter as ReturnType<typeof vi.fn>).mockResolvedValue({ kind: "all" })
    prismaMock.budgetPlan.findFirst.mockResolvedValue({
      id: "actuals-2025",
      organizationId: ORG_ID,
      year: 2025,
      kind: "actual",
      periodType: "annual",
      month: null,
      quarter: null,
    })
    const line = (over: Record<string, unknown>) => ({
      id: "x",
      lineType: "expense",
      plannedAmount: 0,
      forecastAmount: null,
      monthIndex: 1,
      isAutoActual: false,
      isAutoPlanned: false,
      parentId: null,
      companyId: "c1",
      category: null,
      account: null,
      costType: null,
      budgetDept: null,
      ...over,
    })
    prismaMock.budgetLine.findMany.mockResolvedValue([
      line({ id: "r1", lineType: "revenue", plannedAmount: 39_400_000, account: { code: "4000", name: "Revenue", accountType: "revenue" } }),
      line({ id: "e1", lineType: "expense", plannedAmount: 46_300_000, account: { code: "6000", name: "Expense", accountType: "expense" } }),
    ])
    const res = await GET(makeRequest("/api/budgeting/analytics?planId=actuals-2025"))
    expect(res.status).toBe(200)
    const body = await res.json()
    // The actual side now reflects the plan's own lines (the realized data),
    // not 0 — and coincides with the planned side (execution ≈ fully realized).
    expect(body.data.totalRevenueActual).toBe(39_400_000)
    expect(body.data.totalRevenuePlanned).toBe(39_400_000)
    // …and the PER-CATEGORY rows carry the same realized figures (actual =
    // planned, variance 0) so the detailed P&L table shows the data that
    // exists instead of "0 actual / −planned". (User: "где есть данные ты
    // всё равно игнорируешь" — surface it per-category, not just aggregate.)
    const rev = body.data.byCategory.find((c: { lineType: string }) => c.lineType === "revenue")
    expect(rev.actual).toBe(39_400_000)
    expect(rev.variance).toBe(0)
    // Flag tells the UI per-category actuals are real → render numbers, not "—".
    expect(body.data.perCategoryActualsAvailable).toBe(true)
  })

  it("budget plan with no mappable actuals → perCategoryActualsAvailable=false (UI shows —)", async () => {
    // A budget plan whose realized figures live in the matching-year Actuals
    // plan (different account taxonomy) can't map actuals per budget-category.
    // The route still computes the AGGREGATE (Y4) for the KPI cards, but the
    // per-category column has no data → flag false so the table renders "—"
    // instead of a misleading 0/−planned variance.
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    ;(resolveCompanyFilter as ReturnType<typeof vi.fn>).mockResolvedValue({ kind: "all" })
    // First findFirst = the budget plan; second (Y4 actuals lookup) = none.
    prismaMock.budgetPlan.findFirst
      .mockResolvedValueOnce({
        id: "budget-2026",
        organizationId: ORG_ID,
        year: 2026,
        kind: "budget",
        periodType: "annual",
        month: null,
        quarter: null,
      })
      .mockResolvedValueOnce(null)
    prismaMock.budgetLine.findMany.mockResolvedValue([
      {
        id: "r1", lineType: "revenue", plannedAmount: 9_500_000, forecastAmount: null,
        monthIndex: 1, isAutoActual: false, isAutoPlanned: false, parentId: null,
        companyId: "c1", category: null, costType: null, budgetDept: null,
        account: { code: "4000", name: "Revenue", accountType: "revenue" },
      },
    ])
    const res = await GET(makeRequest("/api/budgeting/analytics?planId=budget-2026"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.perCategoryActualsAvailable).toBe(false)
    const rev = body.data.byCategory.find((c: { lineType: string }) => c.lineType === "revenue")
    expect(rev.actual).toBe(0)
    expect(rev.actualAvailable).toBe(false)
  })

  it("budget plan: per-category actual JOINS the matching actuals plan by shared code (Y4)", async () => {
    // The fix for "data should have landed at AI import": once the İcmal budget
    // is re-keyed onto the PLF chart of accounts the actuals use, a budget
    // category's actual is the matching actuals-plan line summed by shared code.
    // A code with no actuals counterpart (subsidy) stays actualAvailable=false → "—".
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    ;(resolveCompanyFilter as ReturnType<typeof vi.fn>).mockResolvedValue({ kind: "all" })
    prismaMock.budgetPlan.findFirst
      .mockResolvedValueOnce({ id: "budget-2026", organizationId: ORG_ID, year: 2026, kind: "budget", periodType: "annual", month: null, quarter: null })
      .mockResolvedValueOnce({ id: "actuals-2026" })
    prismaMock.budgetLine.findMany
      .mockResolvedValueOnce([
        // budget lines, re-keyed: Glucose → PLF code (mappable); Subsidy → ICMAL (no actual)
        { id: "b1", lineType: "revenue", plannedAmount: 7_000_000, forecastAmount: null, monthIndex: 1, isAutoActual: false, isAutoPlanned: false, parentId: null, companyId: "c1", category: null, department: null, costType: null, budgetDept: null, account: { code: "PLF.01.02.01", name: "Glucose", accountType: "revenue" } },
        { id: "b2", lineType: "revenue", plannedAmount: 9_000_000, forecastAmount: null, monthIndex: 1, isAutoActual: false, isAutoPlanned: false, parentId: null, companyId: "c1", category: null, department: null, costType: null, budgetDept: null, account: { code: "ICMAL.SUBSIDY.x", name: "Subsidy", accountType: "revenue" } },
      ])
      .mockResolvedValueOnce([
        // matching actuals plan: only Glucose has a realized figure
        { lineType: "revenue", plannedAmount: 2_600_000, monthIndex: 1, account: { accountType: "revenue", code: "PLF.01.02.01" } },
      ])
    const res = await GET(makeRequest("/api/budgeting/analytics?planId=budget-2026"))
    expect(res.status).toBe(200)
    const body = await res.json()
    const glucose = body.data.byCategory.find((c: { accountCode: string }) => c.accountCode === "PLF.01.02.01")
    expect(glucose.actual).toBe(2_600_000) // joined from actuals by shared code
    expect(glucose.actualAvailable).toBe(true)
    const subsidy = body.data.byCategory.find((c: { accountCode: string }) => c.accountCode === "ICMAL.SUBSIDY.x")
    expect(subsidy.actual).toBe(0)
    expect(subsidy.actualAvailable).toBe(false) // no actuals code → renders "—"
    expect(body.data.perCategoryActualsAvailable).toBe(true) // some categories have real actuals
  })
})
