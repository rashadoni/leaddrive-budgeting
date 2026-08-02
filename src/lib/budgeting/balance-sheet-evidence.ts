export interface BalanceSheetEvidenceLine {
  id: string
  accountCode?: string | null
  accountName?: string | null
  account?: { code: string | null; name: string | null } | null
  /**
   * Which legal entity the row belongs to. Nullable in the schema (rows
   * written before Phase 7.O carry null), and that null is deliberately
   * treated as its own contributor below — see `resolveBalanceSheetScope`.
   */
  companyId?: string | null
  /**
   * Phase 14.8 — an intragroup-elimination row from the client's own `EJE`
   * block. Belongs to no company by construction, which is why `companyId` is
   * null on it; see `resolveBalanceSheetScope`.
   */
  isElimination?: boolean | null
  lineType: string
  month: number
  amount: number
}

/**
 * What the numbers in front of the user actually ARE.
 *
 * `consolidated_holding` — the holding entity carries its own balance sheet,
 *   produced by the client's consolidation with eliminations already inside it
 *   (`azseker-consolidated-bs.ts` imports exactly that, verbatim).
 * `consolidated_computed` — Phase 14.8. Entities summed PLUS the client's own
 *   intragroup-elimination block, which the workbook ships as a fifth `EJE`
 *   block and which the product used to drop. A real consolidated statement:
 *   the eliminations are the client's, not ours, and they balance to zero on
 *   their own before being applied.
 * `single_entity` — one company contributes rows. Nothing to eliminate.
 * `sum_of_entities` — two or more companies were added together and NOTHING
 *   was eliminated. Not a consolidated balance sheet, and must never be shown
 *   as one.
 */
export type BalanceSheetBasis =
  | "consolidated_holding"
  | "consolidated_computed"
  | "single_entity"
  | "sum_of_entities"

export interface BalanceSheetScope {
  basis: BalanceSheetBasis
  /** Distinct contributors behind the totals (a null companyId counts as one). */
  entityCount: number
  /** Sorted, non-null company ids. Shorter than `entityCount` if rows are unscoped. */
  companyIds: string[]
  /** True only when the source itself eliminated intercompany balances. */
  eliminationsApplied: boolean
}

/**
 * Defect 3 (2026-08-01) — the balance sheet tab silently added four legal
 * entities together.
 *
 * `/api/budgeting/balance-sheet` reached for the holding's consolidated rows
 * and, when the holding had none, fell through to `companyFilter = {}` — every
 * company's rows, summed, with no eliminations and no mention of it. On the
 * client's own file that reads Total Assets 373,152,064 (2026-05, AZSF + EDEN +
 * CPC + ProMalt) against a consolidated 249,951,210: 123,200,854 of
 * intercompany holdings and intragroup receivables counted twice.
 *
 * Every automated check passed, and the reason is arithmetic: four balanced
 * balance sheets are still balanced when you add them, so the A = L + E
 * residual gate in `normalizeBalanceSheetMonth` below sees nothing wrong. The
 * only defence is to state the basis rather than infer soundness from balance.
 *
 * A null companyId is counted as a contributor of its own: legacy unscoped
 * rows mixed with per-entity rows are exactly the case where the sum is
 * suspect, and over-warning is the safe direction here.
 */
export function resolveBalanceSheetScope(
  lines: ReadonlyArray<{ companyId?: string | null; isElimination?: boolean | null }>,
  opts: { holdingConsolidated: boolean },
): BalanceSheetScope {
  if (opts.holdingConsolidated) {
    const ids = new Set<string>()
    for (const line of lines) if (line.companyId) ids.add(line.companyId)
    return {
      basis: "consolidated_holding",
      entityCount: 1,
      companyIds: [...ids].sort(),
      eliminationsApplied: true,
    }
  }

  const named = new Set<string>()
  let hasUnscoped = false
  // Phase 14.8 — elimination rows are null-company BY CONSTRUCTION, so they
  // must not be counted as an unscoped contributor. Counting them would push
  // the answer deeper into `sum_of_entities` exactly when the sum has just
  // become a real consolidation, which is backwards.
  let hasEliminations = false
  for (const line of lines) {
    if (line.isElimination) {
      hasEliminations = true
      continue
    }
    if (line.companyId) named.add(line.companyId)
    else hasUnscoped = true
  }
  const entityCount = named.size + (hasUnscoped ? 1 : 0)
  const companyIds = [...named].sort()

  if (entityCount > 1) {
    // Eliminations turn the sum into a consolidated statement — but only over
    // entities we can name. A legacy unscoped row mixed in is still an unknown
    // contributor, and the client's elimination block was computed against its
    // own four entities, not against whatever that row is. Over-warning is the
    // safe direction, as it is everywhere else in this function.
    if (hasEliminations && !hasUnscoped) {
      return {
        basis: "consolidated_computed",
        entityCount,
        companyIds,
        eliminationsApplied: true,
      }
    }
    return {
      basis: "sum_of_entities",
      entityCount,
      companyIds,
      eliminationsApplied: false,
    }
  }
  if (hasEliminations) {
    // Elimination rows with fewer than two entities to eliminate BETWEEN is an
    // incomplete import — the entity sheets failed and the EJE sheet did not —
    // not a basis. Calling it `single_entity` would publish the elimination
    // block's own −119M as somebody's balance sheet, confidently. Refuse it
    // the way an un-eliminated sum is refused.
    return {
      basis: "sum_of_entities",
      entityCount,
      companyIds,
      eliminationsApplied: false,
    }
  }
  return {
    basis: "single_entity",
    entityCount,
    companyIds,
    eliminationsApplied: true,
  }
}

