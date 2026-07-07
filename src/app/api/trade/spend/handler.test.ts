// @vitest-environment node
/**
 * R3 (audit round 2) — handler tests for GET|POST /api/trade/spend.
 * Locks: auth gate, role gate, Zod validation, spend-type org guard,
 * period-lock 423 (T4), auto-recompute fires after a posting (R1).
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock, recomputeMock, lockMock } = vi.hoisted(() => ({
  prismaMock: {
    tradeSpendLedger: { findMany: vi.fn(), create: vi.fn() },
    tradeSpendType: { findFirst: vi.fn() },
    tradeCampaign: { findFirst: vi.fn() },
    tradeChannel: { findFirst: vi.fn(), findMany: vi.fn() },
    user: { findMany: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
  recomputeMock: vi.fn().mockResolvedValue({ period: "2026-07" }),
  lockMock: vi.fn().mockResolvedValue(null),
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/trade/pacing-recompute", () => ({
  recomputeTradePacing: recomputeMock,
  ORG_GRAIN: "org",
}))
vi.mock("@/lib/budgeting/period-lock", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  findFirstActiveLockInPeriods: lockMock,
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET, POST } from "./route"

const ORG_ID = "org_trade_test_000000000001"
const SPEND_TYPE = {
  id: "st1",
  key: "promo_payment",
  label: "Promo ödənişi",
  accrualMethod: "payment_actual",
}

const validBody = {
  entryKind: "actual",
  spendTypeId: "st1",
  entryDate: "2026-07-05",
  amount: 5000,
}

beforeEach(() => {
  prismaMock.tradeSpendLedger.findMany.mockReset().mockResolvedValue([])
  prismaMock.tradeSpendLedger.create.mockReset().mockResolvedValue({
    id: "e1",
    entryKind: "actual",
    entryDate: new Date("2026-07-05"),
    amount: 5000,
    spendType: SPEND_TYPE,
  })
  prismaMock.tradeSpendType.findFirst.mockReset().mockResolvedValue({ id: "st1" })
  prismaMock.tradeCampaign.findFirst.mockReset().mockResolvedValue(null)
  prismaMock.tradeChannel.findFirst.mockReset().mockResolvedValue(null)
  prismaMock.tradeChannel.findMany.mockReset().mockResolvedValue([])
  prismaMock.user.findMany.mockReset().mockResolvedValue([])
  recomputeMock.mockReset().mockResolvedValue({ period: "2026-07" })
  lockMock.mockReset().mockResolvedValue(null)
})

describe("POST /api/trade/spend", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await POST(makeRequest("/api/trade/spend", { method: "POST", json: validBody }))
    expect(res.status).toBe(401)
  })

  it("403 for viewer (manager gate)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await POST(makeRequest("/api/trade/spend", { method: "POST", json: validBody }))
    expect(res.status).toBe(403)
  })

  it("400 on zero amount (Zod)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await POST(
      makeRequest("/api/trade/spend", { method: "POST", json: { ...validBody, amount: 0 } }),
    )
    expect(res.status).toBe(400)
  })

  it("404 when the spend type is not in this org", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.tradeSpendType.findFirst.mockResolvedValue(null)
    const res = await POST(makeRequest("/api/trade/spend", { method: "POST", json: validBody }))
    expect(res.status).toBe(404)
  })

  it("423 when the entry month is CFO-locked (T4)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    lockMock.mockResolvedValue({ period: "2026-07", lockedAt: "2026-07-01T00:00:00Z", lockedBy: "cfo" })
    const res = await POST(makeRequest("/api/trade/spend", { method: "POST", json: validBody }))
    expect(res.status).toBe(423)
    expect(prismaMock.tradeSpendLedger.create).not.toHaveBeenCalled()
  })

  it("201 happy path posts the entry AND auto-recomputes the month (R1)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await POST(makeRequest("/api/trade/spend", { method: "POST", json: validBody }))
    expect(res.status).toBe(201)
    expect(prismaMock.tradeSpendLedger.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: ORG_ID,
          entryKind: "actual",
          amount: 5000,
          year: 2026,
          month: 7,
        }),
      }),
    )
    expect(recomputeMock).toHaveBeenCalledWith(prismaMock, ORG_ID, 2026, 7)
  })
})

describe("GET /api/trade/spend", () => {
  it("returns entries + pivoted summary", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.tradeSpendLedger.findMany.mockResolvedValue([
      { entryKind: "actual", amount: 5000, createdBy: "u1", channelId: null, spendType: SPEND_TYPE },
    ])
    const res = await GET(makeRequest("/api/trade/spend?year=2026&month=7"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.summary.totals).toMatchObject({ actual: 5000, control: 5000, plan: 0 })
    expect(body.entries).toHaveLength(1)
  })
})
