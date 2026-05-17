// @vitest-environment node
/**
 * Handler test for `/api/budgeting/product-lines` (GET + POST).
 *
 * Phase 7.G Turn LXII security closure — strict Zod rejects unknown
 * keys including the organizationId injection vector. This test locks
 * the injection guard.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    productLine: { findMany: vi.fn(), create: vi.fn() },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET, POST } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  prismaMock.productLine.findMany.mockReset().mockResolvedValue([])
  prismaMock.productLine.create.mockReset().mockResolvedValue({ id: "pl1" })
})

describe("GET /api/budgeting/product-lines", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(makeRequest("/api/budgeting/product-lines"))
    expect(res.status).toBe(401)
  })

  it("200 with org-scoped + relation includes", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    await GET(makeRequest("/api/budgeting/product-lines"))
    expect(prismaMock.productLine.findMany).toHaveBeenCalledWith({
      where: { organizationId: ORG_ID },
      include: { salesBudgetLines: true, costComponents: true },
      orderBy: { sortOrder: "asc" },
    })
  })
})

describe("POST /api/budgeting/product-lines — strict Zod security closure", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await POST(
      makeRequest("/api/budgeting/product-lines", {
        method: "POST",
        json: { code: "WIDGET", name: "Widget", unit: "ea" },
      }),
    )
    expect(res.status).toBe(401)
  })

  it("400 missing code (zod min(1))", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/product-lines", {
        method: "POST",
        json: { name: "Widget", unit: "ea" },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("400 strict Zod rejects `organizationId` injection (Phase 7.G LXII closure)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/product-lines", {
        method: "POST",
        json: {
          code: "WIDGET",
          name: "Widget",
          unit: "ea",
          organizationId: "other-org", // attempt to inject
        },
      }),
    )
    expect(res.status).toBe(400)
    expect(prismaMock.productLine.create).not.toHaveBeenCalled()
  })

  it("400 strict Zod rejects `id` injection", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/product-lines", {
        method: "POST",
        json: {
          code: "WIDGET",
          name: "Widget",
          unit: "ea",
          id: "pre-assigned-id",
        },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("400 sortOrder out of range (max 100000)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/product-lines", {
        method: "POST",
        json: {
          code: "WIDGET",
          name: "Widget",
          unit: "ea",
          sortOrder: 999999,
        },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("201 happy path with session-derived organizationId", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/product-lines", {
        method: "POST",
        json: { code: "WIDGET", name: "Widget", unit: "ea" },
      }),
    )
    expect(res.status).toBe(201)
    expect(prismaMock.productLine.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: ORG_ID, // from session, not body
        code: "WIDGET",
      }),
    })
  })
})
