// @vitest-environment node
/**
 * Tests for archive/restore scope construction (`buildScopeWhere` via the
 * public archiveRows/restoreRows). The 2026-06-20 fix makes BS/CF archive
 * company-scoped instead of org-wide-per-year; these lock that in so a
 * regression can't silently re-broaden the wipe radius.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock, logAuditEventMock } = vi.hoisted(() => ({
  prismaMock: {
    company: { findFirst: vi.fn() },
    budgetLine: { updateMany: vi.fn() },
    balanceSheetLine: { updateMany: vi.fn() },
    cashFlowEntry: { updateMany: vi.fn() },
    counterparty: { updateMany: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock)),
  },
  logAuditEventMock: vi.fn(),
}))

vi.mock("@/lib/audit/log", () => ({ logAuditEvent: logAuditEventMock }))

import { archiveRows, MissingArchiveKeyError, restoreRows } from "./archive"

const ORG = "org1"

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.company.findFirst.mockResolvedValue({ id: "c1" })
  for (const m of [prismaMock.budgetLine, prismaMock.balanceSheetLine, prismaMock.cashFlowEntry, prismaMock.counterparty]) {
    m.updateMany.mockResolvedValue({ count: 7 })
  }
  logAuditEventMock.mockResolvedValue({ ok: true, id: "a1" })
})

const where = (m: { updateMany: { mock: { calls: unknown[][] } } }) =>
  (m.updateMany.mock.calls[0][0] as { where: Record<string, unknown> }).where

describe("archiveRows — scope WHERE", () => {
  it("BudgetLine scopes by companyId + plan.year", async () => {
    await archiveRows({ prisma: prismaMock as never, actorUserId: "u1", scope: { organizationId: ORG, entityKind: "BudgetLine", companyCode: "AZSEKER-AZSF", year: 2026 } })
    expect(where(prismaMock.budgetLine)).toMatchObject({ organizationId: ORG, deletedAt: null, companyId: "c1", plan: { year: 2026 } })
  })

  it("BalanceSheetLine WITH companyCode scopes by companyId (the fix)", async () => {
    await archiveRows({ prisma: prismaMock as never, actorUserId: "u1", scope: { organizationId: ORG, entityKind: "BalanceSheetLine", companyCode: "AZSEKER-AZSF", year: 2026 } })
    expect(where(prismaMock.balanceSheetLine)).toMatchObject({ organizationId: ORG, deletedAt: null, year: 2026, companyId: "c1" })
  })

  it("BalanceSheetLine WITHOUT companyCode stays org-wide-per-year (no companyId)", async () => {
    await archiveRows({ prisma: prismaMock as never, actorUserId: "u1", scope: { organizationId: ORG, entityKind: "BalanceSheetLine", year: 2026 } })
    const w = where(prismaMock.balanceSheetLine)
    expect(w).toMatchObject({ organizationId: ORG, deletedAt: null, year: 2026 })
    expect(w).not.toHaveProperty("companyId")
  })

  it("CashFlowEntry WITH companyCode prefers companyId, with sourceId-prefix fallback", async () => {
    await archiveRows({ prisma: prismaMock as never, actorUserId: "u1", scope: { organizationId: ORG, entityKind: "CashFlowEntry", companyCode: "AZSEKER-AZSF", year: 2026 } })
    expect(where(prismaMock.cashFlowEntry)).toMatchObject({
      organizationId: ORG,
      deletedAt: null,
      year: 2026,
      OR: [{ companyId: "c1" }, { sourceId: { startsWith: "AZSEKER-AZSF::" } }],
    })
  })

  it("CashFlowEntry WITHOUT companyCode stays org-wide-per-year (no sourceId filter)", async () => {
    await archiveRows({ prisma: prismaMock as never, actorUserId: "u1", scope: { organizationId: ORG, entityKind: "CashFlowEntry", year: 2026 } })
    const w = where(prismaMock.cashFlowEntry)
    expect(w).toMatchObject({ organizationId: ORG, deletedAt: null, year: 2026 })
    expect(w).not.toHaveProperty("sourceId")
  })

  it("throws on a structurally-invalid scope (BudgetLine without year)", async () => {
    await expect(
      archiveRows({ prisma: prismaMock as never, actorUserId: "u1", scope: { organizationId: ORG, entityKind: "BudgetLine", companyCode: "X" } }),
    ).rejects.toThrow(/invalid scope/)
  })

  it("throws when the named company does not exist (BS with bad code)", async () => {
    prismaMock.company.findFirst.mockResolvedValueOnce(null)
    await expect(
      archiveRows({ prisma: prismaMock as never, actorUserId: "u1", scope: { organizationId: ORG, entityKind: "BalanceSheetLine", companyCode: "NOPE", year: 2026 } }),
    ).rejects.toThrow(/invalid scope/)
  })
})

const STAMP = new Date("2026-07-31T13:37:00.123Z")

describe("restoreRows — targets ONE archive operation", () => {
  it("BS restore keeps companyId scope and matches the exact stamp", async () => {
    await restoreRows({ prisma: prismaMock as never, actorUserId: "u1", archivedAt: STAMP, scope: { organizationId: ORG, entityKind: "BalanceSheetLine", companyCode: "AZSEKER-AZSF", year: 2026 } })
    const w = where(prismaMock.balanceSheetLine)
    expect(w).toMatchObject({ organizationId: ORG, year: 2026, companyId: "c1", deletedAt: STAMP })
  })

  it("CF restore keeps the companyId/sourceId scope, matching the exact stamp", async () => {
    await restoreRows({ prisma: prismaMock as never, actorUserId: "u1", archivedAt: STAMP, scope: { organizationId: ORG, entityKind: "CashFlowEntry", companyCode: "AZSEKER-CPC", year: 2026 } })
    expect(where(prismaMock.cashFlowEntry)).toMatchObject({
      OR: [{ companyId: "c1" }, { sourceId: { startsWith: "AZSEKER-CPC::" } }],
      deletedAt: STAMP,
    })
  })

  it("NEVER matches `deletedAt: { not: null }` — that is the bug it exists to stop", async () => {
    await restoreRows({ prisma: prismaMock as never, actorUserId: "u1", archivedAt: STAMP, scope: { organizationId: ORG, entityKind: "BudgetLine", companyCode: "AZSEKER-AZSF", year: 2026 } })
    const w = where(prismaMock.budgetLine)
    expect(w.deletedAt).toEqual(STAMP)
    expect(w.deletedAt).not.toEqual({ not: null })
  })

  it("records which generation it brought back", async () => {
    await restoreRows({ prisma: prismaMock as never, actorUserId: "u1", archivedAt: STAMP, scope: { organizationId: ORG, entityKind: "BudgetLine", companyCode: "AZSEKER-AZSF", year: 2026 } })
    const event = logAuditEventMock.mock.calls[0][1].event
    expect(event.action).toBe("data_restore")
    expect(event.metadata.archivedAt).toBe(STAMP.toISOString())
  })

  it("FAILS CLOSED without a key — no row is touched", async () => {
    await expect(
      restoreRows({ prisma: prismaMock as never, actorUserId: "u1", scope: { organizationId: ORG, entityKind: "BudgetLine", companyCode: "X", year: 2026 } } as never),
    ).rejects.toThrow(MissingArchiveKeyError)
    expect(prismaMock.budgetLine.updateMany).not.toHaveBeenCalled()
  })

  it("FAILS CLOSED on an unparseable key rather than widening the scope", async () => {
    await expect(
      restoreRows({ prisma: prismaMock as never, actorUserId: "u1", archivedAt: new Date("nonsense"), scope: { organizationId: ORG, entityKind: "BudgetLine", companyCode: "X", year: 2026 } }),
    ).rejects.toThrow(/archivedAt is required/)
    expect(prismaMock.budgetLine.updateMany).not.toHaveBeenCalled()
  })
})

describe("archiveRows records the key the restore needs", () => {
  it("writes metadata.archivedAt matching the stamp it applied", async () => {
    const result = await archiveRows({ prisma: prismaMock as never, actorUserId: "u1", scope: { organizationId: ORG, entityKind: "BudgetLine", companyCode: "AZSEKER-AZSF", year: 2026 } })
    const applied = (prismaMock.budgetLine.updateMany.mock.calls[0][0] as { data: { deletedAt: Date } }).data.deletedAt
    const event = logAuditEventMock.mock.calls[0][1].event
    expect(event.metadata.archivedAt).toBe(applied.toISOString())
    expect(result.archivedAt).toBe(applied.toISOString())
  })

  it("names the table it took, so the restore panel stops guessing four kinds", async () => {
    await archiveRows({ prisma: prismaMock as never, actorUserId: "u1", scope: { organizationId: ORG, entityKind: "Counterparty", companyCode: "AZSEKER-AZSF", period: "2026" } })
    expect(logAuditEventMock.mock.calls[0][1].event.metadata.breakdown).toEqual({ counterparty: 7 })
  })
})
