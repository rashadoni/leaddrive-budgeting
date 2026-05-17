// @vitest-environment node
/**
 * Handler test for `/api/users/[id]/active` (PATCH).
 *
 * Phase 7.F admin v3 — toggle user isActive. Locks admin-only,
 * cross-tenant 404, self-deactivation guard, last-active-admin
 * guard, and audit event emission.
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

describe("PATCH /api/users/[id]/active", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await PATCH(
      makeRequest("/api/users/u_target/active", { method: "PATCH", json: { isActive: false } }),
      makeParams("u_target"),
    )
    expect(res.status).toBe(401)
  })

  it("403 non-admin", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await PATCH(
      makeRequest("/api/users/u_target/active", { method: "PATCH", json: { isActive: false } }),
      makeParams("u_target"),
    )
    expect(res.status).toBe(403)
  })

  it("400 missing isActive boolean", async () => {
    await mockSession({ orgId: ORG_ID, userId: ADMIN_ID, role: "admin" })
    const res = await PATCH(
      makeRequest("/api/users/u_target/active", { method: "PATCH", json: { foo: 1 } }),
      makeParams("u_target"),
    )
    expect(res.status).toBe(400)
  })

  it("404 cross-tenant target", async () => {
    await mockSession({ orgId: ORG_ID, userId: ADMIN_ID, role: "admin" })
    prismaMock.user.findFirst.mockResolvedValue(null)
    const res = await PATCH(
      makeRequest("/api/users/u_target/active", { method: "PATCH", json: { isActive: false } }),
      makeParams("u_target"),
    )
    expect(res.status).toBe(404)
  })

  it("200 idempotent (isActive unchanged)", async () => {
    await mockSession({ orgId: ORG_ID, userId: ADMIN_ID, role: "admin" })
    prismaMock.user.findFirst.mockResolvedValue({ id: "u_target", email: "x@y", role: "editor", isActive: true })
    const res = await PATCH(
      makeRequest("/api/users/u_target/active", { method: "PATCH", json: { isActive: true } }),
      makeParams("u_target"),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.unchanged).toBe(true)
  })

  it("400 SELF_DEACTIVATION_BLOCKED", async () => {
    await mockSession({ orgId: ORG_ID, userId: ADMIN_ID, role: "admin" })
    prismaMock.user.findFirst.mockResolvedValue({ id: ADMIN_ID, email: "a@y", role: "admin", isActive: true })
    const res = await PATCH(
      makeRequest(`/api/users/${ADMIN_ID}/active`, { method: "PATCH", json: { isActive: false } }),
      makeParams(ADMIN_ID),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe("SELF_DEACTIVATION_BLOCKED")
  })

  it("400 LAST_ADMIN_BLOCKED — deactivating last active admin", async () => {
    await mockSession({ orgId: ORG_ID, userId: ADMIN_ID, role: "admin" })
    prismaMock.user.findFirst.mockResolvedValue({ id: "u_other_admin", email: "b@y", role: "admin", isActive: true })
    prismaMock.user.count.mockResolvedValue(0)
    const res = await PATCH(
      makeRequest("/api/users/u_other_admin/active", { method: "PATCH", json: { isActive: false } }),
      makeParams("u_other_admin"),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe("LAST_ADMIN_BLOCKED")
  })

  it("200 happy path + audit emitted", async () => {
    await mockSession({ orgId: ORG_ID, userId: ADMIN_ID, role: "admin" })
    prismaMock.user.findFirst.mockResolvedValue({ id: "u_target", email: "x@y", role: "viewer", isActive: true })
    const res = await PATCH(
      makeRequest("/api/users/u_target/active", { method: "PATCH", json: { isActive: false } }),
      makeParams("u_target"),
    )
    expect(res.status).toBe(200)
    expect(logAuditEventMock).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({
        event: expect.objectContaining({ action: "user_active_toggle" }),
      }),
    )
  })
})
