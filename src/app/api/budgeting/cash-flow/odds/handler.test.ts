// @vitest-environment node
/**
 * Handler test for `/api/budgeting/cash-flow/odds` (GET).
 *
 * Cash Flow Statement (ODDS) by 3 activities: Operating / Investing
 * / Financing. Locks activity-type grouping, monthly breakdown, and
 * YoY compareYear math.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    cashFlowEntry: { findMany: vi.fn() },
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
  prismaMock.cashFlowEntry.findMany.mockReset().mockResolvedValue([])
})

describe("GET /api/budgeting/cash-flow/odds", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(makeRequest("/api/budgeting/cash-flow/odds?year=2026"))
    expect(res.status).toBe(401)
  })

  it("200 empty year — 3 sections + grand totals zero", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await GET(makeRequest("/api/budgeting/cash-flow/odds?year=2026"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.year).toBe(2026)
    expect(body.data.entryCount).toBe(0)
    expect(body.data.sections).toHaveLength(3)
    expect(body.data.sections.map((s: { activity: string }) => s.activity)).toEqual([
      "operating", "investing", "financing",
    ])
    expect(body.data.grandInflow).toBe(0)
    expect(body.data.grandOutflow).toBe(0)
    expect(body.data.grandNet).toBe(0)
  })

  it("groups by activityType and computes net = inflow - outflow", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.cashFlowEntry.findMany.mockResolvedValueOnce([
      { activityType: "operating", entryType: "inflow",  amount: 1000, month: 1, category: "Sales",  source: null },
      { activityType: "operating", entryType: "outflow", amount: 300,  month: 1, category: "Wages",  source: null },
      { activityType: "investing", entryType: "outflow", amount: 5000, month: 6, category: "CapEx",  source: null },
      { activityType: "financing", entryType: "inflow",  amount: 2000, month: 3, category: "Loan",   source: null },
    ])
    const res = await GET(makeRequest("/api/budgeting/cash-flow/odds?year=2026"))
    const body = await res.json()
    const op = body.data.sections.find((s: { activity: string }) => s.activity === "operating")
    expect(body.data.entryCount).toBe(4)
    expect(op.totalInflow).toBe(1000)
    expect(op.totalOutflow).toBe(300)
    expect(op.net).toBe(700)
    const inv = body.data.sections.find((s: { activity: string }) => s.activity === "investing")
    expect(inv.net).toBe(-5000)
    expect(body.data.grandNet).toBe(700 - 5000 + 2000)
  })

  it("computes YoY change when compareYear is provided", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.cashFlowEntry.findMany
      .mockResolvedValueOnce([
        { activityType: "operating", entryType: "inflow",  amount: 2000, month: 1, category: "Sales", source: null },
      ])
      .mockResolvedValueOnce([
        { activityType: "operating", entryType: "inflow",  amount: 1000, month: 1, category: "Sales", source: null },
      ])
    const res = await GET(makeRequest("/api/budgeting/cash-flow/odds?year=2026&compareYear=2025"))
    const body = await res.json()
    const op = body.data.sections.find((s: { activity: string }) => s.activity === "operating")
    expect(body.data.compareEntryCount).toBe(1)
    expect(op.compareNet).toBe(1000)
    expect(op.yoyChange).toBe(100) // 100% YoY growth
  })

  it("treats null activityType as 'operating' (legacy entries)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.cashFlowEntry.findMany.mockResolvedValueOnce([
      { activityType: null, entryType: "inflow", amount: 500, month: 1, category: "Legacy", source: null },
    ])
    const res = await GET(makeRequest("/api/budgeting/cash-flow/odds?year=2026"))
    const body = await res.json()
    const op = body.data.sections.find((s: { activity: string }) => s.activity === "operating")
    expect(op.totalInflow).toBe(500)
  })

  it("does not treat bridge-only evidence as a movement statement", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.cashFlowEntry.findMany.mockResolvedValueOnce([
      { activityType: null, entryType: "bridge", amount: 500, month: 12, source: "CF.05" },
    ])
    const res = await GET(makeRequest("/api/budgeting/cash-flow/odds?year=2026"))
    const body = await res.json()
    expect(body.data.entryCount).toBe(0)
    expect(body.data.grandInflow).toBe(0)
    expect(body.data.grandOutflow).toBe(0)
  })

  it("keeps an explicitly evidenced zero-value movement", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.cashFlowEntry.findMany.mockResolvedValueOnce([
      { activityType: "operating", entryType: "inflow", amount: 0, month: 1, category: "Zero receipt", source: null },
    ])
    const res = await GET(makeRequest("/api/budgeting/cash-flow/odds?year=2026"))
    const body = await res.json()
    expect(body.data.entryCount).toBe(1)
    expect(body.data.grandInflow).toBe(0)
    expect(body.data.grandNet).toBe(0)
  })

  it("org-scoped query filters by organizationId + year AND excludes soft-deleted (deletedAt:null)", async () => {
    // Regression (2026-05-31): the ODDS statement summed archived rows from
    // soft-delete-then-insert re-imports without this filter (same ×2 class
    // as the cash-flow overview GET).
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    await GET(makeRequest("/api/budgeting/cash-flow/odds?year=2026"))
    expect(prismaMock.cashFlowEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: ORG_ID, year: 2026, deletedAt: null },
      }),
    )
  })
})
