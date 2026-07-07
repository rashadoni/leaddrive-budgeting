// @vitest-environment node
/**
 * Handler test for `/api/budgeting/snapshot` (GET).
 *
 * Locks point-in-time reconstruction: required planId/at params,
 * org-scoped raw query, deletion handling, merge of changelog
 * snapshot lines + current unchanged lines, and analytics math.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    $queryRaw: vi.fn(),
    budgetLine: { findMany: vi.fn() },
    budgetActual: { findMany: vi.fn() },
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
  prismaMock.$queryRaw.mockReset().mockResolvedValue([])
  prismaMock.budgetLine.findMany.mockReset().mockResolvedValue([])
  prismaMock.budgetActual.findMany.mockReset().mockResolvedValue([])
})

describe("GET /api/budgeting/snapshot", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(
      makeRequest("/api/budgeting/snapshot?planId=p1&at=2026-01-15T00:00:00Z"),
    )
    expect(res.status).toBe(401)
  })

  it("400 missing planId", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await GET(makeRequest("/api/budgeting/snapshot?at=2026-01-15T00:00:00Z"))
    expect(res.status).toBe(400)
  })

  it("400 missing at timestamp", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await GET(makeRequest("/api/budgeting/snapshot?planId=p1"))
    expect(res.status).toBe(400)
  })

  it("200 empty reconstruction", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await GET(
      makeRequest("/api/budgeting/snapshot?planId=p1&at=2026-01-15T00:00:00Z"),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.lines).toEqual([])
    expect(body.data.actuals).toEqual([])
    expect(body.data.reconstructedAt).toBe("2026-01-15T00:00:00Z")
  })

  it("snapshot lines from changelog override current lines", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    // Changelog has a snapshot for line L1
    prismaMock.$queryRaw.mockResolvedValue([
      {
        entityId: "L1",
        entityType: "line",
        action: "update",
        snapshot: { id: "L1", category: "OLD-Salaries", lineType: "expense", plannedAmount: 100 },
        createdAt: new Date("2026-01-10T00:00:00Z"),
      },
    ])
    // Current state has L1 updated and L2 untouched
    prismaMock.budgetLine.findMany.mockResolvedValue([
      { id: "L1", category: "NEW-Salaries", lineType: "expense", plannedAmount: 200 },
      { id: "L2", category: "Rent", lineType: "expense", plannedAmount: 500 },
    ])
    const res = await GET(
      makeRequest("/api/budgeting/snapshot?planId=p1&at=2026-01-15T00:00:00Z"),
    )
    const body = await res.json()
    const lines = body.data.lines as Array<{ id: string; category: string; plannedAmount: number }>
    const l1 = lines.find((l) => l.id === "L1")
    const l2 = lines.find((l) => l.id === "L2")
    expect(l1?.category).toBe("OLD-Salaries")
    expect(l1?.plannedAmount).toBe(100)
    expect(l2?.category).toBe("Rent")
  })

  it("delete action drops the entity from reconstruction", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.$queryRaw.mockResolvedValue([
      {
        entityId: "L1",
        entityType: "line",
        action: "delete",
        snapshot: null,
        createdAt: new Date("2026-01-10T00:00:00Z"),
      },
    ])
    prismaMock.budgetLine.findMany.mockResolvedValue([
      { id: "L1", category: "Deleted", lineType: "expense", plannedAmount: 999 },
    ])
    const res = await GET(
      makeRequest("/api/budgeting/snapshot?planId=p1&at=2026-01-15T00:00:00Z"),
    )
    const body = await res.json()
    expect(body.data.lines.find((l: { id: string }) => l.id === "L1")).toBeUndefined()
  })

  it("computes analytics totals + executionPct", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.$queryRaw.mockResolvedValue([])
    prismaMock.budgetLine.findMany.mockResolvedValue([
      { id: "L1", category: "Revenue1", lineType: "revenue", plannedAmount: 10000, forecastAmount: null },
      { id: "L2", category: "Wages", lineType: "expense", plannedAmount: 3000, forecastAmount: null },
    ])
    prismaMock.budgetActual.findMany.mockResolvedValue([
      { id: "A1", lineType: "revenue", category: "Revenue1", actualAmount: 9000 },
      { id: "A2", lineType: "expense", category: "Wages", actualAmount: 2500 },
    ])
    const res = await GET(
      makeRequest("/api/budgeting/snapshot?planId=p1&at=2026-01-15T00:00:00Z"),
    )
    const body = await res.json()
    expect(body.data.analytics.totalRevenuePlanned).toBe(10000)
    expect(body.data.analytics.totalRevenueActual).toBe(9000)
    expect(body.data.analytics.totalExpensePlanned).toBe(3000)
    expect(body.data.analytics.totalExpenseActual).toBe(2500)
    // expense execution = 2500/3000 * 100 = 83.33
    expect(body.data.analytics.expenseExecutionPct).toBeCloseTo(83.333, 1)
  })
})
