// @vitest-environment node
/**
 * Handler test for `/api/budgeting/plans/[id]/restore` (POST).
 *
 * Locks soft-delete restore: admin-only + period-lock gate +
 * deletedAt-must-be-set guard.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    budgetPlan: { findFirst: vi.fn(), updateMany: vi.fn() },
    organization: { findUnique: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/db/with-org-scope", () => ({
  withOrgScope: async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock),
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { POST } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  prismaMock.budgetPlan.findFirst.mockReset().mockResolvedValue(null)
  prismaMock.budgetPlan.updateMany.mockReset().mockResolvedValue({ count: 1 })
  prismaMock.organization.findUnique.mockReset().mockResolvedValue({ lockedPeriods: [] })
  prismaMock.auditEvent.create.mockReset().mockResolvedValue({ id: "ae1" })
})

describe("POST /api/budgeting/plans/[id]/restore", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await POST(
      makeRequest("/api/budgeting/plans/p1/restore", { method: "POST" }),
      { params: Promise.resolve({ id: "p1" }) },
    )
    expect(res.status).toBe(401)
  })

  it("403 below admin (manager rejected — same bar as DELETE)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await POST(
      makeRequest("/api/budgeting/plans/p1/restore", { method: "POST" }),
      { params: Promise.resolve({ id: "p1" }) },
    )
    expect(res.status).toBe(403)
  })

  it("404 plan not found OR not deleted (updateMany count=0)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
    prismaMock.budgetPlan.updateMany.mockResolvedValue({ count: 0 })
    const res = await POST(
      makeRequest("/api/budgeting/plans/p1/restore", { method: "POST" }),
      { params: Promise.resolve({ id: "p1" }) },
    )
    expect(res.status).toBe(404)
  })

  it("200 happy path clears deletedAt + deletedBy", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
    const res = await POST(
      makeRequest("/api/budgeting/plans/p1/restore", { method: "POST" }),
      { params: Promise.resolve({ id: "p1" }) },
    )
    expect(res.status).toBe(200)
    expect(prismaMock.budgetPlan.updateMany).toHaveBeenCalledWith({
      where: { id: "p1", organizationId: ORG_ID, deletedAt: { not: null } },
      data: { deletedAt: null, deletedBy: null },
    })
  })
})
