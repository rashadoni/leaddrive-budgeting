/**
 * Phase 10 / B1 shadow slice — adapter unit tests (pure, no DB).
 *
 * Pins the shadow guarantees: the policy is the recorded T-1 Option A SHAPE
 * frozen at "provisional", every output is "provisional" or "blocked" (never
 * pass/fail), every revisionId is null, evidencedZero is never emitted, and
 * the structurally-absent components block honestly instead of fabricating
 * evidence. `fetchStatementEvidence` is exercised with a mock tx.
 */

import { describe, it, expect } from "vitest"
import type { Prisma } from "@prisma/client"
import azMessages from "../../../messages/az.json"
import enMessages from "../../../messages/en.json"
import ruMessages from "../../../messages/ru.json"
import {
  SHADOW_STATEMENT_POLICY,
  assembleShadowStatementControls,
  detectBsSignConvention,
  fetchStatementEvidence,
  type Bucket,
  type ShadowControlEntry,
  type ShadowStatementEvidence,
} from "./statement-controls-adapter"

const ORG_ID = "org-1"
const COMPANY_ID = "company-1"
const PERIOD = "2026-03"
const OPENING = "2026-02"

function bucket(sum: number, rowCount: number): Bucket {
  return { sum, rowCount }
}

const EMPTY = bucket(0, 0)

function makeEvidence(over: Partial<ShadowStatementEvidence> = {}): ShadowStatementEvidence {
  return {
    organizationId: ORG_ID,
    companyId: COMPANY_ID,
    periodKey: PERIOD,
    openingPeriodKey: OPENING,
    bs: {
      assets: bucket(1_000, 4),
      liabilities: bucket(400, 3),
      equity: bucket(600, 2),
      currentYearResult: null,
      rawSums: { assets: 1_000, liabilities: -400, equity: -600 },
      signConvention: detectBsSignConvention(1_000, -400, -600),
      ...(over.bs ?? {}),
    },
    cf: {
      operating: bucket(900, 5),
      investing: bucket(-500, 2),
      financing: bucket(-200, 1),
      fxEffectOnCash: EMPTY,
      netChangeInCash: EMPTY,
      openingCash: EMPTY,
      closingCash: EMPTY,
      ...(over.cf ?? {}),
    },
    pl: {
      revenue: bucket(5_000, 3),
      cogs: bucket(2_000, 2),
      expense: bucket(1_100, 2),
      monthIndexNullCount: 0,
      ytdAligned: true,
      planCount: 1,
      ...(over.pl ?? {}),
    },
    fx: over.fx ?? [],
    ...Object.fromEntries(
      Object.entries(over).filter(([k]) => !["bs", "cf", "pl", "fx"].includes(k)),
    ),
  }
}

function entry(entries: ShadowControlEntry[], code: string, currency?: string): ShadowControlEntry {
  const found = entries.find(
    (e) => e.code === code && (currency === undefined || e.currency === currency),
  )
  if (!found) throw new Error(`no entry for ${code}`)
  return found
}

/** Every guarantee the shadow surface must never break, swept over any output. */
function assertShadowInvariants(entries: ShadowControlEntry[]): void {
  for (const e of entries) {
    if (e.kind === "evaluated") {
      expect(["provisional", "blocked"]).toContain(e.result.decisionStatus)
      expect(e.result.decisionStatus).not.toBe("pass")
      expect(e.result.decisionStatus).not.toBe("fail")
      expect(e.result.decisionEligible).toBe(false)
      expect(e.left.revisionId).toBeNull()
      expect(e.right.revisionId).toBeNull()
    }
    for (const c of e.components) {
      // evidencedZero is used nowhere: an absent component is null-evidence
      // (present: false), never a fabricated zero row.
      if (!c.present) expect(c.value).toBeNull()
    }
  }
}

// ───────────────────────── policy pinning ─────────────────────────

