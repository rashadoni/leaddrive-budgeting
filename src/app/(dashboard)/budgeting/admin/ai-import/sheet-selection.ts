export interface SheetClassificationCandidate {
  sheetName: string
  dataType: string
  confidence: number
}

function hasYearToken(sheetName: string, year: number): boolean {
  return new RegExp(`(^|\\D)${year}(\\D|$)`).test(sheetName)
}

function byConfidenceDesc(
  a: SheetClassificationCandidate,
  b: SheetClassificationCandidate,
): number {
  return b.confidence - a.confidence
}

export function pickDefaultAnalysisSheet(
  classifications: SheetClassificationCandidate[],
  preferredYear?: number,
): string {
  const targetYear =
    preferredYear && Number.isInteger(preferredYear) ? preferredYear : undefined
  const plfSheets = classifications
    .filter((c) => c.dataType === "PLF")
    .slice()
    .sort(byConfidenceDesc)

  if (targetYear) {
    const targetYearPlf = plfSheets.find((c) => hasYearToken(c.sheetName, targetYear))
    if (targetYearPlf) return targetYearPlf.sheetName
  }

  return plfSheets[0]?.sheetName ?? classifications[0]?.sheetName ?? ""
}
