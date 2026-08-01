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

const {
  prismaMock,
  archiveRowsMock,
  restoreRowsMock,
  resetMock,
  orphanSweepMock,
  salesForecastMock,
  previewMock,
  recomputeMock,
} = vi.hoisted(() => ({
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
    // 2026-07-31 — this was MISSING from the mock, so every whole-holding
    // test called `undefined(...)`, threw a TypeError, and the route swallowed
    // it as "non-fatal". The org-level sales-forecast sweep was untested in
    // every test that appeared to cover a whole-holding reset.
    salesForecastMock: vi.fn(),
    previewMock: vi.fn(),
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
  resetOrgSalesForecast: salesForecastMock,
  previewCompanyImportReset: previewMock,
}))
vi.mock("@/lib/risk/recompute-trigger", () => ({ runRecomputeForCompanies: recomputeMock }))

import { requireRole } from "@/lib/api-auth"
import { POST } from "./route"
import { gateFor, type TaskId } from "@/features/admin/lib/delete-data/tier"
import { buildCommitRequest } from "@/features/admin/lib/delete-data/payload"

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
  salesForecastMock.mockResolvedValue({ rowsAffected: 0, auditEventId: null })
  previewMock.mockResolvedValue({ rowsAffected: 0, breakdown: {}, companies: [], years: [] })
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
    const res = await POST(req({ mode: "restore", entityKind: "CashFlowEntry", companyCode: "AZSEKER-AZSF", year: 2026, confirmCode: "AZSEKER-AZSF", archivedAt: "2026-07-31T13:37:00.123Z" }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(restoreRowsMock).toHaveBeenCalled()
    expect(prismaMock.cashFlowEntry.count).not.toHaveBeenCalled()
  })

  // ── The restore key ──────────────────────────────────────────────────
  // Restoring by scope alone un-archives every generation of that
  // company-year — on production, three import generations of the same P&L.
  // The route refuses rather than widening. See ARCHIVE_GENERATION_KEY in
  // `src/lib/server/archive.ts`.
  it("REFUSES a restore that names no archive operation", async () => {
    const res = await POST(req({ mode: "restore", entityKind: "BudgetLine", companyCode: "AZSEKER-AZSF", year: 2026, confirmCode: "AZSEKER-AZSF" }))
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.code).toBe("MISSING_ARCHIVE_KEY")
    expect(restoreRowsMock).not.toHaveBeenCalled()
  })

  it("REFUSES an unparseable archivedAt instead of falling back to the scope", async () => {
    const res = await POST(req({ mode: "restore", entityKind: "BudgetLine", companyCode: "AZSEKER-AZSF", year: 2026, confirmCode: "AZSEKER-AZSF", archivedAt: "last Tuesday" }))
    expect(res.status).toBe(400)
    expect(restoreRowsMock).not.toHaveBeenCalled()
  })

  it("hands the exact stamp through to restoreRows", async () => {
    await POST(req({ mode: "restore", entityKind: "BudgetLine", companyCode: "AZSEKER-AZSF", year: 2026, confirmCode: "AZSEKER-AZSF", archivedAt: "2026-07-31T13:37:00.123Z" }))
    const passed = restoreRowsMock.mock.calls[0][0].archivedAt as Date
    expect(passed.toISOString()).toBe("2026-07-31T13:37:00.123Z")
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

    it("tests EVERY year in a multi-year delete, not just the first", async () => {
      // A two-year delete whose second year is closed must be refused whole.
      // Checking only the first would half-apply it, which is exactly the
      // state a period lock exists to prevent.
      prismaMock.organization.findUnique.mockResolvedValue({ lockedPeriods: [LOCK_2025] })
      const res = await POST(req(resetBody({ years: [2026, 2025] })))
      expect(res.status).toBe(423)
      expect(resetMock).not.toHaveBeenCalled()
    })

    it("passes a multi-year delete when none of its years are closed", async () => {
      prismaMock.organization.findUnique.mockResolvedValue({ lockedPeriods: [LOCK_2025] })
      const res = await POST(req(resetBody({ years: [2026, 2027] })))
      expect(res.status).toBe(200)
      expect(resetMock.mock.calls[0][0].scope.years).toEqual([2026, 2027])
    })
  })

  // ── 2026-07-31 — the drift guard ─────────────────────────────────────
  //
  // The operator confirms ONE number, read off a preview. Between reading it
  // and pressing the button an import can land. Without this, the delete just
  // runs and the result quietly differs from what was agreed to.
  describe("expectRows drift guard", () => {
    const body = (extra: Record<string, unknown>) => ({
      mode: "archive",
      entityKind: "AllImportData",
      companyCodes: ["AZSEKER-CPC"],
      confirmCode: "ALL",
      ...extra,
    })

    beforeEach(() => {
      prismaMock.company.findMany.mockResolvedValue([{ id: "c1", code: "AZSEKER-CPC" }])
    })

    it("409s and deletes NOTHING when the count has moved", async () => {
      previewMock.mockResolvedValue({ rowsAffected: 1290, breakdown: {}, companies: [], years: [] })
      const res = await POST(req(body({ expectRows: 1284 })))
      expect(res.status).toBe(409)
      expect(resetMock).not.toHaveBeenCalled()
      const json = (await res.json()) as { actualRows: number; expectedRows: number }
      expect(json).toMatchObject({ expectedRows: 1284, actualRows: 1290 })
    })

    it("proceeds when the recount matches what was on screen", async () => {
      previewMock.mockResolvedValue({ rowsAffected: 1284, breakdown: {}, companies: [], years: [] })
      const res = await POST(req(body({ expectRows: 1284 })))
      expect(res.status).toBe(200)
      expect(resetMock).toHaveBeenCalled()
    })

    it("skips the recount entirely when the client did not send a number", async () => {
      const res = await POST(req(body({})))
      expect(res.status).toBe(200)
      expect(previewMock).not.toHaveBeenCalled()
    })
  })

  // ── 2026-07-31 — the org-level sweeps follow the category selection ──
  describe("category selection", () => {
    beforeEach(() => {
      prismaMock.company.findMany.mockResolvedValue([
        { id: "c1", code: "AZSEKER-CPC" },
        { id: "c2", code: "AZSEKER-EDEN" },
      ])
    })

    const wholeHolding = (extra: Record<string, unknown>) => ({
      mode: "archive",
      entityKind: "AllImportData",
      companyCodes: ["AZSEKER-CPC", "AZSEKER-EDEN"],
      confirmCode: "ALL",
      ...extra,
    })

    it("sweeps the org sales forecast on a whole-holding delete", async () => {
      salesForecastMock.mockResolvedValue({ rowsAffected: 24, auditEventId: "sf1" })
      const res = await POST(req(wholeHolding({})))
      expect(res.status).toBe(200)
      const json = (await res.json()) as { breakdown: Record<string, number> }
      expect(json.breakdown.salesForecast).toBe(24)
    })

    it("skips both org-level sweeps when their categories were not chosen", async () => {
      // The preview counts `salesForecast` under the sales category and
      // orphan lines under the P&L one. If the commit ignored `include` here,
      // the preview would be promising a number the write does not honour.
      await POST(req(wholeHolding({ include: ["balanceSheetLine"] })))
      expect(salesForecastMock).not.toHaveBeenCalled()
      expect(orphanSweepMock).not.toHaveBeenCalled()
    })

    it("reports ok:false when the sales-forecast sweep fails after a clean reset", async () => {
      // It used to be caught, logged as "non-fatal" and reported as 200: a
      // "no tails" delete that left a tail, called a success.
      salesForecastMock.mockRejectedValue(new Error("deadlock"))
      const res = await POST(req(wholeHolding({})))
      expect(res.status).toBe(207)
      const json = (await res.json()) as { ok: boolean; error: string }
      expect(json.ok).toBe(false)
      expect(json.error).toMatch(/sales-forecast/)
    })
  })
})