describe("SHADOW_STATEMENT_POLICY", () => {
  it("deep-equals the recorded T-1 Option A SHAPE and stays provisional", () => {
    expect(SHADOW_STATEMENT_POLICY).toEqual({
      id: "t1-option-a-shape-shadow-v1",
      approval: "provisional",
      relativeTolerance: 0.00001,
      absoluteFloorByCurrency: {
        AZN: 1.0,
        USD: 0.01,
        EUR: 0.01,
        GBP: 0.01,
        TRY: 0.01,
        RUB: 0.01,
      },
      materialityRate: 0.001,
      materialityFloorByCurrency: {
        AZN: 10_000,
        USD: 0,
        EUR: 0,
        GBP: 0,
        TRY: 0,
        RUB: 0,
      },
    })
  })

  it("pre-registers every pilot currency in both floor maps without approving the policy", () => {
    for (const currency of ["AZN", "USD", "EUR", "GBP", "TRY", "RUB"]) {
      expect(SHADOW_STATEMENT_POLICY.absoluteFloorByCurrency[currency]).toBeDefined()
      expect(SHADOW_STATEMENT_POLICY.materialityFloorByCurrency[currency]).toBeDefined()
    }
    expect(SHADOW_STATEMENT_POLICY.approval).toBe("provisional")
  })

  it("is frozen, including the currency-floor maps", () => {
    expect(Object.isFrozen(SHADOW_STATEMENT_POLICY)).toBe(true)
    expect(Object.isFrozen(SHADOW_STATEMENT_POLICY.absoluteFloorByCurrency)).toBe(true)
    expect(Object.isFrozen(SHADOW_STATEMENT_POLICY.materialityFloorByCurrency)).toBe(true)
  })
})

// ───────────────────────── sign convention ─────────────────────────

describe("detectBsSignConvention", () => {
  it("detects trial-balance storage (liabilities/equity stored negative)", () => {
    const d = detectBsSignConvention(100, -60, -40)
    expect(d.convention).toBe("trial_balance")
    expect(d.signedResidual).toBe(0)
    expect(d.naturalResidual).toBe(200)
  })

  it("leaves natural-stored input as natural", () => {
    const d = detectBsSignConvention(100, 60, 40)
    expect(d.convention).toBe("natural")
    expect(d.signedResidual).toBe(200)
    expect(d.naturalResidual).toBe(0)
  })
})

// ───────────────────────── balance_sheet ─────────────────────────

describe("assembleShadowStatementControls — balance_sheet", () => {
  it("evaluates to provisional with exactly [policy_not_approved, lineage_missing]", () => {
    const entries = assembleShadowStatementControls(makeEvidence())
    const e = entry(entries, "balance_sheet")
    if (e.kind !== "evaluated") throw new Error("expected evaluated")
    expect(e.result.decisionStatus).toBe("provisional")
    expect(e.result.reasons).toEqual(["policy_not_approved", "lineage_missing"])
    expect(e.result.signedDelta).toBe(0) // 1000 − (400 + 600)
    expect(e.left.value).toBe(1_000)
    expect(e.left.sourceRowCount).toBe(4)
    expect(e.right.value).toBe(1_000)
    expect(e.right.sourceRowCount).toBe(5) // 3 liability + 2 equity rows
    assertShadowInvariants(entries)
  })

  it("reports the signed delta of a genuine imbalance", () => {
    const entries = assembleShadowStatementControls(
      makeEvidence({
        bs: {
          assets: bucket(1_050, 4),
          liabilities: bucket(400, 3),
          equity: bucket(600, 2),
          currentYearResult: null,
          rawSums: { assets: 1_050, liabilities: -400, equity: -600 },
          signConvention: detectBsSignConvention(1_050, -400, -600),
        },
      }),
    )
    const e = entry(entries, "balance_sheet")
    if (e.kind !== "evaluated") throw new Error("expected evaluated")
    expect(e.result.signedDelta).toBe(50)
    expect(e.result.numericStatus).toBe("outside_tolerance")
    expect(e.result.decisionStatus).toBe("provisional") // still never "fail"
  })

  it("blocks when the liabilities bucket has zero rows — without policy_not_approved", () => {
    const entries = assembleShadowStatementControls(
      makeEvidence({
        bs: {
          assets: bucket(1_000, 4),
          liabilities: EMPTY,
          equity: bucket(600, 2),
          currentYearResult: null,
          rawSums: { assets: 1_000, liabilities: 0, equity: -600 },
          signConvention: detectBsSignConvention(1_000, 0, -600),
        },
      }),
    )
    const e = entry(entries, "balance_sheet")
    if (e.kind !== "evaluated") throw new Error("expected evaluated")
    expect(e.result.decisionStatus).toBe("blocked")
    expect(e.result.reasons).toContain("non_finite_value")
    expect(e.result.reasons).toContain("source_rows_missing")
    // Verified evaluator behavior: blocked results carry ONLY structural
    // reasons — the blocked return happens before policy/lineage are appended.
    expect(e.result.reasons).not.toContain("policy_not_approved")
    expect(e.result.reasons).not.toContain("lineage_missing")
    const liab = e.components.find((c) => c.component === "liabilities")
    expect(liab?.present).toBe(false)
    expect(liab?.value).toBeNull()
  })
})

