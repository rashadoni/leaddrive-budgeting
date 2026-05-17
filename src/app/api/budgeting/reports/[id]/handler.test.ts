// @vitest-environment node
/**
 * Handler test for `/api/budgeting/reports/[id]` (GET + PUT + DELETE).
 *
 * SavedBudgetReport single-item CRUD. Locks org-scoped lookup,
 * partial-update semantics, defense-in-depth scoped DELETE, and
 * Zod validation envelope.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    savedBudgetReport: {
      findFirst: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET, PUT, DELETE } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  prismaMock.savedBudgetReport.findFirst.mockReset().mockResolvedValue(null)
  prismaMock.savedBudgetReport.update.mockReset().mockResolvedValue({ id: "r1" })
  prismaMock.savedBudgetReport.deleteMany.mockReset().mockResolvedValue({ count: 0 })
})

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) })

describe("GET /api/budgeting/reports/[id]", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(makeRequest("/api/budgeting/reports/r1"), makeParams("r1"))
    expect(res.status).toBe(401)
  })

  it("404 cross-tenant", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.savedBudgetReport.findFirst.mockResolvedValue(null)
    const res = await GET(makeRequest("/api/budgeting/reports/r1"), makeParams("r1"))
    expect(res.status).toBe(404)
  })

  it("200 happy path — org-scoped findFirst", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.savedBudgetReport.findFirst.mockResolvedValue({ id: "r1", name: "X", organizationId: ORG_ID })
    const res = await GET(makeRequest("/api/budgeting/reports/r1"), makeParams("r1"))
    expect(res.status).toBe(200)
    expect(prismaMock.savedBudgetReport.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "r1", organizationId: ORG_ID } }),
    )
  })
})

describe("PUT /api/budgeting/reports/[id]", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await PUT(
      makeRequest("/api/budgeting/reports/r1", { method: "PUT", json: { name: "New" } }),
      makeParams("r1"),
    )
    expect(res.status).toBe(401)
  })

  it("400 invalid sortOrder", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await PUT(
      makeRequest("/api/budgeting/reports/r1", { method: "PUT", json: { sortOrder: "bogus" } }),
      makeParams("r1"),
    )
    expect(res.status).toBe(400)
  })

  it("404 when report not in org", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    prismaMock.savedBudgetReport.findFirst.mockResolvedValue(null)
    const res = await PUT(
      makeRequest("/api/budgeting/reports/r1", { method: "PUT", json: { name: "X" } }),
      makeParams("r1"),
    )
    expect(res.status).toBe(404)
  })

  it("200 partial update — only sends touched fields", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    prismaMock.savedBudgetReport.findFirst.mockResolvedValue({ id: "r1" })
    await PUT(
      makeRequest("/api/budgeting/reports/r1", {
        method: "PUT",
        json: { name: "Updated", sortOrder: "desc" },
      }),
      makeParams("r1"),
    )
    const updateData = prismaMock.savedBudgetReport.update.mock.calls[0][0].data
    expect(updateData).toMatchObject({ name: "Updated", sortOrder: "desc" })
    // entityType not touched → should not be present
    expect(updateData).not.toHaveProperty("entityType")
  })
})

describe("DELETE /api/budgeting/reports/[id]", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await DELETE(
      makeRequest("/api/budgeting/reports/r1", { method: "DELETE" }),
      makeParams("r1"),
    )
    expect(res.status).toBe(401)
  })

  it("404 when no rows affected (cross-tenant or missing)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    prismaMock.savedBudgetReport.deleteMany.mockResolvedValue({ count: 0 })
    const res = await DELETE(
      makeRequest("/api/budgeting/reports/r1", { method: "DELETE" }),
      makeParams("r1"),
    )
    expect(res.status).toBe(404)
  })

  it("200 + defense-in-depth (id, organizationId) scope", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    prismaMock.savedBudgetReport.deleteMany.mockResolvedValue({ count: 1 })
    const res = await DELETE(
      makeRequest("/api/budgeting/reports/r1", { method: "DELETE" }),
      makeParams("r1"),
    )
    expect(res.status).toBe(200)
    expect(prismaMock.savedBudgetReport.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "r1", organizationId: ORG_ID } }),
    )
  })
})
