/**
 * Phase 11.91 (2026-08-02) — run the statement check over stored values and
 * record what it found.
 *
 * Deliberately a SEPARATE PASS over already-written `IndicatorValue` rows,
 * not a side effect of computing them. Three reasons, in order of how much
 * they cost to learn the other way:
 *
 *  1. It can be re-run. "Check this again" must not mean "recompute
 *     everything", or nobody will ever press it — and after a manual
 *     correction, re-checking is the entire point.
 *  2. It reads what is actually STORED. A check folded into the writer
 *     compares against the value in memory, which is the one place a write
 *     bug cannot show up.
 *  3. `recompute.ts` stays a calculator. It already carries lineage
 *     pass-through; teaching it to also hold a workbook's subtotals would put
 *     import-shaped knowledge inside the formula engine.
 *
 * **Only the year period is reconcilable, and that is not a shortcut.** These
 * subtotals are the sheet's FY column. A monthly indicator has no counterpart
 * in them, and comparing an April margin against a full-year total would
 * manufacture a mismatch on every month of every company. Months stay
 * unchecked and say so.
 */

import {
  reconcileAgainstStatement,
  reconcilableIndicatorCodes,
  acceptanceStillHolds,
  unitOf,
  type IndicatorReconResult,
} from "./indicator-reconciliation"

/** One company's statement, as the workbook itself computes it. */
export interface StatementSource {
  companyId: string
  /** `{ "PLF.01": 58880102.23, ... }` — from `crossFootPlfSheet`. */
  statedSubtotals: Record<string, number>
}

/** A single value that disagrees with its source, for the import receipt. */
export interface StatementMismatch {
  companyId: string
  indicatorCode: string
  period: string
  /** What the screen shows. */
  actual: number
  /** What the client's own statement says. */
  expected: number
  /** `actual - expected`. */
  delta: number
}

export interface StatementReconciliationSummary {
  /** Values compared against a statement figure. */
  checked: number
  matched: number
  mismatched: number
  /**
   * 13.7 — differences a person had already signed for, where the gap is
   * unchanged. Reported separately from `matched` on purpose: an accepted
   * difference is a decision about a disagreement, not the absence of one, and
   * folding it into `matched` would be the false green in a summary line.
   */
  stillAccepted: number
  /**
   * Reconcilable indicators that had no stored value, or whose company sent
   * no statement figure for them. Reported so a zero-mismatch run cannot be
   * read as "everything agrees" when in fact nothing was compared.
   */
  notChecked: number
  mismatches: StatementMismatch[]
}

/** The slice of Prisma this needs. Narrow so tests pass a plain object. */
export interface ReconciliationDb {
  indicatorDefinition: {
    findMany(args: {
      where: { organizationId: string; code: { in: string[] } }
      select: { id: true; code: true }
    }): Promise<Array<{ id: string; code: string }>>
  }
  indicatorValue: {
    findMany(args: {
      where: {
        organizationId: string
        companyId: { in: string[] }
        indicatorId: { in: string[] }
        period: string
      }
      select: {
        id: true
        companyId: true
        indicatorId: true
        period: true
        value: true
        reconStatus: true
        reconAcceptedDelta: true
      }
    }): Promise<
      Array<{
        id: string
        companyId: string
        indicatorId: string
        period: string
        value: number
        reconStatus?: string | null
        reconAcceptedDelta?: number | null
      }>
    >
    update(args: {
      where: { id: string }
      data: {
        reconStatus: string
        reconExpected: number
        reconCheckedAt: Date
        lastReconciledAt: Date | null
        reconciledBy: string
      }
    }): Promise<unknown>
  }
}

export interface ReconciliationPassInput {
  organizationId: string
  /** The year the statement covers. Reconciles the `"2026"`-style period. */
  year: number
  sources: StatementSource[]
  /** Recorded in `reconciledBy` — `"import"`, or a user id for a manual re-check. */
  actor: string
  now: Date
}

/**
 * Compare every reconcilable stored value against its statement and stamp the
 * verdict.
 *
 * On a match: `lastReconciledAt` moves forward, which is the only thing in the
 * product that has ever written it honestly.
 *
 * On a mismatch: `lastReconciledAt` is CLEARED. A value that passed in June and
 * fails today is not a reconciled value with a note attached — leaving the old
 * stamp would keep it decision-grade while the surfaces shout that it is wrong,
 * and the gate would be the last thing to find out.
 */
