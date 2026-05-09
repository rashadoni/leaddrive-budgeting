// @vitest-environment node
/**
 * Phase 7.G Turn LXXIII — guard tests for approval-notification helpers.
 * Locks: org-admin recipient query (manager+ only, exclude requester),
 * requester lookup, multi-recipient envelope shape, fire-and-forget
 * silence on email failures.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import { resetEmailServiceForTests, getEmailService, InMemoryEmailService } from "@/lib/email"
import {
  notifyApprovalCreated,
  notifyApprovalReviewed,
} from "./approval-notifications"

beforeEach(() => {
  resetEmailServiceForTests()
})

describe("notifyApprovalCreated — org admins+managers (excluding requester)", () => {
  it("emails all admins+managers in the org, excluding the requester", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: "u_admin1", email: "a1@x", name: "Admin One" },
      { id: "u_mgr1", email: "m1@x", name: "Manager One" },
    ])
    const prismaMock = { user: { findMany } } as any
    await notifyApprovalCreated(prismaMock, {
      orgId: "org_demo",
      requestType: "budget_line_create",
      requesterUserId: "u_requester",
      requesterName: "Alice",
      reason: "Need to add Q1 line",
    })
    // findMany called with role IN (admin, manager) + isActive + id != requester
    const where = findMany.mock.calls[0][0].where
    expect(where.organizationId).toBe("org_demo")
    expect(where.role.in).toEqual(["admin", "manager"])
    expect(where.isActive).toBe(true)
    expect(where.id.not).toBe("u_requester")

    // 1 batched email with 2 recipients
    const sent = (getEmailService() as InMemoryEmailService).getSentEmails()
    expect(sent).toHaveLength(1)
    expect(Array.isArray(sent[0].to)).toBe(true)
    expect((sent[0].to as Array<{ email: string }>).map((r) => r.email)).toEqual(["a1@x", "m1@x"])
    expect(sent[0].metadata?.kind).toBe("approval_request_created")
    expect(sent[0].subject).toContain("Alice")
    expect(sent[0].body).toContain("Need to add Q1 line")
  })

  it("no email sent when org has no admins+managers (other than requester)", async () => {
    const findMany = vi.fn().mockResolvedValue([])
    const prismaMock = { user: { findMany } } as any
    await notifyApprovalCreated(prismaMock, {
      orgId: "org_demo",
      requestType: "budget_line_create",
      requesterUserId: "u_requester",
      requesterName: "Alice",
      reason: null,
    })
    const sent = (getEmailService() as InMemoryEmailService).getSentEmails()
    expect(sent).toHaveLength(0)
  })

  it("never throws — silent on email service failure", async () => {
    // Substitute a failing email service
    const failingService = {
      send: vi.fn().mockRejectedValue(new Error("SMTP down")),
    }
    // Hijack the singleton: replace its send with the failing one
    const svc = getEmailService() as InMemoryEmailService
    svc.send = failingService.send

    const findMany = vi.fn().mockResolvedValue([{ id: "u_admin1", email: "a@x", name: "A" }])
    const prismaMock = { user: { findMany } } as any
    // Should resolve, not reject
    await expect(
      notifyApprovalCreated(prismaMock, {
        orgId: "org_demo",
        requestType: "budget_line_create",
        requesterUserId: "u_requester",
        requesterName: "Alice",
        reason: null,
      }),
    ).resolves.toBeUndefined()
  })
})

describe("notifyApprovalReviewed — emails the requester", () => {
  it("approve event: emails requester with reviewer name + comment", async () => {
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce({ email: "alice@x", name: "Alice" }) // requester
      .mockResolvedValueOnce({ name: "Bob" }) // reviewer
    const prismaMock = { user: { findFirst } } as any
    await notifyApprovalReviewed(prismaMock, {
      event: "approved",
      requesterUserId: "u_alice",
      reviewerUserId: "u_bob",
      requestType: "budget_line_create",
      reviewComment: "Approved for FY26",
    })
    const sent = (getEmailService() as InMemoryEmailService).getSentEmails()
    expect(sent).toHaveLength(1)
    expect(sent[0].to).toEqual({ email: "alice@x", name: "Alice" })
    expect(sent[0].subject).toMatch(/approved/i)
    expect(sent[0].body).toContain("Bob")
    expect(sent[0].body).toContain("Approved for FY26")
    expect(sent[0].metadata?.kind).toBe("approval_request_approved")
  })

  it("reject event: emails requester with reviewer + comment", async () => {
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce({ email: "alice@x", name: "Alice" })
      .mockResolvedValueOnce({ name: "Bob" })
    const prismaMock = { user: { findFirst } } as any
    await notifyApprovalReviewed(prismaMock, {
      event: "rejected",
      requesterUserId: "u_alice",
      reviewerUserId: "u_bob",
      requestType: "budget_line_create",
      reviewComment: "Not enough justification",
    })
    const sent = (getEmailService() as InMemoryEmailService).getSentEmails()
    expect(sent[0].subject).toMatch(/rejected/i)
    expect(sent[0].body).toContain("Not enough justification")
    expect(sent[0].metadata?.kind).toBe("approval_request_rejected")
  })

  it("requester deactivated mid-flight: silent skip (no email, no throw)", async () => {
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce(null) // requester not found / deactivated
      .mockResolvedValueOnce({ name: "Bob" })
    const prismaMock = { user: { findFirst } } as any
    await notifyApprovalReviewed(prismaMock, {
      event: "approved",
      requesterUserId: "u_gone",
      reviewerUserId: "u_bob",
      requestType: "budget_line_create",
      reviewComment: null,
    })
    const sent = (getEmailService() as InMemoryEmailService).getSentEmails()
    expect(sent).toHaveLength(0)
  })

  it("falls back to userId when reviewer name not resolvable", async () => {
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce({ email: "alice@x", name: "Alice" })
      .mockResolvedValueOnce(null) // reviewer not found
    const prismaMock = { user: { findFirst } } as any
    await notifyApprovalReviewed(prismaMock, {
      event: "approved",
      requesterUserId: "u_alice",
      reviewerUserId: "u_bob_id",
      requestType: "budget_line_create",
      reviewComment: null,
    })
    const sent = (getEmailService() as InMemoryEmailService).getSentEmails()
    expect(sent[0].body).toContain("u_bob_id")
  })
})
