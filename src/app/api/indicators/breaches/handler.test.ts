// @vitest-environment node
/**
 * Phase 7.G Turn LXXXXIX (Phase 7.E #3 v2 E.2d server) — handler tests for
 * `GET /api/indicators/breaches`.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    // Phase 7.F sub-group RBAC — getCompanyScope reads user row.
    user: { findFirst: vi.fn().mockResolvedValue({ allowedSubGroupIds: [] }) },
    // Breach route resolves companyId → code + name AND drops rows whose
    // company doesn't exist — mock the real companies used in the tests.
    company: { findMany: vi.fn().mockResolvedValue([
      { id: "co_aac", code: "AZSEKER-MALT", name: "Malt" },
      { id: "co_a", code: "CO-A", name: "Company A" },
      { id: "co_b", code: "CO-B", name: "Company B" },
      { id: "co_c", code: "CO-C", name: "Company C" },
    ]) },
  },
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET } from "./route"
import {
  evaluateAndPersistBreaches,
  clearBreachMemoryForTests,
} from "@/lib/risk/breach-persist"
import type { ForecastedBreach } from "@/lib/risk/breach-forecaster"

const ORG = "org_demo"

const sampleBreach = (overrides: Partial<ForecastedBreach> = {}): ForecastedBreach => ({
  indicatorCode: "REV_GROWTH",
  companyId: "co_aac",
  period: "2026-Q1",
  horizonStep: 1,
  currentStatus: "green",
  predictedStatus: "amber",
  forecastConfidence: 0.85,
  confidenceBand: "high",
  predictedValue: 75,
  ...overrides,
})

beforeEach(() => {
  clearBreachMemoryForTests()
})

describe("GET /api/indicators/breaches — auth gate", () => {
  it("returns 401 when unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(makeRequest("/api/indicators/breaches"))
    expect(res.status).toBe(401)
  })

  it("returns 403 when session has no orgId", async () => {
    await mockSession({ orgId: "", userId: "u1", role: "viewer" })
    const res = await GET(makeRequest("/api/indicators/breaches"))
    // requireAuth may treat empty orgId as auth fail (401) OR pass through
    // and the orgId guard returns 403 — accept either
    expect([401, 403]).toContain(res.status)
  })

  it("any authenticated org member can read (viewer-tier ok)", async () => {
    await mockSession({ orgId: ORG, userId: "u_viewer", role: "viewer" })
    await evaluateAndPersistBreaches(ORG, [sampleBreach()])
    const res = await GET(makeRequest("/api/indicators/breaches"))
    expect(res.status).toBe(200)
  })
})

describe("GET /api/indicators/breaches — Zod validation", () => {
  beforeEach(async () => {
    await mockSession({ orgId: ORG, userId: "u1", role: "manager" })
  })

  it("accepts valid period (annual / quarterly / monthly)", async () => {
    for (const period of ["2026", "2026-Q1", "2026-12"]) {
      const res = await GET(makeRequest(`/api/indicators/breaches?period=${period}`))
      expect(res.status).toBe(200)
    }
  })

  it("rejects malformed period", async () => {
    const res = await GET(makeRequest("/api/indicators/breaches?period=2026-Q9"))
    expect(res.status).toBe(400)
  })

  it("rejects invalid minConfidenceBand", async () => {
    const res = await GET(makeRequest("/api/indicators/breaches?minConfidenceBand=invalid"))
    expect(res.status).toBe(400)
  })

  it("rejects unknown query keys (Zod .strict())", async () => {
    const res = await GET(makeRequest("/api/indicators/breaches?evilParam=1"))
    expect(res.status).toBe(400)
  })

  it("accepts no params (returns all breaches for org)", async () => {
    const res = await GET(makeRequest("/api/indicators/breaches"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.breaches).toEqual([])
    expect(body.filter).toEqual({ period: null, minConfidenceBand: null })
    expect(body.count).toBe(0)
  })
})

describe("GET /api/indicators/breaches — happy path + filters", () => {
  beforeEach(async () => {
    await mockSession({ orgId: ORG, userId: "u1", role: "manager" })
    await evaluateAndPersistBreaches(ORG, [
      sampleBreach({ companyId: "co_a", period: "2026-Q1", confidenceBand: "high" }),
      sampleBreach({ companyId: "co_b", period: "2026-Q1", confidenceBand: "medium" }),
      sampleBreach({ companyId: "co_c", period: "2026-Q2", confidenceBand: "low" }),
    ])
  })

  it("returns all breaches for org when no filter", async () => {
    const res = await GET(makeRequest("/api/indicators/breaches"))
    const body = await res.json()
    expect(body.count).toBe(3)
    expect(body.breaches).toHaveLength(3)
  })

  it("strips organizationId from each row (caller knows own org)", async () => {
    const res = await GET(makeRequest("/api/indicators/breaches"))
    const body = await res.json()
    for (const b of body.breaches) {
      expect(b.organizationId).toBeUndefined()
      // But other fields preserved
      expect(b.indicatorCode).toBeDefined()
      expect(b.predictedValue).toBeDefined()
    }
  })

  it("filters by period", async () => {
    const res = await GET(makeRequest("/api/indicators/breaches?period=2026-Q1"))
    const body = await res.json()
    expect(body.count).toBe(2)
    for (const b of body.breaches) expect(b.period).toBe("2026-Q1")
    expect(body.filter.period).toBe("2026-Q1")
  })

  it("filters by minConfidenceBand=medium → drops low rows", async () => {
    const res = await GET(makeRequest("/api/indicators/breaches?minConfidenceBand=medium"))
    const body = await res.json()
    expect(body.count).toBe(2)
    const bands = body.breaches.map((b: ForecastedBreach) => b.confidenceBand).sort()
    expect(bands).toEqual(["high", "medium"])
  })

  it("filters by minConfidenceBand=high → only high rows", async () => {
    const res = await GET(makeRequest("/api/indicators/breaches?minConfidenceBand=high"))
    const body = await res.json()
    expect(body.count).toBe(1)
    expect(body.breaches[0].confidenceBand).toBe("high")
  })

  it("combined filters: period + minConfidenceBand", async () => {
    const res = await GET(
      makeRequest("/api/indicators/breaches?period=2026-Q1&minConfidenceBand=high"),
    )
    const body = await res.json()
    expect(body.count).toBe(1)
    expect(body.breaches[0].period).toBe("2026-Q1")
    expect(body.breaches[0].confidenceBand).toBe("high")
  })

  it("drops forecasts for non-existent (orphan/mock) companies + enriches code·name", async () => {
    await evaluateAndPersistBreaches(ORG, [
      sampleBreach({ companyId: "co_ghost", period: "2026-Q3", confidenceBand: "high" }),
    ])
    const res = await GET(makeRequest("/api/indicators/breaches?period=2026-Q3"))
    const body = await res.json()
    // co_ghost isn't in the company table → filtered out entirely.
    expect(body.count).toBe(0)
    expect(body.breaches).toEqual([])
    // And a real company's rows carry the resolved name.
    const all = await GET(makeRequest("/api/indicators/breaches?period=2026-Q1"))
    const allBody = await all.json()
    expect(allBody.breaches[0].companyName).toBeDefined()
    expect(allBody.breaches[0].companyCode).not.toMatch(/^co_/) // resolved, not a raw id
  })

  it("multi-tenant: org_b sees zero when only org_a has data", async () => {
    await mockSession({ orgId: "org_b", userId: "u2", role: "viewer" })
    const res = await GET(makeRequest("/api/indicators/breaches"))
    const body = await res.json()
    expect(body.count).toBe(0)
  })
})
