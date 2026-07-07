// @vitest-environment node
/**
 * Handler test for `/api/budgeting/department-owners` (GET + POST + DELETE).
 *
 * Locks admin/manager-only write gate + strict-zod + upsert on
 * (org, dept, user) composite key + scoped deleteMany.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    budgetDepartmentOwner: {
      findMany: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/db/with-org-scope", () => ({
  withOrgScope: async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock),
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET, POST, DELETE } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  prismaMock.budgetDepartmentOwner.findMany.mockReset().mockResolvedValue([])
  prismaMock.budgetDepartmentOwner.upsert.mockReset().mockResolvedValue({ id: "o1" })
  prismaMock.budgetDepartmentOwner.deleteMany.mockReset().mockResolvedValue({ count: 1 })
})

describe("GET /api/budgeting/department-owners", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(makeRequest("/api/budgeting/department-owners"))
    expect(res.status).toBe(401)
  })

  it("200 org-scoped + budgetDept + user include", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    await GET(makeRequest("/api/budgeting/department-owners"))
    expect(prismaMock.budgetDepartmentOwner.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: ORG_ID },
        include: expect.objectContaining({
          budgetDept: expect.any(Object),
          user: expect.any(Object),
        }),
        orderBy: { createdAt: "desc" },
      }),
    )
  })
})

describe("POST /api/budgeting/department-owners", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await POST(
      makeRequest("/api/budgeting/department-owners", {
        method: "POST",
        json: { departmentId: "d1", userId: "u1" },
      }),
    )
    expect(res.status).toBe(401)
  })

  it("403 viewer can't manage owners", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await POST(
      makeRequest("/api/budgeting/department-owners", {
        method: "POST",
        json: { departmentId: "d1", userId: "u2" },
      }),
    )
    expect(res.status).toBe(403)
  })

  it("403 editor can't manage owners (only admin/manager)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/department-owners", {
        method: "POST",
        json: { departmentId: "d1", userId: "u2" },
      }),
    )
    expect(res.status).toBe(403)
  })

  it("400 strict-zod rejects extra field", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await POST(
      makeRequest("/api/budgeting/department-owners", {
        method: "POST",
        json: { departmentId: "d1", userId: "u2", organizationId: "evil" },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("400 missing departmentId", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await POST(
      makeRequest("/api/budgeting/department-owners", {
        method: "POST",
        json: { userId: "u2" },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("201 happy path — upsert on composite key", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await POST(
      makeRequest("/api/budgeting/department-owners", {
        method: "POST",
        json: { departmentId: "d1", userId: "u2", canApprove: true },
      }),
    )
    expect(res.status).toBe(201)
    expect(prismaMock.budgetDepartmentOwner.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId_departmentId_userId: {
            organizationId: ORG_ID,
            departmentId: "d1",
            userId: "u2",
          },
        },
      }),
    )
  })
})

describe("DELETE /api/budgeting/department-owners", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await DELETE(
      makeRequest("/api/budgeting/department-owners?id=o1", { method: "DELETE" }),
    )
    expect(res.status).toBe(401)
  })

  it("403 viewer can't delete", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await DELETE(
      makeRequest("/api/budgeting/department-owners?id=o1", { method: "DELETE" }),
    )
    expect(res.status).toBe(403)
  })

  it("400 missing id query param", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await DELETE(
      makeRequest("/api/budgeting/department-owners", { method: "DELETE" }),
    )
    expect(res.status).toBe(400)
  })

  it("200 + (id, organizationId) scoped deleteMany", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await DELETE(
      makeRequest("/api/budgeting/department-owners?id=o1", { method: "DELETE" }),
    )
    expect(res.status).toBe(200)
    expect(prismaMock.budgetDepartmentOwner.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "o1", organizationId: ORG_ID } }),
    )
  })
})
