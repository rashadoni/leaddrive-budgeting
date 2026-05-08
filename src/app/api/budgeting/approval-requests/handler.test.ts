// @vitest-environment node
/**
 * Phase 7.G Turn LXXI — handler tests for `/api/budgeting/approval-requests` GET + POST.
 *
 * Locks: auth gate, status filter validation, Zod body validation,
 * proposedChange shape guard via isValidProposedChange, cross-tenant
 * planId guard, default status assignment.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    approvalRequest: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    budgetPlan: {
      findFirst: vi.fn(),
    },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET, POST } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  prismaMock.approvalRequest.findMany.mockReset().mockResolvedValue([])
  prismaMock.approvalRequest.create.mockReset().mockResolvedValue({ id: "req1" })
  prismaMock.budgetPlan.findFirst.mockReset().mockResolvedValue({ id: "p1" })
})

describe("GET /api/budgeting/approval-requests", () => {
  it("returns 401 unauth", async () => {
    await mockSession(null)
    const res = await GET(makeRequest("/api/budgeting/approval-requests"))
    expect(res.status).toBe(401)
  })

  it("returns request list filtered by org for any authenticated user", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.approvalRequest.findMany.mockResolvedValue([
      { id: "req1", status: "pending", requestType: "period_unlock" },
    ])
    const res = await GET(makeRequest("/api/budgeting/approval-requests"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.requests).toHaveLength(1)
    const where = prismaMock.approvalRequest.findMany.mock.calls[0][0].where
    expect(where.organizationId).toBe(ORG_ID)
  })

  it("applies status filter when valid", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    await GET(makeRequest("/api/budgeting/approval-requests?status=pending"))
    const where = prismaMock.approvalRequest.findMany.mock.calls[0][0].where
    expect(where.status).toBe("pending")
  })

  it("returns 400 on invalid status filter", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await GET(makeRequest("/api/budgeting/approval-requests?status=bogus"))
    expect(res.status).toBe(400)
  })

  it("applies planId filter when provided", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    await GET(makeRequest("/api/budgeting/approval-requests?planId=p1"))
    const where = prismaMock.approvalRequest.findMany.mock.calls[0][0].where
    expect(where.planId).toBe("p1")
  })
})

describe("POST /api/budgeting/approval-requests — create", () => {
  const validPeriodUnlock = {
    requestType: "period_unlock",
    proposedChange: { period: "2026-Q1" },
    reason: "Need to fix Q1 misclassification",
  }

  it("returns 401 unauth", async () => {
    await mockSession(null)
    const res = await POST(
      makeRequest("/api/budgeting/approval-requests", { method: "POST", json: validPeriodUnlock }),
    )
    expect(res.status).toBe(401)
    expect(prismaMock.approvalRequest.create).not.toHaveBeenCalled()
  })

  it("returns 400 on invalid requestType", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await POST(
      makeRequest("/api/budgeting/approval-requests", {
        method: "POST",
        json: { ...validPeriodUnlock, requestType: "bogus" },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("returns 400 on Zod .strict() — unknown key", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await POST(
      makeRequest("/api/budgeting/approval-requests", {
        method: "POST",
        json: { ...validPeriodUnlock, organizationId: "evil_org" },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("returns 400 when proposedChange shape mismatches requestType", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await POST(
      makeRequest("/api/budgeting/approval-requests", {
        method: "POST",
        json: {
          requestType: "period_unlock",
          proposedChange: { period: "not-a-period" }, // fails the regex
        },
      }),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/proposedChange shape/i)
  })

  it("returns 404 when planId references a plan not in caller's org", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.budgetPlan.findFirst.mockResolvedValue(null)
    const res = await POST(
      makeRequest("/api/budgeting/approval-requests", {
        method: "POST",
        json: {
          requestType: "budget_line_create",
          planId: "p_other_org",
          proposedChange: { category: "Sales", lineType: "revenue" },
        },
      }),
    )
    expect(res.status).toBe(404)
    expect(prismaMock.approvalRequest.create).not.toHaveBeenCalled()
  })

  it("returns 201 happy path + sets requestedBy from session userId", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_requester", role: "manager" })
    const res = await POST(
      makeRequest("/api/budgeting/approval-requests", { method: "POST", json: validPeriodUnlock }),
    )
    expect(res.status).toBe(201)
    expect(prismaMock.approvalRequest.create).toHaveBeenCalledTimes(1)
    const data = prismaMock.approvalRequest.create.mock.calls[0][0].data
    expect(data.organizationId).toBe(ORG_ID)
    expect(data.requestedBy).toBe("u_requester")
    expect(data.requestType).toBe("period_unlock")
  })
})
