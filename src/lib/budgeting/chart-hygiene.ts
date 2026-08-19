/**
 * Dead entries in the chart of accounts and the product dictionary (2026-08-19).
 *
 * The client's chart carries 292 P&L accounts of which 93 have never held a
 * row, and 60 product lines of which 35 have neither a sales nor a cost row.
 * Most of the dead accounts are `.R`-suffixed shadows of a live sibling; most
 * of the dead products are farming lines duplicated across two entity
 * namespaces. None of them appears in any total — that is what makes them
 * dead — so removing them cannot move a number on any screen.
 *
 * ## The one way this can go wrong, and what stops it
 *
 * A screen lists what was dead when it rendered. The user reads it, an import
 * runs, and by the time they click the entry is no longer dead. Deactivating
 * on the strength of the earlier reading would silently hide an account that
 * now carries money — and because it is a soft flag, nothing would fail
 * loudly; the account would simply stop appearing.
 *
 * So the decision is never taken from the screen's list. `planDeactivation`
 * takes a FRESH count read inside the same transaction as the write and
 * refuses anything that has since gained a row, naming it. The screen's list
 * is a proposal; this is the check.
 *
 * Pure.
 */

export type HygieneKind = "account" | "product"

export interface HygieneCandidate {
  id: string
  code: string
  name: string
  kind: HygieneKind
}

export interface DeactivationRequest {
  /** Ids the user ticked, from a list that may be minutes stale. */
  ids: ReadonlyArray<string>
  /** Live row count per id, read at write time. Absent means zero. */
  freshCounts: ReadonlyMap<string, number>
  /** Ids that exist and are currently active. Anything else is refused. */
  eligible: ReadonlySet<string>
}

export type RefusalReason =
  /** Gained rows between the screen rendering and the click. */
  | "no_longer_dead"
  /** Not in this organisation, already inactive, or simply not there. */
  | "not_eligible"

export interface DeactivationPlan {
  /** Safe to deactivate: still carries nothing. */
  approved: string[]
  /** Left alone, each with the reason it was left alone. */
  refused: Array<{ id: string; reason: RefusalReason; rows?: number }>
}

export function planDeactivation(req: DeactivationRequest): DeactivationPlan {
  const approved: string[] = []
  const refused: DeactivationPlan["refused"] = []

  for (const id of new Set(req.ids)) {
    if (!req.eligible.has(id)) {
      refused.push({ id, reason: "not_eligible" })
      continue
    }
    const rows = req.freshCounts.get(id) ?? 0
    // A single row is enough to refuse. There is no threshold below which
    // hiding an account that carries money is acceptable.
    if (rows > 0) {
      refused.push({ id, reason: "no_longer_dead", rows })
      continue
    }
    approved.push(id)
  }

  return { approved, refused }
}

/** Row counts for one dictionary entry, split by what may veto a retirement. */
export interface Usage {
  /** Rows that count against retirement. */
  live: number
  /** Rows an archive or re-import soft-deleted. Shown to the reader, never decisive. */
  archived: number
}

/**
 * Folds per-table row counts into one usage figure per entry.
 *
 * Both arguments are ARRAYS of tables, not one table, because the count that
 * matters is the union. Production says how much that matters: judged on
 * budget lines alone, all 23 balance-sheet accounts read as dead — Cash,
 * Inventories, Share capital — since none of them holds a P&L row.
 *
 * The live/archived split is the other half. Counting archived rows as usage
 * leaves 0 dead accounts of 315; counting only live ones leaves 93, each an
 * account whose rows belong to a superseded import and are themselves due to
 * be purged.
 */
export function foldUsage(
  live: ReadonlyArray<ReadonlyArray<{ id: string; rows: number }>>,
  archived: ReadonlyArray<ReadonlyArray<{ id: string; rows: number }>>,
): Map<string, Usage> {
  const map = new Map<string, Usage>()
  const bump = (id: string, field: keyof Usage, n: number) => {
    const cur = map.get(id) ?? { live: 0, archived: 0 }
    cur[field] += n
    map.set(id, cur)
  }
  for (const table of live) for (const r of table) bump(r.id, "live", r.rows)
  for (const table of archived) for (const r of table) bump(r.id, "archived", r.rows)
  return map
}

/** Dead means no LIVE row anywhere. An archived row is history, not usage. */
export function isDead(usage: Usage | undefined): boolean {
  return (usage?.live ?? 0) === 0
}

/**
 * Why an entry is probably safe to retire, for the reader who has to decide.
 * Advisory only — nothing here gates the write, which is governed solely by
 * whether rows exist.
 */
export type DeadHint =
  /** `PLF.05.10.99.R` beside a live `PLF.05.10.99`. */
  | "shadow_of_live_sibling"
  /** Same name under another code that does carry rows. */
  | "duplicate_name"
  /** Nothing else in the chart explains it. */
  | "none"

export function hintFor(
  candidate: HygieneCandidate,
  live: ReadonlyArray<{ code: string; name: string }>,
): DeadHint {
  const code = candidate.code.trim().toUpperCase()
  if (code.endsWith(".R")) {
    const base = code.slice(0, -2)
    if (live.some((l) => l.code.trim().toUpperCase() === base)) return "shadow_of_live_sibling"
  }
  const name = candidate.name.trim().toLowerCase()
  if (name && live.some((l) => l.name.trim().toLowerCase() === name)) return "duplicate_name"
  return "none"
}
