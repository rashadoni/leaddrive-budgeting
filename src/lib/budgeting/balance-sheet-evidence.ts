export interface BalanceSheetEvidenceLine {
  id: string
  accountCode?: string | null
  accountName?: string | null
  account?: { code: string | null; name: string | null } | null
  lineType: string
  month: number
  amount: number
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
) {
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
  const bestResidual = Math.min(Math.abs(signedResidual), Math.abs(naturalResidual))
  const residualTolerance = Math.max(1, Math.abs(normalizedAssets) * 0.001)
  if (bestResidual > residualTolerance || normalizedLiabilities < 0) {
    return {
      assets: normalizedAssets,
      liabilities: null,
      equity: null,
      convention: null,
    } as const
  }

  return {
    assets: normalizedAssets,
    liabilities: normalizedLiabilities,
    equity: normalizedEquity,
    convention,
  } as const
}
