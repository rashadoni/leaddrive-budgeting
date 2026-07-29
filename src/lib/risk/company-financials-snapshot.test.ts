/**
 * getCompanyFinancialsSnapshot — FX normalization + scoping (terminal-audit #8).
 *
 * Pure async over a prisma-like `{ budgetLine: { findMany } }`. Locks:
 *  - AZN lines sum straight + ebitda = revenue − cogs − opex.
 *  - A foreign line with valid evidence keeps its already-base plannedAmount.
 *  - A foreign line with no/invalid rate is skipped (fail-closed).
 *  - organizationId, when supplied, is pinned in the where (defense-in-depth).
 *  - No lines → nulls (the "macro-placeholder, low-confidence" contract).
 */
import { describe, it, expect } from "vitest"
import { getCompanyFinancialsSnapshot } from "./company-financials-snapshot"

type Line = {
  lineType: string
  plannedAmount: number
  originalAmount?: number | null
  currencyCode: string | null
  exchangeRate: number | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakePrisma(lines: Line[], capture?: (args: any) => void): any {
  return {
    budgetLine: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findMany: async (args: any) => {
        capture?.(args)
        return lines
      },
    },
  }
}

describe("getCompanyFinancialsSnapshot", () => {
  it("sums AZN lines by lineType and derives ebitda", async () => {
    const p = fakePrisma([
      { lineType: "revenue", plannedAmount: 1000, currencyCode: null, exchangeRate: null },
      { lineType: "cogs", plannedAmount: 400, currencyCode: "AZN", exchangeRate: null },
      { lineType: "expense", plannedAmount: 200, currencyCode: null, exchangeRate: null },
    ])
    const s = await getCompanyFinancialsSnapshot(p, "c1", 2026)
    expect(s.revenueAZN).toBe(1000)
    expect(s.cogsAZN).toBe(400)
    expect(s.opexAZN).toBe(200)
    expect(s.ebitdaAZN).toBe(400) // 1000 − 400 − 200
  })

  it("keeps a foreign line's already-base planned amount unchanged", async () => {
    const p = fakePrisma([
      {
        lineType: "revenue",
        plannedAmount: 170,
        originalAmount: 100,
        currencyCode: "USD",
        exchangeRate: 1.7,
      },
    ])
    const s = await getCompanyFinancialsSnapshot(p, "c1", 2026)
    expect(s.revenueAZN).toBeCloseTo(170)
  })

  it("skips a foreign line with non-positive rate but accepts base AZN with null", async () => {
    const p = fakePrisma([
      { lineType: "revenue", plannedAmount: 500, currencyCode: "AZN", exchangeRate: null },
      { lineType: "revenue", plannedAmount: 170, currencyCode: "USD", exchangeRate: 0 },
    ])
    const s = await getCompanyFinancialsSnapshot(p, "c1", 2026)
    expect(s.revenueAZN).toBe(500)
  })

  it("REGRESSION (terminal-audit P3): skips a foreign line with no exchange rate (no face-value sum)", async () => {
    const p = fakePrisma([
      { lineType: "revenue", plannedAmount: 500, currencyCode: null, exchangeRate: null }, // AZN 500
      { lineType: "revenue", plannedAmount: 999, currencyCode: "USD", exchangeRate: null }, // unconvertible → skip
    ])
    const s = await getCompanyFinancialsSnapshot(p, "c1", 2026)
    expect(s.revenueAZN).toBe(500) // 999 USD excluded, NOT summed at face value
  })

  it("pins organizationId + plan/kind/deletedAt in the query when supplied", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let captured: any
    const p = fakePrisma([], (args) => {
      captured = args
    })
    await getCompanyFinancialsSnapshot(p, "c1", 2026, "org_1")
    expect(captured.where.organizationId).toBe("org_1")
    expect(captured.where.companyId).toBe("c1")
    // Phase 11.4 — soft-deleted plans must not feed the snapshot.
    expect(captured.where.plan).toEqual({
      year: 2026,
      kind: "actual",
      deletedAt: null,
    })
    expect(captured.where.deletedAt).toBeNull()
  })

  it("omits organizationId from the where when not supplied (back-compat)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let captured: any
    await getCompanyFinancialsSnapshot(fakePrisma([], (a) => { captured = a }), "c1", 2026)
    expect("organizationId" in captured.where).toBe(false)
  })

  it("returns nulls when no budget lines (no-data contract)", async () => {
    const s = await getCompanyFinancialsSnapshot(fakePrisma([]), "c1", 2026)
    expect(s.revenueAZN).toBeNull()
    expect(s.cogsAZN).toBeNull()
    expect(s.opexAZN).toBeNull()
    expect(s.ebitdaAZN).toBeNull()
    expect(s.period).toBe("2026")
  })
})
