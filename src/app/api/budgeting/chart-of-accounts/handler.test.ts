// @vitest-environment node
/**
 * Handler test for `/api/budgeting/chart-of-accounts` (GET + POST).
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    chartOfAccount: { findMany: vi.fn(), create: vi.fn() },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET, POST } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  prismaMock.chartOfAccount.findMany.mockReset().mockResolvedValue([])
  prismaMock.chartOfAccount.create.mockReset().mockResolvedValue({ id: "a1" })
})

describe("GET /api/budgeting/chart-of-accounts", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(makeRequest("/api/budgeting/chart-of-accounts"))
    expect(res.status).toBe(401)
  })

  it("200 org-scoped + sortOrder+code orderBy", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    await GET(makeRequest("/api/budgeting/chart-of-accounts"))
    expect(prismaMock.chartOfAccount.findMany).toHaveBeenCalledWith({
      where: { organizationId: ORG_ID },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    })
  })
})

describe("POST /api/budgeting/chart-of-accounts", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await POST(
      makeRequest("/api/budgeting/chart-of-accounts", {
        method: "POST",
        json: { code: "601", name: "Sales" },
      }),
    )
    expect(res.status).toBe(401)
  })

  it("201 with org-scoped create", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/chart-of-accounts", {
        method: "POST",
        json: { code: "601", name: "Sales", accountType: "revenue" },
      }),
    )
    expect(res.status).toBe(201)
    expect(prismaMock.chartOfAccount.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: ORG_ID,
        code: "601",
        name: "Sales",
      }),
    })
  })
})
