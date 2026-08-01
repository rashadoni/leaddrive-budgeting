/**
 * Phase 11.76 (2026-07-31) — one table mapping a preview key to what the
 * operator should be told about it.
 *
 * THE RULE: the blast-radius block renders by mapping over the keys the
 * RESPONSE returns, through this table. It never iterates a hardcoded list of
 * keys. That list is exactly how `salesBudgetLine` and `indicatorValue` stayed
 * invisible in the old panel for a whole phase after the reset started
 * deleting them — the response carried them, the component's array did not.
 *
 * An unmapped key still renders (as "Other data"), so the failure mode of
 * forgetting to update this file is a vague line, not a silent deletion.
 */

/** What happens to this data after the delete. Drives grouping and colour. */
export type Fate =
  /** Soft-archived. The Restore task on this same page brings it back. */
  | "recoverable"
  /** Nothing brings it back — not a file, not this page. */
  | "permanent"
  /** Hard-deleted, but a re-upload of the source workbook recreates it. */
  | "reimport"
  /** Deleted and rebuilt automatically by the recompute that follows. */
  | "recomputed"

/** Rows in a table, or records a person maintains. Never summed together. */
export type Unit = "rows" | "items"

/** The `entityKind` the restore endpoint accepts for a soft-archived table. */
export type RestoreEntityKind =
  | "BudgetLine"
  | "BalanceSheetLine"
  | "CashFlowEntry"
  | "Counterparty"

export interface CategoryDescriptor {
  /** Key under `adminDataDelete.category.*`. */
  labelKey: string
  fate: Fate
  unit: Unit
  /** Key under `adminDataDelete.radius.caveat.*`, shown only when count > 0. */
  caveatKey?: string
  /**
   * The restore call that brings this category back, when one exists.
   *
   * 11.78 — the Restore task used to post all four kinds for every event and
   * print a hardcoded four-item "will bring back" list. Delete one year of
   * operational figures and it promised P&L lines, balance-sheet rows, cash
   * flow and counterparties, fired four calls that each returned 0, and
   * reported "0 rows brought back". The list is now read off the event's own
   * breakdown, through this field.
   */
  restoreKind?: RestoreEntityKind
}

export const UNKNOWN_CATEGORY: CategoryDescriptor = {
  labelKey: "unknown",
  fate: "reimport",
  unit: "rows",
}

export const CATEGORIES: Record<string, CategoryDescriptor> = {
  budgetLine: {
    labelKey: "budgetLine",
    fate: "recoverable",
    unit: "rows",
    restoreKind: "BudgetLine",
  },
  balanceSheetLine: {
    labelKey: "balanceSheetLine",
    fate: "recoverable",
    unit: "rows",
    restoreKind: "BalanceSheetLine",
  },
  cashFlowEntry: {
    labelKey: "cashFlowEntry",
    fate: "recoverable",
    unit: "rows",
    restoreKind: "CashFlowEntry",
  },
  counterparty: {
    labelKey: "counterparty",
    fate: "recoverable",
    unit: "rows",
    caveatKey: "counterparty",
    restoreKind: "Counterparty",
  },

  budgetActualManual: { labelKey: "budgetActualManual", fate: "permanent", unit: "rows" },
  complianceWriteBacks: {
    labelKey: "complianceWriteBacks",
    fate: "permanent",
    unit: "items",
  },
  orphanBudgetLine: {
    labelKey: "orphanBudgetLine",
    fate: "permanent",
    unit: "rows",
    caveatKey: "orphan",
  },

  operationalFact: { labelKey: "operationalFact", fate: "reimport", unit: "rows" },
  budgetActualImported: { labelKey: "budgetActualImported", fate: "reimport", unit: "rows" },
  salesBudgetLine: { labelKey: "salesBudgetLine", fate: "reimport", unit: "rows" },
  salesForecast: {
    labelKey: "salesForecast",
    fate: "reimport",
    unit: "rows",
    caveatKey: "salesForecast",
  },
  recordsCompliance: { labelKey: "recordsCompliance", fate: "reimport", unit: "items" },
  recordsAssets: { labelKey: "recordsAssets", fate: "reimport", unit: "items" },
  recordsDescription: { labelKey: "recordsDescription", fate: "reimport", unit: "items" },

  indicatorValue: { labelKey: "indicatorValue", fate: "recomputed", unit: "rows" },
}

