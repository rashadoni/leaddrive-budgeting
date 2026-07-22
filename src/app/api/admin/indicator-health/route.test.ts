// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest"

const { findManyMock, requireRoleMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  requireRoleMock: vi.fn(),
}))

vi.mock("@/lib/api-auth", () => ({
  requireRole: requireRoleMock,
  isAuthError: () => false,
}))
vi.mock("@/lib/db/with-org-scope", () => ({
  withOrgScope: async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) =>
    fn({ indicatorValue: { findMany: findManyMock } }),
}))

import { makeRequest } from "@/test/api-harness"
import { GET } from "./route"

beforeEach(() => {
  requireRoleMock.mockReset()
  findManyMock.mockReset()
  requireRoleMock.mockResolvedValue({
    orgId: "org-demo",
    userId: "admin-1",
    role: "admin",
  })
  findManyMock.mockResolvedValue([])
})

describe("GET /api/admin/indicator-health", () => {
  it("limits every count to the requested exact period", async () => {
    findManyMock.mockResolvedValue([
      {
        status: "green",
        inputs: {},
        indicator: { code: "MARGIN", nameEn: "Margin", nameRu: null, nameAz: null },
        company: { code: "CO-1" },
      },
      {
        status: "unknown",
        inputs: { error: { code: "eval", reason: "undefined variable: inventory" } },
        indicator: { code: "STOCK", nameEn: "Stock", nameRu: null, nameAz: null },
        company: { code: "CO-1" },
      },
    ])

    const res = await GET(
      makeRequest("/api/admin/indicator-health?period=2025-Q4"),
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: "org-demo",
          period: "2025-Q4",
          indicator: { isActive: true },
        },
      }),
    )
    expect(body.period).toBe("2025-Q4")
    expect(body.summary).toEqual({
      totalIvs: 2,
      green: 1,
      amber: 0,
      red: 0,
      unknown: 1,
    })
    expect(body.gappyIndicators[0]).toMatchObject({
      indicatorCode: "STOCK",
      missingVariable: "inventory",
      affectedCellCount: 1,
    })
  })

  it("returns zero-safe summary for an empty valid period", async () => {
    const res = await GET(makeRequest("/api/admin/indicator-health?period=2024"))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.period).toBe("2024")
    expect(body.summary.totalIvs).toBe(0)
    expect(body.gappyIndicators).toEqual([])
  })

  it("rejects an invalid period before querying indicator values", async () => {
    const res = await GET(
      makeRequest("/api/admin/indicator-health?period=all-history"),
    )

    expect(res.status).toBe(400)
    expect(findManyMock).not.toHaveBeenCalled()
  })
})