// ───────────────────────── blocked-by-design controls ─────────────────────────

describe("assembleShadowStatementControls — cash bridge evidence", () => {
  it("keeps the new bridge component and explanation in az/en/ru parity", () => {
    for (const messages of [azMessages, enMessages, ruMessages]) {
      expect(messages.adminStatementControls.components.fxEffectOnCash).toBeTruthy()
      expect(messages.adminStatementControls.controls.cash_flow_sum.equation).toBeTruthy()
      expect(messages.adminStatementControls.blockedDetail.netChangeNotStored).toBeTruthy()
    }
  })

  it("cash_flow_sum blocks even with rich CF rows: net change is never derived", () => {
    const entries = assembleShadowStatementControls(makeEvidence())
    const e = entry(entries, "cash_flow_sum")
    if (e.kind !== "evaluated") throw new Error("expected evaluated")
    expect(e.result.decisionStatus).toBe("blocked")
    // Left side carries the real CF evidence; the right side is honestly NaN.
    expect(e.left.value).toBe(200) // 900 − 500 − 200
    expect(e.left.sourceRowCount).toBe(8)
    expect(e.right.value).toBeNull()
    expect(e.right.sourceRowCount).toBe(0)
    const net = e.components.find((c) => c.component === "netChangeInCash")
    expect(net?.present).toBe(false)
    expect(net?.noteKey).toBe("netChangeNotStored")
    expect(e.notes).toContain("netChangeNotStored")
  })

  it("cash_flow_sum evaluates imported CF.05 independently and includes CF.04 once", () => {
    const entries = assembleShadowStatementControls(makeEvidence({
      cf: {
        operating: bucket(900, 5),
        investing: bucket(-500, 2),
        financing: bucket(-200, 1),
        fxEffectOnCash: bucket(25, 1),
        netChangeInCash: bucket(225, 1),
        openingCash: bucket(1_000, 1),
        closingCash: bucket(1_225, 1),
      },
    }))
    const e = entry(entries, "cash_flow_sum")
    if (e.kind !== "evaluated") throw new Error("expected evaluated")
    expect(e.result.decisionStatus).toBe("provisional")
    expect(e.left.value).toBe(225)
    expect(e.right.value).toBe(225)
    expect(e.result.signedDelta).toBe(0)
    expect(e.components.filter((c) => c.component === "fxEffectOnCash")).toHaveLength(1)
    expect(e.notes).not.toContain("netChangeNotStored")
  })

  it("cash_to_balance_sheet blocks with both cash markers absent", () => {
    const entries = assembleShadowStatementControls(makeEvidence())
    const e = entry(entries, "cash_to_balance_sheet")
    if (e.kind !== "evaluated") throw new Error("expected evaluated")
    expect(e.result.decisionStatus).toBe("blocked")
    expect(e.notes).toEqual(["netChangeNotStored", "cashNotIdentifiable"])
    const opening = e.components.find((c) => c.component === "openingCash")
    expect(opening?.present).toBe(false)
    expect(opening?.noteKey).toBe("cashNotIdentifiable")
    // Partial-evidence context: the CF sections are shown but never summed
    // into a derived net change.
    const op = e.components.find((c) => c.component === "operating")
    expect(op?.present).toBe(true)
    expect(op?.value).toBe(900)
  })

  it("retained_earnings blocks on absent distributions/RE markers with exact blockedDetail keys", () => {
    const entries = assembleShadowStatementControls(makeEvidence())
    const e = entry(entries, "retained_earnings")
    if (e.kind !== "evaluated") throw new Error("expected evaluated")
    expect(e.result.decisionStatus).toBe("blocked")
    expect(e.notes).toEqual(["retainedEarningsNotIdentifiable", "distributionsNotRecorded"])
    const dist = e.components.find((c) => c.component === "distributions")
    expect(dist?.present).toBe(false)
    expect(dist?.noteKey).toBe("distributionsNotRecorded")
    // Net income still shows as partial evidence (5000 − 2000 − 1100).
    const ni = e.components.find((c) => c.component === "netIncome")
    expect(ni?.present).toBe(true)
    expect(ni?.value).toBe(1_900)
  })

  it("never emits evidencedZero anywhere in any output", () => {
    const entries = assembleShadowStatementControls(makeEvidence())
    // Serialize the whole output: the marker string must not exist at all.
    expect(JSON.stringify(entries)).not.toContain("evidencedZero")
    assertShadowInvariants(entries)
  })
})

