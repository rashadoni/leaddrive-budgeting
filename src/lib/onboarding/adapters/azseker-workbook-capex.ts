/**
 * Phase 7.M Tier 3 (2026-05-19) — parse "CAPEX_Farm" + "CAPEX_CPC" sheets
 * from the new Guvven Fin.xlsx into per-entity CAPEX initiatives, which
 * get persisted on `Company.settings.capexInitiatives` (JSON array).
 *
 * Two distinct layouts handled:
 *
 *   CAPEX_Farm — 243 rows, mixed CAPEX + OPEX with cost-centre attribution:
 *     col 0: Group ("CAPEX" or "OPEX")
 *     col 1: Source (Legal / Warehouse / HR / Lab / ...)
 *     col 2: Summary Group (GENERAL ADMIN / OPEX / ...)
 *     col 3: Financing (Internal / Shareholder / ...)
 *     col 4: Capexin təyinatı (purpose / item)
 *     col 5: Capexin təyinatı_Prezentasiya (presentation form)
 *     col 6: PLF # (P&L code)
 *     col 7: CF # (Cash Flow code)
 *     col 8: Xərc mərkəzi 1C (cost centre — e.g. "EDN – Admin", "AZS- Yevlax")
 *     col 9: Sayı (qty)
 *     col 10: Dəyər (CCY) (unit price)
 *     col 11: Məbləğ (CCY) (line total)
 *
 *   CAPEX_CPC — 7 rows, all AZSEKER-CPC, multi-currency:
 *     col 0: Source (Shareholder / Internal)
 *     col 1: CF # (Cash Flow code)
 *     col 2: Capexin təyinatı (purpose)
 *     col 3: Əsas vəsaitin qrupu (asset group)
 *     col 4: Alışın təyinatı (purchase purpose)
 *     col 5: Sayı (qty)
 *     col 6: Alış dəyəri (purchase price, in CCY)
 *     col 7: Məbləğ (CCY) (subtotal in CCY)
 *     col 8: Valyuta (currency: AZN / EUR / ...)
 *     col 9: X-rate
 *     col 10: Məbləğ (AZN) (FX-converted AZN total)
 *     col 11: ƏDV (VAT %)
 *
 * Entity attribution:
 *   • CAPEX_CPC → all rows → AZSEKER-CPC (no cost centre col)
 *   • CAPEX_Farm → resolve from cost-centre col[8] via existing
 *     `resolveEntityFromCostCenter` from azseker-workbook-mapping.ts.
 *     QT/DAS/BO/EDN/AZS → AZSEKER-EDEN (per Phase 7.M Azik confirm
 *     2026-05-19: all farming under Eden Agro).
 */
import { parseNumericCell } from "../numeric-cell"
import { resolveEntityFromCostCenter } from "../azseker-workbook-mapping"

export interface CapexInitiative {
  /** Canonical company code (AZSEKER-EDEN / AZSEKER-CPC / etc). */
  companyCode: string
  /** Free-text item / purpose (Azerbaijani). */
  description: string
  /** Number of units. */
  quantity: number
  /** Total amount in AZN. */
  amountAzn: number
  /** Optional VAT rate (e.g. 0.18 for 18%). */
  vatRate: number | null
  /** Type — "CAPEX" or "OPEX" (Farm sheet mixes them). */
  initiativeType: "CAPEX" | "OPEX"
  /** Source / financing model (Legal / Shareholder / Internal / ...). */
  financingSource: string | null
  /** Optional category from "Source" or "Summary Group" column. */
  category: string | null
  /** Cash-flow code (CF.XX.YY.ZZ) for cross-reference. */
  cfCode: string | null
  /** P&L code (PLF.XX.YY.ZZ) if OPEX type. */
  plfCode: string | null
  /** Optional currency (always AZN for Farm; CCY for CPC). */
  currency: string
  /** Cost centre raw label from the xlsx (Farm only). */
  costCentre: string | null
  /** Sheet name source for audit. */
  sourceSheet: string
}

export interface CapexParseResult {
  initiatives: CapexInitiative[]
  warnings: string[]
  rowsExamined: number
}

const NULL_CODE_TOKENS = new Set(["---", "", "n/a", "N/A"])

/**
 * Phase 11.31 — delegates to the one numeric cell parser. The local version
 * replaced the FIRST comma with a dot, so a CAPEX amount written `"1,234"`
 * (1234 manat) was booked as 1.234 manat, and `"1,234,56"` fell through to 0.
 */
/**
 * Phase 11.38 (2026-07-29) — report the cells this returns 0 for.
 *
 * The parse became correct in 11.31; the `?? 0` kept the other half of the
 * defect: an unreadable cell and a real 0.00 reach the caller as the same
 * number. `parseNumericCell` already says WHY it failed — this drops that
 * reason into the adapter's warnings instead of discarding it.
 *
 * An EMPTY cell is not reported: absent is not invalid, and warning on every
 * blank would bury the cells that matter. The ambiguous verdict IS reported —
 * a single separator before exactly three digits ("1,234") is 1234 under
 * grouping and 1.234 under a decimal reading, and a flag nobody surfaces is
 * the same as no flag.
 */
export interface NumericWarnCtx {
  warnings: string[]
  /** 0-based row index; reported +1 to match the spreadsheet. */
  row: number
  /** What the cell was being read as, e.g. "CAPEX amount". */
  field: string
}

function numericOrZero(v: unknown, ctx?: NumericWarnCtx): number {
  const parsed = parseNumericCell(v)
  if (ctx && parsed.reason) {
    ctx.warnings.push(
      parsed.value === null
        ? `Row ${ctx.row + 1}: ${ctx.field} — ${parsed.reason}; read as 0`
        : `Row ${ctx.row + 1}: ${ctx.field} — ${parsed.reason}`,
    )
  }
  return parsed.value ?? 0
}

