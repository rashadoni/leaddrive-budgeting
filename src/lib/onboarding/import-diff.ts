/**
 * What this import will change, before it changes it (2026-08-19).
 *
 * The client re-imported the same workbook eight times in two days. Each run
 * archives what is there and writes what it parsed, and the only signal
 * afterwards is a row count — which is identical whether the numbers moved or
 * not. When one of those runs silently rolled back, finding out took a walk
 * through `pg_stat_user_tables`; a diff would have said so on the screen.
 *
 * ## Keyed on identity, not on order
 *
 * A row's identity is the account, the company and the month. Comparing by
 * position would report churn every time the parser emitted rows in a
 * different order, which is noise that trains people to ignore the screen.
 * Amounts for the same identity are summed on both sides first, so a source
 * that splits one account across two rows compares equal to one that does not.
 *
 * ## Absent is not zero
 *
 * An account that disappears from the workbook is reported as REMOVED, not as
 * "changed to 0". The two have different causes — a deleted sheet block versus
 * a genuine zero — and only the first is usually a mistake worth stopping for.
 *
 * Pure: the caller supplies both sides.
 */

export interface DiffRow {
  accountId: string
  companyId: string | null
  monthIndex: number | null
  plannedAmount: number
}

export interface ChangedEntry {
  accountId: string
  companyId: string | null
  monthIndex: number | null
  before: number
  after: number
  delta: number
}

export interface ImportDiff {
  /** Identities present in both, with a different amount. */
  changed: ChangedEntry[]
  /** Identities the incoming import introduces. */
  added: ChangedEntry[]
  /** Identities the stored data has and the import does not. */
  removed: ChangedEntry[]
  /** Identities present on both sides with the same amount. */
  unchangedCount: number
  storedTotal: number
  incomingTotal: number
  /** `incomingTotal - storedTotal`. The single number a reader checks first. */
  netDelta: number
  /**
   * True when nothing at all moves. Worth stating: a re-import that changes
   * nothing is the normal case, and saying so plainly is what makes the
   * abnormal case visible.
   */
  identical: boolean
}

/** Amounts below this are treated as equal — float noise, not a change. */
export const DIFF_TOLERANCE = 0.005

function keyOf(r: { accountId: string; companyId: string | null; monthIndex: number | null }): string {
  return `${r.accountId}|${r.companyId ?? ""}|${r.monthIndex ?? ""}`
}

function fold(rows: ReadonlyArray<DiffRow>): Map<string, ChangedEntry> {
  const out = new Map<string, ChangedEntry>()
  for (const r of rows) {
    const k = keyOf(r)
    const seen = out.get(k)
    if (seen) seen.after += r.plannedAmount
    else {
      out.set(k, {
        accountId: r.accountId,
        companyId: r.companyId,
        monthIndex: r.monthIndex,
        before: 0,
        after: r.plannedAmount,
        delta: 0,
      })
    }
  }
  return out
}

export function diffImportRows(
  stored: ReadonlyArray<DiffRow>,
  incoming: ReadonlyArray<DiffRow>,
): ImportDiff {
  const before = fold(stored)
  const after = fold(incoming)

  const changed: ChangedEntry[] = []
  const added: ChangedEntry[] = []
  const removed: ChangedEntry[] = []
  let unchangedCount = 0

  for (const [k, a] of after) {
    const b = before.get(k)
    if (!b) {
      added.push({ ...a, before: 0, delta: a.after })
      continue
    }
    const delta = a.after - b.after
    if (Math.abs(delta) <= DIFF_TOLERANCE) unchangedCount += 1
    else changed.push({ ...a, before: b.after, delta })
  }
  for (const [k, b] of before) {
    if (after.has(k)) continue
    removed.push({ ...b, before: b.after, after: 0, delta: -b.after })
  }

  // Largest movement first: the reason to read this screen is to catch the one
  // line that moved by a lot, and it should not have to be searched for.
  const byImpact = (x: ChangedEntry, y: ChangedEntry) => Math.abs(y.delta) - Math.abs(x.delta)
  changed.sort(byImpact)
  added.sort(byImpact)
  removed.sort(byImpact)

  const sum = (rows: ReadonlyArray<DiffRow>) => rows.reduce((s, r) => s + r.plannedAmount, 0)
  const storedTotal = sum(stored)
  const incomingTotal = sum(incoming)

  return {
    changed,
    added,
    removed,
    unchangedCount,
    storedTotal,
    incomingTotal,
    netDelta: incomingTotal - storedTotal,
    identical: changed.length === 0 && added.length === 0 && removed.length === 0,
  }
}