// ───────────────────────── CF sign convention ─────────────────────────

describe("fetchStatementEvidence — CF sign convention", () => {
  it("reconstructs signed flows as Σ(inflow ? amount : −amount) — no abs() fabrication", async () => {
    const tx = mockTx({
      balanceSheetLine: [
        bsRow("asset", 100, "Cash account"),
      ],
      cashFlowEntry: [
        { activityType: "operating", entryType: "inflow", amount: 100 },
        { activityType: "operating", entryType: "outflow", amount: 40 },
      ],
      budgetLine: [],
      currencyRateHistory: [],
    })
    const evidence = await fetchStatementEvidence(tx, ORG_ID, COMPANY_ID)
    expect(evidence?.cf.operating).toEqual({ sum: 60, rowCount: 2 })
  })

  it("classifies CF.04–CF.07 as separate bridge evidence by canonical account code", async () => {
    const tx = mockTx({
      balanceSheetLine: [bsRow("asset", 100, "Cash account")],
      cashFlowEntry: [
        { activityType: "bridge", entryType: "inflow", amount: 5, account: { code: "CF.04" } },
        { activityType: "bridge", entryType: "inflow", amount: 105, account: { code: "CF.05.01" } },
        { activityType: "bridge", entryType: "inflow", amount: 1_000, account: { code: "CF.06" } },
        { activityType: "bridge", entryType: "inflow", amount: 1_105, account: { code: "CF.07" } },
      ],
      budgetLine: [],
      currencyRateHistory: [],
    })

    const evidence = await fetchStatementEvidence(tx, ORG_ID, COMPANY_ID)
    expect(evidence?.cf.fxEffectOnCash).toEqual({ sum: 5, rowCount: 1 })
    expect(evidence?.cf.netChangeInCash).toEqual({ sum: 105, rowCount: 1 })
    expect(evidence?.cf.openingCash).toEqual({ sum: 1_000, rowCount: 1 })
    expect(evidence?.cf.closingCash).toEqual({ sum: 1_105, rowCount: 1 })
  })
})

// ───────────────────────── net_income_link ─────────────────────────

