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
    // 2026-07-31 — `salesForecast` is deleted by the whole-holding commit
    // path and used to be counted by nobody. Absent from this mock, the
    // preview could not even have tried.
    salesForecast: { count: vi.fn(async () => 0) },
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

    expect(preview.rowsAffected).toBe(40)
    expect(preview.breakdown).toMatchObject({
      budgetLine: 10,
      balanceSheetLine: 4,
      cashFlowEntry: 3,
      counterparty: 2,
      operationalFact: 5,
      // Imported vs hand-entered are separate lines now: only the imported
      // ones come back from a re-upload, and only they are deleted by
      // default. Counting them together made an unrecoverable loss look
      // like a routine one.
      budgetActualImported: 1,
      salesBudgetLine: 6,
      indicatorValue: 9,
    })
    expect(prisma.budgetActual.count.mock.calls[0][0].where).toMatchObject({
      source: { not: null },
    })
    // 2026-07-31 — a YEAR-scoped preview reports no records at all. The
    // records (audit findings, court cases, risk register, land, capex,
    // strategy text) carry no year of their own, so a year-scoped delete
    // has no claim on them — and after this phase the reset agrees.
    expect(preview.breakdown.recordsCompliance).toBeUndefined()
    expect(preview.breakdown.recordsAssets).toBeUndefined()
    expect(preview.breakdown.settingsKeys).toBeUndefined()
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

  // ── 2026-07-31 — the table the preview forgot ────────────────────────
  //
  // `resetOrgSalesForecast` is fired by the whole-holding commit path
  // (route.ts) and `salesForecast` appeared in NO preview. The operator read
  // nine confident numbers, confirmed, and watched the group's sales forecast
  // disappear — the one table whose absence is visible on the first screen
  // anyone opens afterwards. The preview's own comment demanded parity.
  function wholeHolding(prisma: ReturnType<typeof makePrisma>) {
    prisma.company.findMany
      .mockResolvedValueOnce([
        { id: "c1", code: "A", settings: {} },
        { id: "c2", code: "B", settings: {} },
      ])
      .mockResolvedValueOnce([{ code: "A" }, { code: "B" }])
    prisma.budgetLine.count.mockResolvedValue(0)
    prisma.balanceSheetLine.count.mockResolvedValue(0)
    prisma.cashFlowEntry.count.mockResolvedValue(0)
    prisma.counterparty.count.mockResolvedValue(0)
    prisma.operationalFact.count.mockResolvedValue(0)
    prisma.budgetActual.count.mockResolvedValue(0)
    prisma.salesBudgetLine.count.mockResolvedValue(0)
    prisma.indicatorValue.count.mockResolvedValue(0)
    prisma.budgetLine.findMany.mockResolvedValue([])
  }

  it("counts the org-wide sales forecast the whole-holding reset deletes", async () => {
    const prisma = makePrisma()
    wholeHolding(prisma)
    prisma.salesForecast.count = vi.fn(async () => 24) as never

    const preview = await previewCompanyImportReset({
      prisma: prisma as never,
      organizationId: "org1",
      companyCodes: ["A", "B"],
      year: 2026,
    })

    expect(preview.isWholeHolding).toBe(true)
    expect(preview.breakdown.salesForecast).toBe(24)
    expect(preview.rowsAffected).toBe(24)
    const call = (prisma.salesForecast.count as unknown as {
      mock: { calls: Array<[{ where: Record<string, unknown> }]> }
    }).mock.calls[0][0]
    expect(call.where).toEqual({ organizationId: "org1", year: 2026 })
  })

  it("does NOT count the sales forecast for a partial selection", async () => {
    // The route only sweeps it on a whole-holding reset, because the table
    // has no company dimension at all. A partial preview that showed it
    // would be promising a deletion that never happens.
    const prisma = makePrisma()
    prisma.company.findMany
      .mockResolvedValueOnce([{ id: "c1", code: "A", settings: {} }])
      .mockResolvedValueOnce([{ code: "A" }, { code: "B" }])
    prisma.budgetLine.count.mockResolvedValue(0)
    prisma.balanceSheetLine.count.mockResolvedValue(0)
    prisma.cashFlowEntry.count.mockResolvedValue(0)
    prisma.counterparty.count.mockResolvedValue(0)
    prisma.operationalFact.count.mockResolvedValue(0)
    prisma.budgetActual.count.mockResolvedValue(0)
    prisma.salesBudgetLine.count.mockResolvedValue(0)
    prisma.indicatorValue.count.mockResolvedValue(0)
    prisma.salesForecast.count = vi.fn(async () => 24) as never

    const preview = await previewCompanyImportReset({
      prisma: prisma as never,
      organizationId: "org1",
      companyCodes: ["A"],
    })

    expect(preview.isWholeHolding).toBe(false)
    expect(preview.breakdown.salesForecast).toBeUndefined()
    expect(prisma.salesForecast.count).not.toHaveBeenCalled()
  })

  it("reports the records tail only on an ALL-YEARS scope, grouped and named", async () => {
    const prisma = makePrisma()
    prisma.company.findMany
      .mockResolvedValueOnce([
        {
          id: "c1",
          code: "A",
          settings: {
            courtDisputes: [],
            auditFindings: {
              items: [
                { id: 1, closed: true },
                { id: 2, comments: ["late"] },
                { id: 3 },
              ],
            },
            landParcels: [],
            strategicDescription: "x",
          },
        },
      ])
      .mockResolvedValueOnce([{ code: "A" }, { code: "B" }])
    prisma.budgetLine.count.mockResolvedValue(0)
    prisma.balanceSheetLine.count.mockResolvedValue(0)
    prisma.cashFlowEntry.count.mockResolvedValue(0)
    prisma.counterparty.count.mockResolvedValue(0)
    prisma.operationalFact.count.mockResolvedValue(0)
    prisma.budgetActual.count.mockResolvedValue(0)
    prisma.salesBudgetLine.count.mockResolvedValue(0)
    prisma.indicatorValue.count.mockResolvedValue(0)

    const preview = await previewCompanyImportReset({
      prisma: prisma as never,
      organizationId: "org1",
      companyCodes: ["A"],
    })

    expect(preview.breakdown).toMatchObject({
      recordsCompliance: 2, // courtDisputes + auditFindings
      recordsAssets: 1, // landParcels
      recordsDescription: 1, // strategicDescription
      // The line that matters most: statuses / owners / deadlines / comments
      // a person entered in the Compliance Hub. No file brings these back.
      complianceWriteBacks: 2,
    })
    // "Parameter keys: 4" told the operator nothing about what it was.
    expect(preview.breakdown.settingsKeys).toBeUndefined()
  })

  it("scopes several years at once with an IN / OR, not one year at a time", async () => {
    const prisma = makePrisma()
    prisma.company.findMany
      .mockResolvedValueOnce([{ id: "c1", code: "A", settings: {} }])
      .mockResolvedValueOnce([{ code: "A" }, { code: "B" }])
    prisma.budgetLine.count.mockResolvedValue(0)
    prisma.balanceSheetLine.count.mockResolvedValue(0)
    prisma.cashFlowEntry.count.mockResolvedValue(0)
    prisma.counterparty.count.mockResolvedValue(0)
    prisma.operationalFact.count.mockResolvedValue(0)
    prisma.budgetActual.count.mockResolvedValue(0)
    prisma.salesBudgetLine.count.mockResolvedValue(0)
    prisma.indicatorValue.count.mockResolvedValue(0)

    const preview = await previewCompanyImportReset({
      prisma: prisma as never,
      organizationId: "org1",
      companyCodes: ["A"],
      years: [2025, 2026],
    })

    expect(preview.years).toEqual([2025, 2026])
    expect(prisma.budgetLine.count.mock.calls[0][0].where.plan).toEqual({
      year: { in: [2025, 2026] },
    })
    expect(prisma.balanceSheetLine.count.mock.calls[0][0].where.year).toEqual({
      in: [2025, 2026],
    })
    expect(prisma.counterparty.count.mock.calls[0][0].where.OR).toEqual([
      { period: { startsWith: "2025" } },
      { period: { startsWith: "2026" } },
    ])
    // The fact filter already owns its `OR` (the import-source list), so the
    // year windows go into an `AND` — merged into one OR they would delete a
    // manually-entered fact that happens to fall in a selected year.
    expect(prisma.operationalFact.count.mock.calls[0][0].where.AND).toEqual([
      {
        OR: [
          { date: { gte: new Date("2025-01-01T00:00:00.000Z"), lt: new Date("2026-01-01T00:00:00.000Z") } },
          { date: { gte: new Date("2026-01-01T00:00:00.000Z"), lt: new Date("2027-01-01T00:00:00.000Z") } },
        ],
      },
    ])
  })

  it("counts only what `include` names, and always adds indicators", async () => {
    const prisma = makePrisma()
    prisma.company.findMany
      .mockResolvedValueOnce([{ id: "c1", code: "A", settings: {} }])
      .mockResolvedValueOnce([{ code: "A" }, { code: "B" }])
    prisma.balanceSheetLine.count.mockResolvedValue(4)
    prisma.indicatorValue.count.mockResolvedValue(9)

    const preview = await previewCompanyImportReset({
      prisma: prisma as never,
      organizationId: "org1",
      companyCodes: ["A"],
      year: 2026,
      include: ["balanceSheetLine"],
    })

    expect(preview.breakdown).toEqual({ balanceSheetLine: 4, indicatorValue: 9 })
    expect(prisma.budgetLine.count).not.toHaveBeenCalled()
    expect(prisma.cashFlowEntry.count).not.toHaveBeenCalled()
  })
})
