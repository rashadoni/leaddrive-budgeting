import type { PrismaClient } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"
import { computeIndicatorBacklog } from "./indicator-backlog"

describe("computeIndicatorBacklog", () => {
  it("uses active operational companies, org definitions, explicit applicability, and one period", async () => {
    const mocks = {
      organization: { findUnique: vi.fn().mockResolvedValue({ settings: {} }) },
      company: {
        findMany: vi.fn().mockResolvedValue([
          { id: "co-1", code: "CO-1", name: "Company", industry: "agro" },
        ]),
      },
      indicatorDefinition: {
        findMany: vi.fn().mockResolvedValue([
          definition("global-a", "A", null, ["agro"]),
          definition("org-a", "A", "org-1", ["agro"]),
          definition("universal-b", "B", null, []),
          definition("override-c", "C", null, ["retail"]),
          definition("disabled-d", "D", null, ["agro"]),
        ]),
      },
      companyIndicator: {
        findMany: vi.fn().mockResolvedValue([
          { companyId: "co-1", indicatorId: "override-c", enabled: true },
          { companyId: "co-1", indicatorId: "disabled-d", enabled: false },
        ]),
      },
      indicatorValue: {
        findMany: vi.fn().mockResolvedValue([
          { companyId: "co-1", indicatorId: "org-a", status: "green" },
          { companyId: "co-1", indicatorId: "override-c", status: "amber" },
          { companyId: "co-1", indicatorId: "disabled-d", status: "green" },
        ]),
      },
    }

    const result = await computeIndicatorBacklog(
      mocks as unknown as PrismaClient,
      "org-1",
      { period: "2025" },
    )

    expect(mocks.company.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: "org-1",
          isActive: true,
          level: 2,
          role: "operational",
          status: { notIn: ["pending", "archived"] },
        }),
      }),
    )
    expect(mocks.indicatorDefinition.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          isActive: true,
          OR: [{ organizationId: null }, { organizationId: "org-1" }],
        },
      }),
    )
    expect(mocks.companyIndicator.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          indicatorId: {
            in: ["org-a", "universal-b", "override-c", "disabled-d"],
          },
        }),
      }),
    )
    expect(mocks.indicatorValue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ period: "2025" }),
      }),
    )

    expect(result.companies).toHaveLength(1)
    expect(result.companies[0]).toMatchObject({
      applicableCount: 3,
      presentCount: 2,
      missingCount: 1,
      readinessPct: 67,
    })
    expect(result.companies[0].presentItems.map((item) => item.indicatorCode)).toEqual([
      "A",
      "C",
    ])
    expect(result.companies[0].items.map((item) => item.indicatorCode)).toEqual(["B"])
  })
})

function definition(
  id: string,
  code: string,
  organizationId: string | null,
  industries: string[],
) {
  return {
    id,
    code,
    organizationId,
    industries,
    isActive: true,
    nameEn: `Indicator ${code}`,
    nameRu: null,
    nameAz: null,
    category: "finance",
    unit: "%",
    direction: "higher_is_better",
    requiredInputs: ["budgetLine:revenue"],
  }
}
