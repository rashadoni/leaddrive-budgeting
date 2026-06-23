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

import { archiveRows, restoreRows } from "./archive"

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

describe("restoreRows — inverts the soft-delete filter", () => {
  it("BS restore keeps companyId scope but targets archived rows", async () => {
    await restoreRows({ prisma: prismaMock as never, actorUserId: "u1", scope: { organizationId: ORG, entityKind: "BalanceSheetLine", companyCode: "AZSEKER-AZSF", year: 2026 } })
    const w = where(prismaMock.balanceSheetLine)
    expect(w).toMatchObject({ organizationId: ORG, year: 2026, companyId: "c1", deletedAt: { not: null } })
  })

  it("CF restore keeps the companyId/sourceId scope, targeting archived rows", async () => {
    await restoreRows({ prisma: prismaMock as never, actorUserId: "u1", scope: { organizationId: ORG, entityKind: "CashFlowEntry", companyCode: "AZSEKER-CPC", year: 2026 } })
    expect(where(prismaMock.cashFlowEntry)).toMatchObject({
      OR: [{ companyId: "c1" }, { sourceId: { startsWith: "AZSEKER-CPC::" } }],
      deletedAt: { not: null },
    })
  })
})
