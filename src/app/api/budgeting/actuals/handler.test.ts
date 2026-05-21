// @vitest-environment node
/**
 * Phase 7.G Turn LXVIII — handler tests for `/api/budgeting/actuals` POST.
 *
 * Locks Phase 4.2 period-lock gate on the actuals mutation route. Smoke
 * coverage on auth + lock-respect + happy path. Currency conversion +
 * department access tested elsewhere — this file is for the lock contract.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    budgetActual: { create: vi.fn() },
    budgetPlan: { findFirst: vi.fn() },
    organization: { findUnique: vi.fn() },
    currencyRate: { findFirst: vi.fn() },
    approvalRequest: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    // Phase 5.2 Stage 2 — withOrgScope wraps budget_actuals + budget_plans reads/writes.
    $transaction: vi.fn(
      async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock),
    ),
    $executeRawUnsafe: vi.fn(async () => 1),
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({
  prisma: prismaMock,
  logBudgetChange: vi.fn(),
}))
vi.mock("@/lib/budgeting/currency", () => ({
  processCurrencyFields: vi.fn().mockResolvedValue({
    plannedAmount: 100,
    currencyCode: "AZN",
    exchangeRate: 1,
    originalAmount: 100,
  }),
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { POST } from "./route"

// Phase 5.2 — withOrgScope validates 20-32 char cuid-shaped orgId.
const ORG_ID = "cm3rlsactuals000001abc"
const validBody = { planId: "p1", category: "Sales", actualAmount: 100 }

beforeEach(() => {
  prismaMock.budgetActual.create.mockReset().mockResolvedValue({ id: "a1" })
  prismaMock.budgetPlan.findFirst.mockReset().mockResolvedValue({
    id: "p1",
    status: "draft",
    periodType: "annual",
    year: 2026,
    month: null,
    quarter: null,
  })
  prismaMock.organization.findUnique.mockReset().mockResolvedValue({ lockedPeriods: [] })
  prismaMock.approvalRequest.findFirst.mockReset().mockResolvedValue(null)
  prismaMock.approvalRequest.updateMany.mockReset().mockResolvedValue({ count: 1 })
})

describe("POST /api/budgeting/actuals — period lock (Turn LXVIII)", () => {
  it("returns 401 unauth", async () => {
    await mockSession(null)
    const res = await POST(makeRequest("/api/budgeting/actuals", { method: "POST", json: validBody }))
    expect(res.status).toBe(401)
    expect(prismaMock.budgetActual.create).not.toHaveBeenCalled()
  })

  it("returns 423 Locked when plan period is locked", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.organization.findUnique.mockResolvedValue({
      lockedPeriods: [
        { period: "2026", lockedAt: "2027-01-01T00:00:00Z", lockedBy: "u_admin", reason: "FY26 close" },
      ],
    })
    const res = await POST(makeRequest("/api/budgeting/actuals", { method: "POST", json: validBody }))
    expect(res.status).toBe(423)
    const body = await res.json()
    expect(body.error).toMatch(/Period locked/i)
    expect(body.lock.period).toBe("2026")
    expect(prismaMock.budgetActual.create).not.toHaveBeenCalled()
  })

  it("returns 201 happy path when no lock is set", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await POST(makeRequest("/api/budgeting/actuals", { method: "POST", json: validBody }))
    expect(res.status).toBe(201)
    expect(prismaMock.budgetActual.create).toHaveBeenCalledTimes(1)
  })

  it("403 approved-status fires BEFORE 423 lock check (existing gate stays in front)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.budgetPlan.findFirst.mockResolvedValue({
      id: "p1",
      status: "approved",
      periodType: "annual",
      year: 2026,
      month: null,
      quarter: null,
    })
    prismaMock.organization.findUnique.mockResolvedValue({
      lockedPeriods: [{ period: "2026", lockedAt: "x", lockedBy: "y" }],
    })
    const res = await POST(makeRequest("/api/budgeting/actuals", { method: "POST", json: validBody }))
    expect(res.status).toBe(403) // approved gate wins
  })
})

describe("POST /api/budgeting/actuals — approval-request bypass (Turn LXXII ⚠️ #3)", () => {
  it("bypasses 403 (approved-plan) when valid ?approvalRequestId is given + atomically claims", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_requester", role: "manager" })
    // Plan is approved → would normally return 403
    prismaMock.budgetPlan.findFirst.mockResolvedValue({
      id: "p1",
      status: "approved",
      periodType: "annual",
      year: 2026,
      month: null,
      quarter: null,
    })
    prismaMock.approvalRequest.findFirst.mockResolvedValue({
      id: "req1",
      organizationId: ORG_ID,
      requestType: "budget_actual_create",
      status: "approved",
      requestedBy: "u_requester",
      planId: "p1",
      targetId: null,
      appliedAt: null,
    })
    const res = await POST(
      makeRequest("/api/budgeting/actuals?approvalRequestId=req1", {
        method: "POST",
        json: validBody,
      }),
    )
    expect(res.status).toBe(201)
    expect(prismaMock.budgetActual.create).toHaveBeenCalledTimes(1)
    expect(prismaMock.approvalRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "req1", appliedAt: null }),
      }),
    )
  })

  it("does NOT bypass when approvalRequestId belongs to different user", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_other", role: "manager" })
    prismaMock.budgetPlan.findFirst.mockResolvedValue({
      id: "p1",
      status: "approved",
      periodType: "annual",
      year: 2026,
      month: null,
      quarter: null,
    })
    prismaMock.approvalRequest.findFirst.mockResolvedValue({
      id: "req1",
      organizationId: ORG_ID,
      requestType: "budget_actual_create",
      status: "approved",
      requestedBy: "u_requester", // not u_other
      planId: "p1",
      targetId: null,
      appliedAt: null,
    })
    const res = await POST(
      makeRequest("/api/budgeting/actuals?approvalRequestId=req1", {
        method: "POST",
        json: validBody,
      }),
    )
    expect(res.status).toBe(403)
    expect(prismaMock.budgetActual.create).not.toHaveBeenCalled()
  })
})
