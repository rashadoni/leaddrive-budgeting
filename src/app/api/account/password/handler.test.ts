// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextResponse } from "next/server"

const { prismaMock, bcryptMock, enforceRateLimitMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findFirst: vi.fn(), updateMany: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
  bcryptMock: {
    compare: vi.fn(),
    hash: vi.fn(),
  },
  enforceRateLimitMock: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/db/with-org-scope", () => ({
  withOrgScope: async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) =>
    fn(prismaMock),
}))
vi.mock("bcryptjs", () => ({ default: bcryptMock }))
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: enforceRateLimitMock,
  getClientIp: vi.fn(() => "203.0.113.10"),
}))

import { makeRequest, mockSession } from "@/test/api-harness"
import { PATCH } from "./route"

const ORG_ID = "org12345678901234567890"
const USER_ID = "user1234567890123456789"

function request(json: unknown, origin = "http://localhost") {
  return makeRequest("/api/account/password", {
    method: "PATCH",
    headers: { origin, "x-forwarded-for": "203.0.113.10" },
    json,
  })
}

beforeEach(async () => {
  vi.unstubAllEnvs()
  vi.stubEnv("NEXTAUTH_URL", "http://localhost")
  await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "viewer" })
  enforceRateLimitMock.mockReset().mockReturnValue(null)
  prismaMock.user.findFirst.mockReset().mockResolvedValue({
    id: USER_ID,
    email: "user@example.com",
    passwordHash: "old-hash",
  })
  prismaMock.user.updateMany.mockReset().mockResolvedValue({ count: 1 })
  prismaMock.auditEvent.create.mockReset().mockResolvedValue({ id: "audit-1" })
  bcryptMock.compare.mockReset().mockResolvedValue(true)
  bcryptMock.hash.mockReset().mockResolvedValue("new-hash")
})

describe("PATCH /api/account/password", () => {
  it("returns 401 without a session", async () => {
    await mockSession(null)
    const response = await PATCH(
      request({ currentPassword: "old-password", newPassword: "new-password-123" }),
    )
    expect(response.status).toBe(401)
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled()
  })

  it("rejects a cross-origin mutation", async () => {
    const response = await PATCH(
      request(
        { currentPassword: "old-password", newPassword: "new-password-123" },
        "https://attacker.example",
      ),
    )
    expect(response.status).toBe(403)
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled()
  })

  it("rejects a mutation with no Origin header", async () => {
    const response = await PATCH(
      makeRequest("/api/account/password", {
        method: "PATCH",
        json: {
          currentPassword: "old-password",
          newPassword: "new-password-123",
        },
      }),
    )
    expect(response.status).toBe(403)
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled()
  })

  it("rejects plaintext transport in production", async () => {
    vi.stubEnv("NODE_ENV", "production")
    const response = await PATCH(
      request({ currentPassword: "old-password", newPassword: "new-password-123" }),
    )
    expect(response.status).toBe(426)
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled()
  })

  it("accepts trusted HTTPS forwarded by nginx in production", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("NEXTAUTH_URL", "https://budget.example")
    const response = await PATCH(
      makeRequest("/api/account/password", {
        method: "PATCH",
        headers: {
          origin: "https://budget.example",
          "x-forwarded-proto": "https",
          "x-real-ip": "203.0.113.10",
        },
        json: {
          currentPassword: "old-password",
          newPassword: "new-password-123",
        },
      }),
    )
    expect(response.status).toBe(200)
  })

  it("rejects short passwords and unknown request fields", async () => {
    const short = await PATCH(
      request({ currentPassword: "old-password", newPassword: "short" }),
    )
    expect(short.status).toBe(400)

    const extra = await PATCH(
      request({
        currentPassword: "old-password",
        newPassword: "new-password-123",
        userId: "someone-else",
      }),
    )
    expect(extra.status).toBe(400)
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled()
  })

  it("rejects values beyond bcrypt's 72-byte boundary", async () => {
    const response = await PATCH(
      request({ currentPassword: "old-password", newPassword: "🔐".repeat(20) }),
    )
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      code: "PASSWORD_TOO_MANY_BYTES",
    })
  })

  it("does not update or audit when the current password is wrong", async () => {
    bcryptMock.compare.mockResolvedValue(false)
    const response = await PATCH(
      request({ currentPassword: "wrong-password", newPassword: "new-password-123" }),
    )
    expect(response.status).toBe(400)
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled()
    expect(prismaMock.auditEvent.create).not.toHaveBeenCalled()
  })

  it("changes only the session user, increments authVersion and audits no secrets", async () => {
    const response = await PATCH(
      request({ currentPassword: "old-password", newPassword: "new-password-123" }),
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      reauthenticate: true,
    })
    expect(prismaMock.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: USER_ID,
          organizationId: ORG_ID,
          isActive: true,
        },
      }),
    )
    expect(bcryptMock.hash).toHaveBeenCalledWith("new-password-123", 12)
    expect(prismaMock.user.updateMany).toHaveBeenCalledWith({
      where: {
        id: USER_ID,
        organizationId: ORG_ID,
        isActive: true,
        passwordHash: "old-hash",
      },
      data: {
        passwordHash: "new-hash",
        authVersion: { increment: 1 },
      },
    })
    const auditPayload = prismaMock.auditEvent.create.mock.calls[0]?.[0]
    expect(auditPayload).toBeDefined()
    if (!auditPayload) throw new Error("expected password-change audit payload")
    expect(JSON.stringify(auditPayload)).not.toContain("old-password")
    expect(JSON.stringify(auditPayload)).not.toContain("new-password-123")
    expect(auditPayload.data.action).toBe("user_password_change")
    expect(auditPayload.data.actorUserId).toBe(USER_ID)
  })

  it("returns 409 when another request changed the old hash first", async () => {
    prismaMock.user.updateMany.mockResolvedValue({ count: 0 })
    const response = await PATCH(
      request({ currentPassword: "old-password", newPassword: "new-password-123" }),
    )
    expect(response.status).toBe(409)
    expect(prismaMock.auditEvent.create).not.toHaveBeenCalled()
  })

  it("returns Retry-After when the password-change bucket is exhausted", async () => {
    enforceRateLimitMock.mockReturnValueOnce(
      NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": "900" } },
      ),
    )
    const response = await PATCH(
      request({ currentPassword: "old-password", newPassword: "new-password-123" }),
    )
    expect(response.status).toBe(429)
    expect(response.headers.get("Retry-After")).toBe("900")
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled()
  })

  it("applies both the user and IP buckets", async () => {
    const response = await PATCH(
      request({ currentPassword: "old-password", newPassword: "new-password-123" }),
    )
    expect(response.status).toBe(200)
    expect(enforceRateLimitMock).toHaveBeenNthCalledWith(
      1,
      `${ORG_ID}:${USER_ID}`,
      expect.objectContaining({ name: "account-password-change", max: 5 }),
    )
    expect(enforceRateLimitMock).toHaveBeenNthCalledWith(
      2,
      "ip:203.0.113.10",
      expect.objectContaining({ name: "account-password-change-ip", max: 5 }),
    )
  })

  it("reports an audit gap without rolling back the password change", async () => {
    prismaMock.auditEvent.create.mockRejectedValue(new Error("audit unavailable"))
    const response = await PATCH(
      request({ currentPassword: "old-password", newPassword: "new-password-123" }),
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      auditStale: true,
    })
  })
})
