/**
 * Phase 7.M Step 6 (Option B-lean, 2026-05-19) — bit-perfect import
 * reconciliation.
 *
 * Why this file exists
 * ────────────────────
 * Finance users will not trust the system until they can prove that
 * what's on screen MATCHES the xlsx they uploaded. Not "approximately
 * matches" — to-the-qəpik matches. The promise is:
 *
 *   Archive AZSEKER-AZSF data → re-import Workbook Fin.xlsx →
 *   reconciliation report says 🟢 100% match → finance signs off.
 *
 * This module is the math layer of that promise. It compares two
 * `Map<key, number>` snapshots:
 *
 *   • `expected` — sums computed during xlsx parsing. Each key is
 *     `entity::account::period`. The number is the raw cell value
 *     (or sum of leaf cells under a parent code).
 *   • `actual`   — sums computed via DB query AFTER the write. Same
 *     key shape. Number is `SUM(plannedAmount) WHERE deletedAt IS NULL`.
 *
 * A line "matches" when |expected − actual| ≤ TOLERANCE_AZN. The
 * tolerance defaults to half a qəpik (0.005 AZN) to absorb IEEE-754
 * round-trip noise without admitting real arithmetic errors.
 *
 * Design choices
 * ──────────────
 * • Pure module. No I/O, no DB, no Prisma. Both maps are caller-built.
 *   Tests prove correctness on synthetic data — when the wrapper
 *   integrates DB queries, it just feeds two maps in.
 *
 * • Drift is signed. Caller may want to know if DB is OVER- or UNDER-
 *   counting. Sign convention: `drift = actual − expected`. Positive
 *   = DB has more than file (likely double-import); negative = DB has
 *   less (likely missing rows / archive bug).
 *
 * • Three verdicts: `green` (all lines match), `yellow` (every line
 *   within 1% of its expected value — small drift, presumably
 *   floating-point or rounding policy), `red` (any single line off
 *   by more than 1%, OR missing rows, OR extra rows). The thresholds
 *   are conservative on purpose — finance needs to see anything other
 *   than 🟢 as "investigate before signing off".
 */

/** Half a qəpik. Tighter than typical FP noise but loose enough to
 *  absorb common Excel→JS round-trip edge cases. */
export const DEFAULT_TOLERANCE_AZN = 0.005

/** Composite key: `entity::account::period`. Keep underscores and dots
 *  through verbatim so callers can use the same code their existing
 *  CoA tables use (e.g. "AZSEKER-AZSF::PLF.01.01.01::2026-04"). */
export type ReconciliationKey = string

export interface ReconciliationDriftLine {
  /** The composite key — pin-points which (entity, account, period)
   *  cell is off. */
  key: ReconciliationKey
  expected: number
  actual: number
  /** `actual − expected`. Positive = DB has more; negative = DB has less. */
  drift: number
  /** `Math.abs(drift) / Math.max(|expected|, 1e-9)` — clamped above
   *  zero so a zero-expected line doesn't divide-by-zero. */
  driftPct: number
}

export interface ReconciliationReport {
  /** Lines whose drift is within tolerance. */
  matched: number
  /** Lines whose drift exceeded tolerance. */
  drift: ReadonlyArray<ReconciliationDriftLine>
  /** Keys present in `expected` but absent from `actual` — file said
   *  there should be a row, DB has none. Likely an import bug or a
   *  filter that hid the row (deletedAt, wrong period). */
  missing: ReadonlyArray<ReconciliationKey>
  /** Keys present in `actual` but absent from `expected` — DB has
   *  rows that the file didn't claim. Likely leftover archived rows
   *  (purge fail) or stale data from a prior import. */
  extra: ReadonlyArray<ReconciliationKey>
  /** Worst-case roll-up for the UI badge. */
  verdict: "green" | "yellow" | "red"
  /** Threshold used (so the report is self-documenting when stored). */
  toleranceAzn: number
}

