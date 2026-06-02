/**
 * İcmal → BUDGET lines mapping (Farming strategy - Guvven.xlsx, İcmal sheet).
 *
 * İcmal is a forward P&L plan (2026–2035, one column per year). For the
 * budgeting module we load a SINGLE year's column as the budget (kind="budget"
 * plan) so execution % = budget ÷ actuals computes. The multi-year revenue
 * outlook is still captured separately as Organization.settings.forwardForecast.
 *
 * Decisions (user 2026-06-02 — see ROADMAP changelog):
 *   • Revenue + COGS distributed by product → child company; sugar beet → AZSF
 *     (AZSF sells only beet), other crops → EDEN, glucose/fructose/starch/lab/
 *     by-product → CPC, beer raw → MALT.
 *   • Overhead (Logistics/S&M/OPEX) + investment subsidy → split pro-rata by
 *     product-revenue across the revenue children (holding-rollup view only
 *     matches LEAF children, so holding-level lines never display).
 *   • Subsidies included as other income (lineType revenue): farming + product
 *     subsidy → EDEN; investment subsidy → pro-rata.
 *   • Annual ÷ 12 → equal monthly amounts. Costs stored as POSITIVE magnitude
 *     to match the actuals-plan convention (so execution % compares like-for-like).
 *   • Operating P&L only (Revenue/COGS/Logistics/S&M/OPEX) + subsidies;
 *     below-EBITDA (depreciation/interest/tax) excluded.
 *
 * This module is the single source of truth for the mapping — both the import
 * pipeline (makeForwardForecastHandler) and any ad-hoc reload use it.
 */

export const ICMAL_HOLDING_SENTINEL = "AZSEKER"

export type IcmalLineType = "revenue" | "cogs" | "expense"

export interface IcmalBudgetLine {
  group: string
  label: string
  lineType: IcmalLineType
  /** Positive magnitude (abs of the signed İcmal value). */
  annual: number
  companyCode: string
  coaCode: string
  isSubsidy?: boolean
  /** true once an overhead/holding line has been pro-rata'd onto a child. */
  allocated?: boolean
}

/** İcmal group (col 1) → operating P&L lineType. */
const GROUP_MAP: Readonly<Record<string, IcmalLineType>> = {
  Revenue: "revenue",
  COGS: "cogs",
  Logistics: "expense",
  "S&M": "expense",
  OPEX: "expense",
}

/** Subsidy groups → other income (lineType revenue), only when includeSubsidies. */
const SUBSIDY_GROUPS: Readonly<Record<string, string>> = {
  "Subsidy - Farming": "AZSEKER-EDEN",
  "Subsidy - Product": "AZSEKER-EDEN",
  "Subsidies - Investment": ICMAL_HOLDING_SENTINEL, // → pro-rata
}

/** Below-EBITDA groups never loaded into the operating budget. */
const BELOW_EBITDA = new Set([
  "Other expenses",
  "Shareholders' expense",
  "Interest income",
  "Interest expense",
  "Depreciation",
  "Profit tax",
])

/** Product label → child company code (revenue + COGS share the same map). */
const PRODUCT_COMPANY: Readonly<Record<string, string>> = {
  Buğda: "AZSEKER-EDEN",
  "Şəkər çuğunduru": "AZSEKER-AZSF", // AZSF sells ONLY beet
  Qarğıdalı: "AZSEKER-EDEN",
  Pambıq: "AZSEKER-EDEN",
  Arpa: "AZSEKER-EDEN",
  "Sair məhsullar": "AZSEKER-EDEN",
  "Torpaq icarəsi": "AZSEKER-EDEN",
  Qlukoza: "AZSEKER-CPC",
  Fruktoza: "AZSEKER-CPC",
  Nişasta: "AZSEKER-CPC",
  "Laboratoriya xidmətləri": "AZSEKER-CPC",
  "Yan məhsul": "AZSEKER-CPC",
  Tekstil: "AZSEKER-CPC",
  "Pivə xammalı": "AZSEKER-MALT",
}

export function icmalSlug(s: string): string {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40)
}