describe("assembleShadowStatementControls — net_income_link", () => {
  const cyBs = {
    assets: bucket(1_900, 1),
    liabilities: bucket(0, 0),
    equity: bucket(1_900, 1),
    currentYearResult: bucket(1_900, 1),
    rawSums: { assets: 1_900, liabilities: 0, equity: -1_900 },
    signConvention: detectBsSignConvention(1_900, 0, -1_900),
  }

  it("is provisional when fully month-indexed and a CY-result equity line matched", () => {
    const entries = assembleShadowStatementControls(makeEvidence({ bs: cyBs }))
    const e = entry(entries, "net_income_link")
    if (e.kind !== "evaluated") throw new Error("expected evaluated")
    expect(e.result.decisionStatus).toBe("provisional")
    expect(e.result.reasons).toEqual(["policy_not_approved", "lineage_missing"])
    expect(e.left.value).toBe(1_900) // YTD subset: 5000 − 2000 − 1100
    expect(e.right.value).toBe(1_900)
    expect(e.result.signedDelta).toBe(0)
  })

  it("blocks with monthIndexMissing when any contributing row lacks monthIndex", () => {
    const entries = assembleShadowStatementControls(
      makeEvidence({
        bs: cyBs,
        pl: {
          revenue: bucket(5_000, 3),
          cogs: bucket(2_000, 2),
          expense: bucket(1_100, 2),
          monthIndexNullCount: 2,
          ytdAligned: false,
          planCount: 1,
        },
      }),
    )
    const e = entry(entries, "net_income_link")
    if (e.kind !== "evaluated") throw new Error("expected evaluated")
    expect(e.result.decisionStatus).toBe("blocked")
    expect(e.notes).toContain("monthIndexMissing")
    const pnl = e.components.find((c) => c.component === "pnlNetIncome")
    expect(pnl?.present).toBe(false)
    expect(pnl?.noteKey).toBe("monthIndexMissing")
  })

  it("blocks with noCurrentYearResultLine when no equity line matched", () => {
    const entries = assembleShadowStatementControls(makeEvidence()) // currentYearResult: null
    const e = entry(entries, "net_income_link")
    if (e.kind !== "evaluated") throw new Error("expected evaluated")
    expect(e.result.decisionStatus).toBe("blocked")
    expect(e.notes).toContain("noCurrentYearResultLine")
    const linked = e.components.find((c) => c.component === "linkedStatementNetIncome")
    expect(linked?.present).toBe(false)
  })
})

// ───────────────────────── fx_translation ─────────────────────────

