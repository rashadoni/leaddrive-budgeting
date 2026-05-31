// @vitest-environment node
/**
 * Phase 7.G Turn LXVIII follow-up — handler tests for `/api/budgeting/cash-flow` POST.
 *
 * Locks Phase 4.2 period-lock gate. cash-flow direct entries have explicit
 * year+month input (no plan reference) — so we check ALL three containing-
 * period granularities (year + that month's quarter + month) and reject if
 * any matches. This differs from plan-derived routes which check ONE key.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    cashFlowEntry: { create: vi.fn() },
    organization: { findUnique: vi.fn() },
    // Phase 5.2 Stage 2 — withOrgScope wraps cash_flow_entries reads/writes.
    $transaction: vi.fn(
      async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock),
    ),
    $executeRawUnsafe: vi.fn(async () => 1),
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

import { mockSession, makeRequest } from "@/test/api-harness"
import { POST } from "./route"

// Phase 5.2 — withOrgScope validates 20-32 char cuid-shaped orgId.
const ORG_ID = "cm3rlscashflow000001abc"
// accountId is REQUIRED (2026-05-31 — CashFlowEntry.accountId is NOT NULL).
const validBody = { year: 2026, month: 1, entryType: "inflow" as const, amount: 1000, accountId: "acct_coa_1000" }

beforeEach(() => {
  prismaMock.cashFlowEntry.create.mockReset().mockResolvedValue({ id: "cf1" })
  prismaMock.organization.findUnique.mockReset().mockResolvedValue({ lockedPeriods: [] })
})

describe("POST /api/budgeting/cash-flow — period lock (Turn LXVIII follow-up)", () => {
  it("returns 401 unauth", async () => {
    await mockSession(null)
    const res = await POST(makeRequest("/api/budgeting/cash-flow", { method: "POST", json: validBody }))
    expect(res.status).toBe(401)
    expect(prismaMock.cashFlowEntry.create).not.toHaveBeenCalled()
  })

  it("returns 423 when YEAR is locked (e.g. '2026' blocks any month entry)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.organization.findUnique.mockResolvedValue({
      lockedPeriods: [{ period: "2026", lockedAt: "x", lockedBy: "y", reason: "FY26" }],
    })
    const res = await POST(
      makeRequest("/api/budgeting/cash-flow", { method: "POST", json: { ...validBody, month: 7 } }),
    )
    expect(res.status).toBe(423)
    const body = await res.json()
    expect(body.lock.period).toBe("2026")
    expect(prismaMock.cashFlowEntry.create).not.toHaveBeenCalled()
  })

  it("returns 423 when QUARTER is locked (e.g. '2026-Q1' blocks Jan/Feb/Mar entries)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.organization.findUnique.mockResolvedValue({
      lockedPeriods: [{ period: "2026-Q1", lockedAt: "x", lockedBy: "y" }],
    })
    const res = await POST(
      makeRequest("/api/budgeting/cash-flow", { method: "POST", json: { ...validBody, month: 2 } }),
    )
    expect(res.status).toBe(423)
    expect(prismaMock.cashFlowEntry.create).not.toHaveBeenCalled()
  })

  it("returns 423 when EXACT MONTH is locked", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.organization.findUnique.mockResolvedValue({
      lockedPeriods: [{ period: "2026-01", lockedAt: "x", lockedBy: "y" }],
    })
    const res = await POST(makeRequest("/api/budgeting/cash-flow", { method: "POST", json: validBody }))
    expect(res.status).toBe(423)
    expect(prismaMock.cashFlowEntry.create).not.toHaveBeenCalled()
  })

  it("does NOT lock entry when a DIFFERENT quarter is locked (Q1 entry, Q2 lock)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    prismaMock.organization.findUnique.mockResolvedValue({
      lockedPeriods: [{ period: "2026-Q2", lockedAt: "x", lockedBy: "y" }],
    })
    const res = await POST(makeRequest("/api/budgeting/cash-flow", { method: "POST", json: validBody }))
    expect(res.status).toBe(201) // Jan entry, Q2 lock — no overlap
    expect(prismaMock.cashFlowEntry.create).toHaveBeenCalledTimes(1)
  })

  it("returns 201 happy path when no lock matches the entry's month/quarter/year", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await POST(makeRequest("/api/budgeting/cash-flow", { method: "POST", json: validBody }))
    expect(res.status).toBe(201)
    expect(prismaMock.cashFlowEntry.create).toHaveBeenCalledTimes(1)
  })

  it("returns 400 when accountId is missing (now required — CashFlowEntry.accountId NOT NULL)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const { accountId: _omit, ...noAccount } = validBody
    const res = await POST(makeRequest("/api/budgeting/cash-flow", { method: "POST", json: noAccount }))
    expect(res.status).toBe(400)
    expect(prismaMock.cashFlowEntry.create).not.toHaveBeenCalled()
  })
})
