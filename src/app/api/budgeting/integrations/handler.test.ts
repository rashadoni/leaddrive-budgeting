// @vitest-environment node
/**
 * Handler test for `/api/budgeting/integrations` (GET + POST + DELETE).
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    accountingIntegration: {
      findMany: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET, POST, DELETE } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  prismaMock.accountingIntegration.findMany.mockReset().mockResolvedValue([])
  prismaMock.accountingIntegration.create.mockReset().mockResolvedValue({ id: "i1" })
  prismaMock.accountingIntegration.deleteMany.mockReset().mockResolvedValue({ count: 1 })
})

describe("GET /api/budgeting/integrations", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(makeRequest("/api/budgeting/integrations"))
    expect(res.status).toBe(401)
  })

  it("200 org-scoped + recent 5 imports included", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    await GET(makeRequest("/api/budgeting/integrations"))
    expect(prismaMock.accountingIntegration.findMany).toHaveBeenCalledWith({
      where: { organizationId: ORG_ID },
      include: { imports: { take: 5, orderBy: { createdAt: "desc" } } },
      orderBy: { createdAt: "desc" },
    })
  })
})

describe("POST /api/budgeting/integrations", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await POST(
      makeRequest("/api/budgeting/integrations", {
        method: "POST",
        json: { provider: "qbo", name: "QBO" },
      }),
    )
    expect(res.status).toBe(401)
  })

  it("400 missing provider", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/integrations", {
        method: "POST",
        json: { name: "QBO" },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("400 strict-zod extra field rejected (organizationId injection)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/integrations", {
        method: "POST",
        json: {
          provider: "qbo",
          name: "QBO",
          organizationId: "evil-org",
        },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("201 happy path with default empty config/mapping", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/integrations", {
        method: "POST",
        json: { provider: "qbo", name: "QBO" },
      }),
    )
    expect(res.status).toBe(201)
    expect(prismaMock.accountingIntegration.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: ORG_ID,
        provider: "qbo",
        name: "QBO",
        config: {},
        categoryMapping: {},
      }),
    })
  })
})

describe("DELETE /api/budgeting/integrations", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await DELETE(
      makeRequest("/api/budgeting/integrations", {
        method: "DELETE",
        json: { id: "i1" },
      }),
    )
    expect(res.status).toBe(401)
  })

  it("400 missing id (zod min(1))", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await DELETE(
      makeRequest("/api/budgeting/integrations", {
        method: "DELETE",
        json: {},
      }),
    )
    expect(res.status).toBe(400)
  })

  it("200 deleteMany org-scoped (cross-tenant safe even if id is foreign)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await DELETE(
      makeRequest("/api/budgeting/integrations", {
        method: "DELETE",
        json: { id: "i1" },
      }),
    )
    expect(res.status).toBe(200)
    expect(prismaMock.accountingIntegration.deleteMany).toHaveBeenCalledWith({
      where: { id: "i1", organizationId: ORG_ID },
    })
  })
})
