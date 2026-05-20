/**
 * Phase 7.M Tier 4 (2026-05-19) — AI Import: Universal reconciliation
 * aggregator.
 *
 * Wraps the existing `reconciliation.ts` math layer with a per-sheet
 * verdict aggregator. The orchestrator collects expected/actual sum
 * maps from every adapter and feeds them here to get:
 *
 *   • per-sheet verdicts (green / yellow / red, drift list, missing/extra)
 *   • overall verdict (worst per-sheet wins; red dominates yellow, yellow dominates green)
 *   • a gating decision: should we commit, abort, or require user override?
 *
 * Pure module. Caller builds the expected/actual maps from adapter output
 * + post-write DB queries.
 */
import {
  reconcile,
  type ReconciliationKey,
  type ReconciliationReport,
} from "../reconciliation"

export type SheetVerdict = "green" | "yellow" | "red"

export interface SheetReconciliationResult {
  sheetName: string
  dataType: string
  entityCode: string | null
  verdict: SheetVerdict
  matched: number
  driftCount: number
  missingCount: number
  extraCount: number
  /** Up to 5 sample drift lines for display. */
  topDrift: ReadonlyArray<{
    key: string
    expected: number
    actual: number
    driftPct: number
  }>
  /** Empty if no missing — first 5 keys only. */
  topMissing: ReadonlyArray<string>
  /** Empty if no extra — first 5 keys only. */
  topExtra: ReadonlyArray<string>
}

export interface UniversalReconciliationReport {
  overallVerdict: SheetVerdict
  perSheet: ReadonlyArray<SheetReconciliationResult>
  summary: {
    totalSheets: number
    greenSheets: number
    yellowSheets: number
    redSheets: number
  }
  /**
   * Should the orchestrator commit the import?
   *   • green / yellow → ok=true (yellow requires explicit user
   *     `allowYellow` confirmation flag — caller decides)
   *   • red → ok=false (never auto-commit on red drift)
   */
  ok: boolean
}

/** Promote SheetVerdict ordering: red > yellow > green */
function severityOrder(v: SheetVerdict): number {
  return v === "red" ? 2 : v === "yellow" ? 1 : 0
}

function reduceVerdict(verdicts: SheetVerdict[]): SheetVerdict {
  if (verdicts.length === 0) return "green"
  let worst: SheetVerdict = "green"
  for (const v of verdicts) {
    if (severityOrder(v) > severityOrder(worst)) worst = v
  }
  return worst
}

export interface SheetReconciliationInput {
  sheetName: string
  dataType: string
  entityCode: string | null
  expectedSums: ReadonlyMap<ReconciliationKey, number>
  actualSums: ReadonlyMap<ReconciliationKey, number>
}

/**
 * Reconcile a list of sheets, aggregate verdicts into an overall report.
 *
 * @param sheets — one per parsed sheet
 * @param toleranceAzn — passed through to `reconcile()` per sheet
 */
export function reconcileAllSheets(
  sheets: ReadonlyArray<SheetReconciliationInput>,
  toleranceAzn?: number,
): UniversalReconciliationReport {
  const perSheet: SheetReconciliationResult[] = []
  for (const s of sheets) {
    const report: ReconciliationReport = reconcile(s.expectedSums, s.actualSums, {
      toleranceAzn,
    })
    perSheet.push({
      sheetName: s.sheetName,
      dataType: s.dataType,
      entityCode: s.entityCode,
      verdict: report.verdict,
      matched: report.matched,
      driftCount: report.drift.length,
      missingCount: report.missing.length,
      extraCount: report.extra.length,
      topDrift: report.drift.slice(0, 5).map((d) => ({
        key: d.key,
        expected: d.expected,
        actual: d.actual,
        driftPct: d.driftPct,
      })),
      topMissing: report.missing.slice(0, 5),
      topExtra: report.extra.slice(0, 5),
    })
  }
  const verdicts = perSheet.map((s) => s.verdict)
  const overallVerdict = reduceVerdict(verdicts)
  const greenSheets = verdicts.filter((v) => v === "green").length
  const yellowSheets = verdicts.filter((v) => v === "yellow").length
  const redSheets = verdicts.filter((v) => v === "red").length
  return {
    overallVerdict,
    perSheet,
    summary: {
      totalSheets: perSheet.length,
      greenSheets,
      yellowSheets,
      redSheets,
    },
    ok: overallVerdict !== "red",
  }
}

/**
 * Tier the verdict into a recommended action for the orchestrator.
 *
 *   green  → commit
 *   yellow → commit-with-warning (caller may require allowYellow=true)
 *   red    → abort, do not commit
 */
export function decideAction(report: UniversalReconciliationReport, opts: {
  allowYellow?: boolean
} = {}): "commit" | "commit_with_warning" | "abort" {
  if (report.overallVerdict === "red") return "abort"
  if (report.overallVerdict === "yellow") {
    return opts.allowYellow ? "commit_with_warning" : "abort"
  }
  return "commit"
}
