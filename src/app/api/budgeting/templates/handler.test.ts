// @vitest-environment node
/**
 * Handler test for `/api/budgeting/templates` (GET + POST).
 *
 * Locks BudgetDirectionTemplate CRUD with strict zod validation
 * (extra fields rejected) + numeric coercion of monetary fields.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    budgetDirectionTemplate: { findMany: vi.fn(), create: vi.fn() },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET, POST } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  prismaMock.budgetDirectionTemplate.findMany.mockReset().mockResolvedValue([])
  prismaMock.budgetDirectionTemplate.create.mockReset().mockResolvedValue({ id: "t1" })
})

describe("GET /api/budgeting/templates", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(makeRequest("/api/budgeting/templates"))
    expect(res.status).toBe(401)
  })

  it("200 org-scoped + sortOrder+name orderBy", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.budgetDirectionTemplate.findMany.mockResolvedValue([
      { id: "t1", name: "Rent" },
    ])
    const res = await GET(makeRequest("/api/budgeting/templates"))
    expect(res.status).toBe(200)
    expect(prismaMock.budgetDirectionTemplate.findMany).toHaveBeenCalledWith({
      where: { organizationId: ORG_ID },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    })
    const body = await res.json()
    expect(body.data).toHaveLength(1)
  })
})

describe("POST /api/budgeting/templates", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await POST(
      makeRequest("/api/budgeting/templates", {
        method: "POST",
        json: { name: "Rent" },
      }),
    )
    expect(res.status).toBe(401)
  })

  it("400 missing name (zod min(1))", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/templates", {
        method: "POST",
        json: { lineType: "revenue" },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("400 strict zod: extra fields rejected", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/templates", {
        method: "POST",
        json: { name: "Rent", unknownField: "x" },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("400 negative defaultAmount", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/templates", {
        method: "POST",
        json: { name: "Rent", defaultAmount: -100 },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("200 happy path with org-scoped + trimmed name", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/templates", {
        method: "POST",
        json: { name: "  Rent  ", defaultAmount: 100, lineType: "expense" },
      }),
    )
    expect(res.status).toBe(200)
    expect(prismaMock.budgetDirectionTemplate.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: ORG_ID,
        name: "Rent", // trimmed
        defaultAmount: 100,
        lineType: "expense",
      }),
    })
  })

  it("defaults: lineType=revenue when omitted", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    await POST(
      makeRequest("/api/budgeting/templates", {
        method: "POST",
        json: { name: "Sales", defaultAmount: 1000 },
      }),
    )
    expect(prismaMock.budgetDirectionTemplate.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ lineType: "revenue" }),
    })
  })
})
