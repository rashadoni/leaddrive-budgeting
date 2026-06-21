// @vitest-environment node
/**
 * Handler tests for POST /api/admin/data-archive.
 *
 * Focus: the confirmCode safety gate, archive/restore pass-through, and the
 * Codex P2 #3 fix — a company-scoped CashFlow archive reports how many CF
 * rows for the year could NOT be company-attributed (null / non-"::" sourceId)
 * and were therefore left untouched.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock, archiveRowsMock, restoreRowsMock, resetMock, recomputeMock } = vi.hoisted(() => ({
  prismaMock: {
    cashFlowEntry: { count: vi.fn() },
    company: { findMany: vi.fn(), findFirst: vi.fn() },
    indicatorValue: { findMany: vi.fn() },
  },
  archiveRowsMock: vi.fn(),
  restoreRowsMock: vi.fn(),
  resetMock: vi.fn(),
  recomputeMock: vi.fn(),
}))

vi.mock("@/lib/api-auth", () => ({
  requireRole: vi.fn(),
  isAuthError: (r: unknown) => r instanceof Response,
}))
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(() => null),
  getClientIp: vi.fn(() => "1.2.3.4"),
}))
vi.mock("@/lib/log", () => ({ getLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }) }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/server/archive", () => ({
  archiveRows: archiveRowsMock,
  restoreRows: restoreRowsMock,
  resetCompanyImportData: resetMock,
}))
vi.mock("@/lib/risk/recompute-trigger", () => ({ runRecomputeForCompanies: recomputeMock }))

import { requireRole } from "@/lib/api-auth"
import { POST } from "./route"

const SESSION = { userId: "u1", orgId: "org1", role: "admin" as const }

function req(body: Record<string, unknown>) {
  return new Request("http://t/api/admin/data-archive", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as never
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(requireRole as ReturnType<typeof vi.fn>).mockResolvedValue(SESSION)
  archiveRowsMock.mockResolvedValue({ rowsAffected: 84, auditEventId: "a1" })
  restoreRowsMock.mockResolvedValue({ rowsAffected: 84, auditEventId: "a2" })
  prismaMock.cashFlowEntry.count.mockResolvedValue(0)
  resetMock.mockResolvedValue({
    rowsAffected: 100,
    breakdown: { budgetLines: 60, balanceSheetLines: 40 },
    auditEventId: "r1",
  })
  recomputeMock.mockResolvedValue({ ok: 3 })
  prismaMock.indicatorValue.findMany.mockResolvedValue([])
})

describe("POST /api/admin/data-archive", () => {
  it("400s when confirmCode does not match the scope", async () => {
    const res = await POST(req({ mode: "archive", entityKind: "CashFlowEntry", companyCode: "AZSEKER-AZSF", year: 2026, confirmCode: "WRONG" }))
    expect(res.status).toBe(400)
    expect(archiveRowsMock).not.toHaveBeenCalled()
  })

  it("archives CF for a company and reports unattributable (null/non-:: sourceId) rows", async () => {
    prismaMock.cashFlowEntry.count.mockResolvedValueOnce(5)
    const res = await POST(req({ mode: "archive", entityKind: "CashFlowEntry", companyCode: "AZSEKER-AZSF", year: 2026, confirmCode: "AZSEKER-AZSF" }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.rowsAffected).toBe(84)
    expect(body.unattributableCfRows).toBe(5)
    // the count query targets live rows for the year whose sourceId is null
    // OR lacks the "<code>::" prefix — assert the exact predicate, not just
    // its presence (Codex re-review note).
    const w = prismaMock.cashFlowEntry.count.mock.calls[0][0].where
    expect(w).toMatchObject({ organizationId: "org1", year: 2026, deletedAt: null })
    expect(w.OR).toEqual([{ sourceId: null }, { NOT: { sourceId: { contains: "::" } } }])
  })

  it("does NOT compute unattributable count for non-CF kinds", async () => {
    const res = await POST(req({ mode: "archive", entityKind: "BalanceSheetLine", companyCode: "AZSEKER-AZSF", year: 2026, confirmCode: "AZSEKER-AZSF" }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.unattributableCfRows).toBeUndefined()
    expect(prismaMock.cashFlowEntry.count).not.toHaveBeenCalled()
  })

  it("does NOT compute unattributable count on restore", async () => {
    const res = await POST(req({ mode: "restore", entityKind: "CashFlowEntry", companyCode: "AZSEKER-AZSF", year: 2026, confirmCode: "AZSEKER-AZSF" }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(restoreRowsMock).toHaveBeenCalled()
    expect(prismaMock.cashFlowEntry.count).not.toHaveBeenCalled()
  })
})

describe("POST /api/admin/data-archive — AllImportData multi-company reset", () => {
  it("resets several companies in one POST and aggregates results", async () => {
    prismaMock.company.findMany.mockResolvedValue([
      { id: "c1", code: "AZSEKER-CPC" },
      { id: "c2", code: "AZSEKER-EDEN" },
    ])
    const res = await POST(
      req({
        mode: "archive",
        entityKind: "AllImportData",
        companyCodes: ["AZSEKER-CPC", "AZSEKER-EDEN"],
        confirmCode: "ALL",
      }),
    )
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.mode).toBe("reset")
    expect(body.companiesReset).toBe(2)
    expect(body.rowsAffected).toBe(200) // 100 × 2
    expect(body.breakdown).toEqual({ budgetLines: 120, balanceSheetLines: 80 }) // summed
    expect(resetMock).toHaveBeenCalledTimes(2)
    // each reset is scoped to its OWN company (no cross-company bleed)
    expect(resetMock.mock.calls[0][0].scope.companyCode).toBe("AZSEKER-CPC")
    expect(resetMock.mock.calls[1][0].scope.companyCode).toBe("AZSEKER-EDEN")
  })

  it("400s on an unknown company code BEFORE any reset (no partial wipe on a typo)", async () => {
    prismaMock.company.findMany.mockResolvedValue([{ id: "c1", code: "AZSEKER-CPC" }]) // NOPE missing
    const res = await POST(
      req({
        mode: "archive",
        entityKind: "AllImportData",
        companyCodes: ["AZSEKER-CPC", "AZSEKER-NOPE"],
        confirmCode: "ALL",
      }),
    )
    expect(res.status).toBe(400)
    expect(resetMock).not.toHaveBeenCalled()
  })

  it("requires the literal ALL confirm for a bulk reset", async () => {
    const res = await POST(
      req({
        mode: "archive",
        entityKind: "AllImportData",
        companyCodes: ["AZSEKER-CPC"],
        confirmCode: "AZSEKER-CPC",
      }),
    )
    expect(res.status).toBe(400)
    expect(resetMock).not.toHaveBeenCalled()
  })

  it("rejects a reset in restore mode (a reset is not restorable)", async () => {
    prismaMock.company.findMany.mockResolvedValue([{ id: "c1", code: "AZSEKER-CPC" }])
    const res = await POST(
      req({
        mode: "restore",
        entityKind: "AllImportData",
        companyCodes: ["AZSEKER-CPC"],
        confirmCode: "ALL",
      }),
    )
    expect(res.status).toBe(400)
    expect(resetMock).not.toHaveBeenCalled()
  })

  it("does NOT let a single-company confirm unlock a bulk wipe (mixed companyCode + companyCodes)", async () => {
    // Codex HIGH: {companyCode:"SAFE", companyCodes:["A","B"], confirmCode:"SAFE"}
    // must be rejected — a bulk reset requires the literal "ALL".
    const res = await POST(
      req({
        mode: "archive",
        entityKind: "AllImportData",
        companyCode: "AZSEKER-CPC",
        companyCodes: ["AZSEKER-EDEN", "AZSEKER-MALT"],
        confirmCode: "AZSEKER-CPC",
      }),
    )
    expect(res.status).toBe(400)
    expect(resetMock).not.toHaveBeenCalled()
  })

  it("still counts a company as reset when its post-reset recompute throws (non-fatal)", async () => {
    prismaMock.company.findMany.mockResolvedValue([{ id: "c1", code: "AZSEKER-CPC" }])
    prismaMock.indicatorValue.findMany.mockResolvedValue([{ period: "2026" }])
    recomputeMock.mockRejectedValueOnce(new Error("recompute boom"))
    const res = await POST(
      req({ mode: "archive", entityKind: "AllImportData", companyCodes: ["AZSEKER-CPC"], confirmCode: "ALL" }),
    )
    const body = await res.json()
    expect(res.status).toBe(200) // reset committed → not a failure
    expect(body.ok).toBe(true)
    expect(body.companiesReset).toBe(1)
    expect(resetMock).toHaveBeenCalledTimes(1)
  })

  it("returns 207 + ok:false when a company's reset itself fails", async () => {
    prismaMock.company.findMany.mockResolvedValue([
      { id: "c1", code: "AZSEKER-CPC" },
      { id: "c2", code: "AZSEKER-EDEN" },
    ])
    resetMock.mockResolvedValueOnce({ rowsAffected: 100, breakdown: {}, auditEventId: "r1" }) // CPC ok
    resetMock.mockRejectedValueOnce(new Error("db boom")) // EDEN fails
    const res = await POST(
      req({
        mode: "archive",
        entityKind: "AllImportData",
        companyCodes: ["AZSEKER-CPC", "AZSEKER-EDEN"],
        confirmCode: "ALL",
      }),
    )
    const body = await res.json()
    expect(res.status).toBe(207)
    expect(body.ok).toBe(false)
    expect(body.companiesReset).toBe(1) // only CPC
  })
})
