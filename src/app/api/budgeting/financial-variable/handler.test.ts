// @vitest-environment node
/**
 * Handler tests for `POST /api/budgeting/financial-variable` (manual entry of
 * a financial statement figure, e.g. period-end inventory).
 *
 * Locks the auth + validation + write envelope:
 * - Auth: requireRole(manager+) on writes
 * - Zod: variable from the curated registry; year/value bounded; companyId required
 * - Cross-tenant guard: company must belong to the caller's org
 * - 2-step confirm: soft-warn (e.g. 0 balance) returns requiresConfirm, no write
 * - Conforming write: the BalanceSheetLine create matches the resolver contract
 *   (lineType=asset, subType=current, month=12) on the year's actual plan
 *
 * The pure validation/bounds logic is covered directly in
 * `financial-variable-rules.test.ts`; this asserts the HTTP envelope + DB shape.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock, recomputeMock, lockMock } = vi.hoisted(() => ({
  prismaMock: {
    company: { findFirst: vi.fn() },
    budgetPlan: { findFirst: vi.fn(), create: vi.fn() },
    chartOfAccount: { upsert: vi.fn() },
    balanceSheetLine: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    user: { findFirst: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
  recomputeMock: vi.fn().mockResolvedValue({ ok: 1, unknown: 0, failed: 0 }),
  lockMock: vi.fn().mockResolvedValue(null),
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/audit/log", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/recompute/recompute-on-change", () => ({
  recomputeAfterDataChange: recomputeMock,
}))
vi.mock("@/lib/budgeting/period-lock", () => ({
  findFirstActiveLockInPeriods: lockMock,
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { POST } from "./route"

const ORG_ID = "org_demo"
const ROUTE = "/api/budgeting/financial-variable"

const validBody = (over: Record<string, unknown> = {}) => ({
  companyId: "c1",
  variable: "inventory",
  year: 2025,
  value: 1_200_000,
  ...over,
})

beforeEach(() => {
  prismaMock.company.findFirst.mockReset().mockResolvedValue({
    id: "c1",
    code: "AZSEKER-EDEN",
  })
  prismaMock.budgetPlan.findFirst.mockReset().mockResolvedValue({ id: "plan1" })
  prismaMock.budgetPlan.create.mockReset().mockResolvedValue({ id: "planNew" })
  prismaMock.chartOfAccount.upsert.mockReset().mockResolvedValue({ id: "acc1" })
  prismaMock.balanceSheetLine.findFirst.mockReset().mockResolvedValue(null)
  prismaMock.balanceSheetLine.findMany.mockReset().mockResolvedValue([])
  prismaMock.balanceSheetLine.create.mockReset().mockResolvedValue({
    id: "bs1",
    companyId: "c1",
    year: 2025,
    month: 12,
    amount: 1_200_000,
  })
  prismaMock.balanceSheetLine.update.mockReset().mockResolvedValue({
    id: "bs1",
    companyId: "c1",
    year: 2025,
    month: 12,
    amount: 2_000_000,
  })
  prismaMock.user.findFirst.mockReset().mockResolvedValue({ id: "u_admin", role: "admin" })
  prismaMock.auditEvent.create.mockReset().mockResolvedValue({ id: "a1" })
  recomputeMock.mockClear()
  lockMock.mockReset().mockResolvedValue(null)
})

describe("auth + validation envelope", () => {
  it("401 when unauthenticated", async () => {
    await mockSession(null)
    const res = await POST(makeRequest(ROUTE, { method: "POST", json: validBody() }))
    expect(res.status).toBe(401)
    expect(prismaMock.balanceSheetLine.create).not.toHaveBeenCalled()
  })

  it("403 when role is below manager (viewer cannot write)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await POST(makeRequest(ROUTE, { method: "POST", json: validBody() }))
    expect(res.status).toBe(403)
    expect(prismaMock.balanceSheetLine.create).not.toHaveBeenCalled()
  })

  it("400 on unknown variable (zod enum rejects)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await POST(
      makeRequest(ROUTE, { method: "POST", json: validBody({ variable: "made_up" }) }),
    )
    expect(res.status).toBe(400)
  })

  it("400 on missing companyId", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const body = validBody()
    delete (body as Record<string, unknown>).companyId
    const res = await POST(makeRequest(ROUTE, { method: "POST", json: body }))
    expect(res.status).toBe(400)
  })

  it("400 on non-finite value (zod number.finite)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await POST(
      makeRequest(ROUTE, { method: "POST", json: validBody({ value: "x" }) }),
    )
    expect(res.status).toBe(400)
  })

  it("404 when the company is not in the caller's org", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.company.findFirst.mockResolvedValue(null)
    const res = await POST(makeRequest(ROUTE, { method: "POST", json: validBody() }))
    expect(res.status).toBe(404)
    expect(prismaMock.balanceSheetLine.create).not.toHaveBeenCalled()
  })

  it("400 on a negative balance (hard min 0) — no write", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await POST(
      makeRequest(ROUTE, { method: "POST", json: validBody({ value: -5 }) }),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/validation/i)
    expect(prismaMock.balanceSheetLine.create).not.toHaveBeenCalled()
  })
})

describe("period-lock guard", () => {
  it("423 when the target year is locked — no write", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    lockMock.mockResolvedValue({
      id: "lock1",
      period: "2025",
      lockedBy: "u_cfo",
      lockedAt: new Date("2026-01-01"),
      reason: "year-end close",
    })
    const res = await POST(makeRequest(ROUTE, { method: "POST", json: validBody() }))
    expect(res.status).toBe(423)
    expect(prismaMock.balanceSheetLine.create).not.toHaveBeenCalled()
    expect(prismaMock.budgetPlan.create).not.toHaveBeenCalled()
  })

  it("checks the year + quarter + month containing-period keys", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    await POST(makeRequest(ROUTE, { method: "POST", json: validBody() }))
    const keys = lockMock.mock.calls[0][2]
    // year-end snapshot (month 12) → ["2025", "2025-Q4", "2025-12"]
    expect(keys).toEqual(expect.arrayContaining(["2025", "2025-Q4", "2025-12"]))
  })
})

describe("double-count guard", () => {
  it("requiresConfirm when inventory already exists under a different account — no write", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    // An imported inventory line under a DIFFERENT (AZ-named) account.
    prismaMock.balanceSheetLine.findMany.mockResolvedValue([
      { amount: 800_000, account: { code: "BSA.02.01", name: "Anbar ehtiyatları" } },
    ])
    const res = await POST(makeRequest(ROUTE, { method: "POST", json: validBody() }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.requiresConfirm).toBe(true)
    expect(body.warnings.join(" ")).toMatch(/double-count|already recorded/i)
    expect(prismaMock.balanceSheetLine.create).not.toHaveBeenCalled()
  })

  it("does NOT warn for a line under the route's own canonical account", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    // Same account the route writes to → edit-in-place, not a double-count.
    prismaMock.balanceSheetLine.findMany.mockResolvedValue([
      { amount: 800_000, account: { code: "BS.ASSET.INVENTORY", name: "Inventory" } },
    ])
    const res = await POST(makeRequest(ROUTE, { method: "POST", json: validBody() }))
    expect(res.status).toBe(201)
    expect(prismaMock.balanceSheetLine.create).toHaveBeenCalledTimes(1)
  })

  it("does NOT warn for a non-inventory current asset (e.g. receivables)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.balanceSheetLine.findMany.mockResolvedValue([
      { amount: 500_000, account: { code: "BSA.01.03", name: "Trade receivables" } },
    ])
    const res = await POST(makeRequest(ROUTE, { method: "POST", json: validBody() }))
    expect(res.status).toBe(201)
    expect(prismaMock.balanceSheetLine.create).toHaveBeenCalledTimes(1)
  })
})

describe("2-step confirm on soft warnings", () => {
  it("200 requiresConfirm on a 0 balance (will not unlock) — no write", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await POST(
      makeRequest(ROUTE, { method: "POST", json: validBody({ value: 0 }) }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.requiresConfirm).toBe(true)
    expect(Array.isArray(body.warnings)).toBe(true)
    expect(prismaMock.balanceSheetLine.create).not.toHaveBeenCalled()
  })

  it("writes when forceConfirm overrides the warning", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await POST(
      makeRequest(ROUTE, {
        method: "POST",
        json: validBody({ value: 0, forceConfirm: true }),
      }),
    )
    expect(res.status).toBe(201)
    expect(prismaMock.balanceSheetLine.create).toHaveBeenCalledTimes(1)
  })
})

describe("conforming write + recompute", () => {
  it("201 create writes a resolver-conforming balance-sheet line + unlocks", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await POST(makeRequest(ROUTE, { method: "POST", json: validBody() }))
    expect(res.status).toBe(201)

    expect(prismaMock.balanceSheetLine.create).toHaveBeenCalledTimes(1)
    const data = prismaMock.balanceSheetLine.create.mock.calls[0][0].data
    // resolver contract: current asset, year-end snapshot, on the actual plan
    expect(data).toMatchObject({
      organizationId: ORG_ID,
      companyId: "c1",
      planId: "plan1",
      accountId: "acc1",
      lineType: "asset",
      subType: "current",
      year: 2025,
      month: 12,
      amount: 1_200_000,
    })

    const body = await res.json()
    expect(body.unlocks).toContain("FP_INVENTORY_TURNS")
    expect(body.recompute).toMatchObject({ ok: 1 })
    // recompute fires for the entered company + year
    expect(recomputeMock).toHaveBeenCalledWith(ORG_ID, "c1", 2025)
  })

  it("200 update edits the existing line in place (no duplicate row)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.balanceSheetLine.findFirst.mockResolvedValue({
      id: "bs1",
      amount: 999,
    })
    const res = await POST(
      makeRequest(ROUTE, { method: "POST", json: validBody({ value: 2_000_000 }) }),
    )
    expect(res.status).toBe(200)
    expect(prismaMock.balanceSheetLine.update).toHaveBeenCalledTimes(1)
    expect(prismaMock.balanceSheetLine.create).not.toHaveBeenCalled()
  })

  it("creates the year's actual plan when none exists yet", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.budgetPlan.findFirst.mockResolvedValue(null)
    const res = await POST(makeRequest(ROUTE, { method: "POST", json: validBody() }))
    expect(res.status).toBe(201)
    expect(prismaMock.budgetPlan.create).toHaveBeenCalledTimes(1)
    const planData = prismaMock.budgetPlan.create.mock.calls[0][0].data
    expect(planData).toMatchObject({ organizationId: ORG_ID, year: 2025, kind: "actual" })
  })
})