export interface ReconciliationOptions {
  /** Override the default 0.005 AZN tolerance. Pass 0 for strict
   *  bit-perfect compare (regression-test mode). */
  toleranceAzn?: number
  /** Yellow threshold — lines whose driftPct stays below this still
   *  earn `yellow` rather than escalating to `red`. Defaults to 1%. */
  yellowDriftPct?: number
}

/**
 * Compute the reconciliation report from two sum maps.
 *
 * Complexity: O(|expected| + |actual|). Pure — no side effects.
 */
export function reconcile(
  expected: ReadonlyMap<ReconciliationKey, number>,
  actual: ReadonlyMap<ReconciliationKey, number>,
  opts: ReconciliationOptions = {},
): ReconciliationReport {
  const tol = opts.toleranceAzn ?? DEFAULT_TOLERANCE_AZN
  const yellowPct = opts.yellowDriftPct ?? 0.01

  const drift: ReconciliationDriftLine[] = []
  const missing: ReconciliationKey[] = []
  let matched = 0

  for (const [key, expectedVal] of expected) {
    const actualVal = actual.get(key)
    if (actualVal === undefined) {
      missing.push(key)
      continue
    }
    const driftAbs = actualVal - expectedVal
    if (Math.abs(driftAbs) <= tol) {
      matched += 1
      continue
    }
    // Beyond tolerance — record drift.
    const denom = Math.max(Math.abs(expectedVal), 1e-9)
    drift.push({
      key,
      expected: expectedVal,
      actual: actualVal,
      drift: driftAbs,
      driftPct: Math.abs(driftAbs) / denom,
    })
  }

  // Walk `actual` to find keys not in `expected` — those are extras.
  const extra: ReconciliationKey[] = []
  for (const key of actual.keys()) {
    if (!expected.has(key)) extra.push(key)
  }

  // Verdict roll-up.
  let verdict: ReconciliationReport["verdict"]
  if (drift.length === 0 && missing.length === 0 && extra.length === 0) {
    verdict = "green"
  } else if (
    missing.length === 0 &&
    extra.length === 0 &&
    drift.every((d) => d.driftPct <= yellowPct)
  ) {
    verdict = "yellow"
  } else {
    verdict = "red"
  }

  return {
    matched,
    drift,
    missing,
    extra,
    verdict,
    toleranceAzn: tol,
  }
}

/**
 * Format helper for CLI/log output. Compact summary suitable for the
 * smoke-test integration + the import-batch wrapper's final block.
 */
export function formatReconciliationSummary(
  report: ReconciliationReport,
): string {
  const icon = { green: "🟢", yellow: "🟡", red: "🔴" }[report.verdict]
  const lines = [
    `${icon} reconciliation verdict: ${report.verdict.toUpperCase()}`,
    `   matched:  ${report.matched}`,
    `   drift:    ${report.drift.length}`,
    `   missing:  ${report.missing.length}`,
    `   extra:    ${report.extra.length}`,
    `   tolerance: ${report.toleranceAzn} AZN`,
  ]
  if (report.drift.length > 0) {
    lines.push("   top drift:")
    const top = [...report.drift]
      .sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift))
      .slice(0, 5)
    for (const d of top) {
      lines.push(
        `     ${d.key}  expected=${d.expected.toFixed(2)}  actual=${d.actual.toFixed(2)}  drift=${d.drift.toFixed(2)} (${(d.driftPct * 100).toFixed(2)}%)`,
      )
    }
  }
  if (report.missing.length > 0) {
    lines.push(
      `   missing samples: ${report.missing.slice(0, 5).join(", ")}${report.missing.length > 5 ? ` ... +${report.missing.length - 5}` : ""}`,
    )
  }
  if (report.extra.length > 0) {
    lines.push(
      `   extra samples: ${report.extra.slice(0, 5).join(", ")}${report.extra.length > 5 ? ` ... +${report.extra.length - 5}` : ""}`,
    )
  }
  return lines.join("\n")
}

/**
 * Build a composite key from its three components. Centralised so
 * callers can't accidentally use different separators on either side
 * of the comparison.
 */
export function buildReconKey(
  entityCode: string,
  account: string,
  period: string,
): ReconciliationKey {
  return `${entityCode}::${account}::${period}`
}
