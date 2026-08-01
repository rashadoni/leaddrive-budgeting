/**
 * 11.82 — assemble the per-sheet facts a warning briefing is allowed to state.
 *
 * `warning-groups.ts` decides WHAT to say about an unread sheet; it can only
 * do that if someone hands it the sheet's dimensions, its classification and
 * the indicators it was going to feed. All three already travel in the
 * preview payload, in three different places:
 *
 *   perFile[].classifications[]        dataType, confidence, role
 *   perFile[].workbookProfile.sheets[] totalRows, totalColumns, headerRowIndex
 *   sheetImpactsByFilename[file][]     the Analysis tab's indicator projection
 *
 * This module is the join. It is deliberately separate from the component so
 * the arithmetic below — the one place a wrong number would turn a helpful
 * message into a confident lie — is unit-testable against the real workbook's
 * measurements.
 *
 * On the arithmetic. `extractWorkbookMeta` reads each sheet with
 * `blankrows: false`, so `totalRows` counts non-empty rows inside `!ref` and
 * `headerRowIndex` indexes that same collapsed array. Two consequences:
 *
 *   • data rows  = totalRows − headerRowIndex − 1. On the live
 *     `Müştəri İcmalı` (totalRows 375, headerRowIndex 3) that is 371, which
 *     is the exact customer count in column B.
 *   • the Excel row number of the header is NOT recoverable. `!ref` starts at
 *     A2 and row 5 is blank, so the header at index 3 is Excel row 6 — off by
 *     one from every naive formula. `preambleRows` therefore reports "3 rows
 *     sit above the header", which is true of what the pipeline saw, and the
 *     copy never says "row N".
 */
import type { SheetFacts } from "@/lib/onboarding/ai-import/warning-groups"

/** The slice of the preview response this join needs. Structurally typed so
 *  both `MultiFileApiResponse` and a test fixture satisfy it. */
export interface WarningFactsSource {
  perFile?: ReadonlyArray<{
    filename: string
    classifications?: ReadonlyArray<{
      sheetName: string
      dataType: string
      confidence: number
      role?: "source" | "derived_summary"
    }>
    workbookProfile?: {
      sheets?: ReadonlyArray<Record<string, unknown>>
    } | null
  }>
  sheetImpactsByFilename?: Record<
    string,
    ReadonlyArray<{
      sheetName: string
      impact?: { indicators?: ReadonlyArray<{ code: string }> }
    }>
  >
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null
}

export function buildWarningSheetFacts(
  res: WarningFactsSource | null | undefined,
): SheetFacts[] {
  if (!res?.perFile) return []
  const out: SheetFacts[] = []

  for (const file of res.perFile) {
    const profiles = new Map<string, Record<string, unknown>>()
    for (const s of file.workbookProfile?.sheets ?? []) {
      const name = typeof s.sheetName === "string" ? s.sheetName : null
      if (name) profiles.set(name, s)
    }
    const impacts = new Map<string, string[]>()
    for (const i of res.sheetImpactsByFilename?.[file.filename] ?? []) {
      impacts.set(
        i.sheetName,
        (i.impact?.indicators ?? []).map((x) => x.code),
      )
    }

    for (const c of file.classifications ?? []) {
      const p = profiles.get(c.sheetName)
      const totalRows = num(p?.totalRows)
      const headerRowIndex = num(p?.headerRowIndex)
      // headerRowIndex is null both when the sheet is empty and when no
      // header could be identified. Only the second is worth saying, and the
      // difference shows in totalRows.
      const headerFound = p ? headerRowIndex !== null : undefined
      out.push({
        filename: file.filename,
        sheetName: c.sheetName,
        dataType: c.dataType,
        confidence: c.confidence,
        role: c.role ?? null,
        dataRows:
          totalRows === null
            ? null
            : headerRowIndex === null
              ? totalRows
              : Math.max(0, totalRows - headerRowIndex - 1),
        columns: num(p?.totalColumns),
        preambleRows: headerRowIndex,
        headerFound,
        indicatorCodes: impacts.get(c.sheetName) ?? [],
      })
    }
  }
  return out
}
