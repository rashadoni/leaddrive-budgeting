/**
 * Handler tests for GET /api/admin/ai-usage (Phase 7.B v2 Day 6).
 * Locks: admin-only gate, response shape (today/mtd/budget/remaining/
 * overBudget/last30), 30-day series fills gaps with zeros, Prisma read
 * failure degrades cleanly to empty series.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock, costBudgetMock } = vi.hoisted(() => ({
  prismaMock: {
    aiTokenUsage: { findMany: vi.fn() },
  },
  costBudgetMock: {
    getDailyUsage: vi.fn(),
    getMonthlyUsage: vi.fn(),
    DEFAULT_BUDGET: { daily: 500_000, monthly: 10_000_000 },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/llm/cost-budget", () => costBudgetMock)

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET } from "./route"

const ORG_ID = "cmtestaiusagedevorg00000001"

beforeEach(() => {
  prismaMock.aiTokenUsage.findMany.mockReset().mockResolvedValue([])
  costBudgetMock.getDailyUsage.mockReset().mockResolvedValue({
    tokensIn: 0,
    tokensOut: 0,
    calls: 0,
    total: 0,
  })
  costBudgetMock.getMonthlyUsage.mockReset().mockResolvedValue({
    tokensIn: 0,
    tokensOut: 0,
    calls: 0,
    total: 0,
  })
})

describe("GET /api/admin/ai-usage", () => {
  it("401 when unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(makeRequest("/api/admin/ai-usage"))
    expect(res.status).toBe(401)
  })

  it("403 when role is manager (admin-only)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await GET(makeRequest("/api/admin/ai-usage"))
    expect(res.status).toBe(403)
  })

  it("200 returns full usage envelope (today / mtd / budget / remaining / overBudget / last30)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" })
    costBudgetMock.getDailyUsage.mockResolvedValue({
      tokensIn: 10_000,
      tokensOut: 5_000,
      calls: 4,
      total: 15_000,
    })
    costBudgetMock.getMonthlyUsage.mockResolvedValue({
      tokensIn: 200_000,
      tokensOut: 100_000,
      calls: 47,
      total: 300_000,
    })
    const res = await GET(makeRequest("/api/admin/ai-usage"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.today.total).toBe(15_000)
    expect(body.mtd.total).toBe(300_000)
    expect(body.budget).toEqual({ daily: 500_000, monthly: 10_000_000 })
    expect(body.remaining.daily).toBe(485_000)
    expect(body.remaining.monthly).toBe(9_700_000)
    expect(body.overBudget).toEqual({ daily: false, monthly: false })
  })

  it("flags overBudget.daily=true when today > budget.daily", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" })
    costBudgetMock.getDailyUsage.mockResolvedValue({
      tokensIn: 400_000,
      tokensOut: 200_000,
      calls: 12,
      total: 600_000,
    })
    const res = await GET(makeRequest("/api/admin/ai-usage"))
    const body = await res.json()
    expect(body.overBudget.daily).toBe(true)
    expect(body.remaining.daily).toBe(0) // clamped at 0, doesn't go negative
  })

  it("last30 series has exactly 30 entries, oldest-first, gaps zero-filled", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" })
    // Mock returns ONE recent day; other 29 should be zero-filled.
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setUTCDate(yesterday.getUTCDate() - 1)
    prismaMock.aiTokenUsage.findMany.mockResolvedValue([
      {
        date: yesterday.toISOString().slice(0, 10),
        tokensIn: 1_000,
        tokensOut: 500,
        calls: 2,
      },
    ])
    const res = await GET(makeRequest("/api/admin/ai-usage"))
    const body = await res.json()
    expect(body.last30).toHaveLength(30)
    // First entry is 29 days ago, last is today
    expect(body.last30[0].total).toBe(0)
    expect(body.last30[29].total).toBe(0) // today (not yesterday)
    // Yesterday should have the populated row (idx 28).
    expect(body.last30[28].total).toBe(1_500)
    expect(body.last30[28].calls).toBe(2)
  })

  it("Prisma error on last30 read degrades to all-zero series (no 500)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" })
    prismaMock.aiTokenUsage.findMany.mockRejectedValue(new Error("DB blip"))
    const res = await GET(makeRequest("/api/admin/ai-usage"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.last30).toHaveLength(30)
    expect(body.last30.every((d: { total: number }) => d.total === 0)).toBe(true)
  })
})
