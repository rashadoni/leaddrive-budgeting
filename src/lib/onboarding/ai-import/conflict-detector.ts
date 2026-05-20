/**
 * Phase 7.M Tier 5 (2026-05-20) — cross-file conflict detector.
 *
 * Pure stateless function: given expected sums from multiple files
 * (each as `Map<ReconciliationKey, number>`), detect cells where two
 * or more files disagree on the value.
 *
 * The multi-file orchestrator runs this BEFORE any DB write (Phase D
 * in the pipeline). If conflicts are found:
 *   • Orchestrator returns 409 immediately with `conflicts[]` payload
 *   • Zero DB writes happen — financial integrity guaranteed
 *   • UI surfaces a diff table for user resolution
 *
 * Why this matters: if `Guvven Fin.xlsx` says AZSEKER-AZSF Q1 revenue
 * = 530K and a separate `Q1-actuals.xlsx` says 550K, silently picking
 * one would corrupt financial reports. Block and ask.
 *
 * Conflict is determined per-key: if two files both claim the same
 * `(entity, account, period)` cell, their values must match within
 * tolerance (default 0.005 AZN, same as reconciliation.ts). Different
 * keys (cells one file doesn't claim) are NOT conflicts — that's
 * normal "this file scope is X, that file scope is Y".
 */
import type { ReconciliationKey } from "../reconciliation"

/** Half a qəpik — same tolerance as reconciliation cell-match. */
const DEFAULT_TOLERANCE_AZN = 0.005

export interface CrossFileConflict {
  /** Composite key `entity::account::period`. */
  key: ReconciliationKey
  /** Each file that claimed this key with its value. */
  occurrences: Array<{ filename: string; value: number }>
  /** max − min across all occurrences. */
  spread: number
  /** spread / max(|values|, 1e-9) — clamped to avoid div-by-zero. */
  spreadPct: number
}

/**
 * Detect cells where multiple files disagree.
 *
 * @param perFileExpected — outer map: filename → inner map of cell sums.
 *   Order of map entries is preserved in `occurrences[]` for stable UI.
 * @param toleranceAzn — values within this tolerance count as agreeing.
 *
 * @returns Empty array when no conflicts. Otherwise one entry per
 *   conflicting cell, sorted by spreadPct descending (largest disagreements
 *   first — so UI shows the worst ones at top).
 */
export function detectCrossFileConflicts(
  perFileExpected: ReadonlyMap<string, ReadonlyMap<ReconciliationKey, number>>,
  toleranceAzn: number = DEFAULT_TOLERANCE_AZN,
): CrossFileConflict[] {
  // Group occurrences per key across all files.
  const byKey = new Map<
    ReconciliationKey,
    Array<{ filename: string; value: number }>
  >()
  for (const [filename, cellsMap] of perFileExpected) {
    for (const [key, value] of cellsMap) {
      let arr = byKey.get(key)
      if (!arr) {
        arr = []
        byKey.set(key, arr)
      }
      arr.push({ filename, value })
    }
  }

  const conflicts: CrossFileConflict[] = []
  for (const [key, occurrences] of byKey) {
    if (occurrences.length < 2) continue // not seen by 2+ files → no conflict possible
    const values = occurrences.map((o) => o.value)
    const max = Math.max(...values)
    const min = Math.min(...values)
    const spread = max - min
    if (spread <= toleranceAzn) continue // within tolerance — files agree
    const denom = Math.max(Math.abs(max), Math.abs(min), 1e-9)
    const spreadPct = spread / denom
    conflicts.push({
      key,
      occurrences,
      spread,
      spreadPct,
    })
  }
  // Sort: largest spread% first so UI shows worst conflicts at top.
  conflicts.sort((a, b) => b.spreadPct - a.spreadPct)
  return conflicts
}

/**
 * Convenience: format a CrossFileConflict for log output / UI.
 *
 * Example: "AZSEKER-AZSF::PLF.01::2026-01 differs: fileA=530000, fileB=550000 (spread 20000, 3.6%)"
 */
export function formatConflictLine(conflict: CrossFileConflict): string {
  const pcs = conflict.occurrences
    .map((o) => `${o.filename}=${o.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`)
    .join(", ")
  return `${conflict.key} differs: ${pcs} (spread ${conflict.spread.toFixed(2)}, ${(conflict.spreadPct * 100).toFixed(2)}%)`
}
