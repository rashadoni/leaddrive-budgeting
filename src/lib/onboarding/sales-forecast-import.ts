/**
 * Phase 7.M Tier 7 (Phase 4, 2026-05-21) — Sales-forecast grid parser.
 *
 * Pure module — no Prisma. Parses a single-sheet xlsx grid where:
 *   • Column 1 = department/team label (free-form; caller resolves to
 *     BudgetDepartment.id)
 *   • Columns 2-13 = 12 month columns (1=Jan..12=Dec). Header text is
 *     ignored — month index is positional, matching the legacy
 *     `/api/budgeting/sales-forecast/import` ExcelJS shape.
 *
 * Each non-empty cell becomes one `ParsedForecastEntry`. Rows whose
 * label is "total" / "итого" / "cəmi" / empty are skipped. Year is
 * supplied by the caller (orchestrator input), not from the workbook.
 *
 * Validation:
 *  - missing department label → row skipped, warning
 *  - non-finite / negative cell value → cell skipped, warning per cell
 *  - any value 0 is treated as a legitimate forecast amount and included
 *
 * Pure module — no Prisma, no audit, no DB.
 */
import type * as XLSX from "xlsx"

export interface ParsedForecastEntry {
  /** 1-based row number in workbook (matches Excel UI). */
  rowNumber: number
  /** Lower-cased trimmed label — caller maps to BudgetDepartment.id. */
  departmentLabel: string
  /** 1..12 (1=Jan..12=Dec). */
  month: number
  /** Always finite, ≥0. */
  amount: number
}

export interface ParseEntryError {
  rowNumber: number
  reason: string
  departmentLabel?: string
}

export interface ParseEntryWarning {
  rowNumber: number
  message: string
  departmentLabel?: string
}

export interface ImportParseResult {
  entries: ParsedForecastEntry[]
  errors: ParseEntryError[]
  warnings: ParseEntryWarning[]
}

const SKIP_LABELS = new Set([
  "total",
  "итого",
  "cəmi",
  "cemi",
  "ümumi",
  "umumi",
  "sum",
  "summary",
])

/**
 * Parse a sales-forecast workbook (department × 12-month grid).
 * Reads `workbook.SheetNames[0]` — caller wraps a single-sheet workbook
 * around the AI-classified sheet in adapter usage.
 */
export function parseSalesForecastWorkbook(
  workbook: XLSX.WorkBook,
  xlsx: typeof XLSX,
): ImportParseResult {
  const entries: ParsedForecastEntry[] = []
  const errors: ParseEntryError[] = []
  const warnings: ParseEntryWarning[] = []

  const sheetName = workbook.SheetNames[0]
  if (!sheetName) {
    errors.push({ rowNumber: 0, reason: "Workbook has no sheets." })
    return { entries, errors, warnings }
  }
  const sheet = workbook.Sheets[sheetName]
  const aoa = xlsx.utils.sheet_to_json(sheet, {
    header: 1,
    blankrows: false,
    defval: null,
  }) as Array<Array<unknown>>

  if (aoa.length < 2) {
    errors.push({
      rowNumber: 0,
      reason:
        "Workbook must have a header row and at least one data row. Expected col 1 = department, cols 2-13 = monthly amounts (Jan..Dec).",
    })
    return { entries, errors, warnings }
  }

  // Header is row 0; data starts row 1
  for (let r = 1; r < aoa.length; r++) {
    const rowNumber = r + 1 // 1-based for UI parity
    const cells = aoa[r] ?? []
    const labelRaw = cells[0]
    const label =
      typeof labelRaw === "string"
        ? labelRaw.trim()
        : labelRaw != null
          ? String(labelRaw).trim()
          : ""
    if (!label) continue // silently skip blank rows
    const labelLc = label.toLowerCase()
    if (SKIP_LABELS.has(labelLc)) continue // Total / Итого / etc.

    for (let m = 1; m <= 12; m++) {
      const cellValue = cells[m] // col index 1..12 corresponds to month 1..12
      if (cellValue == null || cellValue === "") continue
      const amount =
        typeof cellValue === "number"
          ? cellValue
          : Number(String(cellValue ?? "").replace(/[^\d.\-]/g, ""))
      if (!Number.isFinite(amount)) {
        warnings.push({
          rowNumber,
          message: `non-finite amount in month ${m} — skipped`,
          departmentLabel: label,
        })
        continue
      }
      if (amount < 0) {
        warnings.push({
          rowNumber,
          message: `negative amount ${amount} in month ${m} — skipped`,
          departmentLabel: label,
        })
        continue
      }
      entries.push({
        rowNumber,
        departmentLabel: labelLc,
        month: m,
        amount,
      })
    }
  }

  return { entries, errors, warnings }
}
