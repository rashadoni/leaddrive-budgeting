/**
 * 11.63 — a sheet that writes two row-sets must attest to both.
 *
 * The PLF handler writes twice: `BudgetLine` rows through `runImportBatch`,
 * and `pl_ebitda` OperationalFacts alongside them. The adapter contract
 * carries ONE reconciliation report, so the second write's verdict had
 * nowhere to go — the handler returned the P&L report and the EBITDA write
 * went unverified.
 *
 * Measured on production 2026-07-31: **84 committed `pl_ebitda` facts** under
 * a receipt that said GREEN about a different set of rows entirely. Nothing
 * was corrupt; nothing was checked either. Same silhouette as 11.51 / 11.57 /
 * 11.62 — a write with no attestation.
 */
import { describe, it, expect } from "vitest"
import {
  mergeReconciliationReports,
  buildReconKey,
  type ReconciliationReport,
} from "./reconciliation"

function report(over: Partial<ReconciliationReport> = {}): ReconciliationReport {
  return {
    matched: 0,
    drift: [],
    missing: [],
    extra: [],
    verdict: "green",
    toleranceAzn: 0.005,
    ...over,
  }
}

const K = buildReconKey("c1", "pl_ebitda", "2026-01-01")

describe("mergeReconciliationReports", () => {
  it("carries a RED from either side into the result", () => {
    // The whole point. A clean P&L must not launder a broken subtotal write —
    // this is the direction that used to be silently dropped.
    const merged = mergeReconciliationReports([
      report({ matched: 300, verdict: "green" }),
      report({ verdict: "red", missing: [K] }),
    ])
    expect(merged.verdict).toBe("red")
    expect(merged.missing).toEqual([K])
  })

  it("takes the WORST verdict, not the last or the first", () => {
    expect(
      mergeReconciliationReports([report({ verdict: "yellow" }), report()]).verdict,
    ).toBe("yellow")
    expect(
      mergeReconciliationReports([report(), report({ verdict: "yellow" })]).verdict,
    ).toBe("yellow")
    expect(
      mergeReconciliationReports([
        report({ verdict: "yellow" }),
        report({ verdict: "red" }),
      ]).verdict,
    ).toBe("red")
  })

  it("unions the key lists rather than intersecting them", () => {
    // Each report covers keys the other never claims — a P&L account code and
    // a metric+date. Intersecting would cancel both to green.
    const a = buildReconKey("AZSF", "PLF.01.01.01", "2026-01")
    const merged = mergeReconciliationReports([
      report({ verdict: "red", extra: [a] }),
      report({ verdict: "red", missing: [K] }),
    ])
    expect(merged.extra).toEqual([a])
    expect(merged.missing).toEqual([K])
  })

  it("adds the matched counts so the receipt reflects everything checked", () => {
    const merged = mergeReconciliationReports([
      report({ matched: 300 }),
      report({ matched: 12 }),
    ])
    expect(merged.matched).toBe(312)
  })

  it("keeps the STRICTEST tolerance — reports only compare at one threshold", () => {
    const merged = mergeReconciliationReports([
      report({ toleranceAzn: 0.005 }),
      report({ toleranceAzn: 0 }),
    ])
    expect(merged.toleranceAzn).toBe(0)
  })

  it("returns a single report untouched", () => {
    // The common case — a handler with only one write-set. Identity, so
    // nothing about the existing verdicts can shift under this change.
    const only = report({ matched: 7, verdict: "yellow" })
    expect(mergeReconciliationReports([only])).toBe(only)
  })

  it("concatenates drift lines from both sides", () => {
    const d = { key: K, expected: 100, actual: 130, drift: 30, driftPct: 0.3 }
    const merged = mergeReconciliationReports([report(), report({ drift: [d] })])
    expect(merged.drift).toEqual([d])
  })
})
