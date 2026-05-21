// @vitest-environment node
/**
 * Handler tests for `/api/users` (GET list + POST create).
 *
 * Phase 7.F sub-group RBAC admin v2 — user-management endpoint.
 * Admin-only on both verbs. Critical security surface: bypass on the
 * gate would let any authenticated user create accounts in their org.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    user: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    auditEvent: { create: vi.fn() },
    // Phase 5.2 Stage 2 Tier 4 — withOrgScope wraps users reads/writes.
    $transaction: vi.fn(
      async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock),
    ),
    $executeRawUnsafe: vi.fn(async () => 1),
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("bcryptjs", () => ({
  default: { hash: vi.fn().mockResolvedValue("hashed") },
  hash: vi.fn().mockResolvedValue("hashed"),
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET, POST } from "./route"

// Phase 5.2 — withOrgScope validates 20-32 char cuid-shaped orgId.
const ORG_ID = "cm3rlsusers00000001abc"

beforeEach(() => {
  prismaMock.user.findMany.mockReset().mockResolvedValue([])
  prismaMock.user.findFirst.mockReset().mockResolvedValue(null)
  prismaMock.user.create.mockReset().mockResolvedValue({ id: "new_user" })
  prismaMock.auditEvent.create.mockReset().mockResolvedValue({ id: "a1" })
})

describe("GET /api/users", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(makeRequest("/api/users"))
    expect(res.status).toBe(401)
    expect(prismaMock.user.findMany).not.toHaveBeenCalled()
  })

  it("403 when role is below admin (manager rejected)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await GET(makeRequest("/api/users"))
    expect(res.status).toBe(403)
    expect(prismaMock.user.findMany).not.toHaveBeenCalled()
  })

  it("200 with users array org-scoped + select shape", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
    prismaMock.user.findMany.mockResolvedValue([
      { id: "u1", email: "a@x.com", name: "A", role: "viewer" },
    ])
    const res = await GET(makeRequest("/api/users"))
    expect(res.status).toBe(200)
    expect(prismaMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: ORG_ID },
        orderBy: [{ role: "asc" }, { name: "asc" }],
      }),
    )
    const body = await res.json()
    expect(body.users).toHaveLength(1)
  })
})

describe("POST /api/users", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await POST(
      makeRequest("/api/users", {
        method: "POST",
        json: { email: "x@y.com", name: "X", role: "viewer" },
      }),
    )
    expect(res.status).toBe(401)
  })

  it("403 when role is below admin", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await POST(
      makeRequest("/api/users", {
        method: "POST",
        json: { email: "x@y.com", name: "X", role: "viewer" },
      }),
    )
    expect(res.status).toBe(403)
    expect(prismaMock.user.create).not.toHaveBeenCalled()
  })

  it("400 invalid email format", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
    const res = await POST(
      makeRequest("/api/users", {
        method: "POST",
        json: { email: "not-an-email", name: "X", role: "viewer" },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("400 name shorter than 2 chars", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
    const res = await POST(
      makeRequest("/api/users", {
        method: "POST",
        json: { email: "x@y.com", name: "A", role: "viewer" },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("400 invalid role (not in ALLOWED_ROLES)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
    const res = await POST(
      makeRequest("/api/users", {
        method: "POST",
        json: { email: "x@y.com", name: "Xena", role: "god-mode" },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("409 duplicate email in same org", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
    prismaMock.user.findFirst.mockResolvedValue({ id: "existing-user" })
    const res = await POST(
      makeRequest("/api/users", {
        method: "POST",
        json: { email: "taken@y.com", name: "Xena", role: "viewer" },
      }),
    )
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe("EMAIL_TAKEN")
    expect(prismaMock.user.create).not.toHaveBeenCalled()
  })

  it("200 happy path returns user + tempPassword once", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
    prismaMock.user.create.mockResolvedValue({
      id: "new_u",
      email: "new@y.com",
      name: "New",
      role: "viewer",
      isActive: true,
      lastLogin: null,
      allowedSubGroupIds: [],
    })
    const res = await POST(
      makeRequest("/api/users", {
        method: "POST",
        json: { email: "new@y.com", name: "New User", role: "viewer" },
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.user.email).toBe("new@y.com")
    expect(typeof body.tempPassword).toBe("string")
    expect(body.tempPassword.length).toBeGreaterThan(0)
  })

  it("normalizes email to lowercase + trimmed", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
    await POST(
      makeRequest("/api/users", {
        method: "POST",
        json: { email: "  MIXED@CASE.com  ", name: "Yara", role: "editor" },
      }),
    )
    // findFirst lookup should use normalized email
    expect(prismaMock.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ email: "mixed@case.com" }),
      }),
    )
  })
})
