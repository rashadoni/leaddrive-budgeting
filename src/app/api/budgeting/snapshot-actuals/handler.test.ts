// @vitest-environment node
/**
 * Phase 7.G Turn LXIX — handler tests for `/api/budgeting/snapshot-actuals` POST.
 * Locks Phase 4.2 period-lock gate. snapshot-actuals targets a specific
 * month + N plans — gate must check both each plan's period and the
 * target-month containers.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    budgetPlan: { findMany: vi.fn() },
    budgetLine: { findMany: vi.fn() },
    budgetActual: { findFirst: vi.fn(), create: vi.fn() },
    costModelSnapshot: { upsert: vi.fn() },
    organization: { findUnique: vi.fn() },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/cost-model/db", () => ({
  loadAndCompute: vi.fn().mockResolvedValue({
    grandTotalG: 0,
    serviceRevenues: {},
    summary: { totalCost: 0, totalRevenue: 0, margin: 0, marginPct: 0 },
  }),
}))
vi.mock("@/lib/budgeting/cost-model-map", () => ({
  resolveCostModelKey: vi.fn().mockReturnValue(0),
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { POST } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  prismaMock.budgetPlan.findMany.mockReset().mockResolvedValue([
    { id: "p1", periodType: "annual", year: 2026, month: null, quarter: null },
  ])
  prismaMock.budgetLine.findMany.mockReset().mockResolvedValue([])
  prismaMock.budgetActual.findFirst.mockReset().mockResolvedValue(null)
  prismaMock.budgetActual.create.mockReset()
  prismaMock.costModelSnapshot.upsert.mockReset().mockResolvedValue({})
  prismaMock.organization.findUnique.mockReset().mockResolvedValue({ lockedPeriods: [] })
})

describe("POST /api/budgeting/snapshot-actuals — period lock (Turn LXIX)", () => {
  it("returns 423 when targetMonth's containing year is locked", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.organization.findUnique.mockResolvedValue({
      lockedPeriods: [{ period: "2026", lockedAt: "x", lockedBy: "y" }],
    })
    const res = await POST(
      makeRequest("/api/budgeting/snapshot-actuals", { method: "POST", json: { month: "2026-07" } }),
    )
    expect(res.status).toBe(423)
    expect(prismaMock.budgetActual.create).not.toHaveBeenCalled()
  })

  it("returns 423 when one of the plans' periods is locked", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.budgetPlan.findMany.mockResolvedValue([
      { id: "p1", periodType: "quarterly", year: 2026, month: null, quarter: 1 },
      { id: "p2", periodType: "quarterly", year: 2026, month: null, quarter: 2 },
    ])
    prismaMock.organization.findUnique.mockResolvedValue({
      lockedPeriods: [{ period: "2026-Q2", lockedAt: "x", lockedBy: "y" }],
    })
    const res = await POST(makeRequest("/api/budgeting/snapshot-actuals", { method: "POST", json: {} }))
    expect(res.status).toBe(423)
    expect(prismaMock.budgetActual.create).not.toHaveBeenCalled()
  })

  it("happy path returns 200 when no lock matches", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await POST(
      makeRequest("/api/budgeting/snapshot-actuals", { method: "POST", json: { month: "2026-07" } }),
    )
    expect(res.status).toBe(200)
  })
})
