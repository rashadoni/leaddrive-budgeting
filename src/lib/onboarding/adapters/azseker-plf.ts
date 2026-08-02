/**
 * Phase 7.G CXLV — Azərşəkər PLF/CF code-format xlsx adapter.
 *
 * Parses the PL_X / CF_X / PLF_X sheets from the Consolidated Azərşəkər
 * file (Consolidated budget 2026_AHMAD_NEW.xlsx — 5 entities: EDEN /
 * AZSF / HORIZON / Farm / CPC).
 *
 * --- Sheet shape (observed 2026-04-22) ---
 *
 *   R1: optional flag (e.g. "AFF")
 *   R2: header row — col B = "CASH FLOW STATEMENT" / etc, cols D..O = 12
 *       Excel date headers (2026-01-01 .. 2026-12-01), col Q = annual "2026"
 *   R3: blank
 *   R4+: data rows
 *     col A = PLF/CF code (e.g. "PLF.01", "PLF.01.01", "PLF.01.01.01")
 *     col B = English label
 *     col D..O = 12 monthly values
 *     col Q = annual total
 *
 * --- Code hierarchy (only LEAVES are imported, parents skipped) ---
 *
 *   PLF.XX        — top-level section (REVENUE / COGS / etc.)        SKIP
 *   PLF.XX.XX     — sub-section (Revenue from Products Sold)         SKIP
 *   PLF.XX.XX.XX  — leaf line item (Revenue from Sale of Wheat)      INSERT
 *
 * Parent rows have aggregate values (sum of children) — including them
 * causes ~3× double-counting. Leaf detection: dot-count === 3 (4 segments).
 *
 * --- Account type from PLF code ---
 *
 * Read from `src/lib/budgeting/plf-chart.ts`, which is the ONE statement of
 * what each PLF code is. It is not derived from the section number here (or
 * anywhere) any more: section 07 is titled "OTHER OPERATING INCOME/EXPENSES"
 * and holds both natures, so typing it from `/^0[3-9]$/ -> expense` sent
 * 13,453,098 AZN of subsidies and interest income into the cost-sign pass and
 * stored it NEGATIVE. See that file's header for the full chain.
 *
 * --- Which chart of accounts the sheet is written in ---
 *
 * A sheet whose 12-month band resolves to 2025 is read against the 2025 chart
 * and translated into current terms by `plf-legacy-chart.ts` BEFORE it is
 * typed. `actual-budget-v1.xlsx` renumbered 155 codes between 2025 and 2026,
 * and `chart_of_accounts` is unique on `(organizationId, code)` with no year —
 * so importing 2025 untranslated files 48,735,978 AZN under 2026's names, and
 * leaves 2025's D&A (which the 2025 sheet keeps inside `PLF.05`) above the
 * EBITDA line. Translating first is what makes `plfAccountType` answer for the
 * account the row actually IS. See that file's header.
 *
 * --- CF code prefix (for cash_flow_entries imports) ---
 *
 *   CF.01.* → operating activity
 *   CF.02.* → investing activity
 *   CF.03.* → financing activity
 *
 *   CF.XX.01.XX = INFLOW (positive amounts)
 *   CF.XX.02.XX = OUTFLOW (negative amounts)
 */

import type * as XLSX from "xlsx"
import { toNumberOrNull } from "./azmade-sopl"
import {
  resolveCostSigns,
  type CostSignDecision,
} from "../ai-import/cost-sign"
import {
  classifyCashFlowCode,
  selectLeafMostCashFlowBridgeCodes,
  type CashFlowStoredActivity,
} from "../cf-bridge"
import { plfNature, plfOtherOperatingSide } from "../../budgeting/plf-chart"
import { crossFootPlfSheet, type CrossFootResult } from "./plf-crossfoot"
import {
  resolveLegacyAccount,
  type LegacyMappingKind,
} from "./plf-legacy-chart"
import {
  PLF_2025_CHART_BY_KEY,
  PLF_LEGACY_CHART_YEAR,
} from "./plf-2025-chart-map.generated"

export type PlfAccountType = "revenue" | "cogs" | "expense"
export type CfActivityType = CashFlowStoredActivity
export type CfEntryType = "inflow" | "outflow"

export interface ParsedPlfLine {
  /** The account this row is STORED under — not necessarily the code the
   *  sheet wrote. See `legacyChart`. */
  code: string
  label: string
  accountType: PlfAccountType
  perMonth: number[]
  totalAnnual: number
  /**
   * Set when the row came off a sheet written under a SUPERSEDED chart of
   * accounts and this parse re-pointed it at the current one.
   *
   * `code` above is where the money goes; `sourceCode` is what the sheet
   * said. They differ for a renumbered account, and for a 2025 account whose
   * code the 2026 chart reuses for something else (`kind: "own_account"` with
   * a year-qualified code). Kept on the line so an importer can report the
   * translation instead of the operator discovering it in the ledger.
   */
  legacyChart?: {
    chartYear: number
    sourceCode: string
    kind: LegacyMappingKind
  }
}

