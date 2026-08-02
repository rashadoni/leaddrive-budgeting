// @vitest-environment node
/**
 * Handler test for `/api/budgeting/balance-sheet` (GET + POST).
 *
 * GET: org-scoped read, returns {assets, liabilities, equity, all}.
 * POST: period-lock gate, single + array bulk variants, cross-tenant
 * plan guard.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    balanceSheetLine: {
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
    },
    company: { findMany: vi.fn() },
    budgetPlan: { findFirst: vi.fn() },
    organization: { findFirst: vi.fn(), findUnique: vi.fn() },
    auditEvent: { create: vi.fn() },
    // Phase 5.2 Stage 2 — withOrgScope wraps balance_sheet_lines + budget_plans reads/writes.
    $transaction: vi.fn(
      async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock),
    ),
    $executeRawUnsafe: vi.fn(async () => 1),
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET, POST } from "./route"

// Phase 5.2 — withOrgScope validates 20-32 char cuid-shaped orgId.
const ORG_ID = "cm3rlsbalancesht000001a"

beforeEach(() => {
  prismaMock.balanceSheetLine.findMany.mockReset().mockResolvedValue([])
  prismaMock.balanceSheetLine.count.mockReset().mockResolvedValue(0)
  prismaMock.company.findMany.mockReset().mockResolvedValue([])
  prismaMock.balanceSheetLine.create.mockReset().mockResolvedValue({ id: "bs1" })
  prismaMock.balanceSheetLine.createMany.mockReset().mockResolvedValue({ count: 3 })
  prismaMock.budgetPlan.findFirst.mockReset().mockResolvedValue({
    id: "p1",
    periodType: "annual",
    year: 2026,
    month: null,
    quarter: null,
  })
  prismaMock.organization.findFirst.mockReset().mockResolvedValue({ settings: null })
  prismaMock.organization.findUnique.mockReset().mockResolvedValue({ lockedPeriods: [] })
  prismaMock.auditEvent.create.mockReset().mockResolvedValue({ id: "a1" })
})

describe("GET /api/budgeting/balance-sheet", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(makeRequest("/api/budgeting/balance-sheet?planId=p1"))
    expect(res.status).toBe(401)
  })

  it("400 when planId missing", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await GET(makeRequest("/api/budgeting/balance-sheet"))
    expect(res.status).toBe(400)
  })

  it("groups lines by lineType (assets / liabilities / equity)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.balanceSheetLine.findMany.mockResolvedValue([
      { id: "1", lineType: "asset", accountCode: "1010", month: 1 },
      { id: "2", lineType: "liability", accountCode: "2010", month: 1 },
      { id: "3", lineType: "equity", accountCode: "3010", month: 1 },
      { id: "4", lineType: "asset", accountCode: "1020", month: 1 },
    ])
    const res = await GET(makeRequest("/api/budgeting/balance-sheet?planId=p1"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.assets).toHaveLength(2)
    expect(body.liabilities).toHaveLength(1)
    expect(body.equity).toHaveLength(1)
    expect(body.all).toHaveLength(4)
  })

  it("query is org-scoped AND excludes soft-deleted rows (deletedAt:null)", async () => {
    // Regression (2026-05-31): BalanceSheetLine uses soft-delete-then-insert
    // on re-import. The GET must filter deletedAt:null or it sums archived
    // rows alongside live ones — measured ×1.92 Total-Assets inflation on
    // the live AZSEKER 2026 Budget plan before this filter was added.
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    await GET(makeRequest("/api/budgeting/balance-sheet?planId=p1"))
    expect(prismaMock.balanceSheetLine.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: ORG_ID, planId: "p1", deletedAt: null },
      }),
    )
  })

  it("budget plan falls back to the matching-year actuals plan for BS reads", async () => {
    // The fix (2026-06-04): budget plans are P&L-only (no balance sheet) — the
    // balance sheet must come from the same-year actuals plan, not the empty
    // budget plan. 1st findFirst = active (budget) plan; 2nd = actuals lookup.
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.budgetPlan.findFirst
      .mockResolvedValueOnce({ id: "budget-2026", year: 2026, kind: "budget" })
      .mockResolvedValueOnce({ id: "actuals-2026", kind: "actual" })
    prismaMock.balanceSheetLine.findMany.mockResolvedValue([
      { id: "1", lineType: "asset", month: 1 },
    ])
    const res = await GET(
      makeRequest("/api/budgeting/balance-sheet?planId=budget-2026"),
    )
    expect(res.status).toBe(200)
    // BS rows read from the ACTUALS plan, not the empty budget plan.
    expect(prismaMock.balanceSheetLine.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: ORG_ID, planId: "actuals-2026", deletedAt: null },
      }),
    )
    const body = await res.json()
    expect(body.meta.fellBack).toBe(true)
    expect(body.meta.sourcePlanId).toBe("actuals-2026")
    expect(body.meta.requestedPlanId).toBe("budget-2026")
  })

  it("actual plan reads itself — no fallback lookup", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.budgetPlan.findFirst.mockResolvedValueOnce({
      id: "actuals-2025",
      year: 2025,
      kind: "actual",
    })
    prismaMock.balanceSheetLine.findMany.mockResolvedValue([])
    const res = await GET(
      makeRequest("/api/budgeting/balance-sheet?planId=actuals-2025"),
    )
    expect(res.status).toBe(200)
    expect(prismaMock.balanceSheetLine.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: ORG_ID, planId: "actuals-2025", deletedAt: null },
      }),
    )
    const body = await res.json()
    expect(body.meta.fellBack).toBe(false)
  })

  it("consolidated holding view: single level-1 holding with BS lines → shows ONLY the holding's lines (not the cross-company sum)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.company.findMany.mockResolvedValue([
      { id: "holding1", name: "Holding", code: "AZSEKER", baseCurrencyCode: "AZN" },
    ])
    prismaMock.balanceSheetLine.count.mockResolvedValue(24) // holding carries its consolidated BS
    prismaMock.balanceSheetLine.findMany.mockResolvedValue([
      { id: "1", lineType: "asset", month: 4 },
    ])
    const res = await GET(makeRequest("/api/budgeting/balance-sheet?planId=p1"))
    expect(res.status).toBe(200)
    expect(prismaMock.balanceSheetLine.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: ORG_ID,
          planId: "p1",
          deletedAt: null,
          companyId: "holding1",
          // 14.8 — the holding's own consolidated sheet already contains the
          // client's eliminations. Adding the standalone EJE rows on top would
          // apply them twice.
          isElimination: false,
        },
      }),
    )
    const body = await res.json()
    expect(body.meta.consolidated).toBe(true)
    expect(body.meta.viewCompanyId).toBe("holding1")
    expect(body.meta.currencyCode).toBe("AZN")
  })

  it("?companyId drills into one entity's standalone BS (consolidated=false)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.company.findMany.mockResolvedValue([
      { id: "holding1", name: "Holding", code: "AZSEKER" },
    ])
    prismaMock.balanceSheetLine.count.mockResolvedValue(24)
    const res = await GET(
      makeRequest("/api/budgeting/balance-sheet?planId=p1&companyId=child9"),
    )
    expect(res.status).toBe(200)
    expect(prismaMock.balanceSheetLine.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: ORG_ID,
          planId: "p1",
          deletedAt: null,
          companyId: "child9",
          // 14.8 — an elimination cancels balances BETWEEN group members and
          // is nobody's standalone position. A drill-down that included them
          // would show one company carrying the whole group's intercompany
          // reversal.
          isElimination: false,
        },
      }),
    )
    const body = await res.json()
    expect(body.meta.consolidated).toBe(false)
    expect(body.meta.viewCompanyId).toBe("child9")
  })

  it("no unique holding (≠1 level-1 company) → unchanged cross-company behavior", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.company.findMany.mockResolvedValue([
      { id: "a", name: "A", code: "A" },
      { id: "b", name: "B", code: "B" },
    ])
    await GET(makeRequest("/api/budgeting/balance-sheet?planId=p1"))
    expect(prismaMock.balanceSheetLine.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: ORG_ID, planId: "p1", deletedAt: null },
      }),
    )
  })

  /**
   * Defect 3 (2026-08-01). The consolidated-holding branch fires only when the
   * level-1 holding carries BS rows of its OWN. AZSEKER carries none — the
   * client's workbook has per-entity `BS Actual 2025`/`BS Actual 2026` sheets
   * and no consolidated `BS` tab at all — so `companyFilter` stayed `{}` and
   * four legal entities were added together with nothing said about it:
   * 373,152,064 of "Total assets" at 2026-05 against a consolidated
   * 249,951,210, i.e. 123,200,854 of intercompany balances counted twice.
   */
  describe("un-eliminated cross-entity sums are declared, never silent", () => {
    const entityRows = [
      { id: "1", lineType: "asset", month: 5, amount: 134234695.76, companyId: "azsf" },
      { id: "2", lineType: "asset", month: 5, amount: 177351644.55, companyId: "eden" },
      { id: "3", lineType: "asset", month: 5, amount: 25184079.11, companyId: "cpc" },
      { id: "4", lineType: "asset", month: 5, amount: 36381644.76, companyId: "promalt" },
    ]

    it("holding present but carrying NO consolidated BS → sum_of_entities, eliminationsApplied false", async () => {
      await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
      prismaMock.company.findMany
        // 1st call: the level-1 holding lookup.
        .mockResolvedValueOnce([
          { id: "holding1", name: "AZSEKER", code: "AZSEKER", baseCurrencyCode: "AZN" },
        ])
        // 2nd call: names of the contributing entities.
        .mockResolvedValueOnce([
          { name: "AZSF" },
          { name: "CPC" },
          { name: "EDEN" },
          { name: "ProMalt" },
        ])
      prismaMock.balanceSheetLine.count.mockResolvedValue(0) // the holding has none
      prismaMock.balanceSheetLine.findMany.mockResolvedValue(entityRows)

      const res = await GET(makeRequest("/api/budgeting/balance-sheet?planId=p1"))
      expect(res.status).toBe(200)
      const body = await res.json()

      expect(body.meta.basis).toBe("sum_of_entities")
      expect(body.meta.entityCount).toBe(4)
      expect(body.meta.eliminationsApplied).toBe(false)
      expect(body.meta.consolidated).toBe(false)
      // The actionable half: there IS a holding, it just has no consolidated BS.
      expect(body.meta.holdingHasConsolidatedBs).toBe(false)
      expect(body.meta.entityNames).toEqual(["AZSF", "CPC", "EDEN", "ProMalt"])
      // The rows themselves are unchanged — the sum is qualified, not falsified.
      expect(body.assets).toHaveLength(4)
    })

    it("no unique holding at all → still declared as a 4-entity sum, not a bare total", async () => {
      await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
      prismaMock.company.findMany
        .mockResolvedValueOnce([
          { id: "a", name: "A", code: "A" },
          { id: "b", name: "B", code: "B" },
        ])
        .mockResolvedValueOnce([
          { name: "AZSF" },
          { name: "CPC" },
          { name: "EDEN" },
          { name: "ProMalt" },
        ])
      prismaMock.balanceSheetLine.findMany.mockResolvedValue(entityRows)

      const res = await GET(makeRequest("/api/budgeting/balance-sheet?planId=p1"))
      const body = await res.json()

      expect(body.meta.basis).toBe("sum_of_entities")
      expect(body.meta.eliminationsApplied).toBe(false)
      // Not applicable: there is no unique holding to be missing a BS.
      expect(body.meta.holdingHasConsolidatedBs).toBeNull()
    })

    it("the holding's own consolidated rows are declared consolidated_holding", async () => {
      await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
      prismaMock.company.findMany.mockResolvedValue([
        { id: "holding1", name: "AZSEKER", code: "AZSEKER", baseCurrencyCode: "AZN" },
      ])
      prismaMock.balanceSheetLine.count.mockResolvedValue(24)
      prismaMock.balanceSheetLine.findMany.mockResolvedValue([
        { id: "1", lineType: "asset", month: 4, amount: 253320381, companyId: "holding1" },
      ])

      const res = await GET(makeRequest("/api/budgeting/balance-sheet?planId=p1"))
      const body = await res.json()

      expect(body.meta.basis).toBe("consolidated_holding")
      expect(body.meta.eliminationsApplied).toBe(true)
      expect(body.meta.holdingHasConsolidatedBs).toBe(true)
      // No second company lookup — the consolidated view names no contributors.
      expect(body.meta.entityNames).toEqual([])
    })

    it("?companyId drill-down is single_entity, not a sum", async () => {
      await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
      prismaMock.company.findMany.mockResolvedValue([
        { id: "holding1", name: "AZSEKER", code: "AZSEKER" },
      ])
      prismaMock.balanceSheetLine.findMany.mockResolvedValue([
        { id: "1", lineType: "asset", month: 5, amount: 134234695.76, companyId: "azsf" },
        { id: "2", lineType: "equity", month: 5, amount: -131427632.96, companyId: "azsf" },
      ])

      const res = await GET(
        makeRequest("/api/budgeting/balance-sheet?planId=p1&companyId=azsf"),
      )
      const body = await res.json()

      expect(body.meta.basis).toBe("single_entity")
      expect(body.meta.entityCount).toBe(1)
      expect(body.meta.eliminationsApplied).toBe(true)
    })
  })
})

