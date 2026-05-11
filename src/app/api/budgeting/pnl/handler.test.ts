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
    // Empty-children short-circuit: no Prisma reads on budget-lines
    expect(prismaMock.budgetLine.findMany).not.toHaveBeenCalled()
  })
})