function coaCodeFor(group: string, label: string, isSubsidy: boolean): string {
  if (isSubsidy) return `ICMAL.SUBSIDY.${icmalSlug(label)}`
  return `ICMAL.${group.toUpperCase().replace(/[^A-Z0-9]+/g, "")}.${icmalSlug(label)}`
}

/**
 * Locate the column holding `year`'s values in the İcmal AOA. İcmal's header
 * row lists the years (2026, 2027, …); the value for a given year sits in that
 * same column on the line rows. Returns -1 if not found.
 */
export function findIcmalYearColumn(aoa: unknown[][], year: number): number {
  for (const row of aoa) {
    if (!Array.isArray(row)) continue
    // a real header row has `year` AND `year+1` as numbers
    const hasYear = row.findIndex((c) => c === year)
    if (hasYear >= 0 && row.some((c) => c === year + 1)) return hasYear
  }
  // fallback: any row containing `year` as a numeric cell
  for (const row of aoa) {
    if (!Array.isArray(row)) continue
    const i = row.findIndex((c) => c === year)
    if (i >= 0) return i
  }
  return -1
}

/**
 * Locate the "Group" column (Revenue / COGS / Logistics / S&M / OPEX / Subsidy
 * / below-EBITDA labels). Robust to the sheet origin: `sheet_to_json` returns
 * RANGE-relative columns, so on İcmal (range B2:R109) the Group column lands at
 * index 0, not 1. The label column is Group+1. Returns the column with the most
 * group-token hits, or -1.
 */
const ICMAL_GROUP_TOKENS: ReadonlySet<string> = new Set([
  ...Object.keys(GROUP_MAP),
  ...Object.keys(SUBSIDY_GROUPS),
  ...BELOW_EBITDA,
])
export function findIcmalGroupColumn(aoa: unknown[][]): number {
  const counts = new Map<number, number>()
  for (const row of aoa) {
    if (!Array.isArray(row)) continue
    for (let c = 0; c < row.length; c++) {
      const v = row[c]
      if (typeof v === "string" && ICMAL_GROUP_TOKENS.has(v.trim())) {
        counts.set(c, (counts.get(c) ?? 0) + 1)
      }
    }
  }
  let best = -1
  let bestN = 0
  for (const [c, n] of counts) if (n > bestN) { bestN = n; best = c }
  return best
}

export interface ParseIcmalBudgetResult {
  lines: IcmalBudgetLine[]
  excluded: { group: string; label: string; amount: number }[]
  yearColumn: number
  groupColumn: number
}

/**
 * Parse İcmal's per-line P&L for `year` into operating budget lines.
 * Line items = rows whose col-1 "Group" is a known operating/subsidy group;
 * blank-group rows (computed subtotals: Satış gəliri, Maya dəyəri, EBİTDA, …)
 * and below-EBITDA groups are skipped.
 */
