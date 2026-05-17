// @vitest-environment node
/**
 * Smoke handler tests for `/api/operational-facts` (GET list + POST create).
 *
 * Phase 7.H F4.v2.3 — manual operational-KPI entry. Locks the auth +
 * validation envelope:
 * - Auth: requireAuth on GET (any-member read), requireRole(manager+) on
 *   POST (writes)
 * - Zod validation: metric must come from curated catalog
 * - Cross-tenant guard: company must belong to user's org
 *
 * Does NOT exercise the full anomaly/soft-bound/forceConfirm logic —
 * that's covered by `metric-validation-rules.test.ts` directly on the
 * pure helper.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    company: { findFirst: vi.fn() },
    operationalFact: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    user: { findFirst: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/rbac/company-scope", () => ({
  getCompanyScope: vi.fn().mockResolvedValue({ ids: null, bypassed: true }),
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET, POST } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  prismaMock.company.findFirst.mockReset().mockResolvedValue(null)
  prismaMock.operationalFact.findMany.mockReset().mockResolvedValue([])
  prismaMock.operationalFact.findUnique.mockReset().mockResolvedValue(null)
  prismaMock.operationalFact.create.mockReset().mockResolvedValue({ id: "new" })
  prismaMock.user.findFirst.mockReset().mockResolvedValue({ id: "u_admin", role: "admin" })
  prismaMock.auditEvent.create.mockReset().mockResolvedValue({ id: "a1" })
})

describe("GET /api/operational-facts", () => {
  it("401 when unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(makeRequest("/api/operational-facts"))
    expect(res.status).toBe(401)
    expect(prismaMock.operationalFact.findMany).not.toHaveBeenCalled()
  })

  it("400 when companyId is empty string (zod min(1))", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await GET(makeRequest("/api/operational-facts?companyId="))
    expect(res.status).toBe(400)
  })

  it("400 when from is not ISO-8601", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await GET(makeRequest("/api/operational-facts?from=not-a-date"))
    expect(res.status).toBe(400)
  })

  it("200 with empty {rows: []} when no rows match", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.operationalFact.findMany.mockResolvedValue([])
    const res = await GET(makeRequest("/api/operational-facts"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rows).toEqual([])
  })
})

describe("POST /api/operational-facts", () => {
  it("401 when unauthenticated", async () => {
    await mockSession(null)
    const res = await POST(
      makeRequest("/api/operational-facts", {
        method: "POST",
        json: {
          companyId: "c1",
          metric: "yield_per_ha",
          date: "2026-05-17T00:00:00Z",
          value: 60,
          unit: "tons/ha",
        },
      }),
    )
    expect(res.status).toBe(401)
  })

  it("403 when role is below manager (viewer cannot write)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await POST(
      makeRequest("/api/operational-facts", {
        method: "POST",
        json: {
          companyId: "c1",
          metric: "yield_per_ha",
          date: "2026-05-17T00:00:00Z",
          value: 60,
          unit: "tons/ha",
        },
      }),
    )
    expect(res.status).toBe(403)
    expect(prismaMock.operationalFact.create).not.toHaveBeenCalled()
  })

  it("400 on unknown metric (zod enum rejects)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await POST(
      makeRequest("/api/operational-facts", {
        method: "POST",
        json: {
          companyId: "c1",
          metric: "totally_made_up_metric",
          date: "2026-05-17T00:00:00Z",
          value: 60,
          unit: "x/y",
        },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("400 on missing required field (companyId)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await POST(
      makeRequest("/api/operational-facts", {
        method: "POST",
        json: {
          // companyId omitted
          metric: "yield_per_ha",
          date: "2026-05-17T00:00:00Z",
          value: 60,
          unit: "tons/ha",
        },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("400 on value not finite (zod number.finite rejects NaN/Infinity)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await POST(
      makeRequest("/api/operational-facts", {
        method: "POST",
        json: {
          companyId: "c1",
          metric: "yield_per_ha",
          date: "2026-05-17T00:00:00Z",
          value: "not-a-number",
          unit: "tons/ha",
        },
      }),
    )
    expect(res.status).toBe(400)
  })
})
