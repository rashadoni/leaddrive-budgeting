import { describe, it, expect } from "vitest"
import {
  runIfrsChecks,
  buildIfrsInput,
  type IfrsBalanceSheetSnapshot,
  type IfrsPnlSnapshot,
} from "./ifrs-checks"

/* ── snapshot builders with sane defaults ── */
function bs(over: Partial<IfrsBalanceSheetSnapshot> = {}): IfrsBalanceSheetSnapshot {
  return {
    present: true,
    assets: 0,
    liabilities: 0,
    equity: 0,
    hasAssetSection: true,
    hasLiabilitySection: true,
    hasEquitySection: true,
    lineCount: 1,
    // Defaults represent a well-classified import → the v2 checks pass.
    assetLineCount: 1,
    assetSubTypedCount: 1,
    liabilityLineCount: 1,
    liabilitySubTypedCount: 1,
    equityComponentCount: 2,
    ...over,
  }
}
function pnl(over: Partial<IfrsPnlSnapshot> = {}): IfrsPnlSnapshot {
  return {
    present: true,
    revenue: 0,
    cogs: 0,
    opex: 0,
    revenueAccountCount: 0,
    cogsAccountCount: 0,
    opexAccountCount: 0,
    depreciationAccountCount: 0,
    lineCount: 1,
    ...over,
  }
}
const NO_BS = bs({ present: false, hasAssetSection: false, hasLiabilitySection: false, hasEquitySection: false, lineCount: 0, assetLineCount: 0, assetSubTypedCount: 0, liabilityLineCount: 0, liabilitySubTypedCount: 0, equityComponentCount: 0 })
const NO_PNL = pnl({ present: false, lineCount: 0 })

function find(report: ReturnType<typeof runIfrsChecks>, code: string) {
  const c = report.checks.find((x) => x.code === code)
  if (!c) throw new Error(`check ${code} missing`)
  return c
}

describe("runIfrsChecks — balance sheet balances (real signed-convention data)", () => {
  it("AZSEKER-MALT balances exactly (signed trial-balance convention)", () => {
    // Real DB figures: assets positive, liabilities & equity negative, sum = 0.
    const r = runIfrsChecks({
      balanceSheet: bs({ assets: 326066365, liabilities: -128398951, equity: -197667414 }),
      pnl: NO_PNL,
    })
    const c = find(r, "bs_balances")
    expect(c.status).toBe("pass")
    expect(c.values?.residual).toBe(0)
  })

  it("AZSEKER-AZSF balances within rounding tolerance (residual 2 on 2.1bn)", () => {
    const r = runIfrsChecks({
      balanceSheet: bs({ assets: 2107192947, liabilities: -47146658, equity: -2060046287 }),
      pnl: NO_PNL,
    })
    expect(find(r, "bs_balances").status).toBe("pass")
  })

  it("accepts the natural all-positive convention too (A − L − E ≈ 0)", () => {
    const r = runIfrsChecks({
      balanceSheet: bs({ assets: 1000, liabilities: 600, equity: 400 }),
      pnl: NO_PNL,
    })
    expect(find(r, "bs_balances").status).toBe("pass")
  })

  it("fails when the sheet does not balance beyond tolerance", () => {
    const r = runIfrsChecks({
      balanceSheet: bs({ assets: 1000, liabilities: -600, equity: -100 }), // residual 300
      pnl: NO_PNL,
    })
    const c = find(r, "bs_balances")
    expect(c.status).toBe("fail")
    expect(c.values?.residual).toBe(300)
  })

  it("skips balance check when no balance sheet was imported", () => {
    const r = runIfrsChecks({ balanceSheet: NO_BS, pnl: pnl({ revenue: 5, revenueAccountCount: 1 }) })
    expect(find(r, "bs_balances").status).toBe("skip")
    expect(find(r, "bs_sections").status).toBe("skip")
  })
})

describe("runIfrsChecks — balance sheet sections", () => {
  it("passes when all three sections present", () => {
    const r = runIfrsChecks({ balanceSheet: bs({ assets: 100, liabilities: -60, equity: -40 }), pnl: NO_PNL })
    expect(find(r, "bs_sections").status).toBe("pass")
  })
  it("warns when exactly one section is missing", () => {
    const r = runIfrsChecks({
      balanceSheet: bs({ assets: 100, liabilities: -100, equity: 0, hasEquitySection: false }),
      pnl: NO_PNL,
    })
    const c = find(r, "bs_sections")
    expect(c.status).toBe("warn")
    expect(c.values?.missing).toBe("equity")
  })
  it("fails when two or more sections are missing", () => {
    const r = runIfrsChecks({
      balanceSheet: bs({ assets: 100, liabilities: 0, equity: 0, hasLiabilitySection: false, hasEquitySection: false }),
      pnl: NO_PNL,
    })
    expect(find(r, "bs_sections").status).toBe("fail")
  })
})

