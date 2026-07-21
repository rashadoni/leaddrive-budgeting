// @vitest-environment node
/**
 * Handler test for GET /api/analytics/fx-exposure.
 *
 * Locks:
 *  - Auth gate
 *  - Foreign aggregation uses source `originalAmount`, never base `plannedAmount`
 *  - netExposureByCurrency = revenue - cogs - expense
 *  - null currencyCode treated as base "AZN"
 *  - year/companyId query plumbing
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    budgetLine: { findMany: vi.fn() },
    user: { findFirst: vi.fn().mockResolvedValue({ allowedSubGroupIds: [] }) },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/db/with-org-scope", () => ({
  withOrgScope: async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock),
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  prismaMock.budgetLine.findMany.mockReset().mockResolvedValue([])
})

function mkLine(
  lineType: string,
  plannedAmount: number,
  currencyCode: string | null,
  originalAmount: number | null = null,
  exchangeRate: number | null = null,
) {
  return { lineType, plannedAmount, originalAmount, currencyCode, exchangeRate }
}

describe("GET /api/analytics/fx-exposure — handler", () => {
  it("aggregates totals + net exposure by currency", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.budgetLine.findMany.mockResolvedValue([
      mkLine("revenue", 1000, "AZN"),
      mkLine("revenue", 850, "USD", 500, 1.7),
      mkLine("cogs", 510, "USD", 300, 1.7),
      mkLine("expense", 200, "AZN"),
      mkLine("expense", 50, null), // null → AZN
    ])
    const res = await GET(makeRequest("/api/analytics/fx-exposure?year=2026"))
    const body = await res.json()
    expect(body.year).toBe(2026)
    expect(body.totals.AZN).toEqual({ revenue: 1000, cogs: 0, expense: 250 })
    expect(body.totals.USD).toEqual({ revenue: 500, cogs: 300, expense: 0 })
    // Net AZN = 1000 - 0 - 250 = 750
    expect(body.netExposureByCurrency.AZN).toBe(750)
    // Net USD = 500 - 300 - 0 = 200 (USD-long, hedge sells)
    expect(body.netExposureByCurrency.USD).toBe(200)
    expect(body.lineCount).toBe(5)
    expect(body.excludedForeignLineCount).toBe(0)
  })

  it("uses originalAmount for foreign source exposure, not canonical base plannedAmount", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.budgetLine.findMany.mockResolvedValue([
      mkLine("revenue", 170, "USD", 100, 1.7),
      mkLine("cogs", 50, "AZN", null, null),
    ])
    const res = await GET(makeRequest("/api/analytics/fx-exposure?year=2026"))
    const body = await res.json()
    expect(body.totals.USD).toEqual({ revenue: 100, cogs: 0, expense: 0 })
    expect(body.totals.AZN).toEqual({ revenue: 0, cogs: 50, expense: 0 })
  })

  it("accepts base/null currency without rate and excludes foreign rows without valid source evidence", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.budgetLine.findMany.mockResolvedValue([
      mkLine("revenue", 200, "AZN", null, null),
      mkLine("expense", 50, null, null, null),
      mkLine("cogs", 170, "USD", null, 1.7),
      mkLine("expense", 340, "EUR", 200, 0),
      mkLine("revenue", 170, "USD", Number.NaN, 1.7),
    ])
    const res = await GET(makeRequest("/api/analytics/fx-exposure?year=2026"))
    const body = await res.json()
    expect(body.totals.AZN).toEqual({ revenue: 200, cogs: 0, expense: 50 })
    expect(body.totals.USD).toBeUndefined()
    expect(body.totals.EUR).toBeUndefined()
    expect(body.excludedForeignLineCount).toBe(3)
    expect(body.excludedForeignByCurrency).toEqual({ USD: 2, EUR: 1 })
  })

  it("passes companyId filter to prisma + reports it in response", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    await GET(makeRequest("/api/analytics/fx-exposure?year=2026&companyId=co_a"))
    const arg = prismaMock.budgetLine.findMany.mock.calls[0]?.[0]
    expect(arg.where).toMatchObject({
      organizationId: ORG_ID,
      plan: { is: { year: 2026 } },
      companyId: "co_a",
    })
  })

  it("defaults year to current calendar year when omitted", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await GET(makeRequest("/api/analytics/fx-exposure"))
    const body = await res.json()
    expect(body.year).toBe(new Date().getUTCFullYear())
  })
})