describe("assembleShadowStatementControls — fx_translation", () => {
  it("emits a single no_evidence entry when no foreign currency exists (builder not invoked)", () => {
    const entries = assembleShadowStatementControls(makeEvidence({ fx: [] }))
    const e = entry(entries, "fx_translation")
    expect(e.kind).toBe("no_evidence")
    if (e.kind !== "no_evidence") throw new Error("expected no_evidence")
    expect(e.reasonKey).toBe("noForeignCurrencyRows")
    expect(e.builderError).toBeUndefined()
  })

  it("blocks naming noIndependentRate when a month has no CurrencyRateHistory rate", () => {
    const entries = assembleShadowStatementControls(
      makeEvidence({
        fx: [
          {
            currencyCode: "USD",
            reportedBaseSum: 1_700,
            rowCount: 2,
            rows: [
              { originalAmount: 500, monthIndex: 0, rate: 1.7, rateDate: new Date("2026-01-15T00:00:00Z") },
              { originalAmount: 500, monthIndex: 1, rate: null, rateDate: null }, // no rate for Feb
            ],
          },
        ],
      }),
    )
    const e = entry(entries, "fx_translation", "USD")
    if (e.kind !== "evaluated") throw new Error("expected evaluated")
    expect(e.result.decisionStatus).toBe("blocked")
    expect(e.notes).toContain("noIndependentRate")
    const recomputed = e.components.find((c) => c.component === "recomputed")
    expect(recomputed?.present).toBe(false)
    expect(recomputed?.value).toBeNull()
  })

  it("is provisional on the happy path, using ONLY the independent CurrencyRateHistory rate", async () => {
    // The ledger's own rate (BudgetLine.exchangeRate = 1.9) is planted in the
    // DB rows; the independent CurrencyRateHistory rate is 1.7. The evidence
    // and the recompute must carry 1.7 and never 1.9 — the fetch never even
    // selects exchangeRate.
    const tx = mockTx({
      balanceSheetLine: [bsRow("asset", 100, "Cash")],
      cashFlowEntry: [],
      budgetLine: [
        {
          plannedAmount: 850,
          monthIndex: 0,
          currencyCode: "USD",
          originalAmount: 500,
          exchangeRate: 1.9, // ledger rate — must never be read
          planId: "plan-1",
          account: { accountType: "revenue" },
        },
      ],
      currencyRateHistory: [
        { currencyCode: "USD", rate: 1.7, rateDate: new Date("2026-01-15T00:00:00Z") },
      ],
    })
    const evidence = await fetchStatementEvidence(tx, ORG_ID, COMPANY_ID)
    if (!evidence) throw new Error("expected evidence")
    expect(evidence.fx).toHaveLength(1)
    expect(evidence.fx[0].rows[0].rate).toBe(1.7)
    expect(evidence.fx[0].rows[0].rate).not.toBe(1.9)
    // The matched rate's own date is retained for staleness disclosure.
    expect(evidence.fx[0].rows[0].rateDate).toEqual(new Date("2026-01-15T00:00:00Z"))
    // The budgetLine select must not request the ledger rate at all.
    const select = tx.calls.find((c) => c.method === "budgetLine.findMany")?.args?.select
    expect(select).toBeDefined()
    expect(Object.keys(select as Record<string, unknown>)).not.toContain("exchangeRate")

    const entries = assembleShadowStatementControls(evidence)
    const e = entry(entries, "fx_translation", "USD")
    if (e.kind !== "evaluated") throw new Error("expected evaluated")
    expect(e.result.decisionStatus).toBe("provisional")
    expect(e.result.reasons).toContain("lineage_missing")
    expect(e.right.value).toBe(500 * 1.7) // never 500 × 1.9
    // Same-month rate (Jan rate for a Jan row) → no staleness note.
    expect(e.notes).not.toContain("staleIndependentRate")
    expect(e.fxRateDates).toEqual({
      min: "2026-01-15T00:00:00.000Z",
      max: "2026-01-15T00:00:00.000Z",
      staleRowCount: 0,
    })
    assertShadowInvariants(entries)
  })

  it("discloses a years-old carried-forward rate as staleIndependentRate (still provisional)", async () => {
    // One 2020-dated CurrencyRateHistory row silently feeds every 2026 month
    // via carry-forward. The control still evaluates (matching semantics are
    // an owner methodology decision) but MUST disclose the staleness and the
    // matched rate's own date.
    const tx = mockTx({
      balanceSheetLine: [bsRow("asset", 100, "Cash")],
      cashFlowEntry: [],
      budgetLine: [
        {
          plannedAmount: 850,
          monthIndex: 0,
          currencyCode: "USD",
          originalAmount: 500,
          planId: "plan-1",
          account: { accountType: "revenue" },
        },
        {
          plannedAmount: 850,
          monthIndex: 1,
          currencyCode: "USD",
          originalAmount: 500,
          planId: "plan-1",
          account: { accountType: "revenue" },
        },
      ],
      currencyRateHistory: [
        { currencyCode: "USD", rate: 1.7, rateDate: new Date("2020-06-15T00:00:00Z") },
      ],
    })
    const evidence = await fetchStatementEvidence(tx, ORG_ID, COMPANY_ID)
    if (!evidence) throw new Error("expected evidence")
    expect(evidence.fx[0].rows.map((r) => r.rateDate)).toEqual([
      new Date("2020-06-15T00:00:00Z"),
      new Date("2020-06-15T00:00:00Z"),
    ])
    const entries = assembleShadowStatementControls(evidence)
    const e = entry(entries, "fx_translation", "USD")
    if (e.kind !== "evaluated") throw new Error("expected evaluated")
    expect(e.result.decisionStatus).toBe("provisional") // arithmetic still ties
    expect(e.notes).toContain("staleIndependentRate")
    expect(e.fxRateDates).toEqual({
      min: "2020-06-15T00:00:00.000Z",
      max: "2020-06-15T00:00:00.000Z",
      staleRowCount: 2,
    })
    assertShadowInvariants(entries)
  })

  it("does not flag a same-month rate as stale (pure assembly case)", () => {
    const entries = assembleShadowStatementControls(
      makeEvidence({
        fx: [
          {
            currencyCode: "USD",
            reportedBaseSum: 850,
            rowCount: 1,
            rows: [
              { originalAmount: 500, monthIndex: 0, rate: 1.7, rateDate: new Date("2026-01-10T00:00:00Z") },
            ],
          },
        ],
      }),
    )
    const e = entry(entries, "fx_translation", "USD")
    if (e.kind !== "evaluated") throw new Error("expected evaluated")
    expect(e.notes).not.toContain("staleIndependentRate")
    expect(e.fxRateDates?.staleRowCount).toBe(0)
  })

  it("surfaces a rate ≤ 0 as a caught builder error (no_evidence), not a throw", () => {
    const entries = assembleShadowStatementControls(
      makeEvidence({
        fx: [
          {
            currencyCode: "USD",
            reportedBaseSum: 850,
            rowCount: 1,
            rows: [{ originalAmount: 500, monthIndex: 0, rate: -1.7, rateDate: new Date("2026-01-10T00:00:00Z") }],
          },
        ],
      }),
    )
    const e = entry(entries, "fx_translation", "USD")
    expect(e.kind).toBe("no_evidence")
    if (e.kind !== "no_evidence") throw new Error("expected no_evidence")
    expect(e.builderError).toEqual({
      code: "fx_rate_invalid",
      component: "recomputed_base_USD_0",
    })
  })
})