/**
 * How many unmapped legacy codes are listed individually before the rest
 * become a count. Ten is enough to recognise a genuine gap in the map and few
 * enough that a foreign chart cannot drown the blocking warnings.
 */
const LEGACY_UNKNOWN_WARNING_CAP = 10

/** One code the legacy-chart map re-pointed, for the caller's report. */
export interface PlfLegacyChartRewrite {
  sourceCode: string
  storedCode: string
  name: string
  kind: LegacyMappingKind
}

export interface ParsedCfLine {
  code: string
  label: string
  activityType: CfActivityType
  entryType: CfEntryType
  /** null means absent source evidence; numeric zero is explicit evidence. */
  perMonth: Array<number | null>
}

export interface PlfParseWarning {
  row: number
  reason: string
}

export interface PlfParseResult {
  sheetName: string
  lines: ParsedPlfLine[]
  warnings: PlfParseWarning[]
  /**
   * Phase 11.9b (2026-07-29) — which cost-sign convention the FILE was found
   * to use, and whether the values above were flipped as a result. Absent on
   * the early-return error paths, which parse nothing.
   *
   * This used to be an unconditional `-raw` on every cogs/expense cell. It is
   * correct for AZSEKER's own workbooks (costs stored negative), which is
   * exactly why it stayed invisible — a debit-convention file (SAP/1C export)
   * had every cost sign flipped, turning gross profit into revenue PLUS cost.
   */
  signConvention?: CostSignDecision
  /**
   * Defect 5 (2026-08-01) — present when the sheet was read against a
   * superseded chart of accounts. `rewrites` lists every code that moved,
   * so the operator sees the translation up front rather than reverse-
   * engineering it from account names afterwards.
   */
  legacyChart?: {
    chartYear: number
    rewrites: PlfLegacyChartRewrite[]
  }
  /**
   * 11.88 — the sheet's own arithmetic, checked against ours.
   *
   * These workbooks compute `PLF.10` themselves and the importer deliberately
   * never reads it, so it is a free, independent statement of what the leaves
   * must add up to. Every defect found by hand on 2026-08-01 — 25.6M of
   * subsidies sitting in revenue, a dropped 1.68M adjustment block, 80,000 of
   * shareholders' expense that reached no row — was found by making exactly
   * this comparison in a terminal. Absent on the early-return paths, which
   * parse nothing.
   */
  crossFoot?: CrossFootResult
}

export interface CfParseResult {
  sheetName: string
  entries: ParsedCfLine[]
  warnings: PlfParseWarning[]
}

/**
 * PLF code → the sign convention this row is STORED under.
 *
 * The nature comes from `plfNature`; this only translates it into the three
 * `lineType` values the write path knows, which is what decides whether the
 * cost-sign pass below negates the cell:
 *
 *   revenue → never flipped, so income stays POSITIVE
 *   cogs / expense → flipped when the file stores costs negative, so cost
 *                    reaches the database POSITIVE
 *
 * Other-operating INCOME (`PLF.07.01/.02`) is therefore `revenue`-conventioned
 * even though it is not revenue: the two facts a lineType carries are "which
 * P&L line" and "which sign", and only the second one lives here. Which line
 * it lands on is `pnlSectionFromCode`'s answer, and that says `otherOperating`.
 * Before this, income was `expense`-conventioned and stored negative — which
 * is the whole 13.45M defect.
 *
 * A subtotal row returns `null` and is skipped. This is the second of two
 * independent guards — `buildLeafPredicate` also refuses to rescue a
 * one-segment section — because a subtotal reaching `budget_lines` is silent,
 * and money that lands twice is harder to notice than money that never lands.
 */
function plfAccountType(code: string): PlfAccountType | null {
  switch (plfNature(code)) {
    case "revenue":
    case "other_operating_income":
      return "revenue"
    case "cogs":
      return "cogs"
    case "opex":
    case "other_operating_expense":
    case "below_ebitda":
      return "expense"
    case "subtotal":
    case null:
      return null
  }
}

/** Excel serial → {year, month0Based} or null. Wrapping `excelSerialToMonth`
 *  but keeping the year too — needed for multi-year-coverage sheets where
 *  picking the FIRST 12 dates gives the WRONG year (e.g. Workbook Fin has
 *  PL Malt = 2025-Jan..2026-Dec; first-12 picks 2025, but the user is
 *  loading the 2026 budget).
 */
