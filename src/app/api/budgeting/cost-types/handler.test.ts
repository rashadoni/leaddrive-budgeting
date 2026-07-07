// @vitest-environment node
/**
 * Phase 7.G Turn LXIII — handler tests for `/api/budgeting/cost-types`.
 *
 * Same pattern as `departments/handler.test.ts`: locks role-gate +
 * Zod-rejection + happy-path. Closes Turn-LXII Tier 2 H1.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    budgetCostType: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/db/with-org-scope", () => ({
  withOrgScope: async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock),
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET, POST, PUT, DELETE } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  prismaMock.budgetCostType.findMany.mockReset().mockResolvedValue([])
  prismaMock.budgetCostType.findUnique.mockReset().mockResolvedValue(null)
  prismaMock.budgetCostType.create.mockReset()
  prismaMock.budgetCostType.update.mockReset()
})

describe("GET /api/budgeting/cost-types", () => {
  it("returns 401 unauth", async () => {
    await mockSession(null)
    const res = await GET(makeRequest("/api/budgeting/cost-types"))
    expect(res.status).toBe(401)
  })

  it("returns 200 + filters active for viewer", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await GET(makeRequest("/api/budgeting/cost-types"))
    expect(res.status).toBe(200)
    const calledWhere = prismaMock.budgetCostType.findMany.mock.calls[0][0].where
    expect(calledWhere.organizationId).toBe(ORG_ID)
    expect(calledWhere.isActive).toBe(true)
  })
})

describe("POST /api/budgeting/cost-types — role gate (Turn LXII M2)", () => {
  const validBody = { key: "rent", label: "Rent" }

  it("returns 403 when viewer", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await POST(
      makeRequest("/api/budgeting/cost-types", { method: "POST", json: validBody }),
    )
    expect(res.status).toBe(403)
    expect(prismaMock.budgetCostType.create).not.toHaveBeenCalled()
  })

  it("returns 400 on Zod .strict() rejection", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await POST(
      makeRequest("/api/budgeting/cost-types", {
        method: "POST",
        json: { ...validBody, organizationId: "evil_org" },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("returns 201 on happy manager path", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.budgetCostType.create.mockResolvedValue({
      id: "ct1",
      organizationId: ORG_ID,
      key: "rent",
      label: "Rent",
    })
    const res = await POST(
      makeRequest("/api/budgeting/cost-types", { method: "POST", json: validBody }),
    )
    expect(res.status).toBe(201)
    const createArg = prismaMock.budgetCostType.create.mock.calls[0][0]
    expect(createArg.data.organizationId).toBe(ORG_ID)
  })
})

describe("PUT/DELETE /api/budgeting/cost-types — role gate", () => {
  it("PUT returns 403 when viewer", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await PUT(
      makeRequest("/api/budgeting/cost-types", {
        method: "PUT",
        json: { id: "ct1", label: "Renamed" },
      }),
    )
    expect(res.status).toBe(403)
  })

  it("DELETE returns 403 when viewer", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await DELETE(
      makeRequest("/api/budgeting/cost-types?id=ct1", { method: "DELETE" }),
    )
    expect(res.status).toBe(403)
  })

  it("DELETE soft-deletes for manager", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.budgetCostType.update.mockResolvedValue({
      id: "ct1",
      isActive: false,
    })
    const res = await DELETE(
      makeRequest("/api/budgeting/cost-types?id=ct1", { method: "DELETE" }),
    )
    expect(res.status).toBe(200)
    const updateArg = prismaMock.budgetCostType.update.mock.calls[0][0]
    expect(updateArg.data.isActive).toBe(false)
    expect(updateArg.where.organizationId).toBe(ORG_ID)
  })
})
