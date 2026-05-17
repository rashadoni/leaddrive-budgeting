// @vitest-environment node
/**
 * Handler test for `/api/budgeting/reports` (GET list + POST create).
 *
 * SavedBudgetReport CRUD. Locks pagination math + Zod validation
 * envelope + org-scope.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    savedBudgetReport: {
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
    },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET, POST } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  prismaMock.savedBudgetReport.findMany.mockReset().mockResolvedValue([])
  prismaMock.savedBudgetReport.count.mockReset().mockResolvedValue(0)
  prismaMock.savedBudgetReport.create.mockReset().mockResolvedValue({ id: "r1" })
})

describe("GET /api/budgeting/reports", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(makeRequest("/api/budgeting/reports"))
    expect(res.status).toBe(401)
  })

  it("200 with pagination defaults (page=1, limit=50)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await GET(makeRequest("/api/budgeting/reports"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ success: true, page: 1, limit: 50 })
    expect(prismaMock.savedBudgetReport.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: ORG_ID },
        skip: 0,
        take: 50,
      }),
    )
  })

  it("respects ?page=2 → skip = (page-1)*limit", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    await GET(makeRequest("/api/budgeting/reports?page=2&limit=20"))
    expect(prismaMock.savedBudgetReport.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 20 }),
    )
  })

  it("caps ?limit to 100 hard ceiling", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    await GET(makeRequest("/api/budgeting/reports?limit=500"))
    expect(prismaMock.savedBudgetReport.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100 }),
    )
  })
})

describe("POST /api/budgeting/reports", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await POST(
      makeRequest("/api/budgeting/reports", {
        method: "POST",
        json: { name: "R1", entityType: "budgetLines", columns: [] },
      }),
    )
    expect(res.status).toBe(401)
  })

  it("400 invalid JSON body", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    // Send a non-JSON body via raw text
    const req = new Request("http://localhost/api/budgeting/reports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    })
    const res = await POST(req as never)
    expect(res.status).toBe(400)
  })

  it("400 missing name (zod min(1))", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/reports", {
        method: "POST",
        json: { entityType: "budgetLines", columns: [] },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("400 missing entityType (zod min(1))", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/reports", {
        method: "POST",
        json: { name: "R1", columns: [] },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("400 invalid sortOrder (not asc/desc)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/reports", {
        method: "POST",
        json: {
          name: "R1",
          entityType: "budgetLines",
          columns: [],
          sortOrder: "bogus",
        },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("201 happy path", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/reports", {
        method: "POST",
        json: {
          name: "Annual Variance",
          entityType: "budgetLines",
          columns: [{ field: "category", label: "Category" }],
          filters: [{ field: "lineType", op: "eq", value: "expense" }],
        },
      }),
    )
    expect(res.status).toBe(201)
    expect(prismaMock.savedBudgetReport.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: ORG_ID,
          name: "Annual Variance",
        }),
      }),
    )
  })
})