/**
 * Phase 11.77 — the client/server boundary the old tests never crossed.
 *
 * `tier.test.ts` asserted the token the gate asks for. `payload.test.ts`
 * asserted the body the button sends. Nothing asserted that the route accepts
 * the one when given the other — and it did not: "Remove one company" sent
 * `{companyCode:"ACME", confirmCode:"ALL"}` and got
 * `400 confirmCode must equal "ACME"` every single time.
 *
 * This drives the REAL POST handler with the REAL client output. It fails the
 * moment anybody re-introduces a second opinion about the token.
 */
describe("the confirmation token the client asks for is the one this route demands", () => {
  const SHAPES: Array<{ label: string; codes: string[] }> = [
    { label: "one company", codes: ["AZSEKER-CPC"] },
    { label: "several companies", codes: ["AZSEKER-CPC", "AZSEKER-EDEN"] },
  ]
  const TASKS: TaskId[] = ["clearYears", "removeCompany", "restore", "deleteAll"]

  for (const task of TASKS) {
    for (const { label, codes } of SHAPES) {
      for (const years of [[2026], [] as number[]]) {
        const scope = years.length > 0 ? "named years" : "all years"
        it(`${task} · ${label} · ${scope} — the gate's token is accepted`, async () => {
          prismaMock.company.findMany.mockResolvedValue(
            codes.map((code, i) => ({ id: `c${i}`, code })),
          )
          // The drift guard re-counts before writing; make the recount agree
          // with the number the "operator" read, so the only thing this test
          // can fail on is the token.
          previewMock.mockResolvedValue({
            rowsAffected: 100 * codes.length,
            breakdown: {},
            companies: codes,
            years: [],
          })
          const gate = gateFor({
            task,
            companyCodes: codes,
            allYears: years.length === 0,
            hasPermanent: true,
          })
          const commit = buildCommitRequest({
            task,
            companyCodes: codes,
            years,
            bundle: "everything",
            exactCategories: null,
            includeManualActuals: false,
            reason: "the 2026 file was the draft, not the signed accounts",
            // The operator typed exactly what the screen told them to.
            confirmToken: gate.token,
            expectRows: 100 * codes.length,
          })
          const res = await POST(req(commit as unknown as Record<string, unknown>))
          const body = await res.json()
          expect(
            res.status,
            `expected the route to accept "${gate.token}" for ${task}/${label}; got ${res.status} ${JSON.stringify(body)}`,
          ).toBe(200)
          expect(body.ok).toBe(true)
          expect(resetMock).toHaveBeenCalledTimes(codes.length)
        })
      }
    }
  }

  it("still 400s when the operator types something the gate never offered", async () => {
    prismaMock.company.findMany.mockResolvedValue([{ id: "c1", code: "AZSEKER-CPC" }])
    const gate = gateFor({
      task: "removeCompany",
      companyCodes: ["AZSEKER-CPC"],
      allYears: true,
      hasPermanent: true,
    })
    const commit = buildCommitRequest({
      task: "removeCompany",
      companyCodes: ["AZSEKER-CPC"],
      years: [],
      bundle: "everything",
      exactCategories: null,
      includeManualActuals: false,
      reason: "sold the subsidiary in June",
      confirmToken: "ALL", // the pre-11.77 client's answer
      expectRows: 100,
    })
    expect(gate.token).toBe("AZSEKER-CPC")
    const res = await POST(req(commit as unknown as Record<string, unknown>))
    expect(res.status).toBe(400)
    expect(resetMock).not.toHaveBeenCalled()
  })
})
