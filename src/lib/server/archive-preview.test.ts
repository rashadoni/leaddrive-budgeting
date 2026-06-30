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

    const preview = await previewCompanyImportReset({
      prisma: prisma as never,
      organizationId: "org1",
      companyCodes: ["AZSEKER-CPC"],
      year: 2026,
    })

    expect(preview.rowsAffected).toBe(27)
    expect(preview.breakdown).toMatchObject({
      budgetLine: 10,
      balanceSheetLine: 4,
      cashFlowEntry: 3,
      counterparty: 2,
      operationalFact: 5,
      budgetActual: 1,
      settingsKeys: 2,
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
    expect(prisma.budgetLine.findMany).toHaveBeenCalledTimes(1)
  })
})
