// @vitest-environment node
/**
 * Handler tests for `/api/budgeting/balance-sheet/[id]` (PUT + DELETE) — Phase 3.
 * Covers: auth gate, not-found, approved-plan 403, period-lock 423,
 * successful update (+audit), and soft-delete.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock, logBudgetChangeMock } = vi.hoisted(() => ({
  prismaMock: {
    balanceSheetLine: { findFirst: vi.fn(), updateMany: vi.fn() },
    budgetPlan: { findFirst: vi.fn() },
  },
  logBudgetChangeMock: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock, logBudgetChange: logBudgetChangeMock }))
vi.mock("@/lib/budgeting/period-lock", () => ({
  getActivePeriodLock: vi.fn(async () => null),
  derivePeriodKey: vi.fn(() => "2026"),
}))
vi.mock("@/lib/budgeting/period-lock-http", () => ({
  lockedResponse: vi.fn(() => new Response(JSON.stringify({ error: "locked" }), { status: 423 })),
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { getActivePeriodLock } from "@/lib/budgeting/period-lock"
import { PUT, DELETE } from "./route"

const ORG_ID = "cm3rlsbalancesht000001a"
const ctx = { params: Promise.resolve({ id: "bs1" }) }
const line = { id: "bs1", planId: "p1", amount: 100, lineType: "asset", subType: null, notes: null }

beforeEach(async () => {
  vi.clearAllMocks()
  await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
  prismaMock.balanceSheetLine.findFirst.mockResolvedValue({ ...line })
  prismaMock.balanceSheetLine.updateMany.mockResolvedValue({ count: 1 })
  prismaMock.budgetPlan.findFirst.mockResolvedValue({ status: "draft" })
  ;(getActivePeriodLock as ReturnType<typeof vi.fn>).mockResolvedValue(null)
})

describe("PUT /api/budgeting/balance-sheet/[id]", () => {
  it("401s an unauthenticated caller", async () => {
    await mockSession(null)
    const res = await PUT(makeRequest("http://t/x", { method: "PUT", json: { amount: 5 } }), ctx)
    expect([401, 403]).toContain(res.status)
  })

  it("404s when the line is not found", async () => {
    prismaMock.balanceSheetLine.findFirst.mockResolvedValueOnce(null)
    const res = await PUT(makeRequest("http://t/x", { method: "PUT", json: { amount: 5 } }), ctx)
    expect(res.status).toBe(404)
  })

  it("403s when the plan is approved", async () => {
    prismaMock.budgetPlan.findFirst.mockResolvedValueOnce({ status: "approved" })
    const res = await PUT(makeRequest("http://t/x", { method: "PUT", json: { amount: 5 } }), ctx)
    expect(res.status).toBe(403)
  })

  it("423s when the period is locked", async () => {
    ;(getActivePeriodLock as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: "lock1" })
    const res = await PUT(makeRequest("http://t/x", { method: "PUT", json: { amount: 5 } }), ctx)
    expect(res.status).toBe(423)
  })

  it("updates the amount and writes an audit entry", async () => {
    prismaMock.balanceSheetLine.findFirst
      .mockResolvedValueOnce({ ...line }) // old
      .mockResolvedValueOnce({ ...line, amount: 200 }) // updated
    const res = await PUT(makeRequest("http://t/x", { method: "PUT", json: { amount: 200 } }), ctx)
    expect(res.status).toBe(200)
    expect(prismaMock.balanceSheetLine.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amount: 200 }) }),
    )
    expect(logBudgetChangeMock).toHaveBeenCalled()
  })

  it("rejects an invalid lineType (zod)", async () => {
    const res = await PUT(makeRequest("http://t/x", { method: "PUT", json: { lineType: "bogus" } }), ctx)
    expect(res.status).toBe(400)
  })
})

describe("DELETE /api/budgeting/balance-sheet/[id]", () => {
  it("soft-deletes (sets deletedAt) and returns success", async () => {
    const res = await DELETE(makeRequest("http://t/x", { method: "DELETE" }), ctx)
    expect(res.status).toBe(200)
    const arg = prismaMock.balanceSheetLine.updateMany.mock.calls[0][0]
    expect(arg.data.deletedAt).toBeInstanceOf(Date)
    expect(arg.data.deletedBy).toBe("u1")
    expect(logBudgetChangeMock).toHaveBeenCalledWith(expect.objectContaining({ action: "delete" }))
  })

  it("423s a locked period", async () => {
    ;(getActivePeriodLock as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: "lock1" })
    const res = await DELETE(makeRequest("http://t/x", { method: "DELETE" }), ctx)
    expect(res.status).toBe(423)
  })
})
