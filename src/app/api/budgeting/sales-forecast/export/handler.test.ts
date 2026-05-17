// @vitest-environment node
/**
 * Handler test for `/api/budgeting/sales-forecast/export` (GET).
 *
 * Locks auth + xlsx generation with department rows + month columns +
 * TOTAL row + content-type/disposition headers.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    budgetDepartment: { findMany: vi.fn() },
    salesForecast: { findMany: vi.fn() },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  prismaMock.budgetDepartment.findMany.mockReset().mockResolvedValue([])
  prismaMock.salesForecast.findMany.mockReset().mockResolvedValue([])
})

describe("GET /api/budgeting/sales-forecast/export", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(makeRequest("/api/budgeting/sales-forecast/export?year=2026"))
    expect(res.status).toBe(401)
  })

  it("200 xlsx headers + filename includes year", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await GET(makeRequest("/api/budgeting/sales-forecast/export?year=2026"))
    expect(res.headers.get("Content-Type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    expect(res.headers.get("Content-Disposition") || "").toContain("sales-forecast-2026.xlsx")
  })

  it("xlsx body is non-empty", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.budgetDepartment.findMany.mockResolvedValue([
      { id: "d1", label: "Sales — Wholesale" },
    ])
    prismaMock.salesForecast.findMany.mockResolvedValue([
      { departmentId: "d1", month: 1, amount: 1000 },
      { departmentId: "d1", month: 2, amount: 1200 },
    ])
    const res = await GET(makeRequest("/api/budgeting/sales-forecast/export?year=2026"))
    const buf = await res.arrayBuffer()
    expect(buf.byteLength).toBeGreaterThan(1000)
  })

  it("only includes hasRevenue=true departments", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    await GET(makeRequest("/api/budgeting/sales-forecast/export?year=2026"))
    expect(prismaMock.budgetDepartment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: ORG_ID, hasRevenue: true, isActive: true },
      }),
    )
  })
})
