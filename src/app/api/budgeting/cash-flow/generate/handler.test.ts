// @vitest-environment node
/**
 * Phase 7.G Turn LXIII — handler tests for `/api/budgeting/cash-flow/generate`.
 *
 * Closes Turn-LXII Tier 2 H1 (top-3 untested critical handlers). Smoke-level:
 * auth gate + JSON parse + Zod gates + happy-path empty-data short-circuit.
 * Full cash-flow generation correctness needs fixtures + golden-output
 * (Tier 3 territory).
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    cashFlowEntry: {
      deleteMany: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    cashFlowAlert: {
      deleteMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    budgetPlan: { findMany: vi.fn() },
    budgetLine: { findMany: vi.fn() },
    organization: { findUnique: vi.fn() },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

import { mockSession, makeRequest } from "@/test/api-harness"
import { POST } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  prismaMock.cashFlowEntry.deleteMany.mockReset().mockResolvedValue({ count: 0 })
  prismaMock.cashFlowEntry.findMany.mockReset().mockResolvedValue([])
  prismaMock.cashFlowEntry.findFirst.mockReset().mockResolvedValue(null)
  prismaMock.cashFlowEntry.create.mockReset()
  prismaMock.cashFlowAlert.deleteMany.mockReset().mockResolvedValue({ count: 0 })
  prismaMock.cashFlowAlert.findFirst.mockReset().mockResolvedValue(null)
  prismaMock.cashFlowAlert.create.mockReset()
  prismaMock.budgetPlan.findMany.mockReset().mockResolvedValue([])
  prismaMock.budgetLine.findMany.mockReset().mockResolvedValue([])
  prismaMock.organization.findUnique.mockReset().mockResolvedValue({ lockedPeriods: [] })
})

describe("POST /api/budgeting/cash-flow/generate — gates", () => {
  it("returns 401 unauth", async () => {
    await mockSession(null)
    const res = await POST(
      makeRequest("/api/budgeting/cash-flow/generate", {
        method: "POST",
        json: { year: 2025 },
      }),
    )
    expect(res.status).toBe(401)
    expect(prismaMock.cashFlowEntry.deleteMany).not.toHaveBeenCalled()
  })

  it("returns 400 on Zod — missing year", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await POST(
      makeRequest("/api/budgeting/cash-flow/generate", {
        method: "POST",
        json: {},
      }),
    )
    expect(res.status).toBe(400)
  })

  it("returns 400 on Zod — year out of range", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await POST(
      makeRequest("/api/budgeting/cash-flow/generate", {
        method: "POST",
        json: { year: 1900 },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("returns 400 on Zod .strict() — unknown key", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await POST(
      makeRequest("/api/budgeting/cash-flow/generate", {
        method: "POST",
        json: { year: 2025, organizationId: "evil_org" },
      }),
    )
    expect(res.status).toBe(400)
  })
})

describe("POST /api/budgeting/cash-flow/generate — happy path", () => {
  it("returns 200 + clears old entries scoped by org+year+source", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await POST(
      makeRequest("/api/budgeting/cash-flow/generate", {
        method: "POST",
        json: { year: 2025 },
      }),
    )
    expect(res.status).toBe(200)
    // Org-scoped delete
    const delArg = prismaMock.cashFlowEntry.deleteMany.mock.calls[0][0]
    expect(delArg.where.organizationId).toBe(ORG_ID)
    expect(delArg.where.year).toBe(2025)
    expect(delArg.where.source).toBe("budget_line")
    // Empty plans → no creates fire
    expect(prismaMock.cashFlowEntry.create).not.toHaveBeenCalled()
  })

  it("returns 200 with `created` count when no plans exist", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await POST(
      makeRequest("/api/budgeting/cash-flow/generate", {
        method: "POST",
        json: { year: 2025 },
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.success).toBe(true)
    expect(body.entriesCreated).toBe(0)
    expect(body.year).toBe(2025)
    // Plan query filtered by org + year + non-rolling
    const planArg = prismaMock.budgetPlan.findMany.mock.calls[0][0]
    expect(planArg.where.organizationId).toBe(ORG_ID)
    expect(planArg.where.year).toBe(2025)
    expect(planArg.where.isRolling).toBe(false)
  })

  it("skips months that already carry actual CF (forecast fills only the gaps)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.budgetPlan.findMany.mockResolvedValue([
      { id: "p1", organizationId: ORG_ID, year: 2025, periodType: "annual", month: null, quarter: null, isRolling: false },
    ])
    prismaMock.budgetLine.findMany.mockResolvedValue([
      { id: "bl1", plannedAmount: 1200, lineType: "revenue", accountId: "acc1", companyId: "co1", account: { code: "X", name: "X" } },
    ])
    // co1 has actual CF for months 1-3. The actualKeys fetch is the FIRST
    // cashFlowEntry.findMany; subsequent calls (alerts) keep the default [].
    prismaMock.cashFlowEntry.findMany.mockResolvedValueOnce([
      { companyId: "co1", month: 1 },
      { companyId: "co1", month: 2 },
      { companyId: "co1", month: 3 },
    ])
    const res = await POST(
      makeRequest("/api/budgeting/cash-flow/generate", { method: "POST", json: { year: 2025 } }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.entriesCreated).toBe(9) // 12 − 3 actual (co1) cells
    expect(body.skippedActualCells).toBe(3)
    const createdMonths = prismaMock.cashFlowEntry.create.mock.calls.map(
      (c) => (c[0] as { data: { month: number } }).data.month,
    )
    expect(createdMonths).not.toContain(1)
    expect(createdMonths).toContain(4)
    // companyId inherited from the budget line (per-company projected CF).
    expect(
      (prismaMock.cashFlowEntry.create.mock.calls[0][0] as { data: { companyId: string } }).data.companyId,
    ).toBe("co1")
  })
})

describe("POST /api/budgeting/cash-flow/generate — Phase 4.2 period lock (Turn LXVIII)", () => {
  it("returns 423 Locked when year-level lock is set + DOES NOT delete entries", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.organization.findUnique.mockResolvedValue({
      lockedPeriods: [
        { period: "2025", lockedAt: "2026-01-01T00:00:00Z", lockedBy: "u_admin", reason: "FY25 close" },
      ],
    })
    const res = await POST(
      makeRequest("/api/budgeting/cash-flow/generate", {
        method: "POST",
        json: { year: 2025 },
      }),
    )
    expect(res.status).toBe(423)
    const body = await res.json()
    expect(body.error).toMatch(/Period locked/i)
    expect(body.lock.period).toBe("2025")
    // Critical: 423 fires BEFORE deleteMany — destructive op MUST NOT leak
    expect(prismaMock.cashFlowEntry.deleteMany).not.toHaveBeenCalled()
  })

  it("returns 423 Locked when a plan's quarter within the year is locked", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.budgetPlan.findMany.mockResolvedValue([
      { id: "p1", periodType: "quarterly", year: 2025, month: null, quarter: 1, isRolling: false },
    ])
    prismaMock.organization.findUnique.mockResolvedValue({
      lockedPeriods: [
        { period: "2025-Q1", lockedAt: "2025-04-01T00:00:00Z", lockedBy: "u_admin" },
      ],
    })
    const res = await POST(
      makeRequest("/api/budgeting/cash-flow/generate", {
        method: "POST",
        json: { year: 2025 },
      }),
    )
    expect(res.status).toBe(423)
    expect(prismaMock.cashFlowEntry.deleteMany).not.toHaveBeenCalled()
  })
})
