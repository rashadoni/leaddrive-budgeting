// @vitest-environment node
/**
 * Handler test for `/api/market/ticker` (GET).
 *
 * Tier 2 #9 market-ticker feed. Locks:
 * - Auth: requireRole(viewer) — basic readers OK, but auth required
 * - FX rates fetched from Currency (current) + CurrencyRateHistory (prev)
 * - Commodity series from IntelDataPoint (table-missing → graceful skip)
 * - FX fails closed unless exactly one active base currency is confirmed
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    currency: { findMany: vi.fn() },
    intelDataPoint: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/db/with-org-scope", () => ({
  withOrgScope: async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock),
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  prismaMock.currency.findMany.mockReset().mockResolvedValue([])
  prismaMock.intelDataPoint.findMany.mockReset().mockResolvedValue([])
  prismaMock.$queryRaw.mockReset().mockResolvedValue([])
})

describe("GET /api/market/ticker", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(makeRequest("/api/market/ticker"))
    expect(res.status).toBe(401)
  })

  it("200 with empty entries when no currencies + no commodity data", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await GET(makeRequest("/api/market/ticker"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.entries).toEqual([])
    expect(typeof body.generatedAt).toBe("string") // ISO timestamp
  })

  it("currencies are filtered to the active organization scope", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    await GET(makeRequest("/api/market/ticker"))
    expect(prismaMock.currency.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: ORG_ID, isActive: true },
      }),
    )
  })

  it("fails closed when no confirmed base currency exists", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.currency.findMany.mockResolvedValue([
      { code: "USD", exchangeRate: 1.7, symbol: "$", isBase: false },
    ])
    const res = await GET(makeRequest("/api/market/ticker"))
    const body = await res.json()
    expect(body.entries).toEqual([])
    expect(body.fxBasis).toEqual({ status: "missing", code: null })
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled()
  })

  it("emits one FX entry per non-base currency against the confirmed base", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.currency.findMany.mockResolvedValue([
      { code: "USD", exchangeRate: 1.7, symbol: "$", isBase: false },
      { code: "EUR", exchangeRate: 1.85, symbol: "€", isBase: false },
      { code: "AZN", exchangeRate: 1, symbol: "₼", isBase: true },
    ])
    const res = await GET(makeRequest("/api/market/ticker"))
    const body = await res.json()
    expect(body.entries).toHaveLength(2)
    expect(body.entries[0]).toMatchObject({
      metric: "USD_AZN",
      label: "USD/AZN",
      current: 1.7,
      source: "fx",
      unit: "₼",
    })
    expect(body.fxBasis).toEqual({ status: "confirmed", code: "AZN" })
  })

  it("fails closed on conflicting bases and never queries FX history", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.currency.findMany.mockResolvedValue([
      { code: "AZN", exchangeRate: 1, symbol: "₼", isBase: true },
      { code: "USD", exchangeRate: 1, symbol: "$", isBase: true },
      { code: "EUR", exchangeRate: 1.85, symbol: "€", isBase: false },
    ])
    const res = await GET(makeRequest("/api/market/ticker"))
    const body = await res.json()
    expect(body.entries).toEqual([])
    expect(body.fxBasis).toEqual({ status: "conflicting", code: null })
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled()
  })

  it("suppresses non-finite, zero and negative exchange rates", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.currency.findMany.mockResolvedValue([
      { code: "AZN", exchangeRate: 1, symbol: "₼", isBase: true },
      { code: "USD", exchangeRate: 1.7, symbol: "$", isBase: false },
      { code: "EUR", exchangeRate: 0, symbol: "€", isBase: false },
      { code: "GBP", exchangeRate: -2, symbol: "£", isBase: false },
      { code: "JPY", exchangeRate: Number.NaN, symbol: "¥", isBase: false },
    ])
    const res = await GET(makeRequest("/api/market/ticker"))
    const body = await res.json()
    expect(body.entries.map((entry: { metric: string }) => entry.metric)).toEqual(["USD_AZN"])
  })

  it("FX entry's previous = penultimate rate from history (when available)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.currency.findMany.mockResolvedValue([
      { code: "USD", exchangeRate: 1.7, symbol: "$", isBase: false },
      { code: "AZN", exchangeRate: 1, symbol: "₼", isBase: true },
    ])
    prismaMock.$queryRaw.mockResolvedValue([{ currencyCode: "USD", rate: 1.68 }])
    const res = await GET(makeRequest("/api/market/ticker"))
    const body = await res.json()
    expect(body.entries[0].previous).toBe(1.68)
    const sql = prismaMock.$queryRaw.mock.calls[0][0].join(" ")
    expect(sql).toContain('ROW_NUMBER() OVER')
    expect(sql).toContain('PARTITION BY "currencyCode"')
    expect(sql).toContain('ORDER BY "rateDate" DESC, "createdAt" DESC, "id" DESC')
    expect(sql).toContain('WHERE ranked.position = 2')
  })

  it("FX entry's previous = null when no history row exists", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.currency.findMany.mockResolvedValue([
      { code: "USD", exchangeRate: 1.7, symbol: "$", isBase: false },
      { code: "AZN", exchangeRate: 1, symbol: "₼", isBase: true },
    ])
    prismaMock.$queryRaw.mockResolvedValue([]) // no prev
    const res = await GET(makeRequest("/api/market/ticker"))
    const body = await res.json()
    expect(body.entries[0].previous).toBeNull()
  })

  it("commodity entries appended from IntelDataPoint (most-recent + penultimate)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.intelDataPoint.findMany.mockResolvedValue([
      // sorted DESC by datetime per `orderBy` clause
      { metric: "BRENT_USD_BBL", value: 85.2, unit: "USD/bbl", datetime: new Date("2026-05-17"), sourceCode: "rss-commodities" },
      { metric: "BRENT_USD_BBL", value: 84.1, unit: "USD/bbl", datetime: new Date("2026-05-16"), sourceCode: "rss-commodities" },
      { metric: "WHEAT_USD_TON", value: 210, unit: "USD/ton", datetime: new Date("2026-05-17"), sourceCode: "rss-commodities" },
    ])
    const res = await GET(makeRequest("/api/market/ticker"))
    const body = await res.json()
    const brent = body.entries.find((e: { metric: string }) => e.metric === "BRENT_USD_BBL")
    expect(brent.current).toBe(85.2)
    expect(brent.previous).toBe(84.1)
    expect(brent.source).toBe("rss-commodities")
    const wheat = body.entries.find((e: { metric: string }) => e.metric === "WHEAT_USD_TON")
    expect(wheat.current).toBe(210)
    expect(wheat.previous).toBeNull() // only 1 row
  })

  it("graceful degradation: intelDataPoint throws → FX entries still returned", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.currency.findMany.mockResolvedValue([
      { code: "USD", exchangeRate: 1.7, symbol: "$", isBase: false },
      { code: "AZN", exchangeRate: 1, symbol: "₼", isBase: true },
    ])
    prismaMock.intelDataPoint.findMany.mockRejectedValue(
      new Error('relation "intel_data_points" does not exist'),
    )
    const res = await GET(makeRequest("/api/market/ticker"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.entries).toHaveLength(1) // FX only, no commodity
    expect(body.entries[0].metric).toBe("USD_AZN")
  })
})
