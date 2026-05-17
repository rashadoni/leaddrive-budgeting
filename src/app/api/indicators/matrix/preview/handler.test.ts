// @vitest-environment node
/**
 * Handler test for `/api/indicators/matrix/preview` (POST).
 *
 * Phase 7.E ad-hoc scenario preview — recomputes affected indicators
 * under user-supplied overrides WITHOUT writing to DB. Locks editor
 * auth gate, rate-limit, period parsing, empty-overrides 400,
 * affected-indicator filtering, and per-pair error tolerance.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const {
  prismaMock,
  enforceRateLimitMock,
  getCompanyScopeMock,
  filterOperationalCompaniesMock,
  recomputeIndicatorMock,
  createPrismaDataSourceMock,
} = vi.hoisted(() => ({
  prismaMock: {
    company: { findMany: vi.fn() },
    indicatorDefinition: { findMany: vi.fn() },
    indicatorValue: { findMany: vi.fn() },
  },
  enforceRateLimitMock: vi.fn(),
  getCompanyScopeMock: vi.fn(),
  filterOperationalCompaniesMock: vi.fn(),
  recomputeIndicatorMock: vi.fn(),
  createPrismaDataSourceMock: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: enforceRateLimitMock,
  getClientIp: vi.fn(() => "127.0.0.1"),
}))
vi.mock("@/lib/rbac/company-scope", () => ({
  getCompanyScope: getCompanyScopeMock,
}))
vi.mock("@/lib/risk/targets", () => ({
  filterOperationalCompanies: filterOperationalCompaniesMock,
}))
vi.mock("@/lib/risk/recompute", () => ({
  recomputeIndicator: recomputeIndicatorMock,
  createPrismaDataSource: createPrismaDataSourceMock,
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { POST } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  prismaMock.company.findMany.mockReset().mockResolvedValue([])
  prismaMock.indicatorDefinition.findMany.mockReset().mockResolvedValue([])
  prismaMock.indicatorValue.findMany.mockReset().mockResolvedValue([])
  enforceRateLimitMock.mockReset().mockReturnValue(null)
  getCompanyScopeMock.mockReset().mockResolvedValue({ ids: null })
  filterOperationalCompaniesMock.mockReset().mockImplementation((arr: unknown[]) => arr)
  recomputeIndicatorMock.mockReset().mockResolvedValue({ value: 100, status: "green" })
  createPrismaDataSourceMock.mockReset().mockReturnValue({})
})

describe("POST /api/indicators/matrix/preview", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await POST(
      makeRequest("/api/indicators/matrix/preview", {
        method: "POST",
        json: { period: "2026-Q1", overrides: { fx_usd: 1.8 } },
      }),
    )
    expect(res.status).toBe(401)
  })

  it("403 viewer can't preview", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await POST(
      makeRequest("/api/indicators/matrix/preview", {
        method: "POST",
        json: { period: "2026-Q1", overrides: { fx_usd: 1.8 } },
      }),
    )
    expect(res.status).toBe(403)
  })

  it("429 rate-limited", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    enforceRateLimitMock.mockReturnValue(new Response("rate", { status: 429 }))
    const res = await POST(
      makeRequest("/api/indicators/matrix/preview", {
        method: "POST",
        json: { period: "2026-Q1", overrides: { fx_usd: 1.8 } },
      }),
    )
    expect(res.status).toBe(429)
  })

  it("400 missing period", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/indicators/matrix/preview", {
        method: "POST",
        json: { overrides: { fx_usd: 1.8 } },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("400 invalid period", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/indicators/matrix/preview", {
        method: "POST",
        json: { period: "garbage", overrides: { fx_usd: 1.8 } },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("400 empty overrides", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/indicators/matrix/preview", {
        method: "POST",
        json: { period: "2026-Q1", overrides: {} },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("200 empty cells when no indicators are affected by overrides", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    prismaMock.company.findMany.mockResolvedValue([{ id: "c1", code: "AAC" }])
    // Indicator does NOT depend on currencyRate or fx_usd, so should be unaffected
    prismaMock.indicatorDefinition.findMany.mockResolvedValue([
      { id: "i1", code: "IND_DSO", unit: "days", formula: {}, thresholds: {}, requiredInputs: ["receivables"] },
    ])
    const res = await POST(
      makeRequest("/api/indicators/matrix/preview", {
        method: "POST",
        json: { period: "2026-Q1", overrides: { fx_usd: 1.8 } },
      }),
    )
    const body = await res.json()
    expect(body.affectedIndicatorCount).toBe(0)
    expect(body.cells).toEqual([])
    expect(recomputeIndicatorMock).not.toHaveBeenCalled()
  })

  it("200 happy path — affected by fx_ override (depends on currencyRate)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    prismaMock.company.findMany.mockResolvedValue([
      { id: "c1", code: "AAC", industry: "tech", level: 2, isActive: true, role: "operational", parentCompanyId: "p1" },
    ])
    prismaMock.indicatorDefinition.findMany.mockResolvedValue([
      { id: "i1", code: "IND_USD_EXPOSURE", unit: "%", formula: {}, thresholds: {}, requiredInputs: ["currencyRate"] },
    ])
    prismaMock.indicatorValue.findMany.mockResolvedValue([
      { companyId: "c1", indicatorId: "i1", value: 80, status: "green" },
    ])
    recomputeIndicatorMock.mockResolvedValue({ value: 100, status: "amber" })

    const res = await POST(
      makeRequest("/api/indicators/matrix/preview", {
        method: "POST",
        json: { period: "2026-Q1", overrides: { fx_usd: 1.8 } },
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.affectedIndicatorCount).toBe(1)
    expect(body.cells).toHaveLength(1)
    expect(body.cells[0]).toMatchObject({
      baselineValue: 80,
      scenarioValue: 100,
      scenarioStatus: "amber",
    })
    expect(body.cells[0].deltaPct).toBeCloseTo(25, 4)
  })

  it("per-pair error caught + counted (doesn't abort full preview)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    prismaMock.company.findMany.mockResolvedValue([
      { id: "c1", code: "AAC", industry: "tech", level: 2, isActive: true, role: "operational", parentCompanyId: "p1" },
    ])
    prismaMock.indicatorDefinition.findMany.mockResolvedValue([
      { id: "i1", code: "IND_X", unit: "%", formula: {}, thresholds: {}, requiredInputs: ["currencyRate"] },
    ])
    recomputeIndicatorMock.mockRejectedValue(new Error("boom"))

    const res = await POST(
      makeRequest("/api/indicators/matrix/preview", {
        method: "POST",
        json: { period: "2026-Q1", overrides: { fx_usd: 1.8 } },
      }),
    )
    const body = await res.json()
    expect(body.pairsErrored).toBe(1)
    expect(body.lastError).toBe("boom")
    expect(body.cells).toEqual([])
  })
})
