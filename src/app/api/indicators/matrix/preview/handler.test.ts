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
  recomputeIndicatorMock,
  createPrismaDataSourceMock,
} = vi.hoisted(() => ({
  prismaMock: {
    company: { findMany: vi.fn() },
    indicatorDefinition: { findMany: vi.fn() },
    indicatorValue: { findMany: vi.fn() },
    companyIndicator: { findMany: vi.fn() },
  },
  enforceRateLimitMock: vi.fn(),
  getCompanyScopeMock: vi.fn(),
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
vi.mock("@/lib/risk/recompute", () => ({
  recomputeIndicator: recomputeIndicatorMock,
  createPrismaDataSource: createPrismaDataSourceMock,
  ROLLUP_INPUT_PREFIX: "rollup:",
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { POST } from "./route"

const ORG_ID = "org_demo"

interface CompanyRow {
  id: string
  code: string
  name: string
  industry: string | null
  level: number
  isActive: boolean
  role: "operational" | "admin" | "holding"
  parentCompanyId: string | null
  status: string
}

interface IndicatorRow {
  id: string
  organizationId: string | null
  code: string
  nameEn: string | null
  nameRu: string | null
  unit: string
  formula: Record<string, unknown>
  thresholds: Record<string, unknown>
  requiredInputs: string[]
  industries: string[]
  isActive: boolean
  category: string | null
  aggregation: "snapshot" | "flow"
}

function company(overrides: Partial<CompanyRow> = {}): CompanyRow {
  return {
    id: "c1",
    code: "AAC",
    name: "AAC",
    industry: "tech",
    level: 2,
    isActive: true,
    role: "operational",
    parentCompanyId: "p1",
    status: "active",
    ...overrides,
  }
}

function indicator(overrides: Partial<IndicatorRow> = {}): IndicatorRow {
  return {
    id: "i1",
    organizationId: null,
    code: "IND_USD_EXPOSURE",
    nameEn: "USD exposure",
    nameRu: "USD exposure",
    unit: "%",
    formula: {},
    thresholds: {},
    requiredInputs: ["currencyRate"],
    industries: [],
    isActive: true,
    category: "operational",
    aggregation: "snapshot",
    ...overrides,
  }
}

beforeEach(() => {
  prismaMock.company.findMany.mockReset().mockResolvedValue([])
  prismaMock.indicatorDefinition.findMany.mockReset().mockResolvedValue([])
  prismaMock.indicatorValue.findMany.mockReset().mockResolvedValue([])
  prismaMock.companyIndicator.findMany.mockReset().mockResolvedValue([])
  enforceRateLimitMock.mockReset().mockReturnValue(null)
  getCompanyScopeMock.mockReset().mockResolvedValue({ ids: null })
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
    prismaMock.company.findMany.mockResolvedValue([company()])
    // Indicator does NOT depend on currencyRate or fx_usd, so should be unaffected
    prismaMock.indicatorDefinition.findMany.mockResolvedValue([
      indicator({ code: "IND_DSO", unit: "days", requiredInputs: ["receivables"] }),
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
    prismaMock.company.findMany.mockResolvedValue([company()])
    prismaMock.indicatorDefinition.findMany.mockResolvedValue([indicator()])
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
    expect(prismaMock.indicatorDefinition.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          isActive: true,
          OR: [{ organizationId: null }, { organizationId: ORG_ID }],
        },
      }),
    )
    expect(prismaMock.indicatorValue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: ORG_ID }),
      }),
    )
    expect(createPrismaDataSourceMock).toHaveBeenCalledWith(
      expect.anything(),
      { mode: "preview" },
    )
  })

  it("excludes a rollup-bearing definition from the operational preview even when it is public", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    prismaMock.company.findMany.mockResolvedValue([company()])
    prismaMock.indicatorDefinition.findMany.mockResolvedValue([
      indicator({
        id: "i-rollup",
        code: "PUBLIC_HOLDING_ROLLUP",
        category: "operational",
        requiredInputs: ["currencyRate", "rollup:IND_REVENUE_TOTAL"],
      }),
    ])

    const res = await POST(
      makeRequest("/api/indicators/matrix/preview", {
        method: "POST",
        json: { period: "2026", overrides: { fx_usd: 1.8 } },
      }),
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      affectedIndicatorCount: 0,
      pairsAttempted: 0,
      cells: [],
    })
    expect(recomputeIndicatorMock).not.toHaveBeenCalled()
  })

  it("filters mixed-sector pairs and reports only indicators applicable somewhere", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    prismaMock.company.findMany.mockResolvedValue([
      company({ id: "agro", code: "AGRO", industry: "agro_crops" }),
      company({ id: "food", code: "FOOD", industry: "food_processing" }),
    ])
    prismaMock.indicatorDefinition.findMany.mockResolvedValue([
      indicator({ id: "i-agro", code: "AGRO_ONLY", industries: ["agro_crops"] }),
      indicator({ id: "i-food", code: "FOOD_ONLY", industries: ["food_processing"] }),
      indicator({ id: "i-all", code: "UNIVERSAL", industries: [] }),
      indicator({ id: "i-pharma", code: "PHARMA_ONLY", industries: ["pharma"] }),
    ])

    const res = await POST(
      makeRequest("/api/indicators/matrix/preview", {
        method: "POST",
        json: { period: "2026-Q1", overrides: { fx_usd: 1.8 } },
      }),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.pairsAttempted).toBe(4)
    expect(body.affectedIndicatorCount).toBe(3)
    expect(body.cells).toHaveLength(4)
    expect(
      body.cells.map((cell: { companyCode: string; indicatorCode: string }) =>
        `${cell.companyCode}:${cell.indicatorCode}`,
      ),
    ).toEqual([
      "AGRO:AGRO_ONLY",
      "AGRO:UNIVERSAL",
      "FOOD:FOOD_ONLY",
      "FOOD:UNIVERSAL",
    ])
    expect(recomputeIndicatorMock).toHaveBeenCalledTimes(4)
  })

  it("keeps an org override and drops the global duplicate by indicator code", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    prismaMock.company.findMany.mockResolvedValue([company()])
    prismaMock.indicatorDefinition.findMany.mockResolvedValue([
      indicator({ id: "global", code: "DUP", organizationId: null }),
      indicator({ id: "org", code: "DUP", organizationId: ORG_ID }),
    ])

    const res = await POST(
      makeRequest("/api/indicators/matrix/preview", {
        method: "POST",
        json: { period: "2026-Q1", overrides: { fx_usd: 1.8 } },
      }),
    )

    expect(res.status).toBe(200)
    expect(recomputeIndicatorMock).toHaveBeenCalledTimes(1)
    expect(recomputeIndicatorMock).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        definition: expect.objectContaining({ id: "org", code: "DUP" }),
      }),
    )
  })

  it("does not let a coloured baseline rescue a cross-industry mismatch", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    prismaMock.company.findMany.mockResolvedValue([
      company({ industry: "agro_crops" }),
    ])
    prismaMock.indicatorDefinition.findMany.mockResolvedValue([
      indicator({ industries: ["hospitality"] }),
    ])
    prismaMock.indicatorValue.findMany.mockResolvedValue([
      { companyId: "c1", indicatorId: "i1", value: 80, status: "green" },
    ])

    const res = await POST(
      makeRequest("/api/indicators/matrix/preview", {
        method: "POST",
        json: { period: "2026-Q1", overrides: { fx_usd: 1.8 } },
      }),
    )
    const body = await res.json()
    expect(body.pairsAttempted).toBe(0)
    expect(body.affectedIndicatorCount).toBe(0)
    expect(recomputeIndicatorMock).not.toHaveBeenCalled()
  })

  it("uses explicit CompanyIndicator overrides in both directions", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    prismaMock.company.findMany.mockResolvedValue([
      company({ id: "agro", code: "AGRO", industry: "agro_crops" }),
    ])
    prismaMock.indicatorDefinition.findMany.mockResolvedValue([
      indicator({ id: "retail", code: "RET_ONLY", industries: ["retail"] }),
      indicator({ id: "agro-ind", code: "AGRO_ONLY", industries: ["agro_crops"] }),
    ])
    prismaMock.companyIndicator.findMany.mockResolvedValue([
      { companyId: "agro", indicatorId: "retail", enabled: true },
      { companyId: "agro", indicatorId: "agro-ind", enabled: false },
    ])

    const res = await POST(
      makeRequest("/api/indicators/matrix/preview", {
        method: "POST",
        json: { period: "2026-Q1", overrides: { fx_usd: 1.8 } },
      }),
    )
    const body = await res.json()

    expect(body.pairsAttempted).toBe(1)
    expect(body.affectedIndicatorCount).toBe(1)
    expect(body.cells).toHaveLength(1)
    expect(body.cells[0]).toMatchObject({
      companyId: "agro",
      indicatorId: "retail",
      indicatorCode: "RET_ONLY",
    })
    expect(recomputeIndicatorMock).toHaveBeenCalledTimes(1)
  })

  it("does not preview hidden internal definitions on the operational leaf surface", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    prismaMock.company.findMany.mockResolvedValue([company()])
    prismaMock.indicatorDefinition.findMany.mockResolvedValue([
      indicator({
        id: "internal",
        code: "INTERNAL_HELPER",
        category: "internal",
        requiredInputs: ["currencyRate"],
      }),
    ])

    const res = await POST(
      makeRequest("/api/indicators/matrix/preview", {
        method: "POST",
        json: { period: "2026-Q1", overrides: { fx_usd: 1.8 } },
      }),
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({
      affectedIndicatorCount: 0,
      pairsAttempted: 0,
      cells: [],
    })
    expect(recomputeIndicatorMock).not.toHaveBeenCalled()
  })

  it("does not preview onboarding-pending companies", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    prismaMock.company.findMany.mockResolvedValue([
      company({ id: "pending", status: "pending" }),
    ])
    prismaMock.indicatorDefinition.findMany.mockResolvedValue([indicator()])

    const res = await POST(
      makeRequest("/api/indicators/matrix/preview", {
        method: "POST",
        json: { period: "2026-Q1", overrides: { fx_usd: 1.8 } },
      }),
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({
      affectedIndicatorCount: 0,
      pairsAttempted: 0,
      cells: [],
    })
    expect(prismaMock.indicatorValue.findMany).not.toHaveBeenCalled()
    expect(recomputeIndicatorMock).not.toHaveBeenCalled()
  })

  it("per-pair error caught + counted (doesn't abort full preview)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    prismaMock.company.findMany.mockResolvedValue([company()])
    prismaMock.indicatorDefinition.findMany.mockResolvedValue([
      indicator({ code: "IND_X" }),
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
