// @vitest-environment node
/**
 * Handler test for `/api/indicators` (GET + POST).
 *
 * Phase 7.A.0 indicator definitions API + recompute trigger. Locks
 * GET = any-auth org-scoped + global, POST = manager+ sync vs async
 * threshold dispatch (50-pair boundary), org-specific override
 * preference, and error-tolerant outcome aggregation.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const {
  prismaMock,
  recomputeIndicatorMock,
  createPrismaDataSourceMock,
  filterOperationalCompaniesMock,
  enqueueRecomputeJobMock,
} = vi.hoisted(() => ({
  prismaMock: {
    indicatorDefinition: { findMany: vi.fn() },
    company: { findMany: vi.fn() },
    companyIndicator: { findMany: vi.fn() },
    // Phase 5.2 Stage 2 (2026-05-21) — withOrgScope wraps GET handler.
    $transaction: vi.fn(
      async (
        fn: (tx: typeof prismaMock) => Promise<unknown>,
      ): Promise<unknown> => fn(prismaMock),
    ),
    $executeRawUnsafe: vi.fn(async () => 1),
  },
  recomputeIndicatorMock: vi.fn(),
  createPrismaDataSourceMock: vi.fn(),
  filterOperationalCompaniesMock: vi.fn(),
  enqueueRecomputeJobMock: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/risk/recompute", () => ({
  createPrismaDataSource: createPrismaDataSourceMock,
  recomputeIndicator: recomputeIndicatorMock,
  ROLLUP_INPUT_PREFIX: "rollup:",
}))
vi.mock("@/lib/risk/targets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/risk/targets")>()),
  filterOperationalCompanies: filterOperationalCompaniesMock,
}))
vi.mock("@/lib/recompute/job-runner", () => ({
  enqueue: enqueueRecomputeJobMock,
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET, POST } from "./route"

const ORG_ID = "cm3rlswraporg00000001demo"

beforeEach(() => {
  delete process.env.SERVERLESS_SYNC_RECOMPUTE
  prismaMock.indicatorDefinition.findMany.mockReset().mockResolvedValue([])
  prismaMock.company.findMany.mockReset().mockResolvedValue([])
  prismaMock.companyIndicator.findMany.mockReset().mockResolvedValue([])
  recomputeIndicatorMock.mockReset().mockResolvedValue({ value: 100, status: "green" })
  createPrismaDataSourceMock.mockReset().mockReturnValue({})
  filterOperationalCompaniesMock.mockReset().mockImplementation((arr: unknown[]) => arr)
  enqueueRecomputeJobMock.mockReset().mockReturnValue({ jobId: "job_1" })
})

describe("GET /api/indicators", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(makeRequest("/api/indicators"))
    expect(res.status).toBe(401)
  })

  it("200 returns indicators (org + global), filtered by isActive", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.indicatorDefinition.findMany.mockResolvedValue([
      {
        id: "i1", code: "IND_DSO", organizationId: null,
        isActive: true, industries: [],
      },
    ])
    const res = await GET(makeRequest("/api/indicators"))
    expect(res.status).toBe(200)
    expect(prismaMock.indicatorDefinition.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isActive: true,
          OR: [{ organizationId: null }, { organizationId: ORG_ID }],
        }),
      }),
    )
  })

  // Phase 8 F1 — catalog scoped to the org's active industries (multi-org-safe).
  it("scopes the preferred catalog to the org's company industries", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    // Org operates in agro_crops + food_processing.
    prismaMock.company.findMany.mockResolvedValue([
      { industry: "agro_crops" },
      { industry: "food_processing" },
    ])
    prismaMock.indicatorDefinition.findMany.mockResolvedValue([
      { id: "i-all", code: "UNIVERSAL", organizationId: null, isActive: true, industries: [] },
      { id: "i-agro", code: "AGRO_ONLY", organizationId: null, isActive: true, industries: ["agro_crops"] },
      { id: "i-pharma", code: "PHARMA_ONLY", organizationId: null, isActive: true, industries: ["pharma"] },
    ])
    const res = await GET(makeRequest("/api/indicators"))
    expect(res.status).toBe(200)
    // Distinct industries pulled from the org's companies.
    expect(prismaMock.company.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ distinct: ["industry"] }),
    )
    expect((await res.json()).map((indicator: { code: string }) => indicator.code)).toEqual([
      "UNIVERSAL",
      "AGRO_ONLY",
    ])
    // Both global and tenant rows must reach the preference step; activity
    // filtering in SQL would be too early.
    const call = prismaMock.indicatorDefinition.findMany.mock.calls[0][0]
    expect(call.where.AND).toBeUndefined()
  })

  it("does not resurrect a matching global definition when its tenant override is out of scope", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.company.findMany.mockResolvedValue([{ industry: "agro_crops" }])
    prismaMock.indicatorDefinition.findMany.mockResolvedValue([
      {
        id: "i-global", code: "SAME_CODE", organizationId: null,
        isActive: true, industries: ["agro_crops"],
      },
      {
        id: "i-tenant", code: "SAME_CODE", organizationId: ORG_ID,
        isActive: true, industries: ["pharma"],
      },
    ])

    const res = await GET(makeRequest("/api/indicators"))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })
})

describe("POST /api/indicators (recompute)", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await POST(
      makeRequest("/api/indicators", { method: "POST", json: { period: "2026-Q1" } }),
    )
    expect(res.status).toBe(401)
  })

  it("403 viewer (requires manager)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await POST(
      makeRequest("/api/indicators", { method: "POST", json: { period: "2026-Q1" } }),
    )
    expect(res.status).toBe(403)
  })

  it("400 missing period", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await POST(
      makeRequest("/api/indicators", { method: "POST", json: {} }),
    )
    expect(res.status).toBe(400)
  })

  it("200 + 0 results when no targets matched", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.company.findMany.mockResolvedValue([])
    prismaMock.indicatorDefinition.findMany.mockResolvedValue([])
    const res = await POST(
      makeRequest("/api/indicators", { method: "POST", json: { period: "2026-Q1" } }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.processed).toBe(0)
  })

  it("200 sync path — single (company,indicator) recompute returns withSparkline", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.company.findMany.mockResolvedValue([
      { id: "c1", code: "AAC", industry: "tech", level: 2, isActive: true, role: "operational" },
    ])
    prismaMock.indicatorDefinition.findMany.mockResolvedValue([
      {
        id: "i1", organizationId: null, code: "IND_DSO", formula: {},
        sparklineFormula: null, thresholds: {}, requiredInputs: [],
        industries: [], isActive: true, unit: "days", defaultValueSource: "computed",
      },
    ])
    recomputeIndicatorMock.mockResolvedValue({ value: 30, status: "green" })
    const res = await POST(
      makeRequest("/api/indicators", {
        method: "POST",
        json: { period: "2026-Q1", companyId: "c1", indicatorCode: "IND_DSO" },
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.processed).toBe(1)
    expect(body.ok).toBe(1)
    // single-pair → withSparkline:true
    expect(recomputeIndicatorMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ withSparkline: true }),
    )
  })

  it("does not target a parent-only rollup definition on an operational company", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.company.findMany.mockResolvedValue([
      { id: "c1", code: "AAC", industry: "tech", level: 2, isActive: true, role: "operational" },
    ])
    prismaMock.indicatorDefinition.findMany.mockResolvedValue([
      {
        id: "i-rollup", organizationId: null, code: "PUBLIC_HOLDING_ROLLUP", formula: {},
        sparklineFormula: null, thresholds: {},
        requiredInputs: ["rollup:IND_REVENUE_TOTAL"],
        industries: [], isActive: true, unit: "AZN", defaultValueSource: "computed",
      },
    ])
    // Structural level eligibility is stronger than an explicit enable.
    prismaMock.companyIndicator.findMany.mockResolvedValue([
      { companyId: "c1", indicatorId: "i-rollup", enabled: true },
    ])

    const res = await POST(
      makeRequest("/api/indicators", {
        method: "POST",
        json: { period: "2026", companyId: "c1", indicatorCode: "PUBLIC_HOLDING_ROLLUP" },
      }),
    )

    expect(res.status).toBe(200)
    expect((await res.json()).processed).toBe(0)
    expect(prismaMock.companyIndicator.findMany).not.toHaveBeenCalled()
    expect(recomputeIndicatorMock).not.toHaveBeenCalled()
  })

  it("recomputes an explicitly enabled cross-industry pair", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.company.findMany.mockResolvedValue([
      { id: "c1", code: "AAC", industry: "tech", level: 2, isActive: true, role: "operational" },
    ])
    prismaMock.indicatorDefinition.findMany.mockResolvedValue([
      {
        id: "i_retail", organizationId: null, code: "RET_FOOD_CPI", formula: {},
        sparklineFormula: null, thresholds: {}, requiredInputs: [],
        industries: ["retail"], isActive: true, unit: "%", defaultValueSource: "computed",
      },
    ])
    prismaMock.companyIndicator.findMany.mockResolvedValue([
      { companyId: "c1", indicatorId: "i_retail", enabled: true },
    ])

    const res = await POST(
      makeRequest("/api/indicators", {
        method: "POST",
        json: { period: "2026", companyId: "c1", indicatorCode: "RET_FOOD_CPI" },
      }),
    )

    expect(res.status).toBe(200)
    expect((await res.json()).processed).toBe(1)
    expect(recomputeIndicatorMock).toHaveBeenCalledTimes(1)
  })

  it("does not recompute an explicitly disabled taxonomy-matching pair", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.company.findMany.mockResolvedValue([
      { id: "c1", code: "AAC", industry: "tech", level: 2, isActive: true, role: "operational" },
    ])
    prismaMock.indicatorDefinition.findMany.mockResolvedValue([
      {
        id: "i_tech", organizationId: null, code: "TECH_KPI", formula: {},
        sparklineFormula: null, thresholds: {}, requiredInputs: [],
        industries: ["tech"], isActive: true, unit: "%", defaultValueSource: "computed",
      },
    ])
    prismaMock.companyIndicator.findMany.mockResolvedValue([
      { companyId: "c1", indicatorId: "i_tech", enabled: false },
    ])

    const res = await POST(
      makeRequest("/api/indicators", {
        method: "POST",
        json: { period: "2026", companyId: "c1", indicatorCode: "TECH_KPI" },
      }),
    )

    expect(res.status).toBe(200)
    expect((await res.json()).processed).toBe(0)
    expect(recomputeIndicatorMock).not.toHaveBeenCalled()
  })

  it("202 async path — fan-out > 50 pairs enqueues job", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    // 60 companies × 1 def = 60 pairs > SYNC_THRESHOLD (50)
    const companies = Array.from({ length: 60 }, (_, i) => ({
      id: `c${i}`, code: `C${i}`, industry: "tech", level: 2, isActive: true, role: "operational",
    }))
    prismaMock.company.findMany.mockResolvedValue(companies)
    prismaMock.indicatorDefinition.findMany.mockResolvedValue([
      {
        id: "i1", organizationId: null, code: "IND_X", formula: {},
        sparklineFormula: null, thresholds: {}, requiredInputs: [],
        industries: [], isActive: true, unit: "%", defaultValueSource: "computed",
      },
    ])
    const res = await POST(
      makeRequest("/api/indicators", { method: "POST", json: { period: "2026-Q1" } }),
    )
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.async).toBe(true)
    expect(body.jobId).toBe("job_1")
    expect(enqueueRecomputeJobMock).toHaveBeenCalledTimes(1)
  })

  it("runs a large fan-out inline on scale-to-zero serverless deployments", async () => {
    process.env.SERVERLESS_SYNC_RECOMPUTE = "true"
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const companies = Array.from({ length: 60 }, (_, i) => ({
      id: `c${i}`, code: `C${i}`, industry: "tech", level: 2, isActive: true, role: "operational",
    }))
    prismaMock.company.findMany.mockResolvedValue(companies)
    prismaMock.indicatorDefinition.findMany.mockResolvedValue([
      {
        id: "i1", organizationId: null, code: "IND_X", formula: {},
        sparklineFormula: null, thresholds: {}, requiredInputs: [],
        industries: [], isActive: true, unit: "%", defaultValueSource: "computed",
      },
    ])

    const res = await POST(
      makeRequest("/api/indicators", { method: "POST", json: { period: "2026-Q1" } }),
    )

    expect(res.status).toBe(200)
    expect((await res.json()).processed).toBe(60)
    expect(enqueueRecomputeJobMock).not.toHaveBeenCalled()
  })

  it("error in recompute doesn't abort batch — captured as outcome", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.company.findMany.mockResolvedValue([
      { id: "c1", code: "AAC", industry: "tech", level: 2, isActive: true, role: "operational" },
      { id: "c2", code: "ATL", industry: "tech", level: 2, isActive: true, role: "operational" },
    ])
    prismaMock.indicatorDefinition.findMany.mockResolvedValue([
      {
        id: "i1", organizationId: null, code: "IND_X", formula: {},
        sparklineFormula: null, thresholds: {}, requiredInputs: [],
        industries: [], isActive: true, unit: "%", defaultValueSource: "computed",
      },
    ])
    recomputeIndicatorMock
      .mockResolvedValueOnce({ value: 100, status: "green" })
      .mockRejectedValueOnce(new Error("boom"))
    const res = await POST(
      makeRequest("/api/indicators", { method: "POST", json: { period: "2026-Q1" } }),
    )
    const body = await res.json()
    expect(body.processed).toBe(2)
    expect(body.ok).toBe(1)
    expect(body.error).toBe(1)
  })

  it("org-specific def beats global on code collision", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.company.findMany.mockResolvedValue([
      { id: "c1", code: "AAC", industry: "tech", level: 2, isActive: true, role: "operational" },
    ])
    // Two defs with same code IND_X — one global, one org-specific
    prismaMock.indicatorDefinition.findMany.mockResolvedValue([
      {
        id: "i_global", organizationId: null, code: "IND_X", formula: {},
        sparklineFormula: null, thresholds: {}, requiredInputs: [],
        industries: [], isActive: true, unit: "%", defaultValueSource: "computed",
      },
      {
        id: "i_org", organizationId: ORG_ID, code: "IND_X", formula: {},
        sparklineFormula: null, thresholds: {}, requiredInputs: [],
        industries: [], isActive: true, unit: "%", defaultValueSource: "computed",
      },
    ])
    await POST(
      makeRequest("/api/indicators", {
        method: "POST",
        json: { period: "2026-Q1", companyId: "c1", indicatorCode: "IND_X" },
      }),
    )
    // Should pass the ORG-specific definition (i_org) into recomputeIndicator
    const passedDef = recomputeIndicatorMock.mock.calls[0][1].definition
    expect(passedDef.id).toBe("i_org")
  })
})
