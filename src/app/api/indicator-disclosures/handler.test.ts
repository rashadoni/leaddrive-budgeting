// @vitest-environment node
/**
 * Handler test for `/api/indicator-disclosures` (GET + POST).
 *
 * Phase 7.H F4.v2.3 — manual ESG-disclosure entry. Locks any-member
 * GET + sub-group RBAC + manager+ POST + Zod validation + historical
 * anomaly detection + recompute-trigger fire-and-forget.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const {
  prismaMock,
  logAuditEventMock,
  runRecomputeForCompaniesMock,
  getCompanyScopeMock,
  validateValueMock,
  getEsgDisclosureRuleMock,
} = vi.hoisted(() => ({
  prismaMock: {
    indicatorDisclosure: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    company: { findFirst: vi.fn() },
  },
  logAuditEventMock: vi.fn(),
  runRecomputeForCompaniesMock: vi.fn(),
  getCompanyScopeMock: vi.fn(),
  validateValueMock: vi.fn(),
  getEsgDisclosureRuleMock: vi.fn(),
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
}))
vi.mock("@/lib/risk/recompute-trigger", () => ({
  runRecomputeForCompanies: runRecomputeForCompaniesMock,
}))
vi.mock("@/lib/rbac/company-scope", () => ({
  getCompanyScope: getCompanyScopeMock,
}))
vi.mock("@/lib/risk/metric-validation-rules", () => ({
  ESG_DISCLOSABLE_INDICATOR_CODES: ["IND_CARBON_SCOPE_1", "IND_ESG_COMPOSITE"],
  getEsgDisclosureRule: getEsgDisclosureRuleMock,
  validateValue: validateValueMock,
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET, POST } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  prismaMock.indicatorDisclosure.findMany.mockReset().mockResolvedValue([])
  prismaMock.indicatorDisclosure.findUnique.mockReset().mockResolvedValue(null)
  prismaMock.indicatorDisclosure.create.mockReset().mockResolvedValue({
    id: "d1", companyId: "c1", indicatorCode: "IND_CARBON_SCOPE_1",
    period: "2026", value: 100, unit: "t", sourceNote: null, enteredBy: "u1",
    enteredAt: new Date(), updatedAt: new Date(),
  })
  prismaMock.indicatorDisclosure.update.mockReset().mockResolvedValue({
    id: "d1", companyId: "c1", indicatorCode: "IND_CARBON_SCOPE_1",
    period: "2026", value: 100, unit: "t", sourceNote: null, enteredBy: "u1",
    enteredAt: new Date(), updatedAt: new Date(),
  })
  prismaMock.company.findFirst.mockReset().mockResolvedValue(null)
  logAuditEventMock.mockReset().mockResolvedValue({ ok: true })
  runRecomputeForCompaniesMock.mockReset().mockResolvedValue(undefined)
  getCompanyScopeMock.mockReset().mockResolvedValue({ ids: null })
  validateValueMock.mockReset().mockReturnValue({ ok: true, warnings: [], anomalyWarning: null })
  getEsgDisclosureRuleMock.mockReset().mockReturnValue({ metric: "carbon", unit: "t", min: 0, max: 1e9 })
})

describe("GET /api/indicator-disclosures", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(makeRequest("/api/indicator-disclosures"))
    expect(res.status).toBe(401)
  })

  it("400 invalid period query (wrong shape)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await GET(makeRequest("/api/indicator-disclosures?period=garbage"))
    expect(res.status).toBe(400)
  })

  it("200 returns rows + applies sub-group RBAC", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    getCompanyScopeMock.mockResolvedValue({ ids: new Set(["c1", "c2"]) })
    await GET(makeRequest("/api/indicator-disclosures"))
    expect(prismaMock.indicatorDisclosure.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: ORG_ID,
          companyId: { in: ["c1", "c2"] },
        }),
      }),
    )
  })
})

describe("POST /api/indicator-disclosures", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await POST(
      makeRequest("/api/indicator-disclosures", {
        method: "POST",
        json: {
          companyId: "c1", indicatorCode: "IND_CARBON_SCOPE_1", period: "2026",
          value: 100, unit: "t",
        },
      }),
    )
    expect(res.status).toBe(401)
  })

  it("403 viewer can't create disclosures", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await POST(
      makeRequest("/api/indicator-disclosures", {
        method: "POST",
        json: {
          companyId: "c1", indicatorCode: "IND_CARBON_SCOPE_1", period: "2026",
          value: 100, unit: "t",
        },
      }),
    )
    expect(res.status).toBe(403)
  })

  it("400 invalid indicatorCode (not in allowlist)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await POST(
      makeRequest("/api/indicator-disclosures", {
        method: "POST",
        json: {
          companyId: "c1", indicatorCode: "IND_DSO", period: "2026",
          value: 100, unit: "t",
        },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("404 cross-tenant companyId", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.company.findFirst.mockResolvedValue(null)
    const res = await POST(
      makeRequest("/api/indicator-disclosures", {
        method: "POST",
        json: {
          companyId: "c_evil", indicatorCode: "IND_CARBON_SCOPE_1",
          period: "2026", value: 100, unit: "t",
        },
      }),
    )
    expect(res.status).toBe(404)
  })

  it("requiresConfirm when warnings exist without forceConfirm", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.company.findFirst.mockResolvedValue({ id: "c1" })
    validateValueMock.mockReturnValue({
      ok: true,
      warnings: [{ code: "OUT_OF_BAND" }],
      anomalyWarning: null,
    })
    const res = await POST(
      makeRequest("/api/indicator-disclosures", {
        method: "POST",
        json: {
          companyId: "c1", indicatorCode: "IND_CARBON_SCOPE_1", period: "2026",
          value: 100, unit: "t",
        },
      }),
    )
    const body = await res.json()
    expect(body.requiresConfirm).toBe(true)
    expect(prismaMock.indicatorDisclosure.create).not.toHaveBeenCalled()
  })

  it("201 happy path — create new + triggers recompute", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.company.findFirst.mockResolvedValue({ id: "c1" })
    prismaMock.indicatorDisclosure.findUnique.mockResolvedValue(null)
    const res = await POST(
      makeRequest("/api/indicator-disclosures", {
        method: "POST",
        json: {
          companyId: "c1", indicatorCode: "IND_CARBON_SCOPE_1", period: "2026",
          value: 100, unit: "t",
        },
      }),
    )
    expect(res.status).toBe(201)
    expect(prismaMock.indicatorDisclosure.create).toHaveBeenCalled()
    // Recompute is fire-and-forget — give the void promise a microtask tick
    await new Promise((r) => setImmediate(r))
    expect(runRecomputeForCompaniesMock).toHaveBeenCalledWith(
      prismaMock, ORG_ID,
      [{ companyId: "c1", year: 2026 }], expect.any(Object),
      { codeFilter: ["IND_CARBON_SCOPE_1"] },
    )
  })

  it("200 happy path — update existing row", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.company.findFirst.mockResolvedValue({ id: "c1" })
    prismaMock.indicatorDisclosure.findUnique.mockResolvedValue({ id: "d_existing", value: 50 })
    const res = await POST(
      makeRequest("/api/indicator-disclosures", {
        method: "POST",
        json: {
          companyId: "c1", indicatorCode: "IND_CARBON_SCOPE_1", period: "2026",
          value: 100, unit: "t",
        },
      }),
    )
    expect(res.status).toBe(200)
    expect(prismaMock.indicatorDisclosure.update).toHaveBeenCalled()
  })
})