describe("POST /api/budgeting/balance-sheet", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await POST(
      makeRequest("/api/budgeting/balance-sheet", {
        method: "POST",
        json: { planId: "p1", accountCode: "1010", lineType: "asset" },
      }),
    )
    expect(res.status).toBe(401)
  })

  it("400 missing planId in body", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/balance-sheet", {
        method: "POST",
        json: { accountCode: "1010", lineType: "asset" },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("400 array with mismatched planIds", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/balance-sheet", {
        method: "POST",
        json: [
          { planId: "p1", accountCode: "1010", lineType: "asset" },
          { planId: "p2", accountCode: "1020", lineType: "asset" },
        ],
      }),
    )
    expect(res.status).toBe(400)
  })

  it("404 cross-tenant plan id (plan not found in user's org)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    prismaMock.budgetPlan.findFirst.mockResolvedValue(null)
    const res = await POST(
      makeRequest("/api/budgeting/balance-sheet", {
        method: "POST",
        json: { planId: "p-other-org", accountCode: "1010", lineType: "asset" },
      }),
    )
    expect(res.status).toBe(404)
  })

  it("201 single line happy path", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/balance-sheet", {
        method: "POST",
        json: { planId: "p1", accountCode: "1010", lineType: "asset", month: 1 },
      }),
    )
    expect(res.status).toBe(201)
    expect(prismaMock.balanceSheetLine.create).toHaveBeenCalled()
  })

  it("201 array createMany happy path", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/balance-sheet", {
        method: "POST",
        json: [
          { planId: "p1", accountCode: "1010", lineType: "asset", month: 1 },
          { planId: "p1", accountCode: "1020", lineType: "asset", month: 1 },
        ],
      }),
    )
    expect(res.status).toBe(201)
    expect(prismaMock.balanceSheetLine.createMany).toHaveBeenCalled()
  })
})
