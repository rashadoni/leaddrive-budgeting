// @vitest-environment node
/**
 * Phase 7.G Turn LXIII — handler tests for `/api/budgeting/departments`.
 *
 * Closes Turn-LXII Tier 2 H1 audit gap: the M2 requireRole migration on
 * mutations shipped without route smoke. This file locks the role-gate
 * contract + Zod-rejection shape + happy-path so future regressions
 * surface immediately.
 *
 * Locks:
 *   - GET requires auth (401 unauth)
 *   - POST/PUT/DELETE require manager+ role (401 unauth, 403 viewer)
 *   - POST Zod rejects unknown keys (.strict()) → 400
 *   - POST happy path returns 201 with org-scoped data
 *   - DELETE requires `id` query param → 400 if missing
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    budgetDepartment: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET, POST, PUT, DELETE } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  prismaMock.budgetDepartment.findMany.mockReset().mockResolvedValue([])
  prismaMock.budgetDepartment.findUnique.mockReset().mockResolvedValue(null)
  prismaMock.budgetDepartment.create.mockReset()
  prismaMock.budgetDepartment.update.mockReset()
})

describe("GET /api/budgeting/departments", () => {
  it("returns 401 when unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(makeRequest("/api/budgeting/departments"))
    expect(res.status).toBe(401)
  })

  it("returns 200 + active departments for authenticated viewer", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.budgetDepartment.findMany.mockResolvedValue([
      { id: "d1", organizationId: ORG_ID, key: "it", label: "IT", isActive: true },
    ])
    const res = await GET(makeRequest("/api/budgeting/departments"))
    expect(res.status).toBe(200)
    const calledWhere = prismaMock.budgetDepartment.findMany.mock.calls[0][0].where
    expect(calledWhere.organizationId).toBe(ORG_ID)
    expect(calledWhere.isActive).toBe(true)
  })
})

describe("POST /api/budgeting/departments — role gate (Turn LXII M2)", () => {
  const validBody = { key: "ops", label: "Operations" }

  it("returns 401 when unauthenticated", async () => {
    await mockSession(null)
    const res = await POST(
      makeRequest("/api/budgeting/departments", { method: "POST", json: validBody }),
    )
    expect(res.status).toBe(401)
  })

  it("returns 403 when viewer (Turn LXII M2 closure)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await POST(
      makeRequest("/api/budgeting/departments", { method: "POST", json: validBody }),
    )
    expect(res.status).toBe(403)
    expect(prismaMock.budgetDepartment.create).not.toHaveBeenCalled()
  })

  it("returns 403 when editor (still below manager floor)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/departments", { method: "POST", json: validBody }),
    )
    expect(res.status).toBe(403)
    expect(prismaMock.budgetDepartment.create).not.toHaveBeenCalled()
  })

  it("returns 400 on Zod rejection — unknown key (.strict())", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await POST(
      makeRequest("/api/budgeting/departments", {
        method: "POST",
        // `id` is server-controlled — Zod .strict() must reject it.
        json: { ...validBody, id: "evil" },
      }),
    )
    expect(res.status).toBe(400)
    expect(prismaMock.budgetDepartment.create).not.toHaveBeenCalled()
  })

  it("returns 201 on happy path for manager", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.budgetDepartment.create.mockResolvedValue({
      id: "d1",
      organizationId: ORG_ID,
      key: "ops",
      label: "Operations",
    })
    const res = await POST(
      makeRequest("/api/budgeting/departments", { method: "POST", json: validBody }),
    )
    expect(res.status).toBe(201)
    const createArg = prismaMock.budgetDepartment.create.mock.calls[0][0]
    expect(createArg.data.organizationId).toBe(ORG_ID)
    expect(createArg.data.key).toBe("ops")
    expect(createArg.data.label).toBe("Operations")
  })
})

describe("PUT /api/budgeting/departments — role gate", () => {
  it("returns 403 when viewer", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await PUT(
      makeRequest("/api/budgeting/departments", {
        method: "PUT",
        json: { id: "d1", label: "Renamed" },
      }),
    )
    expect(res.status).toBe(403)
    expect(prismaMock.budgetDepartment.update).not.toHaveBeenCalled()
  })

  it("returns 200 + filters by org on happy manager path", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.budgetDepartment.update.mockResolvedValue({
      id: "d1",
      organizationId: ORG_ID,
      label: "Renamed",
    })
    const res = await PUT(
      makeRequest("/api/budgeting/departments", {
        method: "PUT",
        json: { id: "d1", label: "Renamed" },
      }),
    )
    expect(res.status).toBe(200)
    const updateArg = prismaMock.budgetDepartment.update.mock.calls[0][0]
    expect(updateArg.where.id).toBe("d1")
    expect(updateArg.where.organizationId).toBe(ORG_ID)
  })
})

describe("DELETE /api/budgeting/departments — role gate", () => {
  it("returns 403 when viewer", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await DELETE(
      makeRequest("/api/budgeting/departments?id=d1", { method: "DELETE" }),
    )
    expect(res.status).toBe(403)
    expect(prismaMock.budgetDepartment.update).not.toHaveBeenCalled()
  })

  it("returns 400 when id missing", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await DELETE(
      makeRequest("/api/budgeting/departments", { method: "DELETE" }),
    )
    expect(res.status).toBe(400)
  })

  it("soft-deletes (isActive=false) on happy path", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.budgetDepartment.update.mockResolvedValue({
      id: "d1",
      organizationId: ORG_ID,
      isActive: false,
    })
    const res = await DELETE(
      makeRequest("/api/budgeting/departments?id=d1", { method: "DELETE" }),
    )
    expect(res.status).toBe(200)
    const updateArg = prismaMock.budgetDepartment.update.mock.calls[0][0]
    expect(updateArg.data.isActive).toBe(false)
    expect(updateArg.where.organizationId).toBe(ORG_ID)
  })
})