// ───────────────────────── whole-output provisional sweep ─────────────────────────

describe("assembleShadowStatementControls — provisional-only sweep", () => {
  const fixtures: Array<[string, ShadowStatementEvidence]> = [
    ["rich evidence", makeEvidence()],
    [
      "empty buckets",
      makeEvidence({
        bs: {
          assets: EMPTY,
          liabilities: EMPTY,
          equity: EMPTY,
          currentYearResult: null,
          rawSums: { assets: 0, liabilities: 0, equity: 0 },
          signConvention: detectBsSignConvention(0, 0, 0),
        },
        cf: {
          operating: EMPTY,
          investing: EMPTY,
          financing: EMPTY,
          fxEffectOnCash: EMPTY,
          netChangeInCash: EMPTY,
          openingCash: EMPTY,
          closingCash: EMPTY,
        },
        pl: {
          revenue: EMPTY,
          cogs: EMPTY,
          expense: EMPTY,
          monthIndexNullCount: 0,
          ytdAligned: true,
          planCount: 0,
        },
      }),
    ],
    [
      "fx happy path",
      makeEvidence({
        fx: [
          {
            currencyCode: "EUR",
            reportedBaseSum: 900,
            rowCount: 1,
            rows: [{ originalAmount: 500, monthIndex: 0, rate: 1.8, rateDate: new Date("2026-01-10T00:00:00Z") }],
          },
        ],
      }),
    ],
  ]

  it("no fixture can ever yield pass/fail, decision eligibility, or a revision id", () => {
    for (const [, evidence] of fixtures) {
      assertShadowInvariants(assembleShadowStatementControls(evidence))
    }
  })

  it("covers all six control codes in canonical order", () => {
    const entries = assembleShadowStatementControls(makeEvidence())
    expect(entries.map((e) => e.code)).toEqual([
      "balance_sheet",
      "cash_flow_sum",
      "cash_to_balance_sheet",
      "retained_earnings",
      "net_income_link",
      "fx_translation",
    ])
  })
})