export async function reconcileImportedIndicators(
  db: ReconciliationDb,
  input: ReconciliationPassInput,
): Promise<StatementReconciliationSummary> {
  const empty: StatementReconciliationSummary = {
    checked: 0,
    matched: 0,
    mismatched: 0,
    stillAccepted: 0,
    notChecked: 0,
    mismatches: [],
  }
  const sources = input.sources.filter(
    (s) => s.companyId && Object.keys(s.statedSubtotals).length > 0,
  )
  if (sources.length === 0) return empty

  const codes = reconcilableIndicatorCodes()
  const definitions = await db.indicatorDefinition.findMany({
    where: { organizationId: input.organizationId, code: { in: codes } },
    select: { id: true, code: true },
  })
  if (definitions.length === 0) return empty

  const codeById = new Map(definitions.map((d) => [d.id, d.code]))
  const period = String(input.year)
  // One statement per company. A company appearing twice — two PLF sheets for
  // the same entity and year — has its subtotals SUMMED, because that is
  // exactly what happened to the rows those sheets contributed. Comparing the
  // sum of the parts against one part would report a mismatch the data does
  // not have.
  const byCompany = new Map<string, Record<string, number>>()
  for (const s of sources) {
    const acc = byCompany.get(s.companyId) ?? {}
    for (const [k, v] of Object.entries(s.statedSubtotals)) {
      acc[k] = (acc[k] ?? 0) + v
    }
    byCompany.set(s.companyId, acc)
  }

  const rows = await db.indicatorValue.findMany({
    where: {
      organizationId: input.organizationId,
      companyId: { in: [...byCompany.keys()] },
      indicatorId: { in: definitions.map((d) => d.id) },
      period,
    },
    select: {
      id: true,
      companyId: true,
      indicatorId: true,
      period: true,
      value: true,
      // 13.7 — an acceptance is for a SPECIFIC gap; re-checking has to know
      // which one, or a moved number would keep somebody's old signature.
      reconStatus: true,
      reconAcceptedDelta: true,
    },
  })

  const summary: StatementReconciliationSummary = { ...empty, mismatches: [] }
  // Every (company × reconcilable indicator) pair that COULD have been checked.
  // Decremented as verdicts land, so the remainder is an honest count of what
  // this run says nothing about.
  summary.notChecked = byCompany.size * definitions.length

  for (const row of rows) {
    const code = codeById.get(row.indicatorId)
    const stated = byCompany.get(row.companyId)
    if (!code || !stated) continue
    const [verdict]: IndicatorReconResult[] = reconcileAgainstStatement(
      [{ code, value: row.value }],
      stated,
    )
    // `reconcileAgainstStatement` returns nothing when the statement cannot
    // form the figure — zero revenue, a missing row. That is "not checked",
    // and writing a verdict for it would be the certification-by-silence this
    // whole module exists to refuse.
    if (!verdict) continue

    summary.checked += 1
    summary.notChecked -= 1

    // 13.7 — a previously accepted difference stays accepted only while it is
    // the SAME difference. If the number moved, the signature no longer covers
    // what is on screen: that is a new disagreement nobody has looked at, and
    // it falls back to `mismatched` rather than inheriting the old approval.
    if (
      !verdict.reconciled &&
      row.reconStatus === "accepted" &&
      acceptanceStillHolds(verdict, row.reconAcceptedDelta, unitOf(code) ?? "absolute")
    ) {
      summary.stillAccepted += 1
      continue
    }

    if (verdict.reconciled) summary.matched += 1
    else {
      summary.mismatched += 1
      summary.mismatches.push({
        companyId: row.companyId,
        indicatorCode: code,
        period: row.period,
        actual: verdict.actual,
        expected: verdict.expected,
        delta: verdict.delta,
      })
    }

    await db.indicatorValue.update({
      where: { id: row.id },
      data: {
        reconStatus: verdict.reconciled ? "matched" : "mismatched",
        reconExpected: verdict.expected,
        reconCheckedAt: input.now,
        lastReconciledAt: verdict.reconciled ? input.now : null,
        reconciledBy: input.actor,
      },
    })
  }

  return summary
}

/**
 * One line per mismatch, for the import receipt and the server log.
 *
 * Phrased as the comparison a person would make by hand — "we say X, your
 * sheet says Y" — rather than as an error code. The reader is a finance lead
 * looking at their own workbook, and the useful question is which of the two
 * numbers is wrong, which this deliberately does not presume to answer.
 */
export function describeMismatch(
  m: StatementMismatch,
  companyLabel: (id: string) => string,
): string {
  return (
    `${companyLabel(m.companyId)} · ${m.indicatorCode} (${m.period}): ` +
    `the platform computes ${m.actual.toFixed(2)}, the source statement says ` +
    `${m.expected.toFixed(2)} — a gap of ${m.delta.toFixed(2)}. ` +
    `The imported rows were written as parsed; this compares the derived ` +
    `figure against the workbook's own subtotal.`
  )
}
