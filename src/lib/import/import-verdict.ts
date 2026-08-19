/**
 * Reading an import verdict (2026-08-19).
 *
 * `ImportBatchReport` has recorded every import for months — 33 of them on the
 * client's production, all green, all backed by a post-write re-query — and
 * `/api/import/reports` has been able to serve them since Phase 11.34. Nothing
 * ever displayed one. The owner asking "could a re-import break something?"
 * had no way to see that the system already answers it.
 *
 * ## The distinction this file exists to protect
 *
 * A verdict is only as good as what backs it. `db-readback` means the sums
 * were re-queried FROM THE DATABASE after the write and matched. The
 * `parse-self-check` alternative means the importer compared its own parse
 * against itself, which cannot catch a write that never landed. Both can print
 * "green", and treating them as the same claim is how a silent failure gets a
 * tick beside it.
 *
 * So an unverified green is drawn as its own state, never as green.
 *
 * Pure.
 */

export type ImportVerdict = "green" | "yellow" | "red"

export type VerdictStanding =
  /** Green, and a post-write query proved it. */
  | "verified"
  /** Green or yellow, but only the parser vouches for it. */
  | "unverified"
  /** The import itself reported drift worth a look. */
  | "drift"
  /** The import reported a failure. */
  | "failed"
  /** Written but not committed — the row exists, the data does not. */
  | "uncommitted"

export interface VerdictInput {
  verdict: string
  /** True when `evidence !== "db-readback"`, as the API computes it. */
  verdictUnverified: boolean
  committed: boolean
}

export function verdictStanding(r: VerdictInput): VerdictStanding {
  // An uncommitted write outranks everything: whatever the verdict says about
  // the numbers, they are not in the database.
  if (!r.committed) return "uncommitted"
  if (r.verdict === "red") return "failed"
  if (r.verdictUnverified) return "unverified"
  if (r.verdict === "yellow") return "drift"
  return "verified"
}

/**
 * How much of the run could be checked at all. Sheets carrying nothing
 * reconcilable (settings JSON, zero rows) are not failures, but a run that
 * verified two sheets of twenty is a different claim from one that verified
 * twenty of twenty, and the ratio is the only place that shows.
 */
export function verifiedShare(r: {
  sheetsVerified: number
  sheetsUnverified: number
}): number | null {
  const total = r.sheetsVerified + r.sheetsUnverified
  if (total === 0) return null
  return r.sheetsVerified / total
}