// ───────────────────────── fetch normalization ─────────────────────────

describe("fetchStatementEvidence — sign normalization + scoping", () => {
  it("normalizes trial-balance storage to natural values (−60/−40 → 60/40)", async () => {
    const tx = mockTx({
      balanceSheetLine: [
        bsRow("asset", 100, "Fixed assets"),
        bsRow("liability", -60, "Loans"),
        bsRow("equity", -40, "Share capital"),
      ],
      cashFlowEntry: [],
      budgetLine: [],
      currencyRateHistory: [],
    })
    const evidence = await fetchStatementEvidence(tx, ORG_ID, COMPANY_ID)
    if (!evidence) throw new Error("expected evidence")
    expect(evidence.bs.signConvention.convention).toBe("trial_balance")
    expect(evidence.bs.liabilities).toEqual({ sum: 60, rowCount: 1 })
    expect(evidence.bs.equity).toEqual({ sum: 40, rowCount: 1 })
    expect(evidence.bs.rawSums).toEqual({ assets: 100, liabilities: -60, equity: -40 })
    expect(evidence.periodKey).toBe("2026-03")
    expect(evidence.openingPeriodKey).toBe("2026-02")
  })

  it("returns null when the company has zero BS rows and zero CF rows", async () => {
    const tx = mockTx({ balanceSheetLine: [], cashFlowEntry: [], budgetLine: [], currencyRateHistory: [] })
    expect(await fetchStatementEvidence(tx, ORG_ID, COMPANY_ID)).toBeNull()
  })

  it("carries explicit org + company + deletedAt scoping on every statement where", async () => {
    const tx = mockTx({
      balanceSheetLine: [bsRow("asset", 100, "Cash")],
      cashFlowEntry: [],
      budgetLine: [],
      currencyRateHistory: [],
    })
    await fetchStatementEvidence(tx, ORG_ID, COMPANY_ID)
    for (const call of tx.calls) {
      const where = call.args?.where as Record<string, unknown> | undefined
      expect(where?.organizationId).toBe(ORG_ID)
      if (call.method !== "currencyRateHistory.findMany") {
        expect(where?.companyId).toBe(COMPANY_ID)
        expect(where?.deletedAt).toBeNull()
      }
    }
  })
})

// ───────────────────────── mock tx helpers ─────────────────────────

interface RecordedCall {
  method: string
  args?: { where?: unknown; select?: unknown; orderBy?: unknown }
}

interface MockRows {
  balanceSheetLine: Array<Record<string, unknown>>
  cashFlowEntry: Array<Record<string, unknown>>
  budgetLine: Array<Record<string, unknown>>
  currencyRateHistory: Array<Record<string, unknown>>
}

type MockTx = Prisma.TransactionClient & { calls: RecordedCall[] }

/** Default rows sit in 2026-03 so the latest-period resolution is deterministic. */
function bsRow(lineType: string, amount: number, name: string): Record<string, unknown> {
  return {
    lineType,
    amount,
    year: 2026,
    month: 3,
    account: { name, nameEn: null, nameRu: null, nameAz: null },
  }
}

function mockTx(rows: MockRows): MockTx {
  const calls: RecordedCall[] = []
  const model = (name: keyof MockRows) => ({
    findMany: async (args: RecordedCall["args"]) => {
      calls.push({ method: `${name}.findMany`, args })
      return rows[name]
    },
    findFirst: async (args: RecordedCall["args"]) => {
      calls.push({ method: `${name}.findFirst`, args })
      return rows[name][0] ?? null
    },
  })
  return {
    balanceSheetLine: model("balanceSheetLine"),
    cashFlowEntry: model("cashFlowEntry"),
    budgetLine: model("budgetLine"),
    currencyRateHistory: model("currencyRateHistory"),
    calls,
  } as unknown as MockTx
}
