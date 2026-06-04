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
  })
})
