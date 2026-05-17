// @vitest-environment node
/**
 * Handler test for `/api/organizations/settings` (GET + PATCH).
 *
 * Phase 7.E C6 v2 — org-scoped settings JSON. Locks GET = any-auth,
 * PATCH = admin-only with audit emission + 422 zod validation +
 * sub-key merge preservation.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock, logAuditEventMock, enforceRateLimitMock } = vi.hoisted(() => ({
  prismaMock: {
    organization: { findUnique: vi.fn(), update: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
  logAuditEventMock: vi.fn(),
  enforceRateLimitMock: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/audit/log", () => ({
  logAuditEvent: logAuditEventMock,
  buildAuditContext: vi.fn(() => ({})),
}))
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: enforceRateLimitMock,
}))
vi.mock("@prisma/client", () => ({ Prisma: {} }))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET, PATCH } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  prismaMock.organization.findUnique.mockReset().mockResolvedValue(null)
  prismaMock.organization.update.mockReset().mockResolvedValue({ id: ORG_ID })
  prismaMock.auditEvent.create.mockReset().mockResolvedValue({ id: "a1" })
  logAuditEventMock.mockReset().mockResolvedValue({ ok: true })
  enforceRateLimitMock.mockReset().mockReturnValue(null)
})

describe("GET /api/organizations/settings", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(makeRequest("/api/organizations/settings"))
    expect(res.status).toBe(401)
  })

  it("404 org not found", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.organization.findUnique.mockResolvedValue(null)
    const res = await GET(makeRequest("/api/organizations/settings"))
    expect(res.status).toBe(404)
  })

  it("200 returns settings", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.organization.findUnique.mockResolvedValue({
      settings: { alertThresholds: { foo: 1 } },
    })
    const res = await GET(makeRequest("/api/organizations/settings"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.settings).toMatchObject({ alertThresholds: { foo: 1 } })
  })

  it("200 returns {} when settings is null", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.organization.findUnique.mockResolvedValue({ settings: null })
    const res = await GET(makeRequest("/api/organizations/settings"))
    const body = await res.json()
    expect(body.settings).toEqual({})
  })
})

describe("PATCH /api/organizations/settings", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await PATCH(
      makeRequest("/api/organizations/settings", { method: "PATCH", json: {} }),
    )
    expect(res.status).toBe(401)
  })

  it("403 non-admin (manager)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await PATCH(
      makeRequest("/api/organizations/settings", { method: "PATCH", json: {} }),
    )
    expect(res.status).toBe(403)
  })

  it("422 invalid alertThresholds shape", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
    const res = await PATCH(
      makeRequest("/api/organizations/settings", {
        method: "PATCH",
        json: { alertThresholds: "not-an-object" },
      }),
    )
    expect(res.status).toBe(422)
  })

  it("rate-limited returns the error response", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
    const rateLimitResponse = new Response("rate limited", { status: 429 })
    enforceRateLimitMock.mockReturnValue(rateLimitResponse)
    const res = await PATCH(
      makeRequest("/api/organizations/settings", { method: "PATCH", json: {} }),
    )
    expect(res.status).toBe(429)
  })

  it("404 org not found", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
    prismaMock.organization.findUnique.mockResolvedValue(null)
    const res = await PATCH(
      makeRequest("/api/organizations/settings", { method: "PATCH", json: {} }),
    )
    expect(res.status).toBe(404)
  })

  it("200 happy path — merge alertThresholds, leave siblings", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
    prismaMock.organization.findUnique.mockResolvedValue({
      id: ORG_ID,
      settings: { unrelated: "preserved", alertThresholds: { foo: 1 } },
    })
    const res = await PATCH(
      makeRequest("/api/organizations/settings", {
        method: "PATCH",
        json: { alertThresholds: {} },
      }),
    )
    expect(res.status).toBe(200)
    expect(prismaMock.organization.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ORG_ID },
        data: expect.objectContaining({
          settings: expect.objectContaining({ unrelated: "preserved" }),
        }),
      }),
    )
    expect(logAuditEventMock).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({
        event: expect.objectContaining({ action: "alert_thresholds_update" }),
      }),
    )
  })
})