export function getBalanceSheetSectionData(lines: BalanceSheetEvidenceLine[]) {
  const grouped = new Map<string, Record<number, number>>()
  const cellIds = new Map<
    string,
    Record<number, { id: string; ambiguous: boolean }>
  >()

  for (const line of lines) {
    const label =
      line.account?.name ??
      line.account?.code ??
      line.accountName ??
      line.accountCode ??
      "—"
    if (!grouped.has(label)) {
      grouped.set(label, {})
      cellIds.set(label, {})
    }
    const months = grouped.get(label)!
    months[line.month] = (months[line.month] ?? 0) + line.amount
    const cells = cellIds.get(label)!
    cells[line.month] = cells[line.month]
      ? { id: cells[line.month].id, ambiguous: true }
      : { id: line.id, ambiguous: false }
  }

  const sectionTotals: Record<number, number> = {}
  const sectionCounts: Record<number, number> = {}
  for (let month = 1; month <= 12; month += 1) {
    const monthLines = lines.filter((line) => line.month === month)
    sectionTotals[month] = monthLines.reduce((sum, line) => sum + line.amount, 0)
    sectionCounts[month] = monthLines.length
  }

  return { grouped, sectionTotals, sectionCounts, cellIds }
}

export type BalanceSheetSectionData = ReturnType<
  typeof getBalanceSheetSectionData
>

export function getLatestBalanceSheetEvidenceMonth(
  ...sections: BalanceSheetSectionData[]
): number | null {
  for (let month = 12; month >= 1; month -= 1) {
    if (sections.some((section) => section.sectionCounts[month] > 0)) return month
  }
  return null
}

export function normalizeBalanceSheetMonth(
  assets: BalanceSheetSectionData,
  liabilities: BalanceSheetSectionData,
  equity: BalanceSheetSectionData,
  month: number,
  /**
   * Defect 3 — carried through so callers cannot lose track of what the
   * returned totals mean. Omitted defaults to "eliminations applied", which
   * keeps every pre-existing single-entity / consolidated caller unchanged.
   * The totals themselves are NOT altered: an honest sum is still the best
   * available number, it just may not be described as the group's position.
   */
  scope?: Pick<BalanceSheetScope, "eliminationsApplied"> | null,
) {
  const eliminationsApplied = scope?.eliminationsApplied ?? true
  const hasAssets = assets.sectionCounts[month] > 0
  const hasLiabilities = liabilities.sectionCounts[month] > 0
  const hasEquity = equity.sectionCounts[month] > 0
  const assetValue = hasAssets ? assets.sectionTotals[month] : null

  if (!hasAssets || !hasLiabilities || !hasEquity) {
    return {
      assets: assetValue,
      liabilities: null,
      equity: null,
      convention: null,
      eliminationsApplied,
    } as const
  }

  const normalizedAssets = assets.sectionTotals[month]
  const rawLiabilities = liabilities.sectionTotals[month]
  const rawEquity = equity.sectionTotals[month]
  const signedResidual = normalizedAssets + rawLiabilities + rawEquity
  const naturalResidual = normalizedAssets - rawLiabilities - rawEquity
  const convention =
    Math.abs(signedResidual) <= Math.abs(naturalResidual)
      ? "trial_balance"
      : "natural"
  const factor = convention === "trial_balance" ? -1 : 1
  const normalizedLiabilities = rawLiabilities * factor
  const normalizedEquity = rawEquity * factor
  // A smaller residual is not automatically a credible sign convention. Keep
  // ratio inputs unavailable when the best residual is still material or the
  // normalization would produce negative liabilities. This is a display
  // readiness gate, not a certification of the underlying statement.
  //
  // Defect 3 note: this gate is blind to un-eliminated summation BY
  // CONSTRUCTION. Σ of balanced sheets is balanced, so the residual is ~0 and
  // the convention resolves cleanly on a total that double-counts 123M. That
  // is why `eliminationsApplied` is a separate, declared fact rather than
  // something this function could ever infer.
  const bestResidual = Math.min(Math.abs(signedResidual), Math.abs(naturalResidual))
  const residualTolerance = Math.max(1, Math.abs(normalizedAssets) * 0.001)
  if (bestResidual > residualTolerance || normalizedLiabilities < 0) {
    return {
      assets: normalizedAssets,
      liabilities: null,
      equity: null,
      convention: null,
      eliminationsApplied,
    } as const
  }

  return {
    assets: normalizedAssets,
    liabilities: normalizedLiabilities,
    equity: normalizedEquity,
    convention,
    eliminationsApplied,
  } as const
}

/**
 * Debt-to-equity, or null when the ratio would be a claim the data cannot
 * support.
 *
 * Un-eliminated summation corrupts BOTH sides of this ratio at once —
 * intragroup trade payables inflate the numerator, parent investments in
 * subsidiaries inflate the denominator — so the result is not "approximately
 * right", it is a different quantity wearing a solvency metric's name. The
 * terminal treats D/E as a verdict, so it gets no number rather than a
 * plausible one.
 */
export function balanceSheetDebtToEquity(totals: {
  liabilities: number | null
  equity: number | null
  eliminationsApplied?: boolean
}): number | null {
  if (totals.eliminationsApplied === false) return null
  if (totals.liabilities === null || totals.equity === null) return null
  if (!(totals.equity > 0)) return null
  return totals.liabilities / totals.equity
}
