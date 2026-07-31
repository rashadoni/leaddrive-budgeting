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

/**
 * A sheet whose write could NOT be proved against the database.
 *
 * Phase 11.2 (2026-07-29) — not every adapter writes through a batch
 * function with a post-write DB re-read: the "soft" adapters store JSON on
 * `Company.settings` (descriptions, land registry, forward forecast) and have
 * no sums to reconcile. Silently folding those into a green verdict is
 * exactly the dishonesty this phase exists to remove, so they are counted and
 * named separately instead. An unverified sheet does NOT abort the commit —
 * it is surfaced so the receipt distinguishes "proved correct" from
 * "not checked".
 */
export interface UnverifiedSheet {
  sheetName: string
  dataType: string
  entityCode: string | null
  /** Why no proof exists (e.g. "adapter writes no reconcilable sums"). */
  reason: string
}

export interface UniversalReconciliationReport {
  overallVerdict: SheetVerdict
  perSheet: ReadonlyArray<SheetReconciliationResult>
  summary: {
    totalSheets: number
    greenSheets: number
    yellowSheets: number
    redSheets: number
    /** Sheets with no post-write proof. Present only on aggregated
     *  post-write reports (Phase 11.2); absent on map-based reports. */
    unverifiedSheets?: number
  }
  /** Named unverified sheets — see {@link UnverifiedSheet}. */
  unverified?: ReadonlyArray<UnverifiedSheet>
  /**
   * Does the reconciliation evidence come from a real post-write database
   * re-read, or is it a parse-time self-check?
   *
   * `"db-readback"` — every `perSheet` entry was produced by a batch
   * function that re-queried the rows it had just written, inside the same
   * transaction. This is the only value that can honestly be called proof.
   *
   * `"parse-self-check"` — expected sums were compared against themselves.
   * Structurally green; proves the adapter is internally consistent and
   * NOTHING about what reached the database. Never present this to a user as
   * a reconciliation result.
   */
  evidence?: "db-readback" | "parse-self-check"
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
 * Aggregate reconciliation reports the BATCH LAYER already computed from a
 * real post-write database re-read.
 *
 * Phase 11.2 (2026-07-29). `reconcileAllSheets` above takes two sum maps and
 * does the math itself; this takes reports that have already been computed
 * against the DB and only rolls them up. That distinction is the entire
 * point: every batch function (`runImportBatch`, `runBalanceSheetBatch`,
 * `runCashFlowBatch`, `runKpiBatch`, `runActualsBatch`,
 * `runSalesForecastBatch`) re-reads the rows it just wrote — inside the same
 * transaction, so it sees uncommitted state — and reconciles them against the
 * parsed expectations. Until this function existed every adapter threw that
 * report away and returned only `rowsInserted`, so the orchestrator had
 * nothing to verify against and fell back to comparing the expected map with
 * itself.
 *
 * Entries without a report are recorded as {@link UnverifiedSheet} rather
 * than counted as green.
 */
export function aggregateSheetReports(
  entries: ReadonlyArray<{
    sheetName: string
    dataType: string
    entityCode: string | null
    /** Post-write report from the batch layer, or null when the adapter
     *  writes nothing reconcilable (JSON settings blobs etc.). */
    report: ReconciliationReport | null
    /** Why the report is absent — required when `report` is null. */
    unverifiedReason?: string
  }>,
): UniversalReconciliationReport {
  const perSheet: SheetReconciliationResult[] = []
  const unverified: UnverifiedSheet[] = []

  for (const e of entries) {
    if (!e.report) {
      unverified.push({
        sheetName: e.sheetName,
        dataType: e.dataType,
        entityCode: e.entityCode,
        reason: e.unverifiedReason ?? "adapter returned no reconciliation",
      })
      continue
    }
    const report = e.report
    perSheet.push({
      sheetName: e.sheetName,
      dataType: e.dataType,
      entityCode: e.entityCode,
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
  return {
    overallVerdict,
    perSheet,
    summary: {
      totalSheets: perSheet.length,
      greenSheets: verdicts.filter((v) => v === "green").length,
      yellowSheets: verdicts.filter((v) => v === "yellow").length,
      redSheets: verdicts.filter((v) => v === "red").length,
      unverifiedSheets: unverified.length,
    },
    unverified,
    evidence: "db-readback",
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

/** Sheets named in the rejection before it collapses into a count. */
const MAX_SHEETS_IN_MESSAGE = 6
/** Sample keys quoted per bucket. `topMissing`/`topExtra` already hold 5. */
const MAX_KEYS_PER_BUCKET = 3

function fmtAmount(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

/**
 * Explain a rejected post-write reconciliation in numbers, not just names.
 *
 * 2026-07-31 (11.58) — the abort message used to read:
 *
 *   Post-write reconciliation rejected (verdict=red, drifted sheets=A, B, C)
 *
 * That names the sheets and nothing else: no expected value, no actual value,
 * not one key. When it fired on production it took a four-lens code audit to
 * learn that the balance-sheet keys were entity-prefixed on one side and bare
 * on the other (11.51) — a fact the report ALREADY held, in `topMissing` and
 * `topExtra`, and threw away on the way to the operator. Same class as 11.43:
 * a verdict with the reason omitted, where the reason was in hand all along.
 *
 * The shape is chosen so the two failure modes are told apart at a glance:
 *   • `matched: 0` with equal missing/extra counts ⇒ the two sides are keying
 *     on different strings — compare the sample keys, they will differ by a
 *     prefix or a segment.
 *   • a non-zero `matched` with drift ⇒ the keys agree and the AMOUNTS do not;
 *     the expected/actual pair says by how much.
 *
 * Pure and bounded: no I/O, capped sheet and key counts, so it is safe to put
 * in an exception message that ends up in a log line.
 */
export function describeReconciliationRejection(
  report: UniversalReconciliationReport,
): string {
  const failed = report.perSheet.filter((s) => s.verdict !== "green")
  const head = `Post-write reconciliation rejected (verdict=${report.overallVerdict}, ${failed.length} sheet(s) failed)`
  if (failed.length === 0) return head

  const shown = failed.slice(0, MAX_SHEETS_IN_MESSAGE)
  const lines = shown.map((s) => {
    const counts = [
      `${s.matched} matched`,
      s.driftCount > 0 ? `${s.driftCount} drifted` : null,
      s.missingCount > 0 ? `${s.missingCount} missing` : null,
      s.extraCount > 0 ? `${s.extraCount} extra` : null,
    ]
      .filter(Boolean)
      .join(", ")

    const detail: string[] = []
    for (const d of s.topDrift.slice(0, MAX_KEYS_PER_BUCKET)) {
      detail.push(
        `drift ${d.key}: expected ${fmtAmount(d.expected)}, got ${fmtAmount(d.actual)}`,
      )
    }
    // Missing AND extra together is the signature of a key-space mismatch —
    // quote one of each so the difference is visible side by side.
    if (s.topMissing.length > 0) {
      detail.push(`missing ${s.topMissing.slice(0, MAX_KEYS_PER_BUCKET).join(" | ")}`)
    }
    if (s.topExtra.length > 0) {
      detail.push(`extra ${s.topExtra.slice(0, MAX_KEYS_PER_BUCKET).join(" | ")}`)
    }

    const suffix = detail.length > 0 ? ` — ${detail.join("; ")}` : ""
    return `${s.sheetName} (${s.dataType}): ${s.verdict}, ${counts}${suffix}`
  })

  const more =
    failed.length > shown.length
      ? ` (+${failed.length - shown.length} more sheet(s))`
      : ""
  return `${head}: ${lines.join(" || ")}${more}`
}
