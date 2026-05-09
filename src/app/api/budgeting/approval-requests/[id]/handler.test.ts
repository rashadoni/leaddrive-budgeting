// @vitest-environment node
/**
 * Phase 7.G Turn LXXI — handler tests for `/api/budgeting/approval-requests/[id]` PATCH.
 *
 * Locks: state machine (terminal states block transitions), action-specific
 * authorization (approve/reject = manager+, cancel = requester or admin),
 * apply-on-approve for period_unlock + audit emission, idempotency-on-409.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock, auditMock, notifyReviewedMock } = vi.hoisted(() => ({
  prismaMock: {
    approvalRequest: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    organization: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
  auditMock: vi.fn(),
  notifyReviewedMock: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/audit/log", async () => {
  const actual = await vi.importActual<typeof import("@/lib/audit/log")>("@/lib/audit/log")
  return { ...actual, logAuditEvent: auditMock }
})
vi.mock("@/lib/budgeting/approval-notifications", () => ({
  notifyApprovalReviewed: notifyReviewedMock,
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { PATCH } from "./route"

const ORG_ID = "org_demo"

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  prismaMock.approvalRequest.findFirst.mockReset().mockResolvedValue({
    id: "req1",
    organizationId: ORG_ID,
    status: "pending",
    requestType: "period_unlock",
    proposedChange: { period: "2026-Q1" },
    requestedBy: "u_requester",
  })
  prismaMock.approvalRequest.update.mockReset().mockImplementation(({ data }: any) =>
    Promise.resolve({ id: "req1", ...data }),
  )
  prismaMock.organization.findUnique.mockReset().mockResolvedValue({
    id: ORG_ID,
    lockedPeriods: [{ period: "2026-Q1", lockedAt: "x", lockedBy: "y", reason: "Q1 close" }],
  })
  prismaMock.organization.update.mockReset().mockResolvedValue({})
  auditMock.mockReset().mockResolvedValue({ ok: true, id: "audit1" })
  notifyReviewedMock.mockReset().mockResolvedValue(undefined)
})

describe("PATCH /api/budgeting/approval-requests/[id] — auth + state machine", () => {
  it("returns 401 unauth", async () => {
    await mockSession(null)
    const res = await PATCH(
      makeRequest("/api/budgeting/approval-requests/req1", {
        method: "PATCH",
        json: { action: "approve" },
      }),
      paramsFor("req1"),
    )
    expect(res.status).toBe(401)
  })

  it("returns 404 when request not found in org", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "manager" })
    prismaMock.approvalRequest.findFirst.mockResolvedValue(null)
    const res = await PATCH(
      makeRequest("/api/budgeting/approval-requests/req_missing", {
        method: "PATCH",
        json: { action: "approve" },
      }),
      paramsFor("req_missing"),
    )
    expect(res.status).toBe(404)
  })

  it("returns 409 when request already terminal (approve a previously-approved)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "manager" })
    prismaMock.approvalRequest.findFirst.mockResolvedValue({
      id: "req1",
      organizationId: ORG_ID,
      status: "approved",
      requestType: "period_unlock",
      proposedChange: { period: "2026-Q1" },
      requestedBy: "u_requester",
    })
    const res = await PATCH(
      makeRequest("/api/budgeting/approval-requests/req1", {
        method: "PATCH",
        json: { action: "approve" },
      }),
      paramsFor("req1"),
    )
    expect(res.status).toBe(409)
    expect(prismaMock.approvalRequest.update).not.toHaveBeenCalled()
  })

  it("returns 400 on invalid action", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "manager" })
    const res = await PATCH(
      makeRequest("/api/budgeting/approval-requests/req1", {
        method: "PATCH",
        json: { action: "bogus" },
      }),
      paramsFor("req1"),
    )
    expect(res.status).toBe(400)
  })
})

describe("PATCH approve/reject — manager-only authorization", () => {
  it("returns 403 when viewer tries to approve", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_viewer", role: "viewer" })
    const res = await PATCH(
      makeRequest("/api/budgeting/approval-requests/req1", {
        method: "PATCH",
        json: { action: "approve" },
      }),
      paramsFor("req1"),
    )
    expect(res.status).toBe(403)
    expect(prismaMock.approvalRequest.update).not.toHaveBeenCalled()
  })

  it("returns 403 when viewer tries to reject", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_viewer", role: "viewer" })
    const res = await PATCH(
      makeRequest("/api/budgeting/approval-requests/req1", {
        method: "PATCH",
        json: { action: "reject" },
      }),
      paramsFor("req1"),
    )
    expect(res.status).toBe(403)
  })

  it("manager approves period_unlock → 200 + applies unlock + audits", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "manager" })
    const res = await PATCH(
      makeRequest("/api/budgeting/approval-requests/req1", {
        method: "PATCH",
        json: { action: "approve", comment: "Approved for FY26 close fix" },
      }),
      paramsFor("req1"),
    )
    expect(res.status).toBe(200)
    // ApprovalRequest updated to approved+applied
    const updateArg = prismaMock.approvalRequest.update.mock.calls[0][0]
    expect(updateArg.data.status).toBe("approved")
    expect(updateArg.data.appliedAt).toBeInstanceOf(Date)
    expect(updateArg.data.reviewedBy).toBe("u_admin")
    // Lock removed
    expect(prismaMock.organization.update).toHaveBeenCalledTimes(1)
    const orgUpdateArg = prismaMock.organization.update.mock.calls[0][0]
    expect(orgUpdateArg.data.lockedPeriods).toEqual([])
    // Audit fired (period_lock_remove with original metadata)
    expect(auditMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorUserId: "u_admin",
        event: expect.objectContaining({
          action: "period_lock_remove",
          metadata: expect.objectContaining({
            period: "2026-Q1",
            removedLock: expect.objectContaining({ lockedBy: "y" }),
          }),
        }),
      }),
    )
  })

  it("manager rejects → 200 + status=rejected + NO unlock + NO audit", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "manager" })
    const res = await PATCH(
      makeRequest("/api/budgeting/approval-requests/req1", {
        method: "PATCH",
        json: { action: "reject", comment: "Not enough justification" },
      }),
      paramsFor("req1"),
    )
    expect(res.status).toBe(200)
    expect(prismaMock.approvalRequest.update.mock.calls[0][0].data.status).toBe("rejected")
    // Reject does NOT touch the lock
    expect(prismaMock.organization.update).not.toHaveBeenCalled()
    expect(auditMock).not.toHaveBeenCalled()
  })
})

describe("PATCH cancel — requester-only (or admin)", () => {
  it("requester can cancel own request", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_requester", role: "viewer" })
    const res = await PATCH(
      makeRequest("/api/budgeting/approval-requests/req1", {
        method: "PATCH",
        json: { action: "cancel" },
      }),
      paramsFor("req1"),
    )
    expect(res.status).toBe(200)
    expect(prismaMock.approvalRequest.update.mock.calls[0][0].data.status).toBe("cancelled")
  })

  it("non-requester non-admin viewer CANNOT cancel", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_other", role: "viewer" })
    const res = await PATCH(
      makeRequest("/api/budgeting/approval-requests/req1", {
        method: "PATCH",
        json: { action: "cancel" },
      }),
      paramsFor("req1"),
    )
    expect(res.status).toBe(403)
    expect(prismaMock.approvalRequest.update).not.toHaveBeenCalled()
  })

  it("admin can cancel ANY request (sweep stale)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
    const res = await PATCH(
      makeRequest("/api/budgeting/approval-requests/req1", {
        method: "PATCH",
        json: { action: "cancel" },
      }),
      paramsFor("req1"),
    )
    expect(res.status).toBe(200)
    expect(prismaMock.approvalRequest.update.mock.calls[0][0].data.status).toBe("cancelled")
  })
})

describe("PATCH — terminal-state idempotency (LXXI follow-up)", () => {
  it("returns 409 on re-cancel of a cancelled request", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_requester", role: "viewer" })
    prismaMock.approvalRequest.findFirst.mockResolvedValue({
      id: "req1",
      organizationId: ORG_ID,
      status: "cancelled",
      requestType: "period_unlock",
      proposedChange: { period: "2026-Q1" },
      requestedBy: "u_requester",
    })
    const res = await PATCH(
      makeRequest("/api/budgeting/approval-requests/req1", {
        method: "PATCH",
        json: { action: "cancel" },
      }),
      paramsFor("req1"),
    )
    expect(res.status).toBe(409)
    expect(prismaMock.approvalRequest.update).not.toHaveBeenCalled()
  })

  it("returns 409 on approve of a previously-rejected request", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "manager" })
    prismaMock.approvalRequest.findFirst.mockResolvedValue({
      id: "req1",
      organizationId: ORG_ID,
      status: "rejected",
      requestType: "period_unlock",
      proposedChange: { period: "2026-Q1" },
      requestedBy: "u_requester",
    })
    const res = await PATCH(
      makeRequest("/api/budgeting/approval-requests/req1", {
        method: "PATCH",
        json: { action: "approve" },
      }),
      paramsFor("req1"),
    )
    expect(res.status).toBe(409)
  })
})

describe("PATCH approve period_unlock — race-on-stale-lock branch (LXXI follow-up)", () => {
  it("approve succeeds + sets appliedAt even when lock vanished pre-flight (no audit, no org.update)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "manager" })
    // Org no longer has the requested period in its lockedPeriods (raced
    // with direct DELETE or admin-manual removal). Apply path should
    // still mark request approved + appliedAt to honor requester intent,
    // but skip the org.update + audit since there's nothing to remove.
    prismaMock.organization.findUnique.mockResolvedValue({
      id: ORG_ID,
      lockedPeriods: [{ period: "2026-Q4", lockedAt: "x", lockedBy: "y" }], // Q4 only, NOT the requested Q1
    })
    const res = await PATCH(
      makeRequest("/api/budgeting/approval-requests/req1", {
        method: "PATCH",
        json: { action: "approve" },
      }),
      paramsFor("req1"),
    )
    expect(res.status).toBe(200)
    const updateArg = prismaMock.approvalRequest.update.mock.calls[0][0]
    expect(updateArg.data.status).toBe("approved")
    expect(updateArg.data.appliedAt).toBeInstanceOf(Date) // intent satisfied
    expect(prismaMock.organization.update).not.toHaveBeenCalled() // nothing to remove
    expect(auditMock).not.toHaveBeenCalled() // no audit for no-op apply
  })
})

describe("PATCH — notifier wiring (Turn LXXIII follow-up ⚠️ #3)", () => {
  it("approve fires notifyApprovalReviewed with event=approved", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "manager" })
    await PATCH(
      makeRequest("/api/budgeting/approval-requests/req1", {
        method: "PATCH",
        json: { action: "approve", comment: "OK" },
      }),
      paramsFor("req1"),
    )
    await new Promise((r) => setTimeout(r, 5)) // let void microtask schedule
    expect(notifyReviewedMock).toHaveBeenCalledTimes(1)
    expect(notifyReviewedMock).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({
        event: "approved",
        requesterUserId: "u_requester",
        reviewerUserId: "u_admin",
        requestType: "period_unlock",
        reviewComment: "OK",
      }),
    )
  })

  it("reject fires notifyApprovalReviewed with event=rejected", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "manager" })
    await PATCH(
      makeRequest("/api/budgeting/approval-requests/req1", {
        method: "PATCH",
        json: { action: "reject", comment: "Insufficient detail" },
      }),
      paramsFor("req1"),
    )
    await new Promise((r) => setTimeout(r, 5))
    expect(notifyReviewedMock).toHaveBeenCalledTimes(1)
    expect(notifyReviewedMock).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({ event: "rejected", reviewComment: "Insufficient detail" }),
    )
  })

  it("cancel does NOT fire notifyApprovalReviewed (silent withdraw)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_requester", role: "viewer" })
    await PATCH(
      makeRequest("/api/budgeting/approval-requests/req1", {
        method: "PATCH",
        json: { action: "cancel" },
      }),
      paramsFor("req1"),
    )
    await new Promise((r) => setTimeout(r, 5))
    expect(notifyReviewedMock).not.toHaveBeenCalled()
  })
})
