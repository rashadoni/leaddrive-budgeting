// @vitest-environment node
/**
 * Handler test for `/api/users/[id]/access` (PATCH).
 *
 * Phase 7.F sub-group RBAC admin v2 — per-user access update. Locks
 * admin-only gate, cross-tenant 404, sub-group level-1 validation,
 * and audit event emission.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock, logAuditEventMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findFirst: vi.fn(), update: vi.fn() },
    company: { findMany: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
  logAuditEventMock: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/audit/log", () => ({
  logAuditEvent: logAuditEventMock,
  buildAuditContext: vi.fn(() => ({})),
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { PATCH } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  prismaMock.user.findFirst.mockReset().mockResolvedValue(null)
  prismaMock.user.update.mockReset().mockResolvedValue({ id: "u1" })
  prismaMock.company.findMany.mockReset().mockResolvedValue([])
  prismaMock.auditEvent.create.mockReset().mockResolvedValue({ id: "a1" })
  logAuditEventMock.mockReset().mockResolvedValue(undefined)
})

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) })

describe("PATCH /api/users/[id]/access", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await PATCH(
      makeRequest("/api/users/u1/access", { method: "PATCH", json: { allowedSubGroupIds: [] } }),
      makeParams("u1"),
    )
    expect(res.status).toBe(401)
  })

  it("403 non-admin", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_self", role: "manager" })
    const res = await PATCH(
      makeRequest("/api/users/u1/access", { method: "PATCH", json: { allowedSubGroupIds: [] } }),
      makeParams("u1"),
    )
    expect(res.status).toBe(403)
  })

  it("400 invalid body (not an array)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
    const res = await PATCH(
      makeRequest("/api/users/u1/access", { method: "PATCH", json: { allowedSubGroupIds: "AAC" } }),
      makeParams("u1"),
    )
    expect(res.status).toBe(400)
  })

  it("404 cross-tenant target user", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
    prismaMock.user.findFirst.mockResolvedValue(null)
    const res = await PATCH(
      makeRequest("/api/users/u1/access", { method: "PATCH", json: { allowedSubGroupIds: ["AAC"] } }),
      makeParams("u1"),
    )
    expect(res.status).toBe(404)
  })

  it("400 invalid sub-group id (leaf or cross-tenant)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
    prismaMock.user.findFirst.mockResolvedValue({ id: "u1", email: "x@y", allowedSubGroupIds: [] })
    // Only one of the two requested IDs is a valid level-1 company
    prismaMock.company.findMany.mockResolvedValue([{ id: "AAC" }])
    const res = await PATCH(
      makeRequest("/api/users/u1/access", {
        method: "PATCH",
        json: { allowedSubGroupIds: ["AAC", "AZSEKER-EDEN"] },
      }),
      makeParams("u1"),
    )
    expect(res.status).toBe(400)
  })

  it("200 happy path — empty array clears scope", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
    prismaMock.user.findFirst.mockResolvedValue({ id: "u1", email: "x@y", allowedSubGroupIds: ["AAC"] })
    const res = await PATCH(
      makeRequest("/api/users/u1/access", { method: "PATCH", json: { allowedSubGroupIds: [] } }),
      makeParams("u1"),
    )
    expect(res.status).toBe(200)
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "u1" }, data: { allowedSubGroupIds: [] } }),
    )
    expect(logAuditEventMock).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({ event: expect.objectContaining({ action: "user_access_change" }) }),
    )
  })

  it("200 happy path — narrows to valid sub-groups", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
    prismaMock.user.findFirst.mockResolvedValue({ id: "u1", email: "x@y", allowedSubGroupIds: [] })
    prismaMock.company.findMany.mockResolvedValue([{ id: "AAC" }, { id: "AZSEKER" }])
    const res = await PATCH(
      makeRequest("/api/users/u1/access", {
        method: "PATCH",
        json: { allowedSubGroupIds: ["AAC", "AZSEKER"] },
      }),
      makeParams("u1"),
    )
    expect(res.status).toBe(200)
    // Validates that company.findMany is scoped to parentCompanyId: null (level-1) + org
    expect(prismaMock.company.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: ORG_ID,
          parentCompanyId: null,
        }),
      }),
    )
  })
})
