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

const { prismaMock, archiveRowsMock, restoreRowsMock, resetMock, orphanSweepMock, recomputeMock } =
  vi.hoisted(() => ({
    prismaMock: {
      cashFlowEntry: { count: vi.fn() },
      company: { findMany: vi.fn(), findFirst: vi.fn() },
      indicatorValue: { findMany: vi.fn() },
      // Phase 11.39 — the period-lock gate reads Organization.lockedPeriods on
      // BOTH reset paths now (year-scoped via getActivePeriodLock, all-years
      // directly), so the mock must answer.
      organization: { findUnique: vi.fn() },
    },
    archiveRowsMock: vi.fn(),
    restoreRowsMock: vi.fn(),
    resetMock: vi.fn(),
    orphanSweepMock: vi.fn(),
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
  archiveOrgOrphanBudgetLines: orphanSweepMock,
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
  // Default: org-orphan sweep finds nothing (a no-op) so existing reset tests are
  // unaffected whether or not the whole-holding gate happens to fire.
  orphanSweepMock.mockResolvedValue({ rowsAffected: 0, auditEventId: null })
  recomputeMock.mockResolvedValue({ ok: 3 })
  prismaMock.indicatorValue.findMany.mockResolvedValue([])
  // Default: no locked periods — pre-11.39 behaviour for every existing test.
  prismaMock.organization.findUnique.mockResolvedValue({ lockedPeriods: [] })
})

const LOCK_2025 = {
  period: "2025",
  lockedAt: "2026-07-01T00:00:00.000Z",
  lockedBy: "cfo",
  reason: "signed year",
}

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

  it("sweeps org-level orphan lines ONCE after a whole-holding reset (all operational companies targeted)", async () => {
    prismaMock.company.findMany
      .mockResolvedValueOnce([
        { id: "c1", code: "AZSEKER-CPC" },
        { id: "c2", code: "AZSEKER-EDEN" },
      ]) // targets
      .mockResolvedValueOnce([{ code: "AZSEKER-CPC" }, { code: "AZSEKER-EDEN" }]) // operational (level>1) — all targeted
    orphanSweepMock.mockResolvedValue({ rowsAffected: 214, auditEventId: "o1" })
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
    expect(orphanSweepMock).toHaveBeenCalledTimes(1) // ONCE, after the loop
    expect(orphanSweepMock.mock.calls[0][0]).toMatchObject({ organizationId: "org1" })
    expect(body.orphanRowsAffected).toBe(214)
    expect(body.breakdown.orphanBudgetLine).toBe(214)
    expect(body.rowsAffected).toBe(200 + 214)
  })

  it("does NOT sweep orphans on a partial selection (not every operational company targeted)", async () => {
    prismaMock.company.findMany
      .mockResolvedValueOnce([{ id: "c1", code: "AZSEKER-CPC" }]) // targets (1)
      .mockResolvedValueOnce([{ code: "AZSEKER-CPC" }, { code: "AZSEKER-EDEN" }]) // operational (2) → not all targeted
    const res = await POST(
      req({
        mode: "archive",
        entityKind: "AllImportData",
        companyCodes: ["AZSEKER-CPC"],
        confirmCode: "ALL",
      }),
    )
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(orphanSweepMock).not.toHaveBeenCalled()
    expect(body.orphanRowsAffected).toBe(0)
  })

  it("skips the orphan sweep if ANY company reset failed (no partial-state tails)", async () => {
    prismaMock.company.findMany
      .mockResolvedValueOnce([
        { id: "c1", code: "AZSEKER-CPC" },
        { id: "c2", code: "AZSEKER-EDEN" },
      ]) // targets
      .mockResolvedValueOnce([{ code: "AZSEKER-CPC" }, { code: "AZSEKER-EDEN" }]) // operational → whole holding
    resetMock
      .mockResolvedValueOnce({ rowsAffected: 100, breakdown: {}, auditEventId: "r1" }) // CPC ok
      .mockRejectedValueOnce(new Error("EDEN reset boom")) // EDEN fails
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
    expect(orphanSweepMock).not.toHaveBeenCalled() // failures.length > 0 → no sweep
  })

  it("reports non-success when the orphan sweep itself fails after a clean per-company reset", async () => {
    prismaMock.company.findMany
      .mockResolvedValueOnce([
        { id: "c1", code: "AZSEKER-CPC" },
        { id: "c2", code: "AZSEKER-EDEN" },
      ]) // targets
      .mockResolvedValueOnce([{ code: "AZSEKER-CPC" }, { code: "AZSEKER-EDEN" }]) // operational → whole holding
    orphanSweepMock.mockRejectedValue(new Error("sweep boom"))
    const res = await POST(
      req({
        mode: "archive",
        entityKind: "AllImportData",
        companyCodes: ["AZSEKER-CPC", "AZSEKER-EDEN"],
        confirmCode: "ALL",
      }),
    )
    const body = await res.json()
    expect(res.status).toBe(207) // tails remain → NOT a clean success
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/orphan sweep failed/i)
    expect(body.companiesReset).toBe(2) // the per-company resets DID commit
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

  // ── 11.61 — the widest reset silently skipped its own recompute ──
  // With no `year`, the route derives the years to rebuild from
  // IndicatorValue.period. That query used to run AFTER
  // resetCompanyImportData, which hard-deletes exactly those rows — so it
  // came back empty and the post-reset recompute never ran at all. The UI's
  // year field is optional and documents blank as "all years", so this was
  // the DEFAULT path, not an edge case.
  it("recomputes every year the company had, when no year is given", async () => {
    prismaMock.company.findMany.mockResolvedValue([{ id: "c1", code: "AZSEKER-CPC" }])
    // The stub models the real thing: resetCompanyImportData HARD-DELETES the
    // IndicatorValue rows, so a lookup after it sees nothing. Keyed on the
    // reset actually having run, not on call order — so this test fails for
    // the RIGHT reason (an empty year list) rather than by counting calls.
    let wiped = false
    resetMock.mockImplementation(async () => {
      wiped = true
      return { rowsAffected: 100, breakdown: {}, auditEventId: "r1" }
    })
    prismaMock.indicatorValue.findMany.mockImplementation(async () =>
      wiped ? [] : [{ period: "2025" }, { period: "2025-Q2" }, { period: "2026-04" }],
    )

    await POST(
      req({ mode: "archive", entityKind: "AllImportData", companyCodes: ["AZSEKER-CPC"], confirmCode: "ALL" }),
    )

    expect(recomputeMock).toHaveBeenCalledTimes(1)
    const affected = recomputeMock.mock.calls[0][2] as Array<{ year: number }>
    // "2025", "2025-Q2" and "2026-04" collapse to the two YEARS 2025 and 2026.
    expect(affected.map((a) => a.year).sort()).toEqual([2025, 2026])
  })

  it("reads the year list BEFORE the reset, not after", async () => {
    // Ordering is the whole defect: same query, same result shape, wrong
    // moment. Pinned directly so a future refactor cannot quietly move it
    // back below the delete while every other assertion stays green.
    prismaMock.company.findMany.mockResolvedValue([{ id: "c1", code: "AZSEKER-CPC" }])
    prismaMock.indicatorValue.findMany.mockResolvedValue([{ period: "2026" }])

    await POST(
      req({ mode: "archive", entityKind: "AllImportData", companyCodes: ["AZSEKER-CPC"], confirmCode: "ALL" }),
    )

    const readOrder = prismaMock.indicatorValue.findMany.mock.invocationCallOrder[0]
    const resetOrder = resetMock.mock.invocationCallOrder[0]
    expect(readOrder).toBeLessThan(resetOrder)
  })

  // Guard — an explicit year must not trigger the lookup at all.
  it("skips the period lookup when a year IS given", async () => {
    prismaMock.company.findMany.mockResolvedValue([{ id: "c1", code: "AZSEKER-CPC" }])

    await POST(
      req({ mode: "archive", entityKind: "AllImportData", companyCodes: ["AZSEKER-CPC"], year: 2026, confirmCode: "ALL" }),
    )

    expect(prismaMock.indicatorValue.findMany).not.toHaveBeenCalled()
    const affected = recomputeMock.mock.calls[0][2] as Array<{ year: number }>
    expect(affected).toEqual([{ companyId: "c1", year: 2026 }])
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

  // ── Phase 11.39 — the all-years reset no longer bypasses the period lock ──
  //
  // The gate ran only `if (year)`, and the UI's year field is optional with
  // "blank = all years". So the WIDER operation had the WEAKER check: an
  // all-years reset covers every locked period by definition and sailed
  // through, while a single-year reset of the same data was refused.
  describe("period lock on reset (11.39)", () => {
    const resetBody = (extra: Record<string, unknown>) => ({
      mode: "archive",
      entityKind: "AllImportData",
      companyCodes: ["AZSEKER-CPC", "AZSEKER-EDEN"],
      confirmCode: "ALL",
      ...extra,
    })

    beforeEach(() => {
      prismaMock.company.findMany.mockResolvedValue([
        { id: "c1", code: "AZSEKER-CPC" },
        { id: "c2", code: "AZSEKER-EDEN" },
      ])
    })

    it("REFUSES an all-years reset while ANY period lock is active", async () => {
      prismaMock.organization.findUnique.mockResolvedValue({ lockedPeriods: [LOCK_2025] })
      const res = await POST(req(resetBody({})))
      expect(res.status).toBe(423)
      expect(resetMock).not.toHaveBeenCalled()
    })

    it("still allows an all-years reset when no locks exist", async () => {
      const res = await POST(req(resetBody({})))
      expect(res.status).toBe(200)
      expect(resetMock).toHaveBeenCalled()
    })

    it("year-scoped reset of a LOCKED year is refused (the precise gate)", async () => {
      prismaMock.organization.findUnique.mockResolvedValue({ lockedPeriods: [LOCK_2025] })
      const res = await POST(req(resetBody({ year: 2025 })))
      expect(res.status).toBe(423)
      expect(resetMock).not.toHaveBeenCalled()
    })

    it("year-scoped reset of an UNLOCKED year passes even while another year is locked", async () => {
      prismaMock.organization.findUnique.mockResolvedValue({ lockedPeriods: [LOCK_2025] })
      const res = await POST(req(resetBody({ year: 2026 })))
      expect(res.status).toBe(200)
      expect(resetMock).toHaveBeenCalled()
    })
  })
})
