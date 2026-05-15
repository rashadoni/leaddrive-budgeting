// @vitest-environment node
/**
 * Phase 7.H Feature 5 — handler tests for /api/companies/[id]/reconciliation.
 *
 * Covers the auth + RBAC + tenant-scope contract; deep validator behaviour
 * is in `validate.test.ts`. Mirrors the snapshot-actuals/handler.test.ts
 * pattern (`prismaMock` via `vi.hoisted`, `@/lib/auth` stub for session).
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    company: { findFirst: vi.fn() },
    user: { findFirst: vi.fn() },
    clientReconciliation: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    auditEvent: { create: vi.fn() },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET, POST, DELETE } from "./route"

const ORG_ID = "org_demo"
const COMPANY_ID = "c_azseker_azsf"

function buildParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  for (const fn of [
    prismaMock.company.findFirst,
    prismaMock.user.findFirst,
    prismaMock.clientReconciliation.findUnique,
    prismaMock.clientReconciliation.findFirst,
    prismaMock.clientReconciliation.findMany,
    prismaMock.clientReconciliation.create,
    prismaMock.clientReconciliation.update,
    prismaMock.clientReconciliation.delete,
    prismaMock.auditEvent.create,
  ]) {
    fn.mockReset()
  }
  // Default tenant-scoped company exists.
  prismaMock.company.findFirst.mockResolvedValue({ id: COMPANY_ID })
  // Default: admin (no sub-group restriction via user lookup).
  prismaMock.user.findFirst.mockResolvedValue({ allowedSubGroupIds: [] })
  // Audit insert success by default.
  prismaMock.auditEvent.create.mockResolvedValue({ id: "audit_1" })
})

describe("POST /api/companies/[id]/reconciliation", () => {
  it("creates a new reconciliation row for a manager and returns 201", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_mgr", role: "manager" })
    prismaMock.clientReconciliation.findUnique.mockResolvedValue(null)
    prismaMock.clientReconciliation.create.mockResolvedValue({
      id: "recon_1",
      companyId: COMPANY_ID,
      period: "2026-Q2",
      indicatorKey: "EBITDA",
      value: 850000,
      currency: "AZN",
      note: null,
      submittedById: "u_mgr",
      submittedAt: new Date(),
      updatedAt: new Date(),
    })

    const res = await POST(
      makeRequest(`/api/companies/${COMPANY_ID}/reconciliation`, {
        method: "POST",
        json: { period: "2026-Q2", indicatorKey: "EBITDA", value: 850000 },
      }),
      buildParams(COMPANY_ID),
    )
    expect(res.status).toBe(201)
    expect(prismaMock.clientReconciliation.create).toHaveBeenCalledTimes(1)
    expect(prismaMock.clientReconciliation.update).not.toHaveBeenCalled()
    // Audit call fired.
    expect(prismaMock.auditEvent.create).toHaveBeenCalledTimes(1)
    const auditArgs = prismaMock.auditEvent.create.mock.calls[0][0]
    expect(auditArgs.data.action).toBe("client_reconciliation_submit")
  })

  it("updates an existing row (upsert path) and returns 200 with previousValue in audit", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_mgr", role: "manager" })
    prismaMock.clientReconciliation.findUnique.mockResolvedValue({
      id: "recon_1",
      value: 800000,
    })
    prismaMock.clientReconciliation.update.mockResolvedValue({
      id: "recon_1",
      companyId: COMPANY_ID,
      period: "2026-Q2",
      indicatorKey: "EBITDA",
      value: 850000,
      currency: "AZN",
      note: "Updated after call",
      submittedById: "u_mgr",
      submittedAt: new Date(),
      updatedAt: new Date(),
    })

    const res = await POST(
      makeRequest(`/api/companies/${COMPANY_ID}/reconciliation`, {
        method: "POST",
        json: {
          period: "2026-Q2",
          indicatorKey: "EBITDA",
          value: 850000,
          note: "Updated after call",
        },
      }),
      buildParams(COMPANY_ID),
    )
    expect(res.status).toBe(200)
    expect(prismaMock.clientReconciliation.update).toHaveBeenCalledTimes(1)
    expect(prismaMock.clientReconciliation.create).not.toHaveBeenCalled()
    const auditArgs = prismaMock.auditEvent.create.mock.calls[0][0]
    expect(auditArgs.data.metadata).toMatchObject({ previousValue: 800000 })
  })

  it("rejects viewer role with 403", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_view", role: "viewer" })
    const res = await POST(
      makeRequest(`/api/companies/${COMPANY_ID}/reconciliation`, {
        method: "POST",
        json: { period: "2026", indicatorKey: "EBITDA", value: 1000 },
      }),
      buildParams(COMPANY_ID),
    )
    expect(res.status).toBe(403)
    expect(prismaMock.clientReconciliation.create).not.toHaveBeenCalled()
  })

  it("returns 404 for a company in a different tenant (no info leak)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_mgr", role: "manager" })
    prismaMock.company.findFirst.mockResolvedValue(null)
    const res = await POST(
      makeRequest(`/api/companies/${COMPANY_ID}/reconciliation`, {
        method: "POST",
        json: { period: "2026", indicatorKey: "EBITDA", value: 1000 },
      }),
      buildParams(COMPANY_ID),
    )
    expect(res.status).toBe(404)
  })

  it("returns 403 when sub-group RBAC excludes the company", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_mgr", role: "manager" })
    // user has restricted sub-groups; getCompanyScope resolves via user.findFirst
    prismaMock.user.findFirst.mockResolvedValue({
      allowedSubGroupIds: ["c_tabia"],
    })
    // No need to mock company.findMany — getCompanyScope reads it; the
    // empty result makes the scoped Set NOT include COMPANY_ID.
    ;(prismaMock as any).company.findMany = vi.fn().mockResolvedValue([])

    const res = await POST(
      makeRequest(`/api/companies/${COMPANY_ID}/reconciliation`, {
        method: "POST",
        json: { period: "2026", indicatorKey: "EBITDA", value: 1000 },
      }),
      buildParams(COMPANY_ID),
    )
    expect(res.status).toBe(403)
    expect(prismaMock.clientReconciliation.create).not.toHaveBeenCalled()
  })

  it("returns 400 for invalid period format", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_mgr", role: "manager" })
    const res = await POST(
      makeRequest(`/api/companies/${COMPANY_ID}/reconciliation`, {
        method: "POST",
        json: { period: "2026-13", indicatorKey: "EBITDA", value: 1000 },
      }),
      buildParams(COMPANY_ID),
    )
    expect(res.status).toBe(400)
    expect(prismaMock.clientReconciliation.create).not.toHaveBeenCalled()
  })
})

describe("GET /api/companies/[id]/reconciliation", () => {
  it("returns rows for an authenticated viewer (any-member read)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_v", role: "viewer" })
    prismaMock.clientReconciliation.findMany.mockResolvedValue([
      {
        id: "r1",
        companyId: COMPANY_ID,
        period: "2026-Q2",
        indicatorKey: "EBITDA",
        value: 850000,
        currency: "AZN",
        note: null,
        submittedById: "u_mgr",
        submittedAt: new Date(),
        updatedAt: new Date(),
      },
    ])
    const res = await GET(
      makeRequest(`/api/companies/${COMPANY_ID}/reconciliation`),
      buildParams(COMPANY_ID),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rows).toHaveLength(1)
  })
})

describe("DELETE /api/companies/[id]/reconciliation", () => {
  it("deletes an existing row and emits audit event", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_mgr", role: "manager" })
    prismaMock.clientReconciliation.findFirst.mockResolvedValue({
      id: "r_old",
      period: "2026-Q1",
      indicatorKey: "EBITDA",
      value: 720000,
      currency: "AZN",
    })
    prismaMock.clientReconciliation.delete.mockResolvedValue({})

    const res = await DELETE(
      makeRequest(`/api/companies/${COMPANY_ID}/reconciliation?reconciliationId=r_old`, {
        method: "DELETE",
      }),
      buildParams(COMPANY_ID),
    )
    expect(res.status).toBe(200)
    expect(prismaMock.clientReconciliation.delete).toHaveBeenCalledTimes(1)
    const auditArgs = prismaMock.auditEvent.create.mock.calls[0][0]
    expect(auditArgs.data.action).toBe("client_reconciliation_delete")
    expect(auditArgs.data.metadata).toMatchObject({ deletedValue: 720000 })
  })

  it("returns 404 when reconciliationId doesn't exist", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_mgr", role: "manager" })
    prismaMock.clientReconciliation.findFirst.mockResolvedValue(null)
    const res = await DELETE(
      makeRequest(`/api/companies/${COMPANY_ID}/reconciliation?reconciliationId=missing`, {
        method: "DELETE",
      }),
      buildParams(COMPANY_ID),
    )
    expect(res.status).toBe(404)
    expect(prismaMock.clientReconciliation.delete).not.toHaveBeenCalled()
  })

  it("returns 400 when reconciliationId query param missing", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_mgr", role: "manager" })
    const res = await DELETE(
      makeRequest(`/api/companies/${COMPANY_ID}/reconciliation`, { method: "DELETE" }),
      buildParams(COMPANY_ID),
    )
    expect(res.status).toBe(400)
  })
})
