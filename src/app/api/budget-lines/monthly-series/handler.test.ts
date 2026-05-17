// @vitest-environment node
/**
 * Handler test for `/api/budget-lines/monthly-series` (GET).
 *
 * 12-month series for a single account. Locks accountCode-vs-category
 * priority, FX conversion to AZN base, sub-group RBAC scope, and
 * monthIndex bucketing.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock, getCompanyScopeMock } = vi.hoisted(() => ({
  prismaMock: {
    budgetLine: { findMany: vi.fn() },
  },
  getCompanyScopeMock: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/rbac/company-scope", () => ({
  getCompanyScope: getCompanyScopeMock,
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  prismaMock.budgetLine.findMany.mockReset().mockResolvedValue([])
  // Default: no sub-group scope (admin-style, all companies accessible)
  getCompanyScopeMock.mockReset().mockResolvedValue({ ids: null })
})

describe("GET /api/budget-lines/monthly-series", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(
      makeRequest("/api/budget-lines/monthly-series?companyId=c1&accountCode=601-01&year=2026"),
    )
    expect(res.status).toBe(401)
  })

  it("400 missing companyId", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await GET(
      makeRequest("/api/budget-lines/monthly-series?accountCode=601-01&year=2026"),
    )
    expect(res.status).toBe(400)
  })

  it("400 missing accountCode AND category", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await GET(
      makeRequest("/api/budget-lines/monthly-series?companyId=c1&year=2026"),
    )
    expect(res.status).toBe(400)
  })

  it("400 missing year", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await GET(
      makeRequest("/api/budget-lines/monthly-series?companyId=c1&accountCode=601-01"),
    )
    expect(res.status).toBe(400)
  })

  it("404 when companyId outside sub-group scope", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    getCompanyScopeMock.mockResolvedValue({ ids: new Set(["c-other"]) })
    const res = await GET(
      makeRequest("/api/budget-lines/monthly-series?companyId=c1&accountCode=601-01&year=2026"),
    )
    expect(res.status).toBe(404)
  })

  it("200 — 12-slot months array even with no data", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await GET(
      makeRequest("/api/budget-lines/monthly-series?companyId=c1&accountCode=601-01&year=2026"),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.months).toHaveLength(12)
    expect(body.months[0]).toEqual({ monthIndex: 0, amountBase: 0, lineCount: 0 })
  })

  it("buckets multiple lines into the same month + sums plannedAmount", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.budgetLine.findMany.mockResolvedValue([
      { sortOrder: 0, plannedAmount: 100, currencyCode: "AZN", exchangeRate: 1 },
      { sortOrder: 0, plannedAmount: 50, currencyCode: "AZN", exchangeRate: 1 },
      { sortOrder: 5, plannedAmount: 200, currencyCode: "AZN", exchangeRate: 1 },
    ])
    const res = await GET(
      makeRequest("/api/budget-lines/monthly-series?companyId=c1&accountCode=601-01&year=2026"),
    )
    const body = await res.json()
    expect(body.months[0].amountBase).toBe(150)
    expect(body.months[0].lineCount).toBe(2)
    expect(body.months[5].amountBase).toBe(200)
    expect(body.months[5].lineCount).toBe(1)
  })

  it("converts foreign currency × exchangeRate into AZN base", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.budgetLine.findMany.mockResolvedValue([
      { sortOrder: 0, plannedAmount: 100, currencyCode: "USD", exchangeRate: 1.7 }, // → 170
      { sortOrder: 0, plannedAmount: 50,  currencyCode: "AZN", exchangeRate: 1 },   // → 50
    ])
    const res = await GET(
      makeRequest("/api/budget-lines/monthly-series?companyId=c1&accountCode=601-01&year=2026"),
    )
    const body = await res.json()
    expect(body.months[0].amountBase).toBeCloseTo(220, 4)
  })

  it("uses accountCode when provided (priority over category)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    await GET(
      makeRequest("/api/budget-lines/monthly-series?companyId=c1&accountCode=601-01&year=2026"),
    )
    const where = prismaMock.budgetLine.findMany.mock.calls[0][0].where
    expect(where).toMatchObject({ account: { code: "601-01" } })
  })

  it("falls back to category when accountCode missing", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    await GET(
      makeRequest("/api/budget-lines/monthly-series?companyId=c1&category=Salaries&year=2026"),
    )
    const where = prismaMock.budgetLine.findMany.mock.calls[0][0].where
    expect(where).toMatchObject({ category: "Salaries" })
  })
})
