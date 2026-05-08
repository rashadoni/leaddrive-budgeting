// @vitest-environment node
/**
 * Phase 7.G Turn LXVIII follow-up — handler tests for `/api/budgeting/actuals/[id]`.
 *
 * Locks Phase 4.2 period-lock gate on PUT + DELETE. Same shape as
 * lines/[id] but actuals are facts, not plan; the lock prevents
 * back-dated tampering with closed periods.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    budgetActual: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    budgetPlan: {
      findFirst: vi.fn(),
    },
    organization: {
      findUnique: vi.fn(),
    },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({
  prisma: prismaMock,
  logBudgetChange: vi.fn(),
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { PUT, DELETE } from "./route"

const ORG_ID = "org_demo"

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  prismaMock.budgetActual.findFirst.mockReset().mockResolvedValue({
    id: "a1",
    organizationId: ORG_ID,
    planId: "p1",
    actualAmount: 100,
  })
  prismaMock.budgetActual.updateMany.mockReset().mockResolvedValue({ count: 1 })
  prismaMock.budgetActual.deleteMany.mockReset().mockResolvedValue({ count: 1 })
  prismaMock.budgetPlan.findFirst.mockReset().mockResolvedValue({
    status: "draft",
    periodType: "annual",
    year: 2026,
    month: null,
    quarter: null,
  })
  prismaMock.organization.findUnique.mockReset().mockResolvedValue({ lockedPeriods: [] })
})

describe("PUT /api/budgeting/actuals/[id] — period lock (Turn LXVIII follow-up)", () => {
  it("returns 423 when plan period is locked + does NOT updateMany", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.organization.findUnique.mockResolvedValue({
      lockedPeriods: [{ period: "2026", lockedAt: "2027-01-01T00:00:00Z", lockedBy: "u_admin" }],
    })
    const res = await PUT(
      makeRequest("/api/budgeting/actuals/a1", { method: "PUT", json: { actualAmount: 200 } }),
      paramsFor("a1"),
    )
    expect(res.status).toBe(423)
    expect(prismaMock.budgetActual.updateMany).not.toHaveBeenCalled()
  })

  it("returns 200 happy path when no lock", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await PUT(
      makeRequest("/api/budgeting/actuals/a1", { method: "PUT", json: { actualAmount: 200 } }),
      paramsFor("a1"),
    )
    expect(res.status).toBe(200)
    expect(prismaMock.budgetActual.updateMany).toHaveBeenCalledTimes(1)
  })

  it("403 approved-status fires BEFORE 423 lock check (Turn LXX parity with DELETE)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    // Plan returned by findFirst (called twice: once for status, once for lock)
    prismaMock.budgetPlan.findFirst.mockResolvedValue({
      status: "approved",
      periodType: "annual",
      year: 2026,
      month: null,
      quarter: null,
    })
    prismaMock.organization.findUnique.mockResolvedValue({
      lockedPeriods: [{ period: "2026", lockedAt: "x", lockedBy: "y" }],
    })
    const res = await PUT(
      makeRequest("/api/budgeting/actuals/a1", { method: "PUT", json: { actualAmount: 200 } }),
      paramsFor("a1"),
    )
    expect(res.status).toBe(403) // approved gate wins
    expect(prismaMock.budgetActual.updateMany).not.toHaveBeenCalled()
  })
})

describe("DELETE /api/budgeting/actuals/[id] — period lock (Turn LXVIII follow-up)", () => {
  it("returns 423 when plan period is locked + does NOT deleteMany", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.organization.findUnique.mockResolvedValue({
      lockedPeriods: [{ period: "2026", lockedAt: "2027-01-01T00:00:00Z", lockedBy: "u_admin" }],
    })
    const res = await DELETE(
      makeRequest("/api/budgeting/actuals/a1", { method: "DELETE" }),
      paramsFor("a1"),
    )
    expect(res.status).toBe(423)
    expect(prismaMock.budgetActual.deleteMany).not.toHaveBeenCalled()
  })

  it("403 approved-status fires BEFORE 423 lock check", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.budgetPlan.findFirst.mockResolvedValue({
      status: "approved",
      periodType: "annual",
      year: 2026,
      month: null,
      quarter: null,
    })
    prismaMock.organization.findUnique.mockResolvedValue({
      lockedPeriods: [{ period: "2026", lockedAt: "x", lockedBy: "y" }],
    })
    const res = await DELETE(
      makeRequest("/api/budgeting/actuals/a1", { method: "DELETE" }),
      paramsFor("a1"),
    )
    expect(res.status).toBe(403)
  })
})
