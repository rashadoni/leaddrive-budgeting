/**
 * Workbook-level profile for AI Import.
 *
 * This is deliberately deterministic and compact. It gives the classifier and
 * preview UI workbook-wide signals (source vs summary, actual vs budget, BU,
 * formulas, totals, eliminations, duplicates) without sending the full workbook
 * content or making write decisions.
 */
import { createHash } from "node:crypto"
import type * as XLSXType from "xlsx"
import type { SheetMeta } from "./sheet-meta-extractor"

export type WorkbookPlanHint = "actual" | "budget" | "mixed" | "unknown"
export type WorkbookRoleHint = "source_like" | "summary_like" | "mixed" | "unknown"

export interface WorkbookSheetProfile {
  sheetName: string
  totalRows: number
  totalColumns: number
  headerRowIndex: number | null
  roleHint: WorkbookRoleHint
  planHint: WorkbookPlanHint
  sourceScore: number
  summaryScore: number
  monthHeaderCount: number
  monthHeaders: string[]
  buColumns: string[]
  entityLikeValues: string[]
  formulaCells: number
  codeLikeCells: number
  numericCells: number
  totalRowsCount: number
  subtotalRowsCount: number
  eliminationSignals: string[]
  duplicateGroupId: string | null
  fingerprint: string
}

export interface WorkbookProfile {
  filename: string
  sheetCount: number
  totalRows: number
  totalColumns: number
  workbookPlanHint: WorkbookPlanHint
  sourceLikeSheets: number
  summaryLikeSheets: number
  monthLikeSheets: number
  sheetsWithBuColumns: number
  sheetsWithFormulas: number
  sheetsWithEliminations: number
  duplicateGroups: Array<{ id: string; sheetNames: string[] }>
  repeatedDataHints: Array<{ sheetNames: string[]; reason: string }>
  sheets: WorkbookSheetProfile[]
}

export interface WorkbookProfileOptions {
  filename: string
  sheetMetas: SheetMeta[]
  knownEntityCodes?: readonly string[]
  entityAliases?: Record<string, string>
  scanRows?: number
  scanColumns?: number
}

const MONTH_NAMES = new Set([
  "jan",
  "january",
  "yan",
  "yanvar",
  "feb",
  "february",
  "fev",
  "fevral",
  "mar",
  "march",
  "mart",
  "apr",
  "april",
  "aprel",
  "may",
  "mai",
  "jun",
  "june",
  "iyun",
  "jul",
  "july",
  "iyul",
  "aug",
  "august",
  "avq",
  "avqust",
  "sep",
  "sept",
  "september",
  "sen",
  "sentyabr",
  "oct",
  "october",
  "okt",
  "oktyabr",
  "nov",
  "november",
  "noy",
  "noyabr",
  "dec",
  "december",
  "dek",
  "dekabr",
])

const ACTUAL_RE = /\b(actual|fact|fakt|faktiki|факт)\b/i
const BUDGET_RE = /\b(budget|plan|forecast|proqnoz|budce|büdcə|бюджет|план)\b/i
const SUMMARY_RE = /\b(summary|pivot|dashboard|comparison|compare|cons|consolidated|marginality|title|icmal|icmal|итог|свод)\b/i
const SOURCE_RE = /\b(actual|budget|plf|bs|cf|trial|ledger|data)\b/i
const TOTAL_RE = /\b(total|grand total|cəmi|cemi|yekun|итого|всего)\b/i
const SUBTOTAL_RE = /\b(subtotal|sub total|ara cəmi|ara cemi|промежуточ)\b/i
const ELIMINATION_RE = /\b(eje|aje|elim|elimination|intercompany|intragroup|консолидац|eliminasiya)\b/i
const CODE_RE = /\b(PLF|PL|BS|CF)[._-]?\d{1,3}(?:[._-]\d{1,3}){0,4}\b/i
const BU_RE = /^BU(?:_\d+)?$/i

function clean(v: unknown): string {
  if (v === null || v === undefined) return ""
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v).trim()
}

function normalize(v: unknown): string {
  return clean(v).toLowerCase().replace(/\s+/g, " ")
}

function isMonthLike(v: unknown): boolean {
  if (v instanceof Date) return true
  if (typeof v === "number") return Number.isInteger(v) && v >= 1 && v <= 12
  const s = normalize(v).replace(/[.]/g, "")
  if (!s) return false
  if (/^20\d{2}[-/](0?[1-9]|1[0-2])$/.test(s)) return true
  if (/^(0?[1-9]|1[0-2])[-/]20\d{2}$/.test(s)) return true
  if (MONTH_NAMES.has(s)) return true
  return MONTH_NAMES.has(s.slice(0, 3))
}

function planHintFor(meta: SheetMeta): WorkbookPlanHint {
  const name = meta.sheetName
  const actual = meta.sectionContext === "actual" || ACTUAL_RE.test(name)
  const budget = meta.sectionContext === "budget" || BUDGET_RE.test(name)
  if (actual && budget) return "mixed"
  if (actual) return "actual"
  if (budget) return "budget"
  return "unknown"
}

