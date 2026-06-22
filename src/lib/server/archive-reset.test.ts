// @vitest-environment node
import { describe, it, expect, vi } from "vitest"
import {
  resetCompanyImportData,
  archiveOrgOrphanBudgetLines,
  IMPORT_SETTINGS_KEYS,
} from "./archive"

vi.mock("@/lib/audit/log", () => ({
  logAuditEvent: vi.fn(async () => ({ ok: true, id: "audit_1" })),
}))

function fakePrisma(settings: Record<string, unknown>) {
  let updatedSettings: Record<string, unknown> | null = null
  const tx = {
    budgetLine: { updateMany: vi.fn(async () => ({ count: 10 })) },
    balanceSheetLine: { updateMany: vi.fn(async () => ({ count: 5 })) },
    cashFlowEntry: { updateMany: vi.fn(async () => ({ count: 8 })) },
    counterparty: { updateMany: vi.fn(async () => ({ count: 3 })) },
    operationalFact: { deleteMany: vi.fn(async () => ({ count: 12 })) },
    budgetActual: { deleteMany: vi.fn(async () => ({ count: 4 })) },
    company: {
      update: vi.fn(async (a: { data: { settings: Record<string, unknown> } }) => {
        updatedSettings = a.data.settings
        return {}
      }),
    },
  }
  const prisma = {
    company: { findFirst: vi.fn(async () => ({ id: "co_1", settings })) },
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx)),
  }
  return { prisma: prisma as never, tx, getUpdatedSettings: () => updatedSettings }
}

describe("resetCompanyImportData", () => {
  it("clears every import surface (no tails) and reports a breakdown", async () => {
    const { prisma, tx } = fakePrisma({ courtDisputes: { x: 1 }, riskTags: ["keep"] })
    const res = await resetCompanyImportData({
      prisma,
      actorUserId: "u1",
      scope: { organizationId: "org1", companyCode: "AZSEKER-CPC", year: 2025 },
    })
    expect(tx.budgetLine.updateMany).toHaveBeenCalled()
    expect(tx.balanceSheetLine.updateMany).toHaveBeenCalled()
    expect(tx.cashFlowEntry.updateMany).toHaveBeenCalled()
    expect(tx.counterparty.updateMany).toHaveBeenCalled()
    expect(tx.operationalFact.deleteMany).toHaveBeenCalled() // HARD delete — the tail
    expect(tx.budgetActual.deleteMany).toHaveBeenCalled() // HARD delete — Codex gap
    expect(res.breakdown).toMatchObject({
      budgetLine: 10,
      balanceSheetLine: 5,
      cashFlowEntry: 8,
      counterparty: 3,
      operationalFact: 12,
      budgetActual: 4,
      settingsKeys: 1,
    })
    expect(res.rowsAffected).toBe(10 + 5 + 8 + 3 + 12 + 4 + 1)
    expect(res.auditEventId).toBe("audit_1")
  })

  it("removes EVERY import settings key but KEEPS config keys", async () => {
    const settings: Record<string, unknown> = {
      // config — must survive:
      riskTags: ["subsidy_dependency"],
      legalEntity: "CPC MMC",
      fxExposureSource: "all_domestic",
    }
    for (const k of IMPORT_SETTINGS_KEYS) settings[k] = "x" // every import key present
    const { prisma, getUpdatedSettings } = fakePrisma(settings)
    await resetCompanyImportData({ prisma, actorUserId: "u1", scope: { organizationId: "org1", companyCode: "AZSEKER-CPC" } })
    const next = getUpdatedSettings()!
    for (const k of IMPORT_SETTINGS_KEYS) expect(k in next).toBe(false) // no tails
    expect(next.riskTags).toEqual(["subsidy_dependency"]) // config kept
    expect(next.legalEntity).toBe("CPC MMC")
    expect(next.fxExposureSource).toBe("all_domestic")
  })

  it("deletes only import-sourced facts (preserves manual / inline / custom entries)", async () => {
    const { prisma, tx } = fakePrisma({})
    await resetCompanyImportData({ prisma, actorUserId: "u1", scope: { organizationId: "org1", companyCode: "AZSEKER-AZSF", year: 2025 } })
    const ofCalls = tx.operationalFact.deleteMany.mock.calls as unknown as Array<[{ where: Record<string, unknown> }]>
    const ofWhere = ofCalls[0][0].where
    expect(ofWhere.OR).toEqual([
      { source: { in: ["xlsx_multi_import", "xlsx_import", "ai_import_ops_facts", "import"] } },
      { source: { startsWith: "import:" } },
      { source: { startsWith: "multi-import:" } },
      { source: { endsWith: ".xlsx" } },
    ])
    expect(ofWhere.companyId).toBe("co_1")
  })

  it("scopes the cash-flow archive by the company's sourceId prefix", async () => {
    const { prisma, tx } = fakePrisma({})
    await resetCompanyImportData({ prisma, actorUserId: "u1", scope: { organizationId: "org1", companyCode: "AZSEKER-AZSF", year: 2025 } })
    const cfCalls = tx.cashFlowEntry.updateMany.mock.calls as unknown as Array<[{ where: Record<string, unknown> }]>
    const cfWhere = cfCalls[0][0].where
    expect(cfWhere.sourceId).toEqual({ startsWith: "AZSEKER-AZSF::" })
    expect(cfWhere.year).toBe(2025)
  })

  it("throws without a companyCode (reset is per-company)", async () => {
    const { prisma } = fakePrisma({})
    await expect(
      resetCompanyImportData({ prisma, actorUserId: "u1", scope: { organizationId: "org1" } }),
    ).rejects.toThrow(/companyCode is required/)
  })
})