describe("runIfrsChecks — current/non-current split (IAS 1 §60)", () => {
  it("passes when assets and liabilities carry a subType", () => {
    const r = runIfrsChecks({
      balanceSheet: bs({ assetLineCount: 4, assetSubTypedCount: 4, liabilityLineCount: 3, liabilitySubTypedCount: 3 }),
      pnl: NO_PNL,
    })
    expect(find(r, "bs_current_noncurrent").status).toBe("pass")
  })
  it("warns when a section lacks the current/non-current split", () => {
    const r = runIfrsChecks({
      balanceSheet: bs({ assetLineCount: 4, assetSubTypedCount: 0, liabilityLineCount: 3, liabilitySubTypedCount: 3 }),
      pnl: NO_PNL,
    })
    const c = find(r, "bs_current_noncurrent")
    expect(c.status).toBe("warn")
    expect(c.values?.unclassified).toBe("assets")
  })
  it("skips when no balance sheet imported", () => {
    const r = runIfrsChecks({ balanceSheet: NO_BS, pnl: pnl({ revenue: 1, revenueAccountCount: 1 }) })
    expect(find(r, "bs_current_noncurrent").status).toBe("skip")
  })
})

describe("runIfrsChecks — equity composition (IAS 1 §54)", () => {
  it("passes when equity is split into >=2 components", () => {
    const r = runIfrsChecks({ balanceSheet: bs({ equityComponentCount: 3 }), pnl: NO_PNL })
    expect(find(r, "bs_equity_composition").status).toBe("pass")
  })
  it("warns when equity is a single lumped line", () => {
    const r = runIfrsChecks({ balanceSheet: bs({ equityComponentCount: 1 }), pnl: NO_PNL })
    const c = find(r, "bs_equity_composition")
    expect(c.status).toBe("warn")
    expect(c.values?.equityComponents).toBe(1)
  })
  it("skips when there is no equity section", () => {
    const r = runIfrsChecks({ balanceSheet: bs({ hasEquitySection: false, equityComponentCount: 0 }), pnl: NO_PNL })
    expect(find(r, "bs_equity_composition").status).toBe("skip")
  })
})

describe("runIfrsChecks — P&L revenue", () => {
  it("passes when revenue recognised", () => {
    const r = runIfrsChecks({ balanceSheet: NO_BS, pnl: pnl({ revenue: 5000, revenueAccountCount: 3 }) })
    expect(find(r, "pnl_revenue").status).toBe("pass")
  })
  it("warns when revenue accounts exist but total is zero", () => {
    const r = runIfrsChecks({ balanceSheet: NO_BS, pnl: pnl({ revenue: 0, revenueAccountCount: 2 }) })
    expect(find(r, "pnl_revenue").status).toBe("warn")
  })
  it("fails when no revenue accounts exist", () => {
    const r = runIfrsChecks({ balanceSheet: NO_BS, pnl: pnl({ opex: 100, opexAccountCount: 1 }) })
    expect(find(r, "pnl_revenue").status).toBe("fail")
  })
})

describe("runIfrsChecks — COGS vs OpEx separation", () => {
  it("passes when both COGS and OpEx accounts present", () => {
    const r = runIfrsChecks({ balanceSheet: NO_BS, pnl: pnl({ cogsAccountCount: 4, opexAccountCount: 6 }) })
    expect(find(r, "pnl_cogs_opex_separation").status).toBe("pass")
  })
  it("warns when only one of the two is present", () => {
    const onlyCogs = runIfrsChecks({ balanceSheet: NO_BS, pnl: pnl({ cogsAccountCount: 4 }) })
    expect(find(onlyCogs, "pnl_cogs_opex_separation").status).toBe("warn")
    const onlyOpex = runIfrsChecks({ balanceSheet: NO_BS, pnl: pnl({ opexAccountCount: 4 }) })
    expect(find(onlyOpex, "pnl_cogs_opex_separation").status).toBe("warn")
  })
  it("fails when neither cost nor expense accounts exist", () => {
    const r = runIfrsChecks({ balanceSheet: NO_BS, pnl: pnl({ revenue: 1, revenueAccountCount: 1 }) })
    expect(find(r, "pnl_cogs_opex_separation").status).toBe("fail")
  })
})

describe("runIfrsChecks — depreciation disclosure", () => {
  it("passes when a depreciation account is identifiable", () => {
    const r = runIfrsChecks({ balanceSheet: NO_BS, pnl: pnl({ depreciationAccountCount: 1 }) })
    expect(find(r, "pnl_depreciation").status).toBe("pass")
  })
  it("warns when no D&A line is identified (honest IAS 1 gap)", () => {
    const r = runIfrsChecks({ balanceSheet: NO_BS, pnl: pnl({ opexAccountCount: 3 }) })
    expect(find(r, "pnl_depreciation").status).toBe("warn")
  })
})

