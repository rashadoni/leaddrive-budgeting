// @vitest-environment node
/**
 * Phase 7.G Turn LXXII follow-up — handler tests for `/api/budgeting/lines`
 * POST approval-request bypass path. Architect ⚠️ #3 closure: POST route
 * had only module-level mock coverage; this file adds explicit handler-
 * level assertions for the bypass + cross-user refused paths.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    budgetLine: { create: vi.fn() },
    budgetPlan: { findFirst: vi.fn() },
    organization: { findUnique: vi.fn() },
    approvalRequest: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    currencyRate: { findFirst: vi.fn() },
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

const ORG_ID = "org_demo"
const validBody = { planId: "p1", category: "Sales", lineType: "revenue", plannedAmount: 100 }

beforeEach(() => {
  prismaMock.budgetLine.create.mockReset().mockResolvedValue({ id: "ln_new" })
  prismaMock.budgetPlan.findFirst.mockReset().mockResolvedValue({
    id: "p1",
    status: "approved", // would normally fire 403
    periodType: "annual",
    year: 2026,
    month: null,
    quarter: null,
  })
  prismaMock.organization.findUnique.mockReset().mockResolvedValue({ lockedPeriods: [] })
  prismaMock.approvalRequest.findFirst.mockReset().mockResolvedValue(null)
  prismaMock.approvalRequest.updateMany.mockReset().mockResolvedValue({ count: 1 })
})

describe("POST /api/budgeting/lines — approval-request bypass (Turn LXXII ⚠️ #3)", () => {
  it("bypasses 403 (approved-plan) when valid ?approvalRequestId is given + atomically claims", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_requester", role: "manager" })
    prismaMock.approvalRequest.findFirst.mockResolvedValue({
      id: "req1",
      organizationId: ORG_ID,
      requestType: "budget_line_create",
      status: "approved",
      requestedBy: "u_requester",
      planId: "p1", // matches body.planId — Turn LXXII ⚠️ #1 scope check passes
      targetId: null,
      appliedAt: null,
    })
    const res = await POST(
      makeRequest("/api/budgeting/lines?approvalRequestId=req1", {
        method: "POST",
        json: validBody,
      }),
    )
    expect(res.status).toBe(201)
    expect(prismaMock.budgetLine.create).toHaveBeenCalledTimes(1)
    // Atomic claim with appliedAt: null precondition
    expect(prismaMock.approvalRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "req1", appliedAt: null }),
        data: expect.objectContaining({ appliedAt: expect.any(Date) }),
      }),
    )
  })

  it("does NOT bypass when approvalRequestId belongs to different user (cross-user refused → 403)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_other", role: "manager" })
    prismaMock.approvalRequest.findFirst.mockResolvedValue({
      id: "req1",
      organizationId: ORG_ID,
      requestType: "budget_line_create",
      status: "approved",
      requestedBy: "u_requester", // not u_other
      planId: "p1",
      targetId: null,
      appliedAt: null,
    })
    const res = await POST(
      makeRequest("/api/budgeting/lines?approvalRequestId=req1", {
        method: "POST",
        json: validBody,
      }),
    )
    // Bypass refused → fell through to the 403 approved-plan gate
    expect(res.status).toBe(403)
    expect(prismaMock.budgetLine.create).not.toHaveBeenCalled()
    expect(prismaMock.approvalRequest.updateMany).not.toHaveBeenCalled()
  })

  it("returns 409 Conflict when atomic claim loses race (TOCTOU protection — Turn LXXII ⚠️ #2)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_requester", role: "manager" })
    prismaMock.approvalRequest.findFirst.mockResolvedValue({
      id: "req1",
      organizationId: ORG_ID,
      requestType: "budget_line_create",
      status: "approved",
      requestedBy: "u_requester",
      planId: "p1",
      targetId: null,
      appliedAt: null,
    })
    // Simulate concurrent loss: claim returns count=0
    prismaMock.approvalRequest.updateMany.mockResolvedValue({ count: 0 })
    const res = await POST(
      makeRequest("/api/budgeting/lines?approvalRequestId=req1", {
        method: "POST",
        json: validBody,
      }),
    )
    expect(res.status).toBe(409)
    expect(prismaMock.budgetLine.create).not.toHaveBeenCalled()
  })

  it("does NOT bypass when expectedPlanId mismatches request.planId (Turn LXXII ⚠️ #1 scope check)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_requester", role: "manager" })
    prismaMock.approvalRequest.findFirst.mockResolvedValue({
      id: "req1",
      organizationId: ORG_ID,
      requestType: "budget_line_create",
      status: "approved",
      requestedBy: "u_requester",
      planId: "p_OTHER", // approval was for plan p_OTHER, mutation targets p1
      targetId: null,
      appliedAt: null,
    })
    const res = await POST(
      makeRequest("/api/budgeting/lines?approvalRequestId=req1", {
        method: "POST",
        json: validBody, // planId: "p1"
      }),
    )
    // Scope-leak refused → fell through to the 403 approved-plan gate
    expect(res.status).toBe(403)
    expect(prismaMock.budgetLine.create).not.toHaveBeenCalled()
    expect(prismaMock.approvalRequest.updateMany).not.toHaveBeenCalled()
  })
})
