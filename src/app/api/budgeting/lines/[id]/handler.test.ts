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
    approvalRequest: {
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
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
  prismaMock.approvalRequest.findFirst.mockReset().mockResolvedValue(null)
  prismaMock.approvalRequest.update.mockReset().mockResolvedValue({})
  prismaMock.approvalRequest.updateMany.mockReset().mockResolvedValue({ count: 1 })
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

describe("PUT/DELETE /api/budgeting/lines/[id] — approval-request bypass (Turn LXXII)", () => {
  it("PUT bypasses 423 when valid ?approvalRequestId is given + marks request applied", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_requester", role: "manager" })
    // Period IS locked (would normally return 423)
    prismaMock.organization.findUnique.mockResolvedValue({
      lockedPeriods: [{ period: "2026", lockedAt: "x", lockedBy: "y" }],
    })
    // Approval request is approved + matches PUT line target
    prismaMock.approvalRequest.findFirst.mockResolvedValue({
      id: "req1",
      organizationId: ORG_ID,
      requestType: "budget_line_update",
      status: "approved",
      requestedBy: "u_requester",
      targetId: "ln1",
      planId: "p1", // matches mocked line.planId
      appliedAt: null,
    })
    const res = await PUT(
      makeRequest("/api/budgeting/lines/ln1?approvalRequestId=req1", {
        method: "PUT",
        json: { plannedAmount: 200 },
      }),
      paramsFor("ln1"),
    )
    expect(res.status).toBe(200)
    expect(prismaMock.budgetLine.updateMany).toHaveBeenCalledTimes(1)
    // Turn LXXII architect ⚠️ #2 closure: appliedAt is stamped atomically
    // BEFORE the mutation via claimApprovalRequest (updateMany with
    // appliedAt: null precondition).
    expect(prismaMock.approvalRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "req1", appliedAt: null }),
        data: expect.objectContaining({ appliedAt: expect.any(Date) }),
      }),
    )
  })

  it("PUT does NOT bypass when approvalRequestId belongs to different user", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_other", role: "manager" })
    prismaMock.organization.findUnique.mockResolvedValue({
      lockedPeriods: [{ period: "2026", lockedAt: "x", lockedBy: "y" }],
    })
    prismaMock.approvalRequest.findFirst.mockResolvedValue({
      id: "req1",
      organizationId: ORG_ID,
      requestType: "budget_line_update",
      status: "approved",
      requestedBy: "u_requester", // not u_other
      targetId: "ln1",
      appliedAt: null,
    })
    const res = await PUT(
      makeRequest("/api/budgeting/lines/ln1?approvalRequestId=req1", {
        method: "PUT",
        json: { plannedAmount: 200 },
      }),
      paramsFor("ln1"),
    )
    // Bypass refused → fell through to the 423 lock gate
    expect(res.status).toBe(423)
    expect(prismaMock.approvalRequest.updateMany).not.toHaveBeenCalled()
  })

  it("DELETE bypasses 423 when valid budget_line_delete approvalRequestId is given", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_requester", role: "manager" })
    prismaMock.organization.findUnique.mockResolvedValue({
      lockedPeriods: [{ period: "2026", lockedAt: "x", lockedBy: "y" }],
    })
    prismaMock.approvalRequest.findFirst.mockResolvedValue({
      id: "req2",
      organizationId: ORG_ID,
      requestType: "budget_line_delete",
      status: "approved",
      requestedBy: "u_requester",
      targetId: "ln1",
      planId: "p1", // matches mocked line.planId
      appliedAt: null,
    })
    const res = await DELETE(
      makeRequest("/api/budgeting/lines/ln1?approvalRequestId=req2", { method: "DELETE" }),
      paramsFor("ln1"),
    )
    expect(res.status).toBe(200)
    expect(prismaMock.budgetLine.deleteMany).toHaveBeenCalledTimes(1)
  })
})
