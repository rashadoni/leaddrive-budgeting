/**
 * Handler tests for GET + PATCH /api/admin/api-keys (Phase 5a).
 * Mocks prisma + auth so the test exercises HTTP shape + cross-tenant
 * guard + audit-emit + validation without touching Postgres.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock, auditLogMock } = vi.hoisted(() => ({
  prismaMock: {
    organization: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
  auditLogMock: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/audit/log", () => ({
  logAuditEvent: auditLogMock,
  buildAuditContext: () => null,
}))

import { mockSession } from "@/test/api-harness"
import { GET, PATCH } from "./route"
import type { NextRequest } from "next/server"

const ORG_ID = "org_demo"

async function makeGet(): Promise<NextRequest> {
  const base = new Request("http://localhost/api/admin/api-keys")
  const { NextRequest } = await import("next/server")
  return new NextRequest(base)
}

async function makePatch(body: unknown): Promise<NextRequest> {
  const base = new Request("http://localhost/api/admin/api-keys", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  const { NextRequest } = await import("next/server")
  return new NextRequest(base)
}

beforeEach(() => {
  prismaMock.organization.findUnique.mockReset()
  prismaMock.organization.update.mockReset()
  auditLogMock.mockReset().mockResolvedValue({ ok: true, id: "audit_1" })
})

describe("GET /api/admin/api-keys", () => {
  it("401 when unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(await makeGet())
    expect(res.status).toBe(401)
  })

  it("403 when role < admin", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await GET(await makeGet())
    expect(res.status).toBe(403)
  })

  it("returns redacted keys for admin", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" })
    prismaMock.organization.findUnique.mockResolvedValue({
      settings: { apiKeys: { eia: "ABCDEFGHIJ1234567890" } },
    })
    const res = await GET(await makeGet())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.keys.eia.configured).toBe(true)
    expect(body.keys.eia.preview).toContain("…")
    expect(body.keys.eia.preview).not.toContain("ABCDEFGH") // not raw
    expect(body.keys.usda.configured).toBe(false)
    expect(body.docs.eia.signupUrl).toContain("eia.gov")
  })
})

describe("PATCH /api/admin/api-keys", () => {
  it("401 when unauthenticated", async () => {
    await mockSession(null)
    const res = await PATCH(await makePatch({ updates: {} }))
    expect(res.status).toBe(401)
  })

  it("403 when role < admin", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await PATCH(await makePatch({ updates: { eia: "VALID_KEY_LONG" } }))
    expect(res.status).toBe(403)
  })

  it("400 when body is not JSON", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" })
    const { NextRequest } = await import("next/server")
    const base = new Request("http://localhost/api/admin/api-keys", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: "not json",
    })
    const req = new NextRequest(base)
    const res = await PATCH(req)
    expect(res.status).toBe(400)
  })

  it("400 when source name unknown", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" })
    const res = await PATCH(
      await makePatch({ updates: { unknown_source: "VALID_KEY_LONG_X" } }),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain("Unknown source")
  })

  it("400 when value type wrong (not string/null)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" })
    const res = await PATCH(await makePatch({ updates: { eia: 12345 } }))
    expect(res.status).toBe(400)
  })

  it("400 when key too short", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" })
    prismaMock.organization.findUnique.mockResolvedValue({ settings: {} })
    const res = await PATCH(await makePatch({ updates: { eia: "abc" } }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.details[0]).toContain("too short")
  })

  it("200 saves a valid key + writes audit-log", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" })
    prismaMock.organization.findUnique.mockResolvedValue({ settings: {} })
    prismaMock.organization.update.mockResolvedValue({})
    const res = await PATCH(
      await makePatch({ updates: { eia: "VALID_KEY_LONG_X" } }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.updated).toEqual(["eia"])
    expect(auditLogMock).toHaveBeenCalledTimes(1)
    const [, args] = auditLogMock.mock.calls[0]
    expect(args.event.action).toBe("api_key_update")
    expect(args.event.metadata.updated).toEqual(["eia"])
    // Crucially: metadata never carries the key value itself
    expect(JSON.stringify(args.event.metadata)).not.toContain("VALID_KEY_LONG_X")
  })

  it("200 clears a key when null sent", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" })
    prismaMock.organization.findUnique.mockResolvedValue({
      settings: { apiKeys: { eia: "OLDEIA_KEY12345" } },
    })
    prismaMock.organization.update.mockResolvedValue({})
    const res = await PATCH(await makePatch({ updates: { eia: null } }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.cleared).toEqual(["eia"])
  })
})
