// @vitest-environment node
/**
 * Phase 7.G Turn LXVIII follow-up — handler tests for `/api/budgeting/lines/[id]`.
 *
 * Locks Phase 4.2 period-lock gate on PUT + DELETE. The route already
 * loads `line` for cross-tenant + plan-status check; this turn extends
 * with a lock check via the shared `findActiveLockForPlan` helper.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    budgetLine: {
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
  prismaMock.budgetLine.findFirst.mockReset().mockResolvedValue({
    id: "ln1",
    organizationId: ORG_ID,
    planId: "p1",
    plannedAmount: 100,
  })
  prismaMock.budgetLine.updateMany.mockReset().mockResolvedValue({ count: 1 })
  prismaMock.budgetLine.deleteMany.mockReset().mockResolvedValue({ count: 1 })
  // Plan findFirst is called multiple times: once for status check (returns
  // {status}), once for lock check (returns {periodType, year, ...}). We
  // resolve to a superset shape that satisfies both reads.
  prismaMock.budgetPlan.findFirst.mockReset().mockResolvedValue({
    status: "draft",
    periodType: "annual",
    year: 2026,
    month: null,
    quarter: null,
  })
  prismaMock.organization.findUnique.mockReset().mockResolvedValue({ lockedPeriods: [] })
})

describe("PUT /api/budgeting/lines/[id] — period lock (Turn LXVIII follow-up)", () => {
  it("returns 423 when plan period is locked + does NOT updateMany", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.organization.findUnique.mockResolvedValue({
      lockedPeriods: [{ period: "2026", lockedAt: "2027-01-01T00:00:00Z", lockedBy: "u_admin", reason: "FY26" }],
    })
    const res = await PUT(
      makeRequest("/api/budgeting/lines/ln1", { method: "PUT", json: { plannedAmount: 200 } }),
      paramsFor("ln1"),
    )
    expect(res.status).toBe(423)
    const body = await res.json()
    expect(body.lock.period).toBe("2026")
    expect(prismaMock.budgetLine.updateMany).not.toHaveBeenCalled()
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
    const res = await PUT(
      makeRequest("/api/budgeting/lines/ln1", { method: "PUT", json: { plannedAmount: 200 } }),
      paramsFor("ln1"),
    )
    expect(res.status).toBe(403) // approved gate wins
  })

  it("returns 200 happy path when no lock", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await PUT(
      makeRequest("/api/budgeting/lines/ln1", { method: "PUT", json: { plannedAmount: 200 } }),
      paramsFor("ln1"),
    )
    expect(res.status).toBe(200)
    expect(prismaMock.budgetLine.updateMany).toHaveBeenCalledTimes(1)
  })
})

describe("DELETE /api/budgeting/lines/[id] — period lock (Turn LXVIII follow-up)", () => {
  it("returns 423 when plan period is locked + does NOT deleteMany", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.organization.findUnique.mockResolvedValue({
      lockedPeriods: [{ period: "2026", lockedAt: "2027-01-01T00:00:00Z", lockedBy: "u_admin" }],
    })
    const res = await DELETE(
      makeRequest("/api/budgeting/lines/ln1", { method: "DELETE" }),
      paramsFor("ln1"),
    )
    expect(res.status).toBe(423)
    expect(prismaMock.budgetLine.deleteMany).not.toHaveBeenCalled()
  })

  it("returns 200 happy path when no lock", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await DELETE(
      makeRequest("/api/budgeting/lines/ln1", { method: "DELETE" }),
      paramsFor("ln1"),
    )
    expect(res.status).toBe(200)
    expect(prismaMock.budgetLine.deleteMany).toHaveBeenCalledTimes(1)
  })
})