/** Render order of the fate groups. Permanent second, so it gets read. */
export const FATE_ORDER: Fate[] = ["recoverable", "permanent", "reimport", "recomputed"]

export function describeCategory(key: string): CategoryDescriptor {
  return CATEGORIES[key] ?? UNKNOWN_CATEGORY
}

export interface LedgerLine {
  key: string
  labelKey: string
  count: number
  unit: Unit
  caveatKey?: string
}

export interface Ledger {
  groups: Array<{ fate: Fate; lines: LedgerLine[] }>
  /** Categories present in the response with a zero count. */
  emptyCount: number
  /** Rows only — records are counted in items and never folded in here. */
  rows: number
  /**
   * One total PER FATE, and they sum to `rows` exactly.
   *
   * 11.77 — only `rowsRecoverable` and `rowsPermanent` existed, so the
   * headline had no way to name the biggest bucket on this database. It said
   * "all of them can be brought back" whenever `rowsPermanent` was 0, which is
   * true of a production reset that hard-deletes every operational fact it
   * counted. A total that cannot be written down is a total that gets
   * described as something else.
   */
  rowsRecoverable: number
  rowsPermanent: number
  /** Hard-deleted; only a re-upload of the source workbook recreates them. */
  rowsReimport: number
  /** Deleted and rebuilt by the recompute that follows the delete. */
  rowsRecomputed: number
  /** Records (audit findings, court cases, …), counted apart. */
  items: number
  itemsPermanent: number
}

/**
 * Turn a preview/result breakdown into the grouped ledger the UI renders.
 * Unknown keys are merged into one "Other data" line rather than dropped.
 */
export function buildLedger(breakdown: Record<string, number>): Ledger {
  const byFate = new Map<Fate, LedgerLine[]>()
  // Accumulated per fate rather than per named bucket, so a fate nobody has
  // written a clause for yet still lands somewhere that adds up.
  const rowsByFate: Record<Fate, number> = {
    recoverable: 0,
    permanent: 0,
    reimport: 0,
    recomputed: 0,
  }
  let emptyCount = 0
  let rows = 0
  let items = 0
  let itemsPermanent = 0
  let unknown = 0

  for (const [key, rawCount] of Object.entries(breakdown)) {
    const count = Number(rawCount) || 0
    if (count <= 0) {
      emptyCount++
      continue
    }
    const descriptor = CATEGORIES[key]
    if (!descriptor) {
      unknown += count
      continue
    }
    const line: LedgerLine = {
      key,
      labelKey: descriptor.labelKey,
      count,
      unit: descriptor.unit,
      caveatKey: descriptor.caveatKey,
    }
    const list = byFate.get(descriptor.fate) ?? []
    list.push(line)
    byFate.set(descriptor.fate, list)

    if (descriptor.unit === "rows") {
      rows += count
      rowsByFate[descriptor.fate] += count
    } else {
      items += count
      if (descriptor.fate === "permanent") itemsPermanent += count
    }
  }

  if (unknown > 0) {
    const list = byFate.get(UNKNOWN_CATEGORY.fate) ?? []
    list.push({
      key: "unknown",
      labelKey: UNKNOWN_CATEGORY.labelKey,
      count: unknown,
      unit: UNKNOWN_CATEGORY.unit,
    })
    byFate.set(UNKNOWN_CATEGORY.fate, list)
    rows += unknown
    // An unmapped table is hard-deleted like the rest of its fate group, so it
    // belongs in that group's total too — not only in the grand total, where
    // it would silently break `sum(fates) === rows`.
    rowsByFate[UNKNOWN_CATEGORY.fate] += unknown
  }

  const groups = FATE_ORDER.filter((f) => (byFate.get(f)?.length ?? 0) > 0).map((fate) => ({
    fate,
    lines: (byFate.get(fate) ?? []).sort((a, b) => b.count - a.count),
  }))

  return {
    groups,
    emptyCount,
    rows,
    rowsRecoverable: rowsByFate.recoverable,
    rowsPermanent: rowsByFate.permanent,
    rowsReimport: rowsByFate.reimport,
    rowsRecomputed: rowsByFate.recomputed,
    items,
    itemsPermanent,
  }
}

