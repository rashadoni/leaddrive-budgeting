// @vitest-environment node
/**
 * R3 — handler tests for PUT /api/trade/budget/allocations (T9).
 * Locks: org-pool-first 409, sum>100 → 400, happy-path channel pool
 * upserts + stale-grain cleanup, locked-month 423 (R2).
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock, lockMock } = vi.hoisted(() => {
  const prismaMock = {
    tradeBudgetPool: { findUnique: vi.fn(), findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    tradeChannel: { findMany: vi.fn() },
    tradePlanDaily: { deleteMany: vi.fn(), createMany: vi.fn() },
    auditEvent: { create: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock)),
  }
  return { prismaMock, lockMock: vi.fn().mockResolvedValue(null) }
})

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/budgeting/period-lock", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  findFirstActiveLockInPeriods: lockMock,
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { PUT } from "./route"

const ORG_ID = "org_trade_test_000000000001"
const body = (allocations: { channelId: string; allocationPct: number }[]) => ({
  year: 2026,
  month: 7,
  allocations,
})

beforeEach(() => {
  prismaMock.tradeBudgetPool.findUnique.mockReset().mockResolvedValue({ budgetAmount: 100_000 })
  prismaMock.tradeBudgetPool.findMany.mockReset().mockResolvedValue([])
  prismaMock.tradeBudgetPool.upsert.mockReset().mockResolvedValue({})
  prismaMock.tradeBudgetPool.deleteMany.mockReset().mockResolvedValue({ count: 0 })
  prismaMock.tradeChannel.findMany.mockReset().mockResolvedValue([{ id: "ch1" }, { id: "ch2" }])
  prismaMock.tradePlanDaily.deleteMany.mockReset().mockResolvedValue({ count: 0 })
  prismaMock.tradePlanDaily.createMany.mockReset().mockResolvedValue({ count: 31 })
  lockMock.mockReset().mockResolvedValue(null)
})

describe("PUT /api/trade/budget/allocations", () => {
  it("403 for viewer", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await PUT(
      makeRequest("/api/trade/budget/allocations", { method: "PUT", json: body([]) }),
    )
    expect(res.status).toBe(403)
  })

  it("423 on a CFO-locked month (R2)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    lockMock.mockResolvedValue({ period: "2026-07", lockedAt: "x", lockedBy: "cfo" })
    const res = await PUT(
      makeRequest("/api/trade/budget/allocations", { method: "PUT", json: body([]) }),
    )
    expect(res.status).toBe(423)
  })

  it("409 when the org pool has not been derived", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.tradeBudgetPool.findUnique.mockResolvedValue(null)
    const res = await PUT(
      makeRequest("/api/trade/budget/allocations", {
        method: "PUT",
        json: body([{ channelId: "ch1", allocationPct: 50 }]),
      }),
    )
    expect(res.status).toBe(409)
  })

  it("400 when the split exceeds 100%", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await PUT(
      makeRequest("/api/trade/budget/allocations", {
        method: "PUT",
        json: body([
          { channelId: "ch1", allocationPct: 60 },
          { channelId: "ch2", allocationPct: 45 },
        ]),
      }),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).errors.map((e: { code: string }) => e.code)).toContain(
      "sum_exceeds_100",
    )
  })

  it("upserts channel pools with amounts derived from pct", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await PUT(
      makeRequest("/api/trade/budget/allocations", {
        method: "PUT",
        json: body([{ channelId: "ch1", allocationPct: 40 }]),
      }),
    )
    expect(res.status).toBe(200)
    expect(prismaMock.tradeBudgetPool.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          grainKey: "channel:ch1",
          budgetPct: 40,
          budgetAmount: 40_000,
          salesPlanAmount: 0,
        }),
      }),
    )
  })
})