function fakeOrphanPrisma(mixedPlanIds: string[], sweptCount: number) {
  const tx = {
    budgetLine: {
      findMany: vi.fn(async () => mixedPlanIds.map((planId) => ({ planId }))),
      updateMany: vi.fn(async () => ({ count: sweptCount })),
    },
  }
  const prisma = {
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx)),
  }
  return { prisma: prisma as never, tx }
}

describe("archiveOrgOrphanBudgetLines", () => {
  it("sweeps NULL-company lines ONLY in mixed plans (plans that have company-attributed lines)", async () => {
    const { prisma, tx } = fakeOrphanPrisma(["plan_2023"], 214)
    const res = await archiveOrgOrphanBudgetLines({
      prisma,
      actorUserId: "u1",
      organizationId: "org1",
      year: 2023,
    })
    // 1) residue plans = those with ≥1 company-attributed line (companyId not null)
    const fm = tx.budgetLine.findMany.mock.calls as unknown as Array<
      [{ where: Record<string, unknown>; distinct: string[] }]
    >
    expect(fm[0][0].where).toMatchObject({
      organizationId: "org1",
      companyId: { not: null },
      plan: { year: 2023 },
    })
    expect(fm[0][0].distinct).toEqual(["planId"])
    // 2) soft-archive the NULL lines IN THOSE PLANS — never a blanket companyId:null wipe
    const um = tx.budgetLine.updateMany.mock.calls as unknown as Array<
      [{ where: Record<string, unknown> }]
    >
    expect(um[0][0].where).toMatchObject({
      organizationId: "org1",
      companyId: null,
      planId: { in: ["plan_2023"] },
      deletedAt: null,
      plan: { year: 2023 },
    })
    expect(res.rowsAffected).toBe(214)
    expect(res.auditEventId).toBe("audit_1")
  })

  it("leaves a wholly company-less plan alone (no mixed plans → no sweep)", async () => {
    const { prisma, tx } = fakeOrphanPrisma([], 0)
    const res = await archiveOrgOrphanBudgetLines({
      prisma,
      actorUserId: "u1",
      organizationId: "org1",
    })
    expect(tx.budgetLine.updateMany).not.toHaveBeenCalled()
    expect(res.rowsAffected).toBe(0)
  })
})
