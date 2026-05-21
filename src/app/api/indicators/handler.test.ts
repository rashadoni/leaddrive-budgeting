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
}))
vi.mock("@/lib/risk/targets", () => ({
  filterOperationalCompanies: filterOperationalCompaniesMock,
}))
vi.mock("@/lib/recompute/job-runner", () => ({
  enqueue: enqueueRecomputeJobMock,
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET, POST } from "./route"

const ORG_ID = "cm3rlswraporg00000001demo"

beforeEach(() => {
  prismaMock.indicatorDefinition.findMany.mockReset().mockResolvedValue([])
  prismaMock.company.findMany.mockReset().mockResolvedValue([])
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
      { id: "i1", code: "IND_DSO", organizationId: null },
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
