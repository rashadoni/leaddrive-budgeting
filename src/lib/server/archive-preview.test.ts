import { describe, expect, it, vi } from "vitest"
import { previewCompanyImportReset } from "./archive"

function makePrisma() {
  return {
    company: { findMany: vi.fn() },
    budgetLine: { count: vi.fn(), findMany: vi.fn() },
    balanceSheetLine: { count: vi.fn() },
    cashFlowEntry: { count: vi.fn() },
    counterparty: { count: vi.fn() },
    operationalFact: { count: vi.fn() },
    budgetActual: { count: vi.fn() },
    // Phase 11.6 — the reset now also clears sales lines and indicator
    // values, so the preview must count them or it under-reports the blast
    // radius (the exact way it used to mislead).
    salesBudgetLine: { count: vi.fn() },
    indicatorValue: { count: vi.fn() },
  }
}

describe("previewCompanyImportReset", () => {
  it("counts the same per-company scopes the reset will touch", async () => {
    const prisma = makePrisma()
    prisma.company.findMany
      .mockResolvedValueOnce([
        {
          id: "c1",
          code: "AZSEKER-CPC",
          settings: { auditFindings: [], riskRegister: [] },
        },
      ])
      .mockResolvedValueOnce([{ code: "AZSEKER-CPC" }, { code: "AZSEKER-EDEN" }])
    prisma.budgetLine.count.mockResolvedValueOnce(10)
    prisma.balanceSheetLine.count.mockResolvedValueOnce(4)
    prisma.cashFlowEntry.count.mockResolvedValueOnce(3)
    prisma.counterparty.count.mockResolvedValueOnce(2)
    prisma.operationalFact.count.mockResolvedValueOnce(5)
    prisma.budgetActual.count.mockResolvedValueOnce(1)
    prisma.salesBudgetLine.count.mockResolvedValueOnce(6)
    prisma.indicatorValue.count.mockResolvedValueOnce(9)

    const preview = await previewCompanyImportReset({
      prisma: prisma as never,
      organizationId: "org1",
      companyCodes: ["AZSEKER-CPC"],
      year: 2026,
    })

    expect(preview.rowsAffected).toBe(42)
    expect(preview.breakdown).toMatchObject({
      budgetLine: 10,
      balanceSheetLine: 4,
      cashFlowEntry: 3,
      counterparty: 2,
      operationalFact: 5,
      budgetActual: 1,
      salesBudgetLine: 6,
      indicatorValue: 9,
      settingsKeys: 2,
    })
    // SalesBudgetLine carries no companyId — the scope has to travel through
    // the entity-namespaced ProductLine.code.
    expect(prisma.salesBudgetLine.count.mock.calls[0][0].where).toMatchObject({
      organizationId: "org1",
      productLine: { code: { startsWith: "AZSEKER_CPC__" } },
      year: 2026,
    })
    // IndicatorValue.period is "2026" | "2026-Q2" | "2026-04", so one
    // startsWith covers every granularity for the year.
    expect(prisma.indicatorValue.count.mock.calls[0][0].where).toMatchObject({
      organizationId: "org1",
      companyId: "c1",
      period: { startsWith: "2026" },
    })
    expect(prisma.cashFlowEntry.count.mock.calls[0][0].where).toMatchObject({
      organizationId: "org1",
      sourceId: { startsWith: "AZSEKER-CPC::" },
      deletedAt: null,
      year: 2026,
    })
    expect(prisma.operationalFact.count.mock.calls[0][0].where).toMatchObject({
      organizationId: "org1",
      companyId: "c1",
      date: {
        gte: new Date("2026-01-01T00:00:00.000Z"),
        lt: new Date("2027-01-01T00:00:00.000Z"),
      },
    })
    expect(prisma.operationalFact.count.mock.calls[0][0].where.OR).toEqual(
      expect.arrayContaining([
        { source: { startsWith: "import:" } },
        { source: { startsWith: "multi-import:" } },
      ]),
    )
  })

  it("fails before counting when any requested company is unknown", async () => {
    const prisma = makePrisma()
    prisma.company.findMany.mockResolvedValueOnce([{ id: "c1", code: "KNOWN", settings: {} }])

    await expect(
      previewCompanyImportReset({
        prisma: prisma as never,
        organizationId: "org1",
        companyCodes: ["KNOWN", "MISSING"],
      }),
    ).rejects.toThrow(/MISSING/)
    expect(prisma.budgetLine.count).not.toHaveBeenCalled()
  })

  it("includes orphan budget lines only for a whole-holding preview", async () => {
    const prisma = makePrisma()
    prisma.company.findMany
      .mockResolvedValueOnce([
        { id: "c1", code: "A", settings: {} },
        { id: "c2", code: "B", settings: {} },
      ])
      .mockResolvedValueOnce([{ code: "A" }, { code: "B" }])
    prisma.budgetLine.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(7)
    prisma.balanceSheetLine.count.mockResolvedValue(0)
    prisma.cashFlowEntry.count.mockResolvedValue(0)
    prisma.counterparty.count.mockResolvedValue(0)
    prisma.operationalFact.count.mockResolvedValue(0)
    prisma.budgetActual.count.mockResolvedValue(0)
    prisma.budgetLine.findMany.mockResolvedValue([{ planId: "plan1" }])

    const preview = await previewCompanyImportReset({
      prisma: prisma as never,
      organizationId: "org1",
      companyCodes: ["A", "B"],
      year: 2026,
    })

    expect(preview.isWholeHolding).toBe(true)
    expect(preview.orphanBudgetLine).toBe(7)
    expect(preview.breakdown.orphanBudgetLine).toBe(7)
    // 2026-07-30 — TWO lookups now, and that is the point: mixed plans plus
    // plans that are themselves soft-deleted. Was 1, pinning the old rule.
    expect(prisma.budgetLine.findMany).toHaveBeenCalledTimes(2)
  })

  // ── 2026-07-30 — the preview must promise what the reset will do ──
  //
  // Observed live: the panel reported "Orphan P&L: 0" for a year where the
  // reset was about to archive 1,356 rows sitting in soft-deleted plans. The
  // sweep had learned about them; this counter had not. A preview that
  // understates is worse than none — the operator confirms a number that is
  // not the one executed.
  it("counts orphans in a SOFT-DELETED plan, matching the sweep", async () => {
    const prisma = makePrisma()
    prisma.company.findMany
      .mockResolvedValueOnce([
        { id: "c1", code: "A", settings: {} },
        { id: "c2", code: "B", settings: {} },
      ])
      .mockResolvedValueOnce([{ code: "A" }, { code: "B" }])
    prisma.budgetLine.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1356)
    prisma.balanceSheetLine.count.mockResolvedValue(0)
    prisma.cashFlowEntry.count.mockResolvedValue(0)
    prisma.counterparty.count.mockResolvedValue(0)
    prisma.operationalFact.count.mockResolvedValue(0)
    prisma.budgetActual.count.mockResolvedValue(0)
    // NO mixed plans — the pre-fix rule returned 0 here and hid everything.
    prisma.budgetLine.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ planId: "plan_q1" }, { planId: "plan_june" }])

    const preview = await previewCompanyImportReset({
      prisma: prisma as never,
      organizationId: "org1",
      companyCodes: ["A", "B"],
      year: 2026,
    })

    expect(preview.orphanBudgetLine).toBe(1356)
    // The second lookup asks specifically for orphans under a DELETED plan.
    const second = prisma.budgetLine.findMany.mock.calls[1][0] as {
      where: Record<string, unknown>
    }
    expect(second.where).toMatchObject({
      organizationId: "org1",
      companyId: null,
      deletedAt: null,
      plan: { deletedAt: { not: null }, year: 2026 },
    })
    // …and the count covers BOTH plans found that way.
    const countWhere = prisma.budgetLine.count.mock.calls[2][0] as {
      where: { planId: { in: string[] } }
    }
    expect(countWhere.where.planId.in.sort()).toEqual(["plan_june", "plan_q1"])
  })
})
