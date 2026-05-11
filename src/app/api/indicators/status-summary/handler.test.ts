// @vitest-environment node
/**
 * Phase 7.G CXLVII (CXLVI follow-up) — handler tests for
 * `GET /api/indicators/status-summary`.
 *
 * Locks the contract that backs the HeatMap header badge:
 *  - auth gate (requireAuth)
 *  - period validation (parsePeriod)
 *  - shape: { period, green, amber, red, unknown, total }
 *  - org-scoped groupBy (multi-tenant isolation)
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    indicatorValue: {
      groupBy: vi.fn(),
    },
  },
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET } from "./route"
import { prisma } from "@/lib/prisma"

const ORG = "org_demo"
const groupBy = prisma.indicatorValue.groupBy as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  groupBy.mockReset()
  groupBy.mockResolvedValue([])
})

describe("GET /api/indicators/status-summary — auth gate", () => {
  it("returns 401 when unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(makeRequest("/api/indicators/status-summary"))
    expect(res.status).toBe(401)
  })

  it("any authenticated org member can read (viewer-tier ok)", async () => {
    await mockSession({ orgId: ORG, userId: "u_viewer", role: "viewer" })
    const res = await GET(makeRequest("/api/indicators/status-summary?period=2026"))
    expect(res.status).toBe(200)
  })
})

describe("GET /api/indicators/status-summary — period validation", () => {
  beforeEach(async () => {
    await mockSession({ orgId: ORG, userId: "u1", role: "manager" })
  })

  it("accepts valid annual period", async () => {
    const res = await GET(makeRequest("/api/indicators/status-summary?period=2026"))
    expect(res.status).toBe(200)
  })

  it("accepts valid monthly period", async () => {
    const res = await GET(makeRequest("/api/indicators/status-summary?period=2026-12"))
    expect(res.status).toBe(200)
  })

  it("defaults to current Baku year when period omitted", async () => {
    const res = await GET(makeRequest("/api/indicators/status-summary"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.period).toMatch(/^\d{4}$/)
  })

  it("returns 400 on malformed period", async () => {
    const res = await GET(makeRequest("/api/indicators/status-summary?period=2026-99"))
    expect(res.status).toBe(400)
  })
})

describe("GET /api/indicators/status-summary — counts shape", () => {
  beforeEach(async () => {
    await mockSession({ orgId: ORG, userId: "u1", role: "manager" })
  })

  it("returns zero counts when no rows in DB", async () => {
    groupBy.mockResolvedValueOnce([])
    const res = await GET(makeRequest("/api/indicators/status-summary?period=2026"))
    const body = await res.json()
    expect(body).toEqual({ period: "2026", green: 0, amber: 0, red: 0, unknown: 0, total: 0 })
  })

  it("aggregates groupBy rows into per-status counts + total", async () => {
    groupBy.mockResolvedValueOnce([
      { status: "green",   _count: { _all: 15 } },
      { status: "amber",   _count: { _all: 17 } },
      { status: "red",     _count: { _all: 2  } },
      { status: "unknown", _count: { _all: 86 } },
    ])
    const res = await GET(makeRequest("/api/indicators/status-summary?period=2026"))
    const body = await res.json()
    expect(body).toEqual({ period: "2026", green: 15, amber: 17, red: 2, unknown: 86, total: 120 })
  })

  it("ignores unknown status values (defensive — schema may grow)", async () => {
    groupBy.mockResolvedValueOnce([
      { status: "green", _count: { _all: 10 } },
      { status: "purple-monkey", _count: { _all: 99 } }, // bogus, must be skipped
    ])
    const res = await GET(makeRequest("/api/indicators/status-summary?period=2026"))
    const body = await res.json()
    expect(body.green).toBe(10)
    expect(body.total).toBe(10)
  })

  it("scopes groupBy by organizationId + period (multi-tenant isolation)", async () => {
    await GET(makeRequest("/api/indicators/status-summary?period=2026-Q1"))
    expect(groupBy).toHaveBeenCalledWith({
      by: ["status"],
      where: { organizationId: ORG, period: "2026-Q1" },
      _count: { _all: true },
    })
  })
})
