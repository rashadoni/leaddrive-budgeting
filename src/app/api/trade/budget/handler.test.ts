// @vitest-environment node
/**
 * R3 — handler tests for GET|POST /api/trade/budget (derive).
 * Locks: auth, revenue-plan aggregation → pools, locked-month skip (R2),
 * manual-override preservation via planPoolUpserts wiring.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock, recomputeMock, rebaseMock } = vi.hoisted(() => {
  const prismaMock = {
    tradeBudgetPool: { findMany: vi.fn(), upsert: vi.fn() },
    tradePlanDaily: { deleteMany: vi.fn(), createMany: vi.fn() },
    budgetLine: { groupBy: vi.fn() },
    organization: { findUnique: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock)),
  }
  return { prismaMock, recomputeMock: vi.fn(), rebaseMock: vi.fn() }
})

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
// Codex review #3/#4 — derive now rebases channel pools + recomputes
// pacing; both are units with their own tests, mocked out here.
vi.mock("@/lib/trade/pacing-recompute", () => ({
  recomputeTradePacing: recomputeMock,
}))
vi.mock("@/lib/trade/pool-sync", () => ({
  rebaseChannelPools: rebaseMock,
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET, POST } from "./route"

const ORG_ID = "org_trade_test_000000000001"

beforeEach(() => {
  prismaMock.tradeBudgetPool.findMany.mockReset().mockResolvedValue([])
  prismaMock.tradeBudgetPool.upsert.mockReset().mockResolvedValue({})
  prismaMock.tradePlanDaily.deleteMany.mockReset().mockResolvedValue({ count: 0 })
  prismaMock.tradePlanDaily.createMany.mockReset().mockResolvedValue({ count: 31 })
  prismaMock.budgetLine.groupBy.mockReset().mockResolvedValue([
    { monthIndex: 0, _sum: { plannedAmount: 2_000_000 } },
    { monthIndex: 1, _sum: { plannedAmount: 1_000_000 } },
  ])
  prismaMock.organization.findUnique.mockReset().mockResolvedValue({ lockedPeriods: null })
  recomputeMock.mockReset().mockResolvedValue({})
  rebaseMock.mockReset().mockResolvedValue(undefined)
})

describe("POST /api/trade/budget (derive)", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await POST(makeRequest("/api/trade/budget", { method: "POST", json: { year: 2026 } }))
    expect(res.status).toBe(401)
  })

  it("derives pools from revenue plan months at the default pct", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await POST(makeRequest("/api/trade/budget", { method: "POST", json: { year: 2026 } }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.derived).toBe(2)
    expect(body.skippedLocked).toEqual([])
    // Jan: 2,000,000 × 5% = 100,000
    expect(prismaMock.tradeBudgetPool.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ month: 1, salesPlanAmount: 2_000_000, budgetAmount: 100_000 }),
      }),
    )
    // pacing feed regenerated per month
    expect(prismaMock.tradePlanDaily.createMany).toHaveBeenCalledTimes(2)
    // Codex #4 — channel pools rebased for every derived month
    expect(rebaseMock).toHaveBeenCalledTimes(2)
    // Codex #3 — pacing snapshots refreshed for every touched month
    expect(recomputeMock).toHaveBeenCalledTimes(2)
  })

  it("skips CFO-locked months and reports them (R2)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.organization.findUnique.mockResolvedValue({
      lockedPeriods: [{ period: "2026-01", lockedAt: "2026-02-01T00:00:00Z", lockedBy: "cfo" }],
    })
    const res = await POST(makeRequest("/api/trade/budget", { method: "POST", json: { year: 2026 } }))
    const body = await res.json()
    expect(body.skippedLocked).toEqual([1])
    expect(body.derived).toBe(1)
    const upsertMonths = prismaMock.tradeBudgetPool.upsert.mock.calls.map(
      (c) => (c[0] as { create: { month: number } }).create.month,
    )
    expect(upsertMonths).toEqual([2])
  })
})

describe("GET /api/trade/budget", () => {
  it("returns the year's org pools", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.tradeBudgetPool.findMany.mockResolvedValue([{ id: "p1", month: 1 }])
    const res = await GET(makeRequest("/api/trade/budget?year=2026"))
    expect(res.status).toBe(200)
    expect((await res.json()).pools).toHaveLength(1)
  })
})