export function parseIcmalBudgetLines(
  aoa: unknown[][],
  year: number,
  opts: { includeSubsidies?: boolean } = {},
): ParseIcmalBudgetResult {
  const includeSubsidies = opts.includeSubsidies ?? true
  const yearCol = findIcmalYearColumn(aoa, year)
  const groupCol = findIcmalGroupColumn(aoa)
  const lines: IcmalBudgetLine[] = []
  const excluded: { group: string; label: string; amount: number }[] = []
  if (yearCol < 0 || groupCol < 0) return { lines, excluded, yearColumn: yearCol, groupColumn: groupCol }

  // İcmal layout: Group column (detected), label = Group+1, value = [yearCol].
  const GROUP_COL = groupCol
  const LABEL_COL = groupCol + 1
  for (const row of aoa) {
    if (!Array.isArray(row)) continue
    const g = typeof row[GROUP_COL] === "string" ? (row[GROUP_COL] as string).trim() : ""
    const l = typeof row[LABEL_COL] === "string" ? (row[LABEL_COL] as string).trim() : ""
    const v = row[yearCol]
    if (!g || g === "Group") continue // blank group = subtotal; "Group" = header/total row
    if (typeof v !== "number" || v === 0) continue
    if (GROUP_MAP[g]) {
      lines.push({
        group: g,
        label: l,
        lineType: GROUP_MAP[g],
        annual: Math.abs(v),
        companyCode: PRODUCT_COMPANY[l] ?? ICMAL_HOLDING_SENTINEL,
        coaCode: coaCodeFor(g, l, false),
      })
    } else if (SUBSIDY_GROUPS[g] && includeSubsidies) {
      lines.push({
        group: g,
        label: l,
        lineType: "revenue", // other income
        annual: Math.abs(v),
        companyCode: SUBSIDY_GROUPS[g],
        coaCode: coaCodeFor(g, l, true),
        isSubsidy: true,
      })
    } else {
      excluded.push({ group: g, label: l, amount: v })
    }
  }
  // Sanity gate: a real İcmal P&L spans several operating groups (Revenue,
  // COGS, Logistics, S&M, OPEX). If fewer than 2 distinct GROUP_MAP groups
  // matched, this isn't an İcmal budget sheet — e.g. a generic INFO_SUMMARY
  // summary that merely contains a year cell + one group-like word. Emit
  // nothing rather than phantom budget lines (which a re-import would then
  // write into the kind="budget" plan).
  const distinctGroups = new Set(lines.filter((l) => !l.isSubsidy).map((l) => l.group))
  if (distinctGroups.size < 2) {
    return { lines: [], excluded, yearColumn: yearCol, groupColumn: groupCol }
  }
  return { lines, excluded, yearColumn: yearCol, groupColumn: groupCol }
}

/**
 * Pro-rata any HOLDING-assigned line (overhead, investment subsidy) across the
 * revenue children by their product-revenue share. Revenue/COGS lines already
 * carry a child company and pass through unchanged.
 */
export function allocateIcmalBudget(lines: IcmalBudgetLine[]): IcmalBudgetLine[] {
  const revByChild = new Map<string, number>()
  let totalRev = 0
  for (const l of lines) {
    if (l.lineType === "revenue" && l.companyCode !== ICMAL_HOLDING_SENTINEL && !l.isSubsidy) {
      revByChild.set(l.companyCode, (revByChild.get(l.companyCode) ?? 0) + l.annual)
      totalRev += l.annual
    }
  }
  const children = [...revByChild.keys()]
  const out: IcmalBudgetLine[] = []
  for (const l of lines) {
    if (l.companyCode !== ICMAL_HOLDING_SENTINEL || children.length === 0 || totalRev === 0) {
      out.push(l)
      continue
    }
    let acc = 0
    children.forEach((child, i) => {
      const amt =
        i === children.length - 1
          ? Math.round((l.annual - acc) * 100) / 100
          : Math.round(l.annual * ((revByChild.get(child) ?? 0) / totalRev) * 100) / 100
      acc += amt
      out.push({ ...l, companyCode: child, annual: amt, allocated: true })
    })
  }
  return out
}

export interface IcmalBudgetTotals {
  revenue: number
  cogs: number
  expense: number
}

export function icmalBudgetTotals(lines: IcmalBudgetLine[]): IcmalBudgetTotals {
  const t: IcmalBudgetTotals = { revenue: 0, cogs: 0, expense: 0 }
  for (const l of lines) t[l.lineType] += l.annual
  return t
}

export interface IcmalMonthlyRow {
  companyCode: string
  coaCode: string
  name: string
  lineType: IcmalLineType
  monthIndex: number // 0-11
  plannedAmount: number
}

/**
 * Expand allocated annual lines into 12 equal monthly rows (month 11 absorbs
 * the rounding remainder so Σ months = annual exactly).
 */
export function buildIcmalMonthlyRows(lines: IcmalBudgetLine[]): IcmalMonthlyRow[] {
  const rows: IcmalMonthlyRow[] = []
  for (const l of lines) {
    const monthly = Math.round((l.annual / 12) * 100) / 100
    for (let m = 0; m < 12; m++) {
      const amt = m === 11 ? Math.round((l.annual - monthly * 11) * 100) / 100 : monthly
      rows.push({
        companyCode: l.companyCode,
        coaCode: l.coaCode,
        name: l.label,
        lineType: l.lineType,
        monthIndex: m,
        plannedAmount: amt,
      })
    }
  }
  return rows
}