function excelSerialToYearMonth(cell: unknown): { year: number; month: number } | null {
  let date: Date | null = null
  if (cell instanceof Date) date = cell
  else if (typeof cell === "number" && Number.isFinite(cell)) {
    if (cell < 44000 || cell > 48000) return null
    date = new Date((cell - 25569) * 86400 * 1000)
  }
  if (!date || isNaN(date.getTime())) return null
  const y = date.getUTCFullYear()
  if (y < 2020 || y > 2031) return null
  return { year: y, month: date.getUTCMonth() }
}

/** Find header row + month column positions.
 *
 *  Accepts optional `preferYear` — when present, only collect candidate
 *  date cells with that calendar year. When absent, pick the year with
 *  the largest count of distinct months (covers single-year sheets and
 *  multi-year where one year dominates).
 *
 *  Why this matters: the Workbook Fin xlsx has sheets that cover multiple
 *  years (e.g. PLF CPC spans 2022..2026). The original implementation
 *  picked the FIRST 12 valid date cells which always meant the earliest
 *  year — for a 2026 budget upload, that produced all-zero rows because
 *  2022 actuals weren't populated. Year-aware detection fixes this.
 */
export function findPlfHeaderRow(
  aoa: unknown[][],
  opts?: { preferYear?: number },
): { row: number; monthCols: number[]; year: number } | null {
  for (let i = 0; i < Math.min(aoa.length, 20); i++) {
    const row = aoa[i] ?? []
    const byYear = new Map<number, number[]>() // year → cols[12] (-1 default)
    for (let c = 0; c < row.length; c++) {
      const ym = excelSerialToYearMonth(row[c])
      if (!ym) continue
      let cols = byYear.get(ym.year)
      if (!cols) {
        cols = Array(12).fill(-1)
        byYear.set(ym.year, cols)
      }
      if (cols[ym.month] === -1) cols[ym.month] = c
    }
    if (byYear.size === 0) continue

    // Prefer requested year if it has all 12; else pick year with most months;
    // tie-break by latest year (the user is more likely loading next year's
    // budget than ancient history).
    let candidates = Array.from(byYear.entries())
      .map(([year, cols]) => ({ year, cols, filled: cols.filter((v) => v !== -1).length }))
      .filter((c) => c.filled === 12)
    // STRICT preferYear (Codex re-review 2026-06-20): when a target year is
    // requested, ONLY accept that year's full band — never fall back to another
    // year. Otherwise a 2026-only sheet rescued with preferYear=2025 would write
    // 2026 values into the 2025 plan (the `apply-multi` Workbook-fallback path).
    if (opts?.preferYear !== undefined) {
      candidates = candidates.filter((c) => c.year === opts.preferYear)
    }
    if (candidates.length === 0) continue
    candidates.sort((a, b) => {
      if (a.filled !== b.filled) return b.filled - a.filled
      return b.year - a.year
    })
    const pick = candidates[0]

    // Sanity: monotonic ascending col indices for Jan..Dec
    let mono = true
    for (let k = 1; k < 12; k++) if (pick.cols[k] <= pick.cols[k - 1]) { mono = false; break }
    if (mono) return { row: i, monthCols: pick.cols, year: pick.year }
  }
  return null
}

// Leaf items: numeric like PLF.05.01.01 OR letter-keyed like PLF.05.01.R (G&A
// rollup lines). 11.70 — this SHAPE rule is no longer the whole story: it
// reads depth as leafness, and `PLF.09.01` (three segments, no children
// anywhere in the sheet) was silently dropped, losing 80,000 AZN of AZSF
// budget and 34,500 of EDEN actuals. `buildLeafPredicate` keeps every code
// this rule accepts and additionally rescues the childless ones it rejects.
// Re-exported so existing importers keep the symbol.
export { LEAF_CODE_RE } from "./plf-leaf-codes"
import { LEAF_CODE_RE, buildLeafPredicate } from "./plf-leaf-codes"

/** Parse PL_X or PLF_X sheet → ParsedPlfLine[] (only leaves).
 *
 *  Optional `preferYear` — for workbooks where one sheet covers multiple
 *  years (e.g. Workbook Fin's PLF CPC spans 2022..2026), this hint scopes
 *  the column lookup to the user's intended budget year.
 */
