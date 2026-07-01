// @vitest-environment node
/**
 * Phase 7.G Turn LXIII — handler tests for `/api/budgeting/pnl`.
 *
 * Closes Turn-LXII Tier 2 H1 (top-3 untested critical handlers). PnL
 * route is 361 LOC of P&L aggregation; this is smoke-level (auth gate +
 * required-param gate + plan-not-found gate + cross-tenant 404 + happy
 * path). Full P&L computation correctness is out of scope — that needs
 * fixtures + golden-output assertions (Tier 3 H3 territory).
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock, companyFilterMock } = vi.hoisted(() => ({
  prismaMock: {
    budgetPlan: { findFirst: vi.fn() },
    budgetLine: { findMany: vi.fn() },
    salesBudgetLine: { findMany: vi.fn() },
    cOGSBudgetLine: { findMany: vi.fn() },
    budgetActual: { findMany: vi.fn() },
    user: { findFirst: vi.fn().mockResolvedValue({ allowedSubGroupIds: [] }) },
  },
  companyFilterMock: { resolveCompanyFilter: vi.fn() },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/budgeting/company-filter", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/budgeting/company-filter")
  >("@/lib/budgeting/company-filter")
  return { ...actual, ...companyFilterMock }
})

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  prismaMock.budgetPlan.findFirst.mockReset()
  prismaMock.budgetLine.findMany.mockReset().mockResolvedValue([])
  prismaMock.salesBudgetLine.findMany.mockReset().mockResolvedValue([])
  prismaMock.cOGSBudgetLine.findMany.mockReset().mockResolvedValue([])
  prismaMock.budgetActual.findMany.mockReset().mockResolvedValue([])
  // Default: org-wide consolidated (no companyId param).
  companyFilterMock.resolveCompanyFilter
    .mockReset()
    .mockResolvedValue({ kind: "all" })
})

describe("GET /api/budgeting/pnl — gates", () => {
  it("returns 401 when unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(makeRequest("/api/budgeting/pnl?planId=p1"))
    expect(res.status).toBe(401)
    expect(prismaMock.budgetPlan.findFirst).not.toHaveBeenCalled()
  })

  it("returns 400 when planId param missing", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await GET(makeRequest("/api/budgeting/pnl"))
    expect(res.status).toBe(400)
    expect(prismaMock.budgetPlan.findFirst).not.toHaveBeenCalled()
  })

  it("returns 404 when plan not found / cross-tenant", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.budgetPlan.findFirst.mockResolvedValue(null)
    const res = await GET(makeRequest("/api/budgeting/pnl?planId=p_other_org"))
    expect(res.status).toBe(404)
    // Org filter must be applied to plan lookup
    const findArg = prismaMock.budgetPlan.findFirst.mock.calls[0][0]
    expect(findArg.where.organizationId).toBe(ORG_ID)
    expect(findArg.where.deletedAt).toBeNull()
  })

  it("returns 404 when companyFilter is not_found (cross-tenant company id)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.budgetPlan.findFirst.mockResolvedValue({ year: 2025 })
    companyFilterMock.resolveCompanyFilter.mockResolvedValue({ kind: "not_found" })
    const res = await GET(
      makeRequest("/api/budgeting/pnl?planId=p1&companyId=evil"),
    )
    expect(res.status).toBe(404)
  })
})

describe("GET /api/budgeting/pnl — happy path", () => {
  it("returns 200 + envelope shape (success/sections/year)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.budgetPlan.findFirst.mockResolvedValue({ year: 2025 })
    const res = await GET(makeRequest("/api/budgeting/pnl?planId=p1"))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.success).toBe(true)
    expect(body.year).toBe(2025)
    expect(body.hasActuals).toBe(false)
    expect(body.monthlyActualOpex).toEqual({
      "1": 0,
      "2": 0,
      "3": 0,
      "4": 0,
      "5": 0,
      "6": 0,
      "7": 0,
      "8": 0,
      "9": 0,
      "10": 0,
      "11": 0,
      "12": 0,
    })
    expect(body.monthlyActualBelowEbitda).toEqual({
      "1": 0,
      "2": 0,
      "3": 0,
      "4": 0,
      "5": 0,
      "6": 0,
      "7": 0,
      "8": 0,
      "9": 0,
      "10": 0,
      "11": 0,
      "12": 0,
    })
    expect(body.monthlyActualDa).toEqual({
      "1": 0,
      "2": 0,
      "3": 0,
      "4": 0,
      "5": 0,
      "6": 0,
      "7": 0,
      "8": 0,
      "9": 0,
      "10": 0,
      "11": 0,
      "12": 0,
    })
    // Org filter applied to budget-line query
    const blArg = prismaMock.budgetLine.findMany.mock.calls[0][0]
    expect(blArg.where.organizationId).toBe(ORG_ID)
    expect(blArg.where.planId).toBe("p1")
  })

  it("year query param overrides plan.year", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.budgetPlan.findFirst.mockResolvedValue({ year: 2025 })
    const res = await GET(makeRequest("/api/budgeting/pnl?planId=p1&year=2024"))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.year).toBe(2024)
  })

  it("returns 200 + empty envelope when single sub-group has no children", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.budgetPlan.findFirst.mockResolvedValue({ year: 2025 })
    companyFilterMock.resolveCompanyFilter.mockResolvedValue({
      kind: "single",
      companyIds: [], // empty children
    })
    const res = await GET(
      makeRequest("/api/budgeting/pnl?planId=p1&companyId=group_with_no_children"),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.success).toBe(true)
    expect(body.year).toBe(2025)
    expect(body.monthlyActualOpex).toEqual({})
    expect(body.monthlyActualBelowEbitda).toEqual({})
    expect(body.monthlyActualDa).toEqual({})
    // Empty-children short-circuit: no Prisma reads on budget-lines
    expect(prismaMock.budgetLine.findMany).not.toHaveBeenCalled()
  })

  it("aggregates monthly actuals for OPEX, below-EBITDA and D&A", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.budgetPlan.findFirst.mockResolvedValue({ year: 2025 })
    prismaMock.budgetActual.findMany.mockResolvedValue([
      {
        department: "601-01",
        category: "Revenue",
        lineType: "revenue",
        actualAmount: 1_000,
        expenseDate: new Date("2025-01-15T00:00:00.000Z"),
      },
      {
        department: "701-01",
        category: "COGS",
        lineType: "cogs",
        actualAmount: 300,
        expenseDate: new Date("2025-01-16T00:00:00.000Z"),
      },
      {
        department: "721-02",
        category: "Admin expense",
        lineType: "expense",
        actualAmount: 200,
        expenseDate: new Date("2025-01-17T00:00:00.000Z"),
      },
      {
        department: "721-11",
        category: "D&A",
        lineType: "expense",
        actualAmount: 25,
        expenseDate: new Date("2025-01-18T00:00:00.000Z"),
      },
      {
        department: "741-01",
        category: "Finance cost",
        lineType: "expense",
        actualAmount: 50,
        expenseDate: new Date("2025-01-19T00:00:00.000Z"),
      },
      {
        department: "721-11",
        category: "Out-of-year D&A",
        lineType: "expense",
        actualAmount: 10,
        expenseDate: new Date("2024-01-18T00:00:00.000Z"),
      },
    ])

    const res = await GET(makeRequest("/api/budgeting/pnl?planId=p1"))

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      sectionActuals: Record<string, number>
      hasActuals: boolean
      monthlyActualRevenue: Record<string, number>
      monthlyActualCogs: Record<string, number>
      monthlyActualOpex: Record<string, number>
      monthlyActualBelowEbitda: Record<string, number>
      monthlyActualDa: Record<string, number>
    }
    expect(body.monthlyActualRevenue["1"]).toBe(1_000)
    expect(body.monthlyActualCogs["1"]).toBe(300)
    expect(body.monthlyActualOpex["1"]).toBe(225)
    expect(body.monthlyActualBelowEbitda["1"]).toBe(50)
    expect(body.monthlyActualDa["1"]).toBe(25)
    expect(body.monthlyActualDa["2"]).toBe(0)
    expect(body.hasActuals).toBe(true)
    expect(body.sectionActuals).toMatchObject({
      revenue: 1_000,
      cogs: 300,
      opex: 225,
      belowEbitda: 50,
    })
  })

  it("uses actual-plan budget lines as Actual vs Budget P&L actuals", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.budgetPlan.findFirst
      .mockResolvedValueOnce({ id: "actual_2026", name: "Actual 2026", year: 2026, kind: "actual" })
      .mockResolvedValueOnce({ id: "budget_2026", name: "Budget 2026", year: 2026, kind: "budget" })
    prismaMock.budgetLine.findMany
      .mockResolvedValueOnce([
        {
          companyId: "c1",
          department: "Revenue",
          lineType: "revenue",
          sortOrder: 0,
          monthIndex: 0,
          plannedAmount: 1_000,
          account: { code: "601-01", name: "Revenue", accountType: "revenue" },
        },
        {
          companyId: "c1",
          department: "COGS",
          lineType: "cogs",
          sortOrder: 0,
          monthIndex: 0,
          plannedAmount: 300,
          account: { code: "701-01", name: "COGS", accountType: "cogs" },
        },
      ])
      .mockResolvedValueOnce([])

    const res = await GET(makeRequest("/api/budgeting/pnl?planId=actual_2026"))

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      hasActuals: boolean
      monthlyActualRevenue: Record<string, number>
      monthlyActualCogs: Record<string, number>
      comparison: {
        hasActualLines: boolean
        hasBudgetLines: boolean
        missingData: string[]
        actual: { monthlyRevenue: Record<string, number>; monthlyCogs: Record<string, number> }
        budget: { monthlyRevenue: Record<string, number>; monthlyCogs: Record<string, number> }
      }
    }
    expect(body.hasActuals).toBe(true)
    expect(body.monthlyActualRevenue["1"]).toBe(1_000)
    expect(body.monthlyActualCogs["1"]).toBe(300)
    expect(body.comparison.hasActualLines).toBe(true)
    expect(body.comparison.hasBudgetLines).toBe(false)
    expect(body.comparison.actual.monthlyRevenue["1"]).toBe(1_000)
    expect(body.comparison.actual.monthlyCogs["1"]).toBe(300)
    expect(body.comparison.budget.monthlyRevenue["1"]).toBe(0)
    expect(body.comparison.missingData).toContain("Budget P&L rows are not available for this year.")
  })

  it("classifies Workbook PLF actual-plan lines for Actual vs Budget P&L", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.budgetPlan.findFirst
      .mockResolvedValueOnce({ id: "actual_2026", name: "Actual 2026", year: 2026, kind: "actual" })
      .mockResolvedValueOnce({ id: "budget_2026", name: "Budget 2026", year: 2026, kind: "budget" })
    prismaMock.budgetLine.findMany
      .mockResolvedValueOnce([
        {
          companyId: "c1",
          department: "Revenue from Sales of Glucose",
          lineType: "revenue",
          sortOrder: 0,
          monthIndex: 0,
          plannedAmount: 1_000,
          account: { code: "PLF.01.02.01", name: "Revenue from Sales of Glucose", accountType: "revenue" },
        },
        {
          companyId: "c1",
          department: "Glucose Costs",
          lineType: "cogs",
          sortOrder: 0,
          monthIndex: 0,
          plannedAmount: 300,
          account: { code: "PLF.02.02.01", name: "Glucose Costs", accountType: "cogs" },
        },
        {
          companyId: "c1",
          department: "Staff Salaries",
          lineType: "expense",
          sortOrder: 0,
          monthIndex: 0,
          plannedAmount: 200,
          account: { code: "PLF.05.01.01", name: "Staff Salaries", accountType: "expense" },
        },
        {
          companyId: "c1",
          department: "Depreciation",
          lineType: "expense",
          sortOrder: 0,
          monthIndex: 0,
          plannedAmount: 50,
          account: { code: "PLF.09.03.09", name: "Depreciation", accountType: "expense" },
        },
      ])
      .mockResolvedValueOnce([])

    const res = await GET(makeRequest("/api/budgeting/pnl?planId=actual_2026"))

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      monthlyActualRevenue: Record<string, number>
      monthlyActualCogs: Record<string, number>
      monthlyActualOpex: Record<string, number>
      monthlyActualBelowEbitda: Record<string, number>
      sectionActuals: Record<string, number>
      comparison: {
        actual: {
          monthlyRevenue: Record<string, number>
          monthlyCogs: Record<string, number>
          monthlyOpex: Record<string, number>
          monthlyBelowEbitda: Record<string, number>
        }
      }
    }
    expect(body.monthlyActualRevenue["1"]).toBe(1_000)
    expect(body.monthlyActualCogs["1"]).toBe(300)
    expect(body.monthlyActualOpex["1"]).toBe(200)
    expect(body.monthlyActualBelowEbitda["1"]).toBe(50)
    expect(body.sectionActuals).toMatchObject({
      revenue: 1_000,
      cogs: 300,
      opex: 200,
      belowEbitda: 50,
    })
    expect(body.comparison.actual.monthlyRevenue["1"]).toBe(1_000)
    expect(body.comparison.actual.monthlyCogs["1"]).toBe(300)
    expect(body.comparison.actual.monthlyOpex["1"]).toBe(200)
    expect(body.comparison.actual.monthlyBelowEbitda["1"]).toBe(50)
  })
})