/**
 * A category the deletion took and the restore cannot give back, WITH the
 * reason it cannot.
 *
 * 2026-07-31 — the fate used to be dropped here (`doesNotReturn: string[]`),
 * and the panel printed one blanket "those come back when you upload the file
 * again" under the whole list. `indicatorValue` is in every per-company
 * breakdown, and it is `recomputed`, not `reimport`: 100 % of restore panels
 * therefore promised a file recovery for rows no file returns. With the
 * manual-actuals box ticked the same line appeared over `budgetActualManual`,
 * whose own delete-side copy says, four steps earlier, that re-uploading will
 * NOT bring it back. Two strings, one screen, opposite claims.
 */
export interface RestoreLostLine {
  labelKey: string
  fate: Fate
}

export interface RestorePlan {
  /** Whether the plan was read off a recorded breakdown or guessed. */
  known: boolean
  /** The restore calls this event actually needs — never more. */
  kinds: RestoreEntityKind[]
  /** `category.*` keys the restore will bring back. */
  returns: string[]
  /** What the deletion took and the restore cannot return, with each fate. */
  doesNotReturn: RestoreLostLine[]
}

/** Every kind the restore endpoint accepts — read off the same table. */
const ALL_RESTORE_KINDS: RestoreEntityKind[] = Object.values(CATEGORIES)
  .map((d) => d.restoreKind)
  .filter((k): k is RestoreEntityKind => Boolean(k))

/**
 * What a restore of THIS audit event will and will not bring back, derived
 * from the breakdown the delete recorded.
 *
 * An event written before breakdowns were recorded has nothing to derive from;
 * `known: false` then means "offer all four kinds", which is the old
 * behaviour, and the copy stays generic for those rows.
 */
export function restorePlan(breakdown?: Record<string, number>): RestorePlan {
  const present = Object.entries(breakdown ?? {}).filter(([, n]) => (Number(n) || 0) > 0)
  if (present.length === 0) {
    return {
      known: false,
      kinds: [...ALL_RESTORE_KINDS],
      returns: ["budgetLine", "balanceSheetLine", "cashFlowEntry", "counterparty"],
      doesNotReturn: [
        { labelKey: "operationalFact", fate: "reimport" },
        { labelKey: "budgetActualImported", fate: "reimport" },
        { labelKey: "salesBudgetLine", fate: "reimport" },
      ],
    }
  }
  const kinds: RestoreEntityKind[] = []
  const returns: string[] = []
  const doesNotReturn: RestoreLostLine[] = []
  for (const [key] of present) {
    const descriptor = describeCategory(key)
    if (descriptor.restoreKind) {
      if (!kinds.includes(descriptor.restoreKind)) kinds.push(descriptor.restoreKind)
      returns.push(descriptor.labelKey)
    } else {
      // The fate travels with the label. A list that has forgotten WHY each
      // line is unreachable can only be captioned by a guess, and the guess
      // was wrong for the one line that appears every time.
      doesNotReturn.push({ labelKey: descriptor.labelKey, fate: descriptor.fate })
    }
  }
  // Same order the blast radius groups by, for the same reason: `permanent`
  // early enough to be read. Breakdown key order is an accident of the
  // server's statement order and puts the worst news wherever it lands.
  doesNotReturn.sort((a, b) => FATE_ORDER.indexOf(a.fate) - FATE_ORDER.indexOf(b.fate))
  return { known: true, kinds, returns, doesNotReturn }
}