export function parsePlfPlSheet(
  workbook: XLSX.WorkBook,
  sheetName: string,
  xlsx: typeof XLSX,
  opts?: {
    preferYear?: number
    /**
     * Phase 11.36 (2026-07-29) — use THIS verdict instead of classifying the
     * sheet in isolation.
     *
     * `reporting-pack-detail.ts` splits one worksheet into a synthetic sheet
     * per `BU` and calls this parser once per entity. Each call therefore saw
     * only one entity's rows and could reach a DIFFERENT conclusion about the
     * same workbook — most sharply when a BU's costs are all zero, which
     * classifies as `no_evidence` and falls back to the default flip while a
     * sibling BU reads `positive_costs` and does not flip. One file, two
     * conventions, no signal.
     *
     * The convention is a property of the FILE, so the caller classifies once
     * over every row and passes the verdict down.
     */
    signOverride?: CostSignDecision
    /**
     * Defect 5 (2026-08-01) — which chart of accounts this sheet is written
     * in, when it is not the current one.
     *
     * `undefined` (the default) decides from the resolved header year: a
     * sheet whose 12-month band is 2025 is read against the 2025 chart. That
     * has to be the default, because the whole failure mode is an operator
     * importing 2025 without knowing the codes moved.
     *
     * `null` disables the translation — for a caller that has already done
     * it, or a test that wants the raw codes.
     */
    legacyChartYear?: number | null
  },
): PlfParseResult {
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) {
    return { sheetName, lines: [], warnings: [{ row: 0, reason: `Sheet "${sheetName}" not found` }] }
  }
  const aoa = xlsx.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, blankrows: false }) as unknown[][]

  const header = findPlfHeaderRow(aoa, { preferYear: opts?.preferYear })
  if (!header) {
    return { sheetName, lines: [], warnings: [{ row: 0, reason: "No 12-month date header row found" }] }
  }
  const { row: headerRowIdx, monthCols } = header

  // Defect 5 — a sheet in the 2025 chart of accounts is translated into 2026
  // terms. Only 2025 has a map; any other year (including 2026) is already
  // current and passes through untouched.
  const legacyChartYear =
    opts?.legacyChartYear === undefined
      ? header.year === PLF_LEGACY_CHART_YEAR
        ? PLF_LEGACY_CHART_YEAR
        : null
      : opts.legacyChartYear
  const legacyRewrites: PlfLegacyChartRewrite[] = []
  /** Codes the map does not describe — warned once each, up to the cap. */
  const legacyUnknown = new Set<string>()
  /** Duplicate-name warnings, once per code. */
  const legacyWarned = new Set<string>()

  const lines: ParsedPlfLine[] = []
  // Phase 11.9b — raw per-row annuals feeding the cost-sign classifier.
  const cogsRawAnnuals: number[] = []
  const expenseRawAnnuals: number[] = []
  const cogsLabels: string[] = []
  const expenseLabels: string[] = []
  const warnings: PlfParseWarning[] = []
  /** PLF.07 branches with no chart entry — warned once each, not once per row. */
  const unmappedOtherOperating = new Set<string>()

  // 11.70 — leafness needs the WHOLE sheet, not one row at a time. "Has no
  // children" cannot be decided from a code in isolation, and deciding it
  // from the code's depth is what lost `PLF.09.01`.
  const allCodes: string[] = []
  for (let r = headerRowIdx + 1; r < aoa.length; r++) {
    const c = (aoa[r] ?? [])[0]
    if (typeof c === "string" && c.trim()) allCodes.push(c.trim())
  }
  const isLeafCode = buildLeafPredicate(allCodes)

  for (let r = headerRowIdx + 1; r < aoa.length; r++) {
    const row = aoa[r] ?? []
    const codeRaw = row[0]
    const sourceCode = typeof codeRaw === "string" ? codeRaw.trim() : ""
    if (!sourceCode) continue
    if (!isLeafCode(sourceCode)) continue // only leaves

    const labelRaw = row[1]
    const sourceLabel = typeof labelRaw === "string" ? labelRaw.trim() : sourceCode

    // ── Legacy chart translation ──────────────────────────────────────────
    // Runs BEFORE `plfAccountType`, and that ordering is the point: the 2025
    // chart files D&A inside `PLF.05` (opex) while the 2026 chart puts it at
    // `PLF.09.03` (below EBITDA). Typing the row from the code the SHEET
    // wrote would keep 8,578,368 AZN of depreciation above the EBITDA line
    // and leave 2025 unable to reconcile to its own PLF.08 row.
    const legacy =
      legacyChartYear === null
        ? null
        : resolveLegacyAccount(PLF_2025_CHART_BY_KEY, sourceCode, sourceLabel)
    const code = legacy ? legacy.code : sourceCode
    const label = legacy ? legacy.name : sourceLabel
    const accountType = plfAccountType(code)
    if (!accountType) continue

    // Phase 11.9b (2026-07-29) — pass 1 keeps RAW values. The cogs/expense
    // sign convention is INFERRED from the file after this loop and applied
    // in pass 2, instead of being assumed here.
    //
    // The original note still holds for AZSEKER's own files: this source
    // stores cogs/expense NEGATIVE (additive convention: gross_margin =
    // revenue + cogs in the sheet), and negating — not abs() — is what makes
    // a provision reversal (positive in Excel) land as negative expense
    // rather than inflating the charge. What changed is that this is no
    // longer ASSUMED: a debit-convention file (SAP/1C export) would have had
    // every cost sign flipped, turning gross profit into revenue PLUS cost.
    // Revenue rows are never flipped (negative revenue = returns, which net
    // correctly).
    const perMonth: number[] = []
    let rawAnnual = 0
    let allZero = true
    for (let m = 0; m < 12; m++) {
      const raw = toNumberOrNull(row[monthCols[m]]) ?? 0
      perMonth.push(raw)
      rawAnnual += raw
      if (raw !== 0) allZero = false
    }
    if (allZero) continue

    // Legacy-chart reporting, raised only for rows that actually carry money.
    // A code the map does not describe is the dangerous case: it keeps the
    // code the sheet wrote, and if the CURRENT chart reuses that code the row
    // posts under the current account's name — which is Defect 5 itself,
    // arriving through the one door the map does not cover.
    if (legacyChartYear !== null && !legacy && !legacyUnknown.has(sourceCode)) {
      legacyUnknown.add(sourceCode)
      // Capped: a sheet from a DIFFERENT client that happens to use `PLF.*`
      // codes matches nothing here, and one warning per leaf would bury the
      // channel that carries the blocking ones. The tail is summarised after
      // the loop, so the count is never hidden — only the list is.
      if (legacyUnknown.size <= LEGACY_UNKNOWN_WARNING_CAP) {
        warnings.push({
          row: r + 1,
          reason:
            `${sourceCode} ("${sourceLabel}") is a leaf on a ${legacyChartYear} sheet that the ` +
            `${legacyChartYear} chart map does not describe — imported under its own code, so it ` +
            `will post under whatever the current chart already calls that code. Re-derive the map: ` +
            `npx tsx scripts/derive-plf-2025-chart-map.ts <workbook>`,
        })
      }
    }
    if (legacy?.duplicateOfCurrentCodes && !legacyWarned.has(sourceCode)) {
      legacyWarned.add(sourceCode)
      warnings.push({
        row: r + 1,
        reason:
          `${sourceCode} ("${legacy.name}") keeps its own ${legacyChartYear} account, but the ` +
          `current chart already carries that name at ${legacy.duplicateOfCurrentCodes.join(", ")} — ` +
          `two accounts, one meaning.`,
      })
    }
    if (
      legacy?.rewritten &&
      !legacyRewrites.some((w) => w.sourceCode === sourceCode)
    ) {
      legacyRewrites.push({
        sourceCode,
        storedCode: code,
        name: label,
        kind: legacy.kind,
      })
    }

    // A PLF.07 branch the chart map does not know carries money under a
    // guessed nature. It keeps the historical expense treatment so nothing is
    // dropped, but it must not pass in silence — half of section 07 is income
    // and the guess is wrong half the time.
    if (plfOtherOperatingSide(code) === "unmapped" && !unmappedOtherOperating.has(code)) {
      unmappedOtherOperating.add(code)
      warnings.push({
        row: r + 1,
        reason:
          `${code} is a PLF.07 branch with no entry in the chart map — treated as other-operating ` +
          `EXPENSE. Section 07 holds both income and expense; classify it in src/lib/budgeting/plf-chart.ts.`,
      })
    }

    // 2026-07-30 — labels travel with the annuals so the sign classifier can
    // drop income lines filed under a cost section. Income under PLF.07 no
    // longer reaches this population at all (it types as `revenue` now), but
    // the label filter stays: the next client's chart will file income under a
    // cost section too, and its codes will not be `PLF.xx`.
    if (accountType === "cogs") {
      cogsRawAnnuals.push(rawAnnual)
      cogsLabels.push(label)
    } else if (accountType === "expense") {
      expenseRawAnnuals.push(rawAnnual)
      expenseLabels.push(label)
    }

    lines.push({
      code,
      label,
      accountType,
      perMonth,
      totalAnnual: rawAnnual,
      ...(legacy
        ? {
            legacyChart: {
              chartYear: legacyChartYear as number,
              sourceCode,
              kind: legacy.kind,
            },
          }
        : {}),
    })
  }

  // ── Pass 2: apply the INFERRED cost-sign convention ────────────────────
  // 11.36 — a caller that split this sheet out of a larger one classifies over
  // the WHOLE sheet and passes the verdict in; only a standalone sheet decides
  // for itself.
  const signDecision =
    opts?.signOverride ??
    resolveCostSigns(cogsRawAnnuals, expenseRawAnnuals, {
      cogs: cogsLabels,
      expense: expenseLabels,
    })
  // 11.88 — cross-foot BEFORE the flip, while the leaves are still in the
  // file's own sign convention, because `PLF.10` is written in that convention
  // too. Comparing after the flip would compare two different quantities.
  const crossFoot = crossFootPlfSheet(
    lines.map((l) => l.perMonth.reduce((a, b) => a + b, 0)),
    aoa,
    header.monthCols,
  )
  for (const line of lines) {
    const flip =
      line.accountType === "cogs"
        ? signDecision.flipCogs
        : line.accountType === "expense"
          ? signDecision.flipExpense
          : false
    if (!flip) continue
    for (let m = 0; m < 12; m++) line.perMonth[m] = -line.perMonth[m]
    line.totalAnnual = -line.totalAnnual
  }
  if (legacyUnknown.size > LEGACY_UNKNOWN_WARNING_CAP) {
    warnings.push({
      row: 0,
      reason:
        `${legacyUnknown.size} leaves on this ${legacyChartYear} sheet are not in the ` +
        `${legacyChartYear} chart map (${LEGACY_UNKNOWN_WARNING_CAP} listed above). At this ` +
        `scale the sheet is probably not the chart the map describes, and NOTHING was translated ` +
        `— check the workbook before trusting the account names.`,
    })
  }
  // `warnings` is a row-level PROBLEM channel — callers treat an empty list as
  // "clean parse" — so the routine verdict travels on the result instead, and
  // only a genuinely blocking one is raised as a warning.
  if (signDecision.blockedReason) {
    warnings.push({ row: 0, reason: `BLOCKED: ${signDecision.blockedReason}` })
  }
  // 11.88 — a disagreement with the sheet's own bottom line is reported, never
  // resolved. Which side is right is an accounting question about the client's
  // workbook, not a parsing question, and guessing is how 25.6M of subsidies
  // spent a year in the revenue line. Not `BLOCKED:` — the import proceeds and
  // the operator decides; a gate here would refuse a file whose own arithmetic
  // is off by a rounding, which is not ours to police.
  if (crossFoot.mismatch) {
    warnings.push({
      row: 0,
      reason:
        `CROSS-FOOT: the rows imported from this sheet add up to ` +
        `${crossFoot.parsedTotal.toFixed(2)}, but the sheet's own PLF.10 ` +
        `(NET PROFIT / (LOSS)) says ${crossFoot.sheetTotal?.toFixed(2)} — a gap ` +
        `of ${crossFoot.delta?.toFixed(2)}. Nothing was dropped or added by the ` +
        `import; the sheet does not agree with itself. Check PLF.10's formula ` +
        `against the rows above it before trusting either number.`,
    })
  }

  return {
    sheetName,
    lines,
    warnings,
    signConvention: signDecision,
    crossFoot,
    ...(legacyChartYear !== null
      ? { legacyChart: { chartYear: legacyChartYear, rewrites: legacyRewrites } }
      : {}),
  }
}