function mergePlanHints(hints: readonly WorkbookPlanHint[]): WorkbookPlanHint {
  const hasActual = hints.includes("actual") || hints.includes("mixed")
  const hasBudget = hints.includes("budget") || hints.includes("mixed")
  if (hasActual && hasBudget) return "mixed"
  if (hasActual) return "actual"
  if (hasBudget) return "budget"
  return "unknown"
}

function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)))
}

function roleHint(sourceScore: number, summaryScore: number): WorkbookRoleHint {
  if (sourceScore >= 50 && summaryScore >= 50) return "mixed"
  if (sourceScore >= 50) return "source_like"
  if (summaryScore >= 50) return "summary_like"
  return "unknown"
}

function buildAliasSet(
  knownEntityCodes: readonly string[] = [],
  entityAliases: Record<string, string> = {},
): Set<string> {
  const out = new Set<string>()
  for (const code of knownEntityCodes) {
    out.add(code.toUpperCase())
    const last = code.split("-").at(-1)
    if (last) out.add(last.toUpperCase())
  }
  for (const alias of Object.keys(entityAliases)) out.add(alias.toUpperCase())
  return out
}

function fingerprintSheet(input: {
  meta: SheetMeta
  monthHeaders: readonly string[]
  buColumns: readonly string[]
  codeLikeCells: number
  totalRowsCount: number
  sample: readonly string[]
}): string {
  const payload = JSON.stringify({
    headers: input.meta.headers.map(normalize).filter(Boolean),
    rowsBand: Math.round(input.meta.totalRows / 25) * 25,
    colsBand: Math.round(input.meta.totalColumns / 5) * 5,
    monthHeaders: input.monthHeaders.map(normalize),
    buColumns: input.buColumns.map(normalize),
    codeBand: Math.round(input.codeLikeCells / 10) * 10,
    totalRowsCount: input.totalRowsCount,
    sample: input.sample.slice(0, 30).map(normalize).filter(Boolean),
  })
  return createHash("sha256").update(payload).digest("hex").slice(0, 12)
}

function formulaCellCount(sheet: XLSXType.WorkSheet): number {
  let count = 0
  for (const key of Object.keys(sheet)) {
    if (key.startsWith("!")) continue
    const cell = sheet[key] as { f?: unknown } | undefined
    if (cell?.f) count++
  }
  return count
}

