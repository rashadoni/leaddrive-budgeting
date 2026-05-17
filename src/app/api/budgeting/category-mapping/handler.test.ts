// @vitest-environment node
/**
 * Handler test for `/api/budgeting/category-mapping` (GET + POST).
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    accountingIntegration: { findFirst: vi.fn(), updateMany: vi.fn() },
    budgetCostType: { findMany: vi.fn() },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET, POST } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  prismaMock.accountingIntegration.findFirst.mockReset().mockResolvedValue(null)
  prismaMock.accountingIntegration.updateMany.mockReset().mockResolvedValue({ count: 1 })
  prismaMock.budgetCostType.findMany.mockReset().mockResolvedValue([])
})

describe("GET /api/budgeting/category-mapping", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(makeRequest("/api/budgeting/category-mapping?integrationId=i1"))
    expect(res.status).toBe(401)
  })

  it("400 missing integrationId", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await GET(makeRequest("/api/budgeting/category-mapping"))
    expect(res.status).toBe(400)
  })

  it("404 cross-tenant integrationId", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.accountingIntegration.findFirst.mockResolvedValue(null)
    const res = await GET(
      makeRequest("/api/budgeting/category-mapping?integrationId=i-other"),
    )
    expect(res.status).toBe(404)
  })

  it("200 returns mapping + integration name + cost types", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.accountingIntegration.findFirst.mockResolvedValue({
      categoryMapping: { "Sales": "sales-cost-type" },
      name: "QBO",
    })
    prismaMock.budgetCostType.findMany.mockResolvedValue([
      { id: "ct1", name: "Sales", code: "601", lineType: "revenue" },
    ])
    const res = await GET(
      makeRequest("/api/budgeting/category-mapping?integrationId=i1"),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.mapping).toEqual({ Sales: "sales-cost-type" })
    expect(body.integrationName).toBe("QBO")
    expect(body.costTypes).toHaveLength(1)
  })
})

describe("POST /api/budgeting/category-mapping", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await POST(
      makeRequest("/api/budgeting/category-mapping", {
        method: "POST",
        json: { integrationId: "i1", mapping: { Sales: "ct1" } },
      }),
    )
    expect(res.status).toBe(401)
  })

  it("400 missing integrationId", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/category-mapping", {
        method: "POST",
        json: { mapping: {} },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("400 strict zod: extra fields rejected", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/category-mapping", {
        method: "POST",
        json: {
          integrationId: "i1",
          mapping: {},
          organizationId: "evil-org",
        },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("404 cross-tenant integrationId (updateMany count=0)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    prismaMock.accountingIntegration.updateMany.mockResolvedValue({ count: 0 })
    const res = await POST(
      makeRequest("/api/budgeting/category-mapping", {
        method: "POST",
        json: { integrationId: "i-other", mapping: { Sales: "ct1" } },
      }),
    )
    expect(res.status).toBe(404)
  })

  it("200 happy path updates org-scoped integration", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/category-mapping", {
        method: "POST",
        json: { integrationId: "i1", mapping: { Sales: "ct1", Rent: "ct2" } },
      }),
    )
    expect(res.status).toBe(200)
    expect(prismaMock.accountingIntegration.updateMany).toHaveBeenCalledWith({
      where: { id: "i1", organizationId: ORG_ID },
      data: { categoryMapping: { Sales: "ct1", Rent: "ct2" } },
    })
  })
})