/** Parse CF_X sheet → ParsedCfLine[] (only leaves).
 *  Same `preferYear` hint as `parsePlfPlSheet`.
 */
export function parsePlfCfSheet(
  workbook: XLSX.WorkBook,
  sheetName: string,
  xlsx: typeof XLSX,
  opts?: { preferYear?: number },
): CfParseResult {
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) {
    return { sheetName, entries: [], warnings: [{ row: 0, reason: `Sheet "${sheetName}" not found` }] }
  }
  const aoa = xlsx.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, blankrows: false }) as unknown[][]

  const header = findPlfHeaderRow(aoa, { preferYear: opts?.preferYear })
  if (!header) {
    return { sheetName, entries: [], warnings: [{ row: 0, reason: "No 12-month date header row found" }] }
  }
  const { row: headerRowIdx, monthCols } = header

  const entries: ParsedCfLine[] = []
  const warnings: PlfParseWarning[] = []

  // 11.72 — the same treatment 11.70 gave the P&L parser, for the same reason.
  //
  // This loop used to decide leafness from the SHAPE of the code
  // (`LEAF_CODE_RE`, i.e. "four segments"), which is exactly the rule that lost
  // `PLF.09.01` — 80,000 ₼ on AZSF, 10.8% of that company's entire activity,
  // under a green `db-readback` verdict. Depth stood in for leafness there and
  // stands in for it here; `buildLeafPredicate` uses the real thing.
  //
  // Additive, as on the P&L side: everything the shape rule accepts still
  // passes, and a rejected code is rescued only when nothing descends from it
  // and no ancestor of it is already imported. Nothing that imports today stops
  // importing.
  //
  // One structural difference worth stating, because it changes what a rescue
  // MEANS here. A P&L code is `PLF.<section>.<account>`, so `PLF.09.01` is a
  // posting account. A cash-flow code is `CF.<activity>.<direction>.<account>`
  // — the third segment is the inflow/outflow bucket this very function reads
  // below — so a three-segment `CF.01.01` is a DIRECTION SUBTOTAL, not an
  // account. It is rescued only when the sheet breaks out nothing beneath it,
  // in which case that row is the most specific evidence the file contains and
  // importing it is the only way not to lose it. `CF.01` cannot be rescued at
  // all: one numeric segment fails the depth guard, the same guard that stops
  // `PLF.03`/`PLF.08` being imported as expenses (11.74).
  //
  // Bridge rows (CF.04–07) never went through the shape rule and do not go
  // through this one either — they are canonical statement evidence, may
  // legitimately be top-level, and have their own month-scoped leaf-most
  // selection further down.
  const allCfCodes: string[] = []
  for (let r = headerRowIdx + 1; r < aoa.length; r++) {
    const c = (aoa[r] ?? [])[0]
    if (typeof c === "string" && c.trim()) allCfCodes.push(c.trim())
  }
  const isLeafCfCode = buildLeafPredicate(allCfCodes)

  for (let r = headerRowIdx + 1; r < aoa.length; r++) {
    const row = aoa[r] ?? []
    const codeRaw = row[0]
    const code = typeof codeRaw === "string" ? codeRaw.trim() : ""
    if (!code) continue
    const classification = classifyCashFlowCode(code)
    if (!classification) continue
    const isBridge = classification.activityType === "bridge"
    // Movement rows remain leaf-only to avoid importing computed subtotals.
    // Bridge rows are canonical statement evidence and can be top-level
    // (CF.04) or source-specific descendants (CF.04.01.01).
    if (!isBridge && !isLeafCfCode(code)) continue
    const activityType = classification.activityType

    const labelRaw = row[1]
    const label = typeof labelRaw === "string" ? labelRaw.trim() : code

    // Default entryType for the LINE from its code segment (used downstream
    // only for the account-type classification, inflow→revenue/outflow→expense).
    // CF.XX.01.XX = inflow segment; CF.XX.02.XX = outflow segment.
    const segMatch = code.match(/^CF\.\d{2}\.(\d{2})\./)
    const segment = segMatch ? segMatch[1] : null
    let entryType: CfEntryType
    if (segment === "01") entryType = "inflow"
    else if (segment === "02") entryType = "outflow"
    else {
      // Fallback: derive from sum of values
      let sum = 0
      for (let m = 0; m < 12; m++) {
        const v = toNumberOrNull(row[monthCols[m]])
        sum += v ?? 0
      }
      entryType = sum >= 0 ? "inflow" : "outflow"
    }

    // 2026-06-02 fix: keep the SIGNED monthly value. A positive month inside
    // an outflow line (or negative inside an inflow line) is a refund /
    // reversal and must net correctly. The previous `Math.abs()` + one
    // entryType-per-line flipped those refunds into same-direction flows,
    // overstating MALT operating CF by 2× the refund (204K) and AZSF by 40K.
    // The handler derives the per-MONTH inflow/outflow direction from this
    // sign (see makeCfHandler).
    const perMonth: Array<number | null> = []
    let hasSourceEvidence = false
    let hasNonZeroMovement = false
    for (let m = 0; m < 12; m++) {
      const v = toNumberOrNull(row[monthCols[m]])
      perMonth.push(v)
      if (v !== null) hasSourceEvidence = true
      if (v !== null && v !== 0) hasNonZeroMovement = true
    }
    // For ordinary movements retain the established sparse behavior: a line
    // with no non-zero movement creates no rows. For bridge evidence, an
    // explicit numeric zero is meaningful and must not collapse into absence.
    if (isBridge ? !hasSourceEvidence : !hasNonZeroMovement) continue

    entries.push({ code, label, activityType, entryType, perMonth })
  }

  // Leaf-most selection is MONTH-SCOPED. A child evidenced in January must
  // suppress its ancestor only in January; a sparse parent value in February
  // remains valid evidence when the child is blank there.
  const selectedBridgeCodesByMonth = Array.from({ length: 12 }, (_, month) =>
    selectLeafMostCashFlowBridgeCodes(
      entries
        .filter(
          (entry) =>
            entry.activityType === "bridge" && entry.perMonth[month] !== null,
        )
        .map((entry) => entry.code),
    ),
  )
  const partiallySuppressedBridgeCodes = new Set<string>()
  const filteredEntries = entries
    .map((entry): ParsedCfLine => {
      if (entry.activityType !== "bridge") return entry
      const perMonth = entry.perMonth.map((value, month) => {
        if (
          value !== null &&
          !selectedBridgeCodesByMonth[month].has(entry.code)
        ) {
          partiallySuppressedBridgeCodes.add(entry.code)
          return null
        }
        return value
      })
      return { ...entry, perMonth }
    })
    .filter(
      (entry) =>
        entry.activityType !== "bridge" ||
        entry.perMonth.some((value) => value !== null),
    )
  for (const code of partiallySuppressedBridgeCodes) {
    warnings.push({
      row: 0,
      reason: `Bridge subtotal ${code} skipped only for periods with more specific descendant evidence`,
    })
  }

  return { sheetName, entries: filteredEntries, warnings }
}

