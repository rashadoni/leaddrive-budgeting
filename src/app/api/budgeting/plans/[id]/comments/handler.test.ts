// @vitest-environment node
/**
 * Handler test for `/api/budgeting/plans/[id]/comments` (GET + POST).
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    budgetApprovalComment: { findMany: vi.fn(), create: vi.fn() },
    budgetPlan: { findFirst: vi.fn() },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/db/with-org-scope", () => ({
  withOrgScope: async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock),
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET, POST } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  prismaMock.budgetApprovalComment.findMany.mockReset().mockResolvedValue([])
  prismaMock.budgetApprovalComment.create.mockReset().mockResolvedValue({ id: "c1" })
  prismaMock.budgetPlan.findFirst.mockReset().mockResolvedValue({ id: "p1" })
})

describe("GET /api/budgeting/plans/[id]/comments", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(
      makeRequest("/api/budgeting/plans/p1/comments"),
      { params: Promise.resolve({ id: "p1" }) },
    )
    expect(res.status).toBe(401)
  })

  it("200 org-scoped + ascending createdAt", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    await GET(
      makeRequest("/api/budgeting/plans/p1/comments"),
      { params: Promise.resolve({ id: "p1" }) },
    )
    expect(prismaMock.budgetApprovalComment.findMany).toHaveBeenCalledWith({
      where: { planId: "p1", organizationId: ORG_ID },
      orderBy: { createdAt: "asc" },
    })
  })
})

describe("POST /api/budgeting/plans/[id]/comments", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await POST(
      makeRequest("/api/budgeting/plans/p1/comments", {
        method: "POST",
        json: { comment: "looks good" },
      }),
      { params: Promise.resolve({ id: "p1" }) },
    )
    expect(res.status).toBe(401)
  })

  it("400 invalid JSON", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const req = new Request("http://localhost/api/budgeting/plans/p1/comments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    })
    const res = await POST(req as never, { params: Promise.resolve({ id: "p1" }) })
    expect(res.status).toBe(400)
  })

  it("400 missing comment (zod min(1))", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/plans/p1/comments", {
        method: "POST",
        json: {},
      }),
      { params: Promise.resolve({ id: "p1" }) },
    )
    expect(res.status).toBe(400)
  })

  it("400 comment > 2000 chars", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/plans/p1/comments", {
        method: "POST",
        json: { comment: "x".repeat(2001) },
      }),
      { params: Promise.resolve({ id: "p1" }) },
    )
    expect(res.status).toBe(400)
  })

  it("400 strict-zod: extra fields rejected", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/plans/p1/comments", {
        method: "POST",
        json: { comment: "ok", organizationId: "evil-org" },
      }),
      { params: Promise.resolve({ id: "p1" }) },
    )
    expect(res.status).toBe(400)
  })

  it("404 cross-tenant plan (findFirst returns null)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    prismaMock.budgetPlan.findFirst.mockResolvedValue(null)
    const res = await POST(
      makeRequest("/api/budgeting/plans/p-other/comments", {
        method: "POST",
        json: { comment: "ok" },
      }),
      { params: Promise.resolve({ id: "p-other" }) },
    )
    expect(res.status).toBe(404)
    expect(prismaMock.budgetApprovalComment.create).not.toHaveBeenCalled()
  })

  it("201 happy path defaults status='comment'", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/plans/p1/comments", {
        method: "POST",
        json: { comment: "looks good" },
      }),
      { params: Promise.resolve({ id: "p1" }) },
    )
    expect(res.status).toBe(201)
    expect(prismaMock.budgetApprovalComment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: ORG_ID,
        planId: "p1",
        userId: "u1",
        status: "comment", // default
        comment: "looks good",
      }),
    })
  })
})