function cleanCode(v: unknown): string | null {
  if (typeof v !== "string") return null
  const trimmed = v.trim()
  if (NULL_CODE_TOKENS.has(trimmed)) return null
  return trimmed
}

/**
 * Parse the "CAPEX_Farm" sheet (243 rows, mixed CAPEX + OPEX with
 * cost-centre attribution).
 */
export function parseCapexFarmSheetFromAoa(
  aoa: unknown[][],
  sourceSheet = "CAPEX_Farm",
): CapexParseResult {
  const initiatives: CapexInitiative[] = []
  const warnings: string[] = []
  // Header row is r=1 (zero-indexed). Data starts r=2.
  for (let r = 2; r < aoa.length; r++) {
    const row = aoa[r]
    if (!row) continue
    const groupCell = row[0]
    if (typeof groupCell !== "string") continue
    const group = groupCell.trim().toUpperCase()
    if (group !== "CAPEX" && group !== "OPEX") continue
    const description =
      typeof row[4] === "string" ? row[4].trim() : ""
    if (!description) {
      warnings.push(`Row ${r + 1}: empty description; skipped`)
      continue
    }
    const costCentre = typeof row[8] === "string" ? row[8].trim() : ""
    const companyCode = resolveEntityFromCostCenter(costCentre) ?? "AZSEKER-EDEN"
    const quantity = numericOrZero(row[9], { warnings, row: r, field: "quantity" })
    const amountAzn = numericOrZero(row[11], { warnings, row: r, field: "CAPEX amount" })
    if (amountAzn === 0) {
      warnings.push(
        `Row ${r + 1}: zero amount for "${description.slice(0, 40)}" — included anyway`,
      )
    }
    initiatives.push({
      companyCode,
      description,
      quantity,
      amountAzn,
      vatRate: null,
      initiativeType: group as "CAPEX" | "OPEX",
      financingSource: typeof row[3] === "string" ? row[3].trim() : null,
      category: typeof row[1] === "string" ? row[1].trim() : null,
      cfCode: cleanCode(row[7]),
      plfCode: cleanCode(row[6]),
      currency: "AZN",
      costCentre: costCentre || null,
      sourceSheet,
    })
  }
  return { initiatives, warnings, rowsExamined: aoa.length }
}

/**
 * Parse the "CAPEX_CPC" sheet (compact, 7 rows, all AZSEKER-CPC).
 */
export function parseCapexCpcSheetFromAoa(
  aoa: unknown[][],
  sourceSheet = "CAPEX_CPC",
): CapexParseResult {
  const initiatives: CapexInitiative[] = []
  const warnings: string[] = []
  // Header row is r=0. Data starts r=1.
  for (let r = 1; r < aoa.length; r++) {
    const row = aoa[r]
    if (!row) continue
    const description =
      typeof row[2] === "string"
        ? row[2].trim()
        : typeof row[4] === "string"
          ? row[4].trim()
          : ""
    if (!description) continue
    const quantity = numericOrZero(row[5], { warnings, row: r, field: "quantity" })
    const amountAzn = numericOrZero(row[10], { warnings, row: r, field: "CAPEX amount" })
    const currency =
      typeof row[8] === "string" && row[8].trim() ? row[8].trim() : "AZN"
    const vatRate = typeof row[11] === "number" ? row[11] : null
    initiatives.push({
      companyCode: "AZSEKER-CPC",
      description,
      quantity,
      amountAzn,
      vatRate,
      initiativeType: "CAPEX",
      financingSource: typeof row[0] === "string" ? row[0].trim() : null,
      category: typeof row[3] === "string" ? row[3].trim() : null,
      cfCode: cleanCode(row[1]),
      plfCode: null,
      currency,
      costCentre: null,
      sourceSheet,
    })
  }
  return { initiatives, warnings, rowsExamined: aoa.length }
}

/**
 * Convenience wrapper — parses both CAPEX sheets from a workbook and
 * merges results.
 */
export function parseCapexSheets(
  workbook: { Sheets: Record<string, unknown>; SheetNames: string[] },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  XLSX: any,
  sheetNames: { farm: string; cpc: string } = {
    farm: "CAPEX_Farm",
    cpc: "CAPEX_CPC",
  },
): CapexParseResult {
  const all: CapexInitiative[] = []
  const warnings: string[] = []
  let rowsExamined = 0

  const farmSheet = workbook.Sheets[sheetNames.farm]
  if (farmSheet) {
    const aoa = XLSX.utils.sheet_to_json(farmSheet, {
      header: 1,
      blankrows: true,
    }) as unknown[][]
    const res = parseCapexFarmSheetFromAoa(aoa, sheetNames.farm)
    all.push(...res.initiatives)
    warnings.push(...res.warnings)
    rowsExamined += res.rowsExamined
  } else {
    warnings.push(`Sheet "${sheetNames.farm}" not found`)
  }

  const cpcSheet = workbook.Sheets[sheetNames.cpc]
  if (cpcSheet) {
    const aoa = XLSX.utils.sheet_to_json(cpcSheet, {
      header: 1,
      blankrows: true,
    }) as unknown[][]
    const res = parseCapexCpcSheetFromAoa(aoa, sheetNames.cpc)
    all.push(...res.initiatives)
    warnings.push(...res.warnings)
    rowsExamined += res.rowsExamined
  } else {
    warnings.push(`Sheet "${sheetNames.cpc}" not found`)
  }

  return { initiatives: all, warnings, rowsExamined }
}