/**
 * Extract the source's OWN EBITDA subtotal row (col-B label contains "EBITDA",
 * excluding margin/% variants) → monthly values for `preferYear`. The PLF
 * leaves lump D&A + interest + tax into one `expense` type, so deriving EBITDA
 * from them collapses it to NET (2026-05-31 audit); capturing the author's own
 * EBITDA subtotal as `pl_ebitda` operational_facts lets the recompute report it
 * correctly. Returns [] when no EBITDA row / year header exists (non-PLF or
 * cross-entity summary sheets).
 */
export function parsePlfEbitdaSubtotal(
  workbook: XLSX.WorkBook,
  sheetName: string,
  xlsx: typeof XLSX,
  opts?: { preferYear?: number },
): { month: number; value: number }[] {
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) return []
  const aoa = xlsx.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    blankrows: false,
  }) as unknown[][]
  const header = findPlfHeaderRow(aoa, { preferYear: opts?.preferYear })
  if (!header) return []
  const { monthCols } = header
  const ebitdaRow = aoa.find((r) => {
    const label = String((r as unknown[])[1] ?? "").toUpperCase()
    return label.includes("EBITDA") && !label.includes("MARGIN") && !label.includes("%")
  })
  if (!ebitdaRow) return []
  const out: { month: number; value: number }[] = []
  for (let m = 0; m < 12; m++) {
    const v = (ebitdaRow as unknown[])[monthCols[m]]
    if (typeof v === "number" && Number.isFinite(v) && Math.abs(v) > 0.005) {
      out.push({ month: m + 1, value: v })
    }
  }
  return out
}