describe("buildIfrsInput — shaping raw DB rows", () => {
  it("sums balance-sheet sections and flags section presence", () => {
    const input = buildIfrsInput(
      [
        { lineType: "asset", amount: 326066365 },
        { lineType: "liability", amount: -128398951 },
        { lineType: "equity", amount: -197667414 },
      ],
      [],
    )
    expect(input.balanceSheet.present).toBe(true)
    expect(input.balanceSheet.assets).toBe(326066365)
    expect(input.balanceSheet.hasEquitySection).toBe(true)
    expect(input.pnl.present).toBe(false)
  })

  it("counts DISTINCT P&L accounts per class (an account repeats across periods)", () => {
    const input = buildIfrsInput(
      [],
      [
        { amount: 100, accountType: "revenue", accountKey: "acc_rev1" },
        { amount: 120, accountType: "revenue", accountKey: "acc_rev1" }, // same account, next period
        { amount: 50, accountType: "cogs", accountKey: "acc_cogs1" },
        { amount: 30, accountType: "expense", accountKey: "acc_opex1" },
        { amount: 30, accountType: "expense", accountKey: "acc_opex2" },
      ],
    )
    expect(input.pnl.revenue).toBe(220)
    expect(input.pnl.revenueAccountCount).toBe(1) // deduped
    expect(input.pnl.cogsAccountCount).toBe(1)
    expect(input.pnl.opexAccountCount).toBe(2)
  })

  it("detects depreciation by category and by multilingual name", () => {
    const input = buildIfrsInput(
      [],
      [
        { amount: 10, accountType: "expense", accountKey: "a1", category: "depreciation" },
        { amount: 10, accountType: "cogs", accountKey: "a2", accountName: "Amortizasiya xərcləri" },
        { amount: 10, accountType: "expense", accountKey: "a3", accountName: "Износ основных средств" },
        { amount: 10, accountType: "expense", accountKey: "a4", accountName: "Salaries" }, // not D&A
      ],
    )
    expect(input.pnl.depreciationAccountCount).toBe(3)
  })

  it("round-trips a well-classified company through runIfrsChecks to a 100 report", () => {
    const input = buildIfrsInput(
      [
        { lineType: "asset", amount: 700, subType: "non_current", accountKey: "a1" },
        { lineType: "asset", amount: 300, subType: "current", accountKey: "a2" },
        { lineType: "liability", amount: -600, subType: "short_term", accountKey: "l1" },
        { lineType: "equity", amount: -250, accountKey: "eq_capital" },
        { lineType: "equity", amount: -150, accountKey: "eq_retained" },
      ],
      [
        { amount: 500, accountType: "revenue", accountKey: "r1" },
        { amount: 200, accountType: "cogs", accountKey: "c1" },
        { amount: 100, accountType: "expense", accountKey: "e1", category: "depreciation" },
      ],
    )
    expect(input.balanceSheet.assetSubTypedCount).toBe(2)
    expect(input.balanceSheet.equityComponentCount).toBe(2)
    const report = runIfrsChecks(input)
    expect(report.summary.fail).toBe(0)
    expect(report.summary.warn).toBe(0)
    expect(report.summary.score).toBe(100)
  })
})

describe("runIfrsChecks — skip + summary", () => {
  it("skips every check for an empty company", () => {
    const r = runIfrsChecks({ balanceSheet: NO_BS, pnl: NO_PNL })
    expect(r.checks.every((c) => c.status === "skip")).toBe(true)
    expect(r.summary.skip).toBe(7)
    expect(r.summary.score).toBeNull()
  })

  it("scores 100 when every scored check passes", () => {
    const r = runIfrsChecks({
      balanceSheet: bs({ assets: 100, liabilities: -60, equity: -40 }),
      pnl: pnl({ revenue: 9, revenueAccountCount: 1, cogsAccountCount: 1, opexAccountCount: 1, depreciationAccountCount: 1 }),
    })
    expect(r.summary.fail).toBe(0)
    expect(r.summary.warn).toBe(0)
    expect(r.summary.score).toBe(100)
  })

  it("counts a warn as half a pass in the score", () => {
    // 6 pass + 1 warn over 7 scored = (6 + 0.5)/7 = 92.86 → 93
    const r = runIfrsChecks({
      balanceSheet: bs({ assets: 100, liabilities: -60, equity: -40 }),
      pnl: pnl({ revenue: 9, revenueAccountCount: 1, cogsAccountCount: 1, opexAccountCount: 1, depreciationAccountCount: 0 }),
    })
    expect(r.summary.pass).toBe(6)
    expect(r.summary.warn).toBe(1)
    expect(r.summary.score).toBe(93)
  })

  it("always returns exactly the seven structural checks", () => {
    const r = runIfrsChecks({ balanceSheet: NO_BS, pnl: NO_PNL })
    expect(r.checks.map((c) => c.code).sort()).toEqual(
      [
        "bs_balances",
        "bs_sections",
        "bs_current_noncurrent",
        "bs_equity_composition",
        "pnl_cogs_opex_separation",
        "pnl_depreciation",
        "pnl_revenue",
      ].sort(),
    )
  })
})
