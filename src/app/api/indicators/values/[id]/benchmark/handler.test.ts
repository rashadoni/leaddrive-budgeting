// @vitest-environment node
/**
 * Handler test for `/api/indicators/values/[id]/benchmark` (GET).
 *
 * Phase 7.H Feature 3 — Peer Benchmarking. Locks viewer + sub-group
 * RBAC, NO_INDUSTRY 400, trailing-12 period derivation, and cohort
 * findMany shape.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock, getCompanyScopeMock, computePeerBenchmarkMock } = vi.hoisted(() => ({
  prismaMock: {
    indicatorValue: { findFirst: vi.fn(), findMany: vi.fn() },
    company: { findMany: vi.fn() },
  },
  getCompanyScopeMock: vi.fn(),
  computePeerBenchmarkMock: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
// Stage 3 RLS — hand the mock straight to the scope callback.
vi.mock("@/lib/db/with-org-scope", () => ({
  withOrgScope: async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) =>
    fn(prismaMock),
}))
vi.mock("@/lib/rbac/company-scope", () => ({
  getCompanyScope: getCompanyScopeMock,
}))
vi.mock("@/lib/risk/peer-benchmark", () => ({
  computePeerBenchmark: computePeerBenchmarkMock,
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  prismaMock.indicatorValue.findFirst.mockReset().mockResolvedValue(null)
  prismaMock.indicatorValue.findMany.mockReset().mockResolvedValue([])
  prismaMock.company.findMany.mockReset().mockResolvedValue([])
  getCompanyScopeMock.mockReset().mockResolvedValue({ ids: null })
  computePeerBenchmarkMock.mockReset().mockReturnValue({
    medianSeries: [],
    p75Series: [],
    insufficientPeers: true,
    rank: null,
  })
})

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) })

describe("GET /api/indicators/values/[id]/benchmark", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(makeRequest("/api/indicators/values/iv1/benchmark"), makeParams("iv1"))
    expect(res.status).toBe(401)
  })

  it("404 cross-tenant IV", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.indicatorValue.findFirst.mockResolvedValue(null)
    const res = await GET(makeRequest("/api/indicators/values/iv1/benchmark"), makeParams("iv1"))
    expect(res.status).toBe(404)
  })

  it("404 when company outside sub-group scope", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.indicatorValue.findFirst.mockResolvedValue({
      id: "iv1", companyId: "c_restricted", indicatorId: "ind1", period: "2026-01",
      indicator: { code: "IND_DSO", direction: "lower_better", unit: "days" },
      company: { id: "c_restricted", code: "X", name: "X", industry: "agro_crops" },
    })
    getCompanyScopeMock.mockResolvedValue({ ids: new Set(["c_allowed"]) })
    const res = await GET(makeRequest("/api/indicators/values/iv1/benchmark"), makeParams("iv1"))
    expect(res.status).toBe(404)
  })

  it("400 NO_INDUSTRY when company has no industry", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.indicatorValue.findFirst.mockResolvedValue({
      id: "iv1", companyId: "c1", indicatorId: "ind1", period: "2026-01",
      indicator: { code: "IND_DSO", direction: "lower_better", unit: "days" },
      company: { id: "c1", code: "X", name: "X", industry: null },
    })
    const res = await GET(makeRequest("/api/indicators/values/iv1/benchmark"), makeParams("iv1"))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe("NO_INDUSTRY")
  })

  it("200 happy path — fetches cohort same-industry, returns benchmark", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.indicatorValue.findFirst.mockResolvedValue({
      id: "iv1", companyId: "c1", indicatorId: "ind1", period: "2026-01",
      indicator: { code: "IND_DSO", direction: "lower_better", unit: "days" },
      company: { id: "c1", code: "AZSEKER-EDEN", name: "Eden", industry: "agro_crops" },
    })
    prismaMock.company.findMany.mockResolvedValue([
      { id: "c2", code: "AZSEKER-AZSF" },
      { id: "c3", code: "AZSEKER-CPC" },
    ])
    prismaMock.indicatorValue.findMany.mockResolvedValue([])
    computePeerBenchmarkMock.mockReturnValue({
      medianSeries: [{ period: "2026-01", value: 30 }],
      p75Series: [{ period: "2026-01", value: 45 }],
      insufficientPeers: false,
      rank: { position: 1, total: 3 },
    })
    const res = await GET(makeRequest("/api/indicators/values/iv1/benchmark"), makeParams("iv1"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.medianSeries).toHaveLength(1)
    expect(body.cohortSize).toBe(2)
    expect(body.company.code).toBe("AZSEKER-EDEN")
    // Cohort findMany filtered same-industry + excluding self
    expect(prismaMock.company.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          industry: "agro_crops",
          id: { not: "c1" },
        }),
      }),
    )
  })

  it("400 on unparseable period", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.indicatorValue.findFirst.mockResolvedValue({
      id: "iv1", companyId: "c1", indicatorId: "ind1", period: "garbage-period",
      indicator: { code: "IND_X", direction: "higher_better", unit: "%" },
      company: { id: "c1", code: "X", name: "X", industry: "agro_crops" },
    })
    const res = await GET(makeRequest("/api/indicators/values/iv1/benchmark"), makeParams("iv1"))
    expect(res.status).toBe(400)
  })
})
