// @vitest-environment node
/**
 * Handler test for `/api/indicators/values/[id]/drilldown` (GET).
 *
 * Tier-3 drill-down — surfaces BudgetLine rows that fed the indicator
 * formula. Locks org-scoped IV lookup, sub-group RBAC 404,
 * period→sortOrder math, AZN base FX conversion, accountType
 * summarization, and 500-row cap.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock, getCompanyScopeMock } = vi.hoisted(() => ({
  prismaMock: {
    indicatorValue: { findFirst: vi.fn() },
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
  prismaMock.indicatorValue.findFirst.mockReset().mockResolvedValue(null)
  prismaMock.budgetLine.findMany.mockReset().mockResolvedValue([])
  getCompanyScopeMock.mockReset().mockResolvedValue({ ids: null })
})

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) })

describe("GET /api/indicators/values/[id]/drilldown", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(makeRequest("/api/indicators/values/iv1/drilldown"), makeParams("iv1"))
    expect(res.status).toBe(401)
  })

  it("400 invalid id (empty)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await GET(makeRequest("/api/indicators/values//drilldown"), makeParams("   "))
    expect(res.status).toBe(400)
  })

  it("404 cross-tenant indicator value", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.indicatorValue.findFirst.mockResolvedValue(null)
    const res = await GET(makeRequest("/api/indicators/values/iv1/drilldown"), makeParams("iv1"))
    expect(res.status).toBe(404)
  })

  it("404 when companyId outside sub-group RBAC", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.indicatorValue.findFirst.mockResolvedValue({
      id: "iv1", value: 1, status: "green", period: "2026-Q1",
      inputs: {}, companyId: "c_restricted",
      indicator: { code: "IND_X" },
      company: { code: "X" },
    })
    getCompanyScopeMock.mockResolvedValue({ ids: new Set(["c_allowed"]) })
    const res = await GET(makeRequest("/api/indicators/values/iv1/drilldown"), makeParams("iv1"))
    expect(res.status).toBe(404)
  })

  it("500 on invalid period (parsePeriod throws)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.indicatorValue.findFirst.mockResolvedValue({
      id: "iv1", value: 1, status: "green", period: "garbage",
      inputs: {}, companyId: "c1",
      indicator: {}, company: {},
    })
    const res = await GET(makeRequest("/api/indicators/values/iv1/drilldown"), makeParams("iv1"))
    expect(res.status).toBe(500)
  })

  it("200 happy path — converts foreign FX to AZN base, summarises by accountType", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.indicatorValue.findFirst.mockResolvedValue({
      id: "iv1", value: 100, status: "green", period: "2026-Q1",
      inputs: { resolved: { opex: 4_300_000 } }, companyId: "c1",
      indicator: { code: "IND_DSO", nameEn: "DSO" },
      company: { code: "AAC", name: "AAC" },
    })
    prismaMock.budgetLine.findMany.mockResolvedValue([
      {
        id: "L1", category: "Salaries", department: null, lineType: "expense",
        plannedAmount: 1000, currencyCode: "USD", exchangeRate: 1.7,
        sortOrder: 0, notes: null,
        account: { code: "601", name: "Wages", nameEn: "Wages", accountType: "expense" },
      },
      {
        id: "L2", category: "Sales", department: null, lineType: "revenue",
        plannedAmount: 5000, currencyCode: "AZN", exchangeRate: 1,
        sortOrder: 0, notes: null,
        account: { code: "501", name: "Sales", nameEn: "Sales", accountType: "revenue" },
      },
    ])
    const res = await GET(makeRequest("/api/indicators/values/iv1/drilldown"), makeParams("iv1"))
    expect(res.status).toBe(200)
    const body = await res.json()
    const expense = body.lines.find((l: { id: string }) => l.id === "L1")
    expect(expense.amountBase).toBeCloseTo(1700, 4) // 1000 * 1.7
    expect(body.summary.expense.total).toBeCloseTo(1700, 4)
    expect(body.summary.revenue.total).toBe(5000)
    expect(body.resolved).toMatchObject({ opex: 4_300_000 })
    expect(body.truncated).toBe(false)
  })

  it("truncates when 500-row cap reached", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.indicatorValue.findFirst.mockResolvedValue({
      id: "iv1", value: 0, status: "green", period: "2026-Q1",
      inputs: {}, companyId: "c1", indicator: {}, company: {},
    })
    // Mock returns exactly 500 rows
    const rows = Array.from({ length: 500 }, (_, i) => ({
      id: `L${i}`, category: `cat${i}`, department: null, lineType: "expense",
      plannedAmount: 1, currencyCode: "AZN", exchangeRate: 1, sortOrder: 0, notes: null,
      account: null,
    }))
    prismaMock.budgetLine.findMany.mockResolvedValue(rows)
    const res = await GET(makeRequest("/api/indicators/values/iv1/drilldown"), makeParams("iv1"))
    const body = await res.json()
    expect(body.truncated).toBe(true)
  })
})
