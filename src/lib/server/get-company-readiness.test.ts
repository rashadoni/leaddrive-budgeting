import type { PrismaClient } from "@prisma/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { getCompanyReadiness } from "./get-company-readiness"

const prisma = {
  company: { findMany: vi.fn() },
  budgetLine: { groupBy: vi.fn(), findMany: vi.fn() },
  currency: { findMany: vi.fn() },
  balanceSheetLine: { groupBy: vi.fn() },
  counterparty: { groupBy: vi.fn() },
  operationalFact: { groupBy: vi.fn() },
  indicatorValue: { groupBy: vi.fn() },
} as unknown as PrismaClient

const model = prisma as unknown as {
  company: { findMany: ReturnType<typeof vi.fn> }
  budgetLine: {
    groupBy: ReturnType<typeof vi.fn>
    findMany: ReturnType<typeof vi.fn>
  }
  currency: { findMany: ReturnType<typeof vi.fn> }
  balanceSheetLine: { groupBy: ReturnType<typeof vi.fn> }
  counterparty: { groupBy: ReturnType<typeof vi.fn> }
  operationalFact: { groupBy: ReturnType<typeof vi.fn> }
  indicatorValue: { groupBy: ReturnType<typeof vi.fn> }
}

beforeEach(() => {
  for (const group of Object.values(model)) {
    for (const fn of Object.values(group)) fn.mockReset()
  }
  model.company.findMany.mockResolvedValue([
    { id: "co-1", settings: {} },
    { id: "co-2", settings: {} },
  ])
  model.budgetLine.groupBy.mockResolvedValue([])
  model.budgetLine.findMany.mockResolvedValue([])
  model.currency.findMany.mockResolvedValue([{ code: "AZN" }])
  model.balanceSheetLine.groupBy.mockResolvedValue([])
  model.counterparty.groupBy.mockResolvedValue([])
  model.operationalFact.groupBy.mockResolvedValue([])
  model.indicatorValue.groupBy.mockResolvedValue([])
})

describe("getCompanyReadiness evidence boundaries", () => {
  it("credits balance-sheet evidence only to the line's direct company", async () => {
    model.balanceSheetLine.groupBy.mockResolvedValue([
      { companyId: "co-1", _count: { _all: 4 } },
    ])

    const result = await getCompanyReadiness(prisma, "org-1", "2025")

    expect(model.company.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: "org-1",
          isActive: true,
          level: 2,
          role: "operational",
        }),
      }),
    )
    expect(model.balanceSheetLine.groupBy).toHaveBeenCalledWith({
      by: ["companyId"],
      where: {
        organizationId: "org-1",
        companyId: { in: ["co-1", "co-2"] },
        deletedAt: null,
      },
      _count: { _all: true },
    })
    expect(result.get("co-1")?.areas.find((area) => area.id === "bs")?.earned).toBe(15)
    expect(result.get("co-2")?.areas.find((area) => area.id === "bs")?.earned).toBe(0)
  })

  it("requires one confirmed base and a complete non-base source tuple for FX credit", async () => {
    model.budgetLine.findMany.mockResolvedValue([
      { companyId: "co-1", currencyCode: "AZN", exchangeRate: 1, originalAmount: 50 },
      { companyId: "co-1", currencyCode: "USD", exchangeRate: 1.7, originalAmount: 100 },
      { companyId: "co-2", currencyCode: "EUR", exchangeRate: 0, originalAmount: 100 },
    ])

    const result = await getCompanyReadiness(prisma, "org-1", "2025")

    expect(result.get("co-1")?.areas.find((area) => area.id === "fxTags")?.earned).toBe(10)
    expect(result.get("co-2")?.areas.find((area) => area.id === "fxTags")?.earned).toBe(0)

    model.currency.findMany.mockResolvedValue([{ code: "AZN" }, { code: "USD" }])
    model.budgetLine.findMany.mockClear()
    const ambiguous = await getCompanyReadiness(prisma, "org-1", "2025")

    expect(model.budgetLine.findMany).not.toHaveBeenCalled()
    expect(ambiguous.get("co-1")?.areas.find((area) => area.id === "fxTags")?.earned).toBe(0)
    expect(model.indicatorValue.groupBy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ period: "2025" }),
      }),
    )
  })
})