export function buildWorkbookProfile(
  workbook: XLSXType.WorkBook,
  xlsx: typeof XLSXType,
  opts: WorkbookProfileOptions,
): WorkbookProfile {
  const scanRows = opts.scanRows ?? 160
  const scanColumns = opts.scanColumns ?? 40
  const metaByName = new Map(opts.sheetMetas.map((m) => [m.sheetName, m]))
  const aliases = buildAliasSet(opts.knownEntityCodes, opts.entityAliases)

  const sheets: WorkbookSheetProfile[] = []
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    const meta =
      metaByName.get(sheetName) ?? {
        sheetName,
        range: sheet?.["!ref"] ?? null,
        totalRows: 0,
        totalColumns: 0,
        headerRowIndex: null,
        headers: [],
        sample: [],
        columnProfiles: [],
        isSectionSeparator: false,
        sectionContext: null,
      }
    const rows = sheet
      ? (xlsx.utils.sheet_to_json(sheet, {
          header: 1,
          raw: true,
          blankrows: false,
          defval: "",
        }) as unknown[][])
      : []
    const scan = rows.slice(0, scanRows).map((row) => row.slice(0, scanColumns))
    const headerRows = [
      ...(meta.headerRowIndex !== null ? [rows[meta.headerRowIndex] ?? []] : []),
      ...scan.slice(0, 6),
    ]
    const monthHeaders = Array.from(
      new Set(
        headerRows
          .flat()
          .filter(isMonthLike)
          .map((v) => clean(v).slice(0, 24)),
      ),
    )
    const buColumns = Array.from(
      new Set(
        headerRows
          .flat()
          .filter((v) => BU_RE.test(clean(v)))
          .map((v) => clean(v).toUpperCase()),
      ),
    )
    let numericCells = 0
    let codeLikeCells = 0
    let totalRowsCount = 0
    let subtotalRowsCount = 0
    const eliminationSignals = new Set<string>()
    const entityLikeValues = new Set<string>()
    const sampleValues: string[] = []

    for (const row of scan) {
      let rowHasTotal = false
      let rowHasSubtotal = false
      for (const value of row) {
        const text = clean(value)
        if (!text) continue
        if (sampleValues.length < 40) sampleValues.push(text)
        if (typeof value === "number" && Number.isFinite(value)) numericCells++
        if (CODE_RE.test(text)) codeLikeCells++
        if (TOTAL_RE.test(text)) rowHasTotal = true
        if (SUBTOTAL_RE.test(text)) rowHasSubtotal = true
        if (ELIMINATION_RE.test(text)) eliminationSignals.add(text.slice(0, 40))
        const upper = text.toUpperCase()
        if (aliases.has(upper) && entityLikeValues.size < 8) entityLikeValues.add(upper)
      }
      if (rowHasTotal) totalRowsCount++
      if (rowHasSubtotal) subtotalRowsCount++
    }

    if (ELIMINATION_RE.test(sheetName)) eliminationSignals.add(sheetName)

    const formulaCells = sheet ? formulaCellCount(sheet) : 0
    const sourceScore = clampScore(
      monthHeaders.length * 10 +
        Math.min(codeLikeCells, 30) * 2 +
        Math.min(numericCells, 80) * 0.4 +
        buColumns.length * 15 +
        (SOURCE_RE.test(sheetName) ? 15 : 0),
    )
    const summaryScore = clampScore(
      (SUMMARY_RE.test(sheetName) ? 35 : 0) +
        Math.min(formulaCells, 30) * 1.5 +
        Math.min(totalRowsCount, 12) * 4 +
        Math.min(subtotalRowsCount, 8) * 5 +
        (eliminationSignals.size > 0 ? 25 : 0) +
        (meta.totalRows <= 12 && meta.totalColumns <= 8 ? 15 : 0),
    )
    const fingerprint = fingerprintSheet({
      meta,
      monthHeaders,
      buColumns,
      codeLikeCells,
      totalRowsCount,
      sample: sampleValues,
    })

    sheets.push({
      sheetName,
      totalRows: meta.totalRows,
      totalColumns: meta.totalColumns,
      headerRowIndex: meta.headerRowIndex,
      roleHint: roleHint(sourceScore, summaryScore),
      planHint: planHintFor(meta),
      sourceScore,
      summaryScore,
      monthHeaderCount: monthHeaders.length,
      monthHeaders,
      buColumns,
      entityLikeValues: Array.from(entityLikeValues),
      formulaCells,
      codeLikeCells,
      numericCells,
      totalRowsCount,
      subtotalRowsCount,
      eliminationSignals: Array.from(eliminationSignals),
      duplicateGroupId: null,
      fingerprint,
    })
  }

  const byFingerprint = new Map<string, WorkbookSheetProfile[]>()
  for (const sheet of sheets) {
    const group = byFingerprint.get(sheet.fingerprint) ?? []
    group.push(sheet)
    byFingerprint.set(sheet.fingerprint, group)
  }
  const duplicateGroups: WorkbookProfile["duplicateGroups"] = []
  let duplicateIndex = 1
  for (const group of byFingerprint.values()) {
    if (group.length < 2) continue
    const id = `dup-${duplicateIndex++}`
    duplicateGroups.push({ id, sheetNames: group.map((s) => s.sheetName) })
    for (const sheet of group) sheet.duplicateGroupId = id
  }

  const repeatedDataHints = duplicateGroups.map((g) => ({
    sheetNames: g.sheetNames,
    reason: "matching structure fingerprint",
  }))

  return {
    filename: opts.filename,
    sheetCount: sheets.length,
    totalRows: sheets.reduce((sum, s) => sum + s.totalRows, 0),
    totalColumns: sheets.reduce((sum, s) => sum + s.totalColumns, 0),
    workbookPlanHint: mergePlanHints(sheets.map((s) => s.planHint)),
    sourceLikeSheets: sheets.filter((s) => s.roleHint === "source_like" || s.roleHint === "mixed").length,
    summaryLikeSheets: sheets.filter((s) => s.roleHint === "summary_like" || s.roleHint === "mixed").length,
    monthLikeSheets: sheets.filter((s) => s.monthHeaderCount >= 3).length,
    sheetsWithBuColumns: sheets.filter((s) => s.buColumns.length > 0).length,
    sheetsWithFormulas: sheets.filter((s) => s.formulaCells > 0).length,
    sheetsWithEliminations: sheets.filter((s) => s.eliminationSignals.length > 0).length,
    duplicateGroups,
    repeatedDataHints,
    sheets,
  }
}

export function compactWorkbookProfileForClassifier(profile: WorkbookProfile) {
  return {
    filename: profile.filename,
    sheetCount: profile.sheetCount,
    workbookPlanHint: profile.workbookPlanHint,
    sourceLikeSheets: profile.sourceLikeSheets,
    summaryLikeSheets: profile.summaryLikeSheets,
    monthLikeSheets: profile.monthLikeSheets,
    sheetsWithBuColumns: profile.sheetsWithBuColumns,
    sheetsWithFormulas: profile.sheetsWithFormulas,
    sheetsWithEliminations: profile.sheetsWithEliminations,
    duplicateGroups: profile.duplicateGroups,
    repeatedDataHints: profile.repeatedDataHints,
    sheets: profile.sheets.map((s) => ({
      sheetName: s.sheetName,
      roleHint: s.roleHint,
      planHint: s.planHint,
      sourceScore: s.sourceScore,
      summaryScore: s.summaryScore,
      monthHeaderCount: s.monthHeaderCount,
      buColumnCount: s.buColumns.length,
      entityLikeValues: s.entityLikeValues,
      formulaCells: s.formulaCells,
      codeLikeCells: s.codeLikeCells,
      totalRowsCount: s.totalRowsCount,
      subtotalRowsCount: s.subtotalRowsCount,
      eliminationSignalCount: s.eliminationSignals.length,
      duplicateGroupId: s.duplicateGroupId,
    })),
  }
}
