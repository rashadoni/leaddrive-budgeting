// @vitest-environment node
/**
 * Handler test for `/api/intel/data-points` (GET).
 *
 * Phase 7.I commodity/weather feed read API. Locks:
 * - org-scoped query (no leak of other-org commodity data)
 * - zod query validation (sourceCode required, limit hard cap 500)
 * - graceful degradation when intel_data_points table doesn't exist
 *   (returns {rows: [], stale: true} instead of 500)
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    intelDataPoint: { findMany: vi.fn() },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  prismaMock.intelDataPoint.findMany.mockReset().mockResolvedValue([])
})

describe("GET /api/intel/data-points", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(makeRequest("/api/intel/data-points?sourceCode=tcmb-fx"))
    expect(res.status).toBe(401)
  })

  it("400 missing sourceCode", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await GET(makeRequest("/api/intel/data-points"))
    expect(res.status).toBe(400)
  })

  it("400 sourceCode too long (> 60 chars)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const longCode = "x".repeat(61)
    const res = await GET(
      makeRequest(`/api/intel/data-points?sourceCode=${longCode}`),
    )
    expect(res.status).toBe(400)
  })

  it("400 limit > 500", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await GET(
      makeRequest("/api/intel/data-points?sourceCode=tcmb-fx&limit=999"),
    )
    expect(res.status).toBe(400)
  })

  it("200 org-scoped query with default limit 24", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await GET(
      makeRequest("/api/intel/data-points?sourceCode=tcmb-fx"),
    )
    expect(res.status).toBe(200)
    expect(prismaMock.intelDataPoint.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: ORG_ID, sourceCode: "tcmb-fx" },
        take: 24,
        orderBy: { datetime: "asc" },
      }),
    )
  })

  it("metric filter passes through to where clause", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    await GET(
      makeRequest(
        "/api/intel/data-points?sourceCode=worldbank-pink&metric=SUGAR_RAW_USD",
      ),
    )
    expect(prismaMock.intelDataPoint.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ metric: "SUGAR_RAW_USD" }),
      }),
    )
  })

  it("custom limit respected", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    await GET(
      makeRequest("/api/intel/data-points?sourceCode=tcmb-fx&limit=100"),
    )
    expect(prismaMock.intelDataPoint.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100 }),
    )
  })

  it("graceful degradation: returns stale:true when table doesn't exist (P2021)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const err = new Error('relation "intel_data_points" does not exist')
    prismaMock.intelDataPoint.findMany.mockRejectedValue(err)
    const res = await GET(makeRequest("/api/intel/data-points?sourceCode=x"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ rows: [], stale: true })
  })

  it("500 on other errors (NOT swallowed as stale)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.intelDataPoint.findMany.mockRejectedValue(
      new Error("connection refused"),
    )
    const res = await GET(makeRequest("/api/intel/data-points?sourceCode=x"))
    expect(res.status).toBe(500)
  })
})
