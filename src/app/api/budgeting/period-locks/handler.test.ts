// @vitest-environment node
/**
 * Phase 7.G Turn LXX (Phase 4.2 closure) — handler tests for
 * `/api/budgeting/period-locks` GET/POST/DELETE.
 *
 * Locks: auth gate (read for any member, mutate admin-only), Zod period
 * format gate, idempotency on add+remove, audit emission on add+remove,
 * and the response shape contract (isNew flag distinguishing duplicate).
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock, auditMock } = vi.hoisted(() => ({
  prismaMock: {
    organization: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    auditEvent: {
      create: vi.fn(),
    },
    // Phase L10 — GET enriches lock list with the latest PeriodSnapshot
    // per period. Tests pre-stub findFirst to return null so the
    // existing assertions on { locks: [...] } keep working; new tests
    // can override to assert snapshot data flow.
    periodSnapshot: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
  },
  auditMock: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
// Stage 3 RLS — route wraps DB access in withOrgScope; hand the mock straight to the callback so the handler test stays DB-free.
vi.mock("@/lib/db/with-org-scope", () => ({
  withOrgScope: async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock),
}))
vi.mock("@/lib/audit/log", async () => {
  const actual = await vi.importActual<typeof import("@/lib/audit/log")>("@/lib/audit/log")
  return {
    ...actual,
    logAuditEvent: auditMock,
  }
})

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET, POST, DELETE } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  prismaMock.organization.findUnique.mockReset().mockResolvedValue({ id: ORG_ID, lockedPeriods: [] })
  prismaMock.organization.update.mockReset().mockResolvedValue({})
  prismaMock.auditEvent.create.mockReset().mockResolvedValue({ id: "audit1" })
  auditMock.mockReset().mockResolvedValue({ ok: true, id: "audit1" })
})

describe("GET /api/budgeting/period-locks", () => {
  it("returns 401 unauth", async () => {
    await mockSession(null)
    const res = await GET(makeRequest("/api/budgeting/period-locks"))
    expect(res.status).toBe(401)
  })

  it("returns lock list for any authenticated org member (viewer ok)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.organization.findUnique.mockResolvedValue({
      lockedPeriods: [{ period: "2026", lockedAt: "x", lockedBy: "y" }],
    })
    const res = await GET(makeRequest("/api/budgeting/period-locks"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.locks).toHaveLength(1)
    expect(body.locks[0].period).toBe("2026")
  })
})

describe("POST /api/budgeting/period-locks — admin gate + Zod + idempotency", () => {
  const validBody = { period: "2026-Q1", reason: "Q1 close" }

  it("returns 403 when viewer", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await POST(
      makeRequest("/api/budgeting/period-locks", { method: "POST", json: validBody }),
    )
    expect(res.status).toBe(403)
    expect(prismaMock.organization.update).not.toHaveBeenCalled()
  })

  it("returns 400 on invalid period format", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
    const res = await POST(
      makeRequest("/api/budgeting/period-locks", {
        method: "POST",
        json: { period: "not-a-period" },
      }),
    )
    expect(res.status).toBe(400)
    expect(prismaMock.organization.update).not.toHaveBeenCalled()
  })

  it("returns 400 on Zod .strict() — unknown key", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
    const res = await POST(
      makeRequest("/api/budgeting/period-locks", {
        method: "POST",
        json: { ...validBody, organizationId: "evil_org" },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("returns 201 + audit-emits + isNew=true for new lock", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
    const res = await POST(
      makeRequest("/api/budgeting/period-locks", { method: "POST", json: validBody }),
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.isNew).toBe(true)
    expect(body.lock.period).toBe("2026-Q1")
    expect(body.lock.lockedBy).toBe("u_admin")
    expect(prismaMock.organization.update).toHaveBeenCalledTimes(1)
    expect(auditMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG_ID,
        actorUserId: "u_admin",
        event: expect.objectContaining({
          action: "period_lock_add",
          metadata: expect.objectContaining({ period: "2026-Q1", reason: "Q1 close" }),
        }),
      }),
    )
  })

  it("returns 200 + isNew=false on duplicate add (idempotent)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
    prismaMock.organization.findUnique.mockResolvedValue({
      id: ORG_ID,
      lockedPeriods: [
        { period: "2026-Q1", lockedAt: "2026-04-01T00:00:00Z", lockedBy: "u_other", reason: "original" },
      ],
    })
    const res = await POST(
      makeRequest("/api/budgeting/period-locks", { method: "POST", json: validBody }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.isNew).toBe(false)
    // Original preserved (lockedBy stays u_other, reason stays "original")
    expect(body.lock.lockedBy).toBe("u_other")
    expect(body.lock.reason).toBe("original")
    // No audit emission for no-op
    expect(auditMock).not.toHaveBeenCalled()
  })
})

describe("DELETE /api/budgeting/period-locks — admin gate + idempotency", () => {
  it("returns 403 when viewer", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await DELETE(
      makeRequest("/api/budgeting/period-locks", {
        method: "DELETE",
        json: { period: "2026-Q1" },
      }),
    )
    expect(res.status).toBe(403)
  })

  it("returns 200 + removed=true + audit-emits when lock exists", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
    prismaMock.organization.findUnique.mockResolvedValue({
      id: ORG_ID,
      lockedPeriods: [
        { period: "2026-Q1", lockedAt: "2026-04-01T00:00:00Z", lockedBy: "u_other", reason: "original" },
      ],
    })
    const res = await DELETE(
      makeRequest("/api/budgeting/period-locks", {
        method: "DELETE",
        json: { period: "2026-Q1" },
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.removed).toBe(true)
    expect(prismaMock.organization.update).toHaveBeenCalledTimes(1)
    expect(auditMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        event: expect.objectContaining({
          action: "period_lock_remove",
          metadata: expect.objectContaining({
            period: "2026-Q1",
            removedLock: expect.objectContaining({ lockedBy: "u_other" }),
          }),
        }),
      }),
    )
  })

  it("returns 200 + removed=false (idempotent) when lock not present", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_admin", role: "admin" })
    const res = await DELETE(
      makeRequest("/api/budgeting/period-locks", {
        method: "DELETE",
        json: { period: "2026-Q1" },
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.removed).toBe(false)
    expect(prismaMock.organization.update).not.toHaveBeenCalled()
    expect(auditMock).not.toHaveBeenCalled()
  })
})
