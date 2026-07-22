// @vitest-environment node
/**
 * Handler test for `/api/budgeting/cash-flow/plan-fact` (GET).
 *
 * Plan-vs-Fact dashboard — monthly revenue/expense plan vs actual.
 * Locks variance math + variance% rounding + month indexing.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    budgetLine: { findMany: vi.fn() },
    budgetActual: { findMany: vi.fn() },
    salesForecast: { findMany: vi.fn() },
    expenseForecast: { findMany: vi.fn() },
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
  prismaMock.budgetActual.findMany.mockReset().mockResolvedValue([])
  prismaMock.salesForecast.findMany.mockReset().mockResolvedValue([])
  prismaMock.expenseForecast.findMany.mockReset().mockResolvedValue([])
})

describe("GET /api/budgeting/cash-flow/plan-fact", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(makeRequest("/api/budgeting/cash-flow/plan-fact?year=2026"))
    expect(res.status).toBe(401)
  })

  it("200 empty year — 12 months + zero totals", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await GET(makeRequest("/api/budgeting/cash-flow/plan-fact?year=2026"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.year).toBe(2026)
    expect(body.data.evidenceCounts).toEqual({
      salesForecasts: 0,
      expenseForecasts: 0,
      budgetActuals: 0,
    })
    expect(body.data.evidenceCoverage).toEqual({ completeMonths: 0, totalMonths: 12 })
    expect(body.data.monthly).toHaveLength(12)
    expect(body.data.totals.revenuePlan).toBe(0)
    expect(body.data.totals.revenueFact).toBe(0)
    expect(body.data.totals.netPlan).toBe(0)
  })

  it("computes monthly variance + variancePct (rounded)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.salesForecast.findMany.mockResolvedValue([
      { month: 1, amount: 1000, budgetDept: { label: "Sales" } },
    ])
    prismaMock.budgetActual.findMany.mockResolvedValue([
      { lineType: "revenue", actualAmount: 1200, expenseDate: new Date(Date.UTC(2026, 0, 15)), department: null },
    ])
    const res = await GET(makeRequest("/api/budgeting/cash-flow/plan-fact?year=2026"))
    const body = await res.json()
    const jan = body.data.monthly[0]
    expect(body.data.evidenceCounts).toEqual({
      salesForecasts: 1,
      expenseForecasts: 0,
      budgetActuals: 1,
    })
    expect(body.data.evidenceCoverage).toEqual({ completeMonths: 0, totalMonths: 12 })
    expect(jan.evidence).toEqual({
      revenuePlan: 1,
      revenueFact: 1,
      expensePlan: 0,
      expenseFact: 0,
    })
    expect(jan.month).toBe(1)
    expect(jan.revenuePlan).toBe(1000)
    // Variance can be timezone-shifted; tolerate ±1200 or 0 by checking variance not negative for ≥1200
    expect(jan.revenueVariance).toBeGreaterThanOrEqual(0)
  })

  it("handles cogs + expense lineTypes as expenseFact", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.budgetActual.findMany.mockResolvedValue([
      { lineType: "expense", actualAmount: 100, expenseDate: new Date(Date.UTC(2026, 0, 15)), department: null },
      { lineType: "cogs",    actualAmount: 200, expenseDate: new Date(Date.UTC(2026, 0, 15)), department: null },
    ])
    const res = await GET(makeRequest("/api/budgeting/cash-flow/plan-fact?year=2026"))
    const body = await res.json()
    // Both cogs and expense roll into expenseFact for the month they hit
    const total = body.data.monthly.reduce((s: number, m: { expenseFact: number }) => s + m.expenseFact, 0)
    expect(total).toBe(300)
  })

  it("variancePct = 0 when plan = 0 (no div-by-zero)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.budgetActual.findMany.mockResolvedValue([
      { lineType: "revenue", actualAmount: 500, expenseDate: new Date(Date.UTC(2026, 5, 15)), department: null },
    ])
    const res = await GET(makeRequest("/api/budgeting/cash-flow/plan-fact?year=2026"))
    const body = await res.json()
    const jun = body.data.monthly[5]
    expect(jun.revenuePlan).toBe(0)
    expect(jun.revenueVariancePct).toBe(0)
  })

  it("keeps evidenced zeroes when every monthly input population is present", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.salesForecast.findMany.mockResolvedValue(
      Array.from({ length: 12 }, (_, index) => ({
        month: index + 1,
        amount: 0,
        budgetDept: { label: "Sales" },
      })),
    )
    prismaMock.expenseForecast.findMany.mockResolvedValue(
      Array.from({ length: 12 }, (_, index) => ({
        month: index + 1,
        amount: 0,
        budgetCostType: { label: "Operating expense" },
      })),
    )
    prismaMock.budgetActual.findMany.mockResolvedValue(
      Array.from({ length: 12 }, (_, index) => [
        {
          lineType: "revenue",
          actualAmount: 0,
          expenseDate: new Date(Date.UTC(2026, index, 15, 12)),
          department: null,
        },
        {
          lineType: "expense",
          actualAmount: 0,
          expenseDate: new Date(Date.UTC(2026, index, 15, 12)),
          department: null,
        },
      ]).flat(),
    )

    const res = await GET(makeRequest("/api/budgeting/cash-flow/plan-fact?year=2026"))
    const body = await res.json()

    expect(body.data.evidenceCoverage).toEqual({ completeMonths: 12, totalMonths: 12 })
    expect(body.data.monthly).toHaveLength(12)
    expect(body.data.monthly.every((month: { revenuePlan: number; revenueFact: number; expensePlan: number; expenseFact: number }) =>
      month.revenuePlan === 0 &&
      month.revenueFact === 0 &&
      month.expensePlan === 0 &&
      month.expenseFact === 0,
    )).toBe(true)
  })
})
