// @vitest-environment node
/**
 * Handler test for `/api/budgeting/export` (GET).
 *
 * Full-plan xlsx export. Locks auth, missing planId 400, cross-tenant
 * 404, content-type + xlsx body non-empty.
 *
 * Note: deep formatting + section semantics are exercised in the
 * Phase 7.G visual smoke; here we lock the API contract surface.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock, loadAndComputeMock } = vi.hoisted(() => ({
  prismaMock: {
    budgetPlan: { findFirst: vi.fn() },
    budgetLine: { findMany: vi.fn() },
    budgetActual: { findMany: vi.fn() },
    budgetForecastEntry: { findMany: vi.fn() },
  },
  loadAndComputeMock: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/cost-model/db", () => ({
  loadAndCompute: loadAndComputeMock,
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  prismaMock.budgetPlan.findFirst.mockReset().mockResolvedValue(null)
  prismaMock.budgetLine.findMany.mockReset().mockResolvedValue([])
  prismaMock.budgetActual.findMany.mockReset().mockResolvedValue([])
  prismaMock.budgetForecastEntry.findMany.mockReset().mockResolvedValue([])
  loadAndComputeMock.mockReset().mockResolvedValue(null)
})

describe("GET /api/budgeting/export", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(makeRequest("/api/budgeting/export?planId=p1"))
    expect(res.status).toBe(401)
  })

  it("400 missing planId", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await GET(makeRequest("/api/budgeting/export"))
    expect(res.status).toBe(400)
  })

  it("404 cross-tenant plan", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.budgetPlan.findFirst.mockResolvedValue(null)
    const res = await GET(makeRequest("/api/budgeting/export?planId=p_evil"))
    expect(res.status).toBe(404)
  })

  it("200 xlsx content-type + non-empty body", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.budgetPlan.findFirst.mockResolvedValue({
      id: "p1", name: "Plan A", year: 2026, periodType: "annual", quarter: null, month: null,
      organizationId: ORG_ID,
    })
    prismaMock.budgetLine.findMany.mockResolvedValue([
      { id: "L1", category: "Salaries", lineType: "expense", plannedAmount: 1000, forecastAmount: null, sortOrder: 0 },
      { id: "L2", category: "Revenue1", lineType: "revenue", plannedAmount: 5000, forecastAmount: null, sortOrder: 1 },
    ])
    const res = await GET(makeRequest("/api/budgeting/export?planId=p1"))
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toContain("spreadsheetml")
    const buf = await res.arrayBuffer()
    expect(buf.byteLength).toBeGreaterThan(1000)
  })

  it("org-scoped findFirst (planId + orgId)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.budgetPlan.findFirst.mockResolvedValue({
      id: "p1", name: "Plan A", year: 2026, periodType: "annual", quarter: null, month: null,
      organizationId: ORG_ID,
    })
    await GET(makeRequest("/api/budgeting/export?planId=p1"))
    expect(prismaMock.budgetPlan.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "p1", organizationId: ORG_ID } }),
    )
  })
})
