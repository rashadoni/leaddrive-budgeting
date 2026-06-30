import { describe, expect, it } from "vitest"
import {
  findApprovedSemanticCoaDecision,
  isDerivedFinancialLabel,
  loadSemanticCoaAccounts,
  rankSemanticCoaCandidates,
  resolveSemanticCoaLabel,
} from "./semantic-coa-mapper"
import type { SemanticCoaAccount } from "./semantic-coa-mapper"

const accounts: SemanticCoaAccount[] = [
  {
    code: "PLF.01.01.01",
    name: "Revenue",
    accountType: "revenue",
  },
  {
    code: "PLF.02.01.01",
    name: "Raw materials",
    accountType: "cogs",
  },
  {
    code: "BS.01.02.01",
    name: "Cash and cash equivalents",
    accountType: "asset",
  },
  {
    code: "BS.03.02.01",
    name: "Loans payable",
    accountType: "liability",
  },
]

describe("semantic CoA mapper", () => {
  it("maps common no-code labels to high-confidence CoA candidates", () => {
    const revenue = resolveSemanticCoaLabel({
      dataType: "PLF",
      label: "Revenue",
      accounts,
    })
    const cash = resolveSemanticCoaLabel({
      dataType: "BS",
      label: "Cash equivalents",
      accounts,
    })

    expect(revenue).toMatchObject({
      code: "PLF.01.01.01",
      accountType: "revenue",
    })
    expect(cash).toMatchObject({
      code: "BS.01.02.01",
      accountType: "asset",
    })
  })

  it("does not map derived totals and calculated rows", () => {
    expect(isDerivedFinancialLabel("EBITDA")).toBe(true)
    expect(
      resolveSemanticCoaLabel({
        dataType: "PLF",
        label: "Gross margin",
        accounts,
      }),
    ).toBeNull()
  })

  it("exposes lower-confidence candidates for review without auto-resolving", () => {
    const match = resolveSemanticCoaLabel({
      dataType: "BS",
      label: "Loans",
      accounts,
      minConfidence: 0.95,
    })
    const candidates = rankSemanticCoaCandidates({
      dataType: "BS",
      label: "Loans",
      accounts,
      minScore: 0.35,
      limit: 3,
    })

    expect(match).toBeNull()
    expect(candidates[0]).toMatchObject({ code: "BS.03.02.01" })
  })

  it("finds approved decisions with normalized labels", () => {
    expect(
      findApprovedSemanticCoaDecision("  raw   materials ", [
        {
          sourceLabel: "Raw Materials",
          targetCode: "PLF.02.01.01",
          confidence: 1,
          action: "map",
        },
      ]),
    ).toMatchObject({ targetCode: "PLF.02.01.01" })
  })

  it("ignores existing parent CoA rows when loading semantic candidates", async () => {
    const prisma = {
      chartOfAccount: {
        findMany: async () => [
          {
            code: "PLF.01",
            name: "Revenue",
            nameAz: null,
            nameRu: null,
            nameEn: null,
            accountType: "revenue",
          },
        ],
      },
    } as any
    const loaded = await loadSemanticCoaAccounts(prisma, "org1", "PLF")
    const match = resolveSemanticCoaLabel({
      dataType: "PLF",
      label: "Revenue",
      accounts: loaded,
    })

    expect(loaded.some((account) => account.code === "PLF.01")).toBe(false)
    expect(match?.code).toBe("PLF.01.01.01")
  })
})
