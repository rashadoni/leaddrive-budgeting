// @vitest-environment node
/**
 * Handler test for `/api/users/[id]/role` (PATCH).
 *
 * Phase 7.F admin v2 — change a user's role. Locks admin-only gate,
 * cross-tenant 404, self-demotion + last-admin guards, and audit
 * event emission.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock, logAuditEventMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findFirst: vi.fn(), update: vi.fn(), count: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
  logAuditEventMock: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
// Stage 3 RLS — hand the mock straight to the scope callback.
vi.mock("@/lib/db/with-org-scope", () => ({
  withOrgScope: async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) =>
    fn(prismaMock),
}))
vi.mock("@/lib/audit/log", () => ({
  logAuditEvent: logAuditEventMock,
  buildAuditContext: vi.fn(() => ({})),
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { PATCH } from "./route"

const ORG_ID = "org_demo"
const ADMIN_ID = "u_admin"

beforeEach(() => {
  prismaMock.user.findFirst.mockReset().mockResolvedValue(null)
  prismaMock.user.update.mockReset().mockResolvedValue({ id: "u1" })
  prismaMock.user.count.mockReset().mockResolvedValue(1)
  prismaMock.auditEvent.create.mockReset().mockResolvedValue({ id: "a1" })
  logAuditEventMock.mockReset().mockResolvedValue(undefined)
})

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) })

describe("PATCH /api/users/[id]/role", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await PATCH(
      makeRequest("/api/users/u_target/role", { method: "PATCH", json: { role: "editor" } }),
      makeParams("u_target"),
    )
    expect(res.status).toBe(401)
  })

  it("403 non-admin", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await PATCH(
      makeRequest("/api/users/u_target/role", { method: "PATCH", json: { role: "editor" } }),
      makeParams("u_target"),
    )
    expect(res.status).toBe(403)
  })

  it("400 invalid role value", async () => {
    await mockSession({ orgId: ORG_ID, userId: ADMIN_ID, role: "admin" })
    const res = await PATCH(
      makeRequest("/api/users/u_target/role", { method: "PATCH", json: { role: "ceo" } }),
      makeParams("u_target"),
    )
    expect(res.status).toBe(400)
  })

  it("404 cross-tenant target", async () => {
    await mockSession({ orgId: ORG_ID, userId: ADMIN_ID, role: "admin" })
    prismaMock.user.findFirst.mockResolvedValue(null)
    const res = await PATCH(
      makeRequest("/api/users/u_target/role", { method: "PATCH", json: { role: "editor" } }),
      makeParams("u_target"),
    )
    expect(res.status).toBe(404)
  })

  it("200 idempotent (role unchanged)", async () => {
    await mockSession({ orgId: ORG_ID, userId: ADMIN_ID, role: "admin" })
    prismaMock.user.findFirst.mockResolvedValue({ id: "u_target", email: "x@y", role: "editor" })
    const res = await PATCH(
      makeRequest("/api/users/u_target/role", { method: "PATCH", json: { role: "editor" } }),
      makeParams("u_target"),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.unchanged).toBe(true)
    expect(prismaMock.user.update).not.toHaveBeenCalled()
  })

  it("400 SELF_DEMOTION_BLOCKED — admin demoting self", async () => {
    await mockSession({ orgId: ORG_ID, userId: ADMIN_ID, role: "admin" })
    prismaMock.user.findFirst.mockResolvedValue({ id: ADMIN_ID, email: "a@y", role: "admin" })
    const res = await PATCH(
      makeRequest(`/api/users/${ADMIN_ID}/role`, { method: "PATCH", json: { role: "editor" } }),
      makeParams(ADMIN_ID),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe("SELF_DEMOTION_BLOCKED")
  })

  it("400 LAST_ADMIN_BLOCKED — no other admins", async () => {
    await mockSession({ orgId: ORG_ID, userId: ADMIN_ID, role: "admin" })
    prismaMock.user.findFirst.mockResolvedValue({ id: "u_other_admin", email: "b@y", role: "admin" })
    prismaMock.user.count.mockResolvedValue(0)
    const res = await PATCH(
      makeRequest("/api/users/u_other_admin/role", { method: "PATCH", json: { role: "editor" } }),
      makeParams("u_other_admin"),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe("LAST_ADMIN_BLOCKED")
  })

  it("200 happy path + audit emitted", async () => {
    await mockSession({ orgId: ORG_ID, userId: ADMIN_ID, role: "admin" })
    prismaMock.user.findFirst.mockResolvedValue({ id: "u_target", email: "x@y", role: "viewer" })
    const res = await PATCH(
      makeRequest("/api/users/u_target/role", { method: "PATCH", json: { role: "editor" } }),
      makeParams("u_target"),
    )
    expect(res.status).toBe(200)
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "u_target" }, data: { role: "editor" } }),
    )
    expect(logAuditEventMock).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({
        event: expect.objectContaining({ action: "user_role_change" }),
      }),
    )
  })
})
