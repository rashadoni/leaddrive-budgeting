// @vitest-environment node
/**
 * Handler test for `/api/indicators/values/[id]` (GET).
 *
 * Phase 7.D IndicatorValue drill-down. Locks org-scope findFirst,
 * sub-group RBAC 404, materiality enrichment, and provenance fields.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock, getCompanyScopeMock, getMaterialityMock, isMaterialityScopedMock } = vi.hoisted(() => ({
  prismaMock: {
    indicatorValue: { findFirst: vi.fn() },
    // Phase 5.2 Stage 2 — withOrgScope wraps handler in $transaction.
    $transaction: vi.fn(
      async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock),
    ),
    $executeRawUnsafe: vi.fn(async () => 1),
  },
  getCompanyScopeMock: vi.fn(),
  getMaterialityMock: vi.fn(),
  isMaterialityScopedMock: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/rbac/company-scope", () => ({
  getCompanyScope: getCompanyScopeMock,
}))
vi.mock("@/lib/risk/esg-materiality", () => ({
  getMateriality: getMaterialityMock,
  getMaterialityNote: vi.fn(() => null),
  getMaterialityNoteI18n: vi.fn(() => null),
  isMaterialityScoped: isMaterialityScopedMock,
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET } from "./route"

const ORG_ID = "cm3rlswraporg00000001demo"

beforeEach(() => {
  prismaMock.indicatorValue.findFirst.mockReset().mockResolvedValue(null)
  getCompanyScopeMock.mockReset().mockResolvedValue({ ids: null })
  getMaterialityMock.mockReset().mockReturnValue(null)
  isMaterialityScopedMock.mockReset().mockReturnValue(false)
})

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) })

describe("GET /api/indicators/values/[id]", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(makeRequest("/api/indicators/values/iv1"), makeParams("iv1"))
    expect(res.status).toBe(401)
  })

  it("400 invalid id (empty)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await GET(makeRequest("/api/indicators/values/"), makeParams("   "))
    expect(res.status).toBe(400)
  })

  it("404 cross-tenant indicator value", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.indicatorValue.findFirst.mockResolvedValue(null)
    const res = await GET(makeRequest("/api/indicators/values/iv1"), makeParams("iv1"))
    expect(res.status).toBe(404)
  })

  it("404 when companyId outside sub-group RBAC scope", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.indicatorValue.findFirst.mockResolvedValue({
      id: "iv1",
      value: 1.5,
      status: "green",
      period: "2026-Q1",
      computedAt: new Date(),
      inputs: {},
      sparkline: [],
      companyId: "c_restricted",
      valueSource: "calc",
      confidence: null,
      sourceDocument: null,
      lastReconciledAt: null,
      reconciledBy: null,
      sanityBand: null,
      indicator: { code: "IND_DSO", nameEn: "DSO" },
      company: { id: "c_restricted", code: "X", industry: "agro_crops" },
    })
    getCompanyScopeMock.mockResolvedValue({ ids: new Set(["c_allowed"]) })
    const res = await GET(makeRequest("/api/indicators/values/iv1"), makeParams("iv1"))
    expect(res.status).toBe(404)
  })

  it("200 happy path with materiality enrichment (ESG indicator)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.indicatorValue.findFirst.mockResolvedValue({
      id: "iv1",
      value: 30,
      status: "amber",
      period: "2026-Q1",
      computedAt: new Date("2026-01-15T12:00:00Z"),
      inputs: { x: 1 },
      sparkline: [10, 20, 30],
      companyId: "c1",
      valueSource: "calc",
      confidence: 0.8,
      sourceDocument: { name: "ar.xlsx", sheet: "P&L" },
      lastReconciledAt: new Date("2026-01-15T12:00:00Z"),
      reconciledBy: "u_admin",
      sanityBand: "ok",
      indicator: { code: "ESG_GHG_INTENSITY", nameEn: "GHG" },
      company: { id: "c1", code: "AZSEKER-EDEN", industry: "agro_crops" },
    })
    isMaterialityScopedMock.mockReturnValue(true)
    getMaterialityMock.mockReturnValue("material")

    const res = await GET(makeRequest("/api/indicators/values/iv1"), makeParams("iv1"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.materiality).toBe("material")
    expect(body.valueSource).toBe("calc")
    expect(body.confidence).toBe(0.8)
    expect(body.sourceDocument).toMatchObject({ name: "ar.xlsx" })
  })

  it("materiality is null for non-ESG indicators", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.indicatorValue.findFirst.mockResolvedValue({
      id: "iv1",
      value: 30,
      status: "green",
      period: "2026-Q1",
      computedAt: new Date(),
      inputs: {},
      sparkline: [],
      companyId: "c1",
      valueSource: "calc",
      confidence: null,
      sourceDocument: null,
      lastReconciledAt: null,
      reconciledBy: null,
      sanityBand: null,
      indicator: { code: "IND_DSO", nameEn: "DSO" },
      company: { id: "c1", code: "X", industry: "agro_crops" },
    })
    isMaterialityScopedMock.mockReturnValue(false)
    const res = await GET(makeRequest("/api/indicators/values/iv1"), makeParams("iv1"))
    const body = await res.json()
    expect(body.materiality).toBeNull()
  })
})
