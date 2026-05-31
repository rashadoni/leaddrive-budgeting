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
      create: vi.fn(),
      createMany: vi.fn(),
    },
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
