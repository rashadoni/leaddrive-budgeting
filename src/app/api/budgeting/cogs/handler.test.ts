// @vitest-environment node
/**
 * Phase 7.G Turn LXVIII — handler tests for `/api/budgeting/cogs` POST.
 *
 * Locks Phase 4.2 period-lock gate on the cogs mutation route. Bulk array
 * + single-object both supported by the route; period gate applies to BOTH.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    cOGSBudgetLine: {
      findMany: vi.fn(),
      upsert: vi.fn(),
      create: vi.fn(),
    },
    costComponent: { findMany: vi.fn() },
    cOGSCostDetail: { findMany: vi.fn() },
    budgetLine: { findMany: vi.fn() },
    budgetPlan: { findMany: vi.fn(), findFirst: vi.fn() },
    organization: { findUnique: vi.fn() },
    // Phase 8 D3 final — accountId is a required CoA FK since Phase 2.1, so
    // the route resolves it via chartOfAccount.findUnique before writing.
    chartOfAccount: { findUnique: vi.fn() },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET, POST } from "./route"

const ORG_ID = "org_demo"
const validBody = {
  planId: "p1",
  productLineId: "pl1",
  year: 2026,
  month: 1,
  productionQty: 100,
  totalCost: 5000,
  // SAP-style code so resolveAccountId() maps it to a CoA row (the FK is
  // required since Phase 2.1; unmatched codes now 400).
  accountCode: "601-01-02",
}

beforeEach(() => {
  prismaMock.cOGSBudgetLine.findMany.mockReset().mockResolvedValue([])
  prismaMock.cOGSBudgetLine.upsert.mockReset().mockResolvedValue({ id: "c1" })
  prismaMock.cOGSBudgetLine.create.mockReset().mockResolvedValue({ id: "c1" })
  prismaMock.costComponent.findMany.mockReset().mockResolvedValue([])
  prismaMock.cOGSCostDetail.findMany.mockReset().mockResolvedValue([])
  prismaMock.budgetLine.findMany.mockReset().mockResolvedValue([])
  prismaMock.budgetPlan.findMany.mockReset().mockResolvedValue([
    { id: "p1", periodType: "annual", year: 2026, month: null, quarter: null },
  ])
  prismaMock.budgetPlan.findFirst.mockReset().mockResolvedValue({ id: "p1", year: 2026 })
  prismaMock.organization.findUnique.mockReset().mockResolvedValue({ lockedPeriods: [] })
  prismaMock.chartOfAccount.findUnique.mockReset().mockResolvedValue({ id: "acc1" })
})

describe("GET /api/budgeting/cogs", () => {
  it("returns 401 unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(makeRequest("/api/budgeting/cogs?planId=p1"))
    expect(res.status).toBe(401)
  })

  it("returns 400 when planId is missing", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await GET(makeRequest("/api/budgeting/cogs"))
    expect(res.status).toBe(400)
  })

  it("returns legacy COGS product rows when the dedicated table has data", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.cOGSBudgetLine.findMany.mockResolvedValue([
      {
        id: "cogs1",
        planId: "p1",
        month: 1,
        totalCost: 1500,
        productLine: { id: "product1", name: "Sugar", sortOrder: 1 },
      },
    ])

    const res = await GET(makeRequest("/api/budgeting/cogs?planId=p1"))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.source).toBeUndefined()
    expect(body.cogsLines).toHaveLength(1)
    expect(body.cogsLines[0]).toMatchObject({ id: "cogs1", month: 1, totalCost: 1500 })
    expect(prismaMock.budgetLine.findMany).not.toHaveBeenCalled()
  })

  it("falls back to BudgetLine COGS rows when the dedicated COGS table is empty", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.budgetLine.findMany.mockResolvedValue([
      {
        id: "bl1",
        department: "CPC",
        plannedAmount: -1250,
        quantity: null,
        monthIndex: 0,
        sortOrder: 0,
        account: { id: "acc701", code: "701-01", name: "Raw materials" },
      },
      {
        id: "bl2",
        department: "CPC",
        plannedAmount: -1750,
        quantity: null,
        monthIndex: 1,
        sortOrder: 1,
        account: { id: "acc701", code: "701-01", name: "Raw materials" },
      },
    ])

    const res = await GET(makeRequest("/api/budgeting/cogs?planId=p1"))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.source).toBe("budget_lines")
    expect(body.cogsLines).toMatchObject([
      {
        month: 1,
        totalCost: 1250,
        productLine: { name: "Raw materials" },
      },
      {
        month: 2,
        totalCost: 1750,
        productLine: { name: "Raw materials" },
      },
    ])
    expect(prismaMock.budgetLine.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: ORG_ID, planId: "p1", lineType: "cogs", deletedAt: null },
      }),
    )
  })

  it("compare=1 returns budget and actual COGS product rows for the same year", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.budgetPlan.findFirst
      .mockResolvedValueOnce({ id: "budget-2026", name: "Budget", year: 2026, kind: "budget" })
      .mockResolvedValueOnce({ id: "actual-2026", name: "Actuals", year: 2026, kind: "actual" })
    prismaMock.cOGSBudgetLine.findMany
      .mockResolvedValueOnce([
        { id: "b1", planId: "budget-2026", productLineId: "p1", year: 2026, month: 1, productionQty: 100, totalCost: 800, productLine: { id: "p1", name: "Glucose" } },
      ])
      .mockResolvedValueOnce([
        { id: "a1", planId: "actual-2026", productLineId: "p1", year: 2026, month: 1, productionQty: 110, totalCost: 990, productLine: { id: "p1", name: "Glucose" } },
      ])

    const res = await GET(makeRequest("/api/budgeting/cogs?planId=budget-2026&compare=1"))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.meta.activePlan.kind).toBe("budget")
    expect(body.meta.comparisonPlan.kind).toBe("actual")
    expect(body.comparison.budgetLines).toHaveLength(1)
    expect(body.comparison.actualLines).toHaveLength(1)
    expect(body.comparison.missingData).toEqual([])
  })
})

describe("POST /api/budgeting/cogs — period lock (Turn LXVIII)", () => {
  it("returns 401 unauth", async () => {
    await mockSession(null)
    const res = await POST(makeRequest("/api/budgeting/cogs", { method: "POST", json: validBody }))
    expect(res.status).toBe(401)
    expect(prismaMock.cOGSBudgetLine.create).not.toHaveBeenCalled()
    expect(prismaMock.cOGSBudgetLine.upsert).not.toHaveBeenCalled()
  })

  it("returns 423 Locked for single-object body when plan period is locked", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.organization.findUnique.mockResolvedValue({
      lockedPeriods: [
        { period: "2026", lockedAt: "2027-01-01T00:00:00Z", lockedBy: "u_admin", reason: "FY26 close" },
      ],
    })
    const res = await POST(makeRequest("/api/budgeting/cogs", { method: "POST", json: validBody }))
    expect(res.status).toBe(423)
    expect(prismaMock.cOGSBudgetLine.create).not.toHaveBeenCalled()
  })

  it("returns 423 Locked for bulk array when ANY plan period is locked", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.budgetPlan.findMany.mockResolvedValue([
      { id: "p1", periodType: "monthly", year: 2026, month: 1, quarter: null },
      { id: "p2", periodType: "monthly", year: 2026, month: 2, quarter: null },
    ])
    prismaMock.organization.findUnique.mockResolvedValue({
      lockedPeriods: [
        { period: "2026-02", lockedAt: "2026-03-01T00:00:00Z", lockedBy: "u_admin" },
      ],
    })
    const res = await POST(
      makeRequest("/api/budgeting/cogs", {
        method: "POST",
        json: [
          { ...validBody, planId: "p1" },
          { ...validBody, planId: "p2", month: 2 },
        ],
      }),
    )
    expect(res.status).toBe(423)
    expect(prismaMock.cOGSBudgetLine.upsert).not.toHaveBeenCalled()
  })

  it("returns 404 when planId references a plan not in caller's org", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.budgetPlan.findMany.mockResolvedValue([]) // plan absent
    const res = await POST(makeRequest("/api/budgeting/cogs", { method: "POST", json: validBody }))
    expect(res.status).toBe(404)
    expect(prismaMock.cOGSBudgetLine.create).not.toHaveBeenCalled()
  })

  it("returns 201 happy path when no plan period is locked", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await POST(makeRequest("/api/budgeting/cogs", { method: "POST", json: validBody }))
    expect(res.status).toBe(201)
    expect(prismaMock.cOGSBudgetLine.create).toHaveBeenCalledTimes(1)
  })
})
