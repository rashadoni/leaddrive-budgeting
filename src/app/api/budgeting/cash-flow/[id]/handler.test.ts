// @vitest-environment node
/**
 * Handler tests for `/api/budgeting/cash-flow/[id]` (PUT + DELETE) — Phase 3.
 * Covers: auth gate, not-found, period-lock 423, successful update (+audit),
 * soft-delete, and zod validation.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock, logBudgetChangeMock } = vi.hoisted(() => ({
  prismaMock: {
    cashFlowEntry: { findFirst: vi.fn(), updateMany: vi.fn() },
  },
  logBudgetChangeMock: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock, logBudgetChange: logBudgetChangeMock }))
// Stage 3 RLS — route wraps DB access in withOrgScope; hand the mock straight to the callback so the handler test stays DB-free.
vi.mock("@/lib/db/with-org-scope", () => ({
  withOrgScope: async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock),
}))
vi.mock("@/lib/budgeting/period-lock", () => ({
  findFirstActiveLockInPeriods: vi.fn(async () => null),
}))
vi.mock("@/lib/budgeting/period-lock-http", () => ({
  lockedResponse: vi.fn(() => new Response(JSON.stringify({ error: "locked" }), { status: 423 })),
  containingPeriodKeys: vi.fn(() => ["2026", "2026-Q1", "2026-03"]),
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { findFirstActiveLockInPeriods } from "@/lib/budgeting/period-lock"
import { PUT, DELETE } from "./route"

const ORG_ID = "cm3rlscashflow0000001a"
const ctx = { params: Promise.resolve({ id: "cf1" }) }
const entry = { id: "cf1", year: 2026, month: 3, entryType: "inflow", amount: 100, description: null }

beforeEach(async () => {
  vi.clearAllMocks()
  await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
  prismaMock.cashFlowEntry.findFirst.mockResolvedValue({ ...entry })
  prismaMock.cashFlowEntry.updateMany.mockResolvedValue({ count: 1 })
  ;(findFirstActiveLockInPeriods as ReturnType<typeof vi.fn>).mockResolvedValue(null)
})

describe("PUT /api/budgeting/cash-flow/[id]", () => {
  it("401s an unauthenticated caller", async () => {
    await mockSession(null)
    const res = await PUT(makeRequest("http://t/x", { method: "PUT", json: { amount: 5 } }), ctx)
    expect([401, 403]).toContain(res.status)
  })

  it("404s when the entry is not found", async () => {
    prismaMock.cashFlowEntry.findFirst.mockResolvedValueOnce(null)
    const res = await PUT(makeRequest("http://t/x", { method: "PUT", json: { amount: 5 } }), ctx)
    expect(res.status).toBe(404)
  })

  it("423s when the entry's period is locked", async () => {
    ;(findFirstActiveLockInPeriods as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: "lock1" })
    const res = await PUT(makeRequest("http://t/x", { method: "PUT", json: { amount: 5 } }), ctx)
    expect(res.status).toBe(423)
  })

  it("updates the amount and writes an audit entry", async () => {
    prismaMock.cashFlowEntry.findFirst
      .mockResolvedValueOnce({ ...entry })
      .mockResolvedValueOnce({ ...entry, amount: 250 })
    const res = await PUT(makeRequest("http://t/x", { method: "PUT", json: { amount: 250 } }), ctx)
    expect(res.status).toBe(200)
    expect(prismaMock.cashFlowEntry.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amount: 250 }) }),
    )
    expect(logBudgetChangeMock).toHaveBeenCalled()
  })

  it("rejects an invalid entryType (zod)", async () => {
    const res = await PUT(makeRequest("http://t/x", { method: "PUT", json: { entryType: "bogus" } }), ctx)
    expect(res.status).toBe(400)
  })
})

describe("DELETE /api/budgeting/cash-flow/[id]", () => {
  it("soft-deletes (sets deletedAt) and returns success", async () => {
    const res = await DELETE(makeRequest("http://t/x", { method: "DELETE" }), ctx)
    expect(res.status).toBe(200)
    const arg = prismaMock.cashFlowEntry.updateMany.mock.calls[0][0]
    expect(arg.data.deletedAt).toBeInstanceOf(Date)
    expect(logBudgetChangeMock).toHaveBeenCalledWith(expect.objectContaining({ action: "delete" }))
  })

  it("423s a locked period", async () => {
    ;(findFirstActiveLockInPeriods as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: "lock1" })
    const res = await DELETE(makeRequest("http://t/x", { method: "DELETE" }), ctx)
    expect(res.status).toBe(423)
  })
})
