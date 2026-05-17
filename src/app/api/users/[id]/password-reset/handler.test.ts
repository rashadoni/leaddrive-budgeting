// @vitest-environment node
/**
 * Handler test for `/api/users/[id]/password-reset` (PATCH).
 *
 * Phase 7.F admin v3 — temp password generation. Admin-only.
 * Returns the new temp password ONCE.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findFirst: vi.fn(), update: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("bcryptjs", () => ({
  default: { hash: vi.fn().mockResolvedValue("hashed") },
  hash: vi.fn().mockResolvedValue("hashed"),
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { PATCH } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  prismaMock.user.findFirst.mockReset().mockResolvedValue(null)
  prismaMock.user.update.mockReset().mockResolvedValue({ id: "u-target" })
  prismaMock.auditEvent.create.mockReset().mockResolvedValue({ id: "a1" })
})

describe("PATCH /api/users/[id]/password-reset", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await PATCH(
      makeRequest("/api/users/u-target/password-reset", { method: "PATCH" }),
      { params: Promise.resolve({ id: "u-target" }) },
    )
    expect(res.status).toBe(401)
  })

  it("403 below admin (manager rejected)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_mgr", role: "manager" })
    const res = await PATCH(
      makeRequest("/api/users/u-target/password-reset", { method: "PATCH" }),
      { params: Promise.resolve({ id: "u-target" }) },
    )
    expect(res.status).toBe(403)
    expect(prismaMock.user.update).not.toHaveBeenCalled()
  })

  it("400 invalid (empty) user id", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
    const res = await PATCH(
      makeRequest("/api/users/%20/password-reset", { method: "PATCH" }),
      { params: Promise.resolve({ id: "   " }) },
    )
    expect(res.status).toBe(400)
  })

  it("404 target user not found in org (cross-tenant guard)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
    prismaMock.user.findFirst.mockResolvedValue(null)
    const res = await PATCH(
      makeRequest("/api/users/u-other-org/password-reset", { method: "PATCH" }),
      { params: Promise.resolve({ id: "u-other-org" }) },
    )
    expect(res.status).toBe(404)
    expect(prismaMock.user.update).not.toHaveBeenCalled()
  })

  it("200 returns tempPassword ONCE + writes passwordHash", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
    prismaMock.user.findFirst.mockResolvedValue({
      id: "u-target",
      email: "target@x.com",
    })
    const res = await PATCH(
      makeRequest("/api/users/u-target/password-reset", { method: "PATCH" }),
      { params: Promise.resolve({ id: "u-target" }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(typeof body.tempPassword).toBe("string")
    expect(body.tempPassword.length).toBeGreaterThan(0)
    // user.update was called with passwordHash (not plaintext)
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "u-target" },
        data: { passwordHash: expect.any(String) },
      }),
    )
  })

  it("findFirst is org-scoped (cross-tenant safe)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
    prismaMock.user.findFirst.mockResolvedValue({
      id: "u-target",
      email: "target@x.com",
    })
    await PATCH(
      makeRequest("/api/users/u-target/password-reset", { method: "PATCH" }),
      { params: Promise.resolve({ id: "u-target" }) },
    )
    expect(prismaMock.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "u-target", organizationId: ORG_ID },
      }),
    )
  })
})