/**
 * Like `parsePlfEbitdaSubtotal`, but extracts the EBITDA subtotal for EVERY year
 * present in the sheet — a single PLF header row carries each year's 12 month
 * columns side by side (Guvven Fin.xlsx spans 2022..2026). Returns one entry per
 * year that has at least one non-trivial EBITDA month, sorted ascending.
 *
 * Why the AI import needs this: the per-sheet import targets ONE `year`, so it
 * only ever captured that year's `pl_ebitda` — a workbook's prior-year EBITDA
 * subtotals were never loaded, and a re-import that target-year-scoped its delete
 * could silently drop a year whose parse came back empty. Capturing all years
 * (each gated per-year by the caller on having data) makes the EBITDA history
 * self-sufficient and re-import-safe.
 */
export function parsePlfEbitdaSubtotalAllYears(
  workbook: XLSX.WorkBook,
  sheetName: string,
  xlsx: typeof XLSX,
): { year: number; monthly: { month: number; value: number }[] }[] {
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) return []
  const aoa = xlsx.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    blankrows: false,
  }) as unknown[][]

  // Detect ALL fully-populated, monotonic year column-blocks from the header
  // band (mirrors findPlfHeaderRow's per-year detection, but keeps EVERY year
  // rather than picking one).
  let yearCols: Map<number, number[]> | null = null
  for (let i = 0; i < Math.min(aoa.length, 20); i++) {
    const row = aoa[i] ?? []
    const byYear = new Map<number, number[]>()
    for (let c = 0; c < row.length; c++) {
      const ym = excelSerialToYearMonth(row[c])
      if (!ym) continue
      let cols = byYear.get(ym.year)
      if (!cols) {
        cols = Array(12).fill(-1)
        byYear.set(ym.year, cols)
      }
      if (cols[ym.month] === -1) cols[ym.month] = c
    }
    const full = new Map<number, number[]>()
    for (const [year, cols] of byYear) {
      if (cols.filter((v) => v !== -1).length !== 12) continue
      let mono = true
      for (let k = 1; k < 12; k++) if (cols[k] <= cols[k - 1]) { mono = false; break }
      if (mono) full.set(year, cols)
    }
    if (full.size > 0) {
      yearCols = full
      break
    }
  }
  if (!yearCols) return []

  const ebitdaRow = aoa.find((r) => {
    const label = String((r as unknown[])[1] ?? "").toUpperCase()
    return label.includes("EBITDA") && !label.includes("MARGIN") && !label.includes("%")
  })
  if (!ebitdaRow) return []

  const out: { year: number; monthly: { month: number; value: number }[] }[] = []
  for (const [year, cols] of [...yearCols.entries()].sort((a, b) => a[0] - b[0])) {
    const monthly: { month: number; value: number }[] = []
    for (let m = 0; m < 12; m++) {
      const v = (ebitdaRow as unknown[])[cols[m]]
      if (typeof v === "number" && Number.isFinite(v) && Math.abs(v) > 0.005) {
        monthly.push({ month: m + 1, value: v })
      }
    }
    if (monthly.length > 0) out.push({ year, monthly })
  }
  return out
}
