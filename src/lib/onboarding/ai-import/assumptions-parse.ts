/**
 * Phase 16.5 (2026-08-06) — parse a budget-assumptions sheet.
 *
 * Finance teams already keep their drivers on a tab of their own workbook —
 * FX rates, inflation, tariffs, yields, imported-input share. Until now the
 * classifier had nowhere to put such a sheet, so the Fərziyyələr tab could
 * only ever be filled by hand, one row at a time, for ~60 companies. That does
 * not happen, which is why the tab has been empty since the model was created.
 *
 * Pure: no DB, no LLM. Takes a workbook, returns rows.
 *
 * ── Shape ────────────────────────────────────────────────────────────────
 * A label/value table. Columns are located by LABEL, never by position, for
 * the reason `audit-findings-parse.ts` records: positional parsing is silent
 * when it is wrong, and one inserted column moves every driver one field
 * sideways while the import still reports success.
 *
 * Required: a label column and a value column. Optional: key, unit, period,
 * category, company, notes.
 *
 * A row with a label and NO value is treated as a category section header and
 * carries forward to the rows beneath it — the common workbook idiom
 * ("FX rates" / "Inflation" as banded headings over their parameters).
 *
 * ── What it deliberately does NOT do ─────────────────────────────────────
 * It does not rescale percentages. A cell holding `6` under a `%` unit may
 * mean 6% or, if the author typed a already-decimal rate, 600%. Guessing is
 * a 100× error in a scenario, so the value is stored exactly as the cell
 * holds it and the ambiguous ones are REPORTED for a human to confirm.
 */
import type * as XLSXType from "xlsx"
import type { CompanyMatcher } from "./soft-entity-match"

export interface ParsedAssumption {
  /** Stable lookup identifier — from a `key` column, a canonical match, or the slugified label. */
  key: string
  label: string
  value: number
  unit: string | null
  period: string | null
  category: string
  notes: string | null
  /** Resolved company code for an override row; null = plan-level default. */
  companyCode: string | null
  /** How `key` was arrived at — surfaced so a reader can tell a real key from a guess. */
  keySource: "column" | "canonical" | "derived"
}

export interface AssumptionsParseResult {
  rows: ParsedAssumption[]
  warnings: string[]
}

/**
 * Canonical keys for the drivers something in the product actually looks up.
 *
 * This exists because a derived key is useless to a consumer: slugifying
 * «Доля импортных затрат» yields `доля_импортных_затрат`, which is a perfectly
 * stable identifier and matches nothing. The scenario engine asks for
 * `import_share`. Recognising the well-known drivers by keyword is what makes
 * an imported sheet reach a formula rather than merely render on a tab.
 *
 * Keyword lists are lower-cased substrings, matched against the label in
 * EN / RU / AZ. Conservative on purpose — a label matching two families is
 * left to the derived slug rather than attributed to whichever came first.
 */
const CANONICAL_KEYS: Array<{ key: string; category: string; hints: string[] }> = [
  {
    key: "import_share",
    category: "fx",
    hints: ["import share", "imported input", "imported share", "доля импорт", "импортн", "idxal pay", "idxal xərc"],
  },
  { key: "inflation", category: "inflation", hints: ["inflation", "инфляц", "inflyasiya"] },
  { key: "fx_usd", category: "fx", hints: ["usd", "доллар", "dollar"] },
  { key: "fx_eur", category: "fx", hints: ["eur", "евро", "avro"] },
  { key: "fx_try", category: "fx", hints: ["try", "лир", "lirə", "turkish lira"] },
  { key: "fx_rub", category: "fx", hints: ["rub", "рубл", "rubl"] },
  { key: "tax_rate", category: "tax", hints: ["tax rate", "profit tax", "налог на прибыль", "ставка налог", "vergi dərəc", "mənfəət vergi"] },
  { key: "vat_rate", category: "tax", hints: ["vat", "ндс", "ədv"] },
  { key: "discount_rate", category: "finance", hints: ["discount rate", "wacc", "ставка дисконт", "diskont"] },
  { key: "interest_rate", category: "finance", hints: ["interest rate", "процентная ставка", "faiz dərəc"] },
  { key: "wage_growth", category: "hr", hints: ["wage growth", "salary growth", "рост зарплат", "əmək haqqı artım"] },
  { key: "price_growth", category: "pricing", hints: ["price growth", "price increase", "рост цен", "qiymət artım"] },
  { key: "yield_per_ha", category: "operations", hints: ["yield per ha", "урожайност", "məhsuldarlıq"] },
  { key: "capacity_utilization", category: "operations", hints: ["capacity utilization", "utilisation", "загрузка мощност", "güc istifadə"] },
]

/**
 * Column label hints, EN / RU / AZ. No legacy positional fallback — see below.
 *
 * ── Provenance of the Azerbaijani terms ──────────────────────────────────
 * `maddə`, `miqdar` and `mərkəz` are NOT translations chosen here; they are
 * the words this tenant's real workbooks use, read off the header literals the
 * shipped adapters match against (`'MADDƏ'` and `'GƏLİR/XƏRC MADDƏLƏRİ'` as the
 * line-item column in `azseker-plf`, `'Məhsul miqdarı (ton)'` and
 * `'Miqdar/Məbləğ'` as quantity columns, `'Mərkəz'` as the cost centre).
 * The first draft of this list was invented from the dictionary and missed all
 * three, which is exactly the failure mode 16.5a exists to name: a vocabulary
 * that looks complete because nobody compared it to a real file.
 *
 * That comparison is still partial — no client ASSUMPTIONS tab has been seen,
 * only their P&L / KPI / CAPEX sheets — so 16.5a stays open. What changed is
 * that the terms below are now evidence where they used to be guesses.
 */
const COLUMN_HINTS: Record<string, string[]> = {
  key: ["key", "ключ", "açar", "code", "код", "kod"],
  label: [
    "parameter", "assumption", "driver", "name", "indicator", "item", "article",
    "показател", "параметр", "допущен", "наименован", "название", "статья",
    "gösterici", "göstərici", "ad", "fərziyyə", "maddə",
  ],
  value: [
    "value", "amount", "rate", "norm", "quantity",
    "значение", "сумма", "ставка", "норма", "количеств",
    "dəyər", "məbləğ", "miqdar", "dərəcə",
  ],
  unit: ["unit", "uom", "единиц", "изм", "vahid", "ölçü"],
  period: ["period", "frequency", "период", "частот", "dövr", "tezlik"],
  category: ["category", "group", "section", "категор", "групп", "раздел", "kateqoriya", "qrup", "bölmə"],
  company: ["company", "entity", "компан", "предприят", "юрлиц", "şirkət", "müəssisə", "mərkəz"],
  notes: ["note", "comment", "source", "basis", "примечан", "коммент", "источник", "обоснован", "qeyd", "şərh", "mənbə", "əsas"],
}

/** Period vocabulary → the closed set `assumption-input.ts` accepts. */
const PERIOD_ALIASES: Array<{ period: string; hints: string[] }> = [
  { period: "monthly", hints: ["month", "месяч", "ежемесяч", "aylıq"] },
  { period: "quarterly", hints: ["quarter", "квартал", "rüblük"] },
  { period: "annual", hints: ["annual", "year", "год", "ежегод", "illik"] },
  { period: "per_unit", hints: ["per unit", "unit", "на единиц", "vahidə"] },
]

function cell(row: unknown[] | undefined, idx: number | undefined): string {
  if (!row || idx === undefined || idx < 0) return ""
  return String(row[idx] ?? "").trim()
}

/**
 * Parse a numeric cell. Accepts what a spreadsheet actually produces: a real
 * number, a string with spaces or non-breaking spaces as thousand separators,
 * a comma decimal mark, a trailing `%`, or a parenthesised negative.
 *
 * Returns `null` — not 0 — for anything it cannot read. A zero here would be a
 * meaningful driver value (0% imported share is a real statement about a
 * domestic business), so an unparseable cell must never become one.
 */
export function parseAssumptionNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null
  if (typeof raw !== "string") return null
  let s = raw.trim()
  if (!s) return null
  const negated = /^\(.*\)$/.test(s)
  if (negated) s = s.slice(1, -1)
  s = s.replace(/%/g, "").replace(/[\s  ']/g, "")
  // A comma is a decimal mark only when no dot is present; "1,234.5" is a
  // thousand-separated number and its comma must be dropped, not promoted.
  if (s.includes(",") && !s.includes(".")) s = s.replace(/,/g, ".")
  else s = s.replace(/,/g, "")
  if (!/^-?\d*\.?\d+$/.test(s)) return null
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return negated ? -n : n
}

/** Lower-case, collapse every non-alphanumeric run to `_`. Unicode-preserving. */
export function slugifyAssumptionKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80)
}

/** First canonical driver whose hints match, or null when none or several do. */
export function canonicalAssumptionKey(label: string): { key: string; category: string } | null {
  const n = label.toLowerCase()
  const hits = CANONICAL_KEYS.filter((c) => c.hints.some((h) => n.includes(h)))
  return hits.length === 1 ? { key: hits[0].key, category: hits[0].category } : null
}

function normalizePeriod(raw: string): string | null {
  if (!raw) return null
  const n = raw.toLowerCase()
  const hit = PERIOD_ALIASES.find((p) => p.hints.some((h) => n.includes(h)))
  return hit ? hit.period : null
}

/**
 * Locate the header row and its columns.
 *
 * Unlike the audit register there is NO legacy positional fallback: this
 * dataType has never shipped, so no workbook depends on fixed offsets, and
 * inventing a fallback would mean guessing which column holds the numbers
 * that drive a scenario. A sheet whose header cannot be found is reported
 * and parsed as nothing.
 */
function locateColumns(aoa: unknown[][]): {
  headerRow: number
  index: Record<string, number>
  warnings: string[]
} {
  let headerRow = -1
  let best = 1
  for (let r = 0; r < Math.min(15, aoa.length); r++) {
    const cells = (aoa[r] ?? []).map((c) => String(c ?? "").toLowerCase().trim())
    let hits = 0
    for (const hints of Object.values(COLUMN_HINTS)) {
      if (cells.some((c) => c && hints.some((h) => c.includes(h)))) hits++
    }
    if (hits > best) {
      best = hits
      headerRow = r
    }
  }
  if (headerRow === -1) {
    return {
      headerRow: -1,
      index: {},
      warnings: [
        "assumptions: no header row recognised in the first 15 rows — the sheet needs at " +
          "least a parameter/name column and a value column. Nothing imported.",
      ],
    }
  }
  const cells = (aoa[headerRow] ?? []).map((c) => String(c ?? "").toLowerCase().trim())
  const index: Record<string, number> = {}
  for (const [field, hints] of Object.entries(COLUMN_HINTS)) {
    const found = cells.findIndex((c) => c && hints.some((h) => c.includes(h)))
    if (found >= 0) index[field] = found
  }
  return { headerRow, index, warnings: [] }
}

export function parseAssumptions(
  workbook: XLSXType.WorkBook,
  sheetName: string,
  XLSX: typeof XLSXType,
  /** Resolves a company cell against THIS org's companies. Absent → company column ignored. */
  matcher?: CompanyMatcher,
): AssumptionsParseResult {
  const ws = workbook.Sheets[sheetName]
  if (!ws) return { rows: [], warnings: [`Sheet "${sheetName}" not found`] }
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" }) as unknown[][]

  const located = locateColumns(aoa)
  const warnings = [...located.warnings]
  if (located.headerRow === -1) return { rows: [], warnings }

  const col = located.index
  if (col.label === undefined || col.value === undefined) {
    warnings.push(
      `assumptions: header row found but ${col.label === undefined ? "no parameter/name" : "no value"} ` +
        "column — nothing imported. Rename the column or add one.",
    )
    return { rows: [], warnings }
  }

  const rows: ParsedAssumption[] = []
  const seen = new Map<string, number>()
  const unresolvedCompanies = new Set<string>()
  const ambiguousCompanies = new Set<string>()
  const percentScaleSuspects: string[] = []
  let derivedKeyCount = 0
  let currentCategory = "other"

  for (let r = located.headerRow + 1; r < aoa.length; r++) {
    const row = aoa[r]
    if (!row || !row.some((c) => c !== "" && c != null)) continue

    const label = cell(row, col.label)
    if (!label) continue

    const rawValue = col.value !== undefined ? row[col.value] : undefined
    const value = parseAssumptionNumber(rawValue)

    // A label with no readable value is a section heading — the banded
    // "FX rates" / "Inflation" row that groups the parameters under it.
    if (value === null) {
      const looksLikeHeading = row.every(
        (c, i) => i === col.label || c === "" || c == null,
      )
      if (looksLikeHeading) {
        currentCategory = label
        continue
      }
      warnings.push(`assumptions: row ${r + 1} ("${label}") has no readable number — skipped.`)
      continue
    }

    const canonical = canonicalAssumptionKey(label)
    const keyFromColumn = cell(row, col.key)
    let key: string
    let keySource: ParsedAssumption["keySource"]
    if (keyFromColumn) {
      key = keyFromColumn
      keySource = "column"
    } else if (canonical) {
      key = canonical.key
      keySource = "canonical"
    } else {
      key = slugifyAssumptionKey(label)
      keySource = "derived"
      derivedKeyCount++
    }
    if (!key) continue

    // Company attribution. An unresolvable name is SKIPPED, never demoted to a
    // plan-level default: promoting one company's imported-input share to the
    // holding's default would apply it to every other company silently, which
    // is the exact failure the two-tier model exists to end.
    let companyCode: string | null = null
    const companyRaw = cell(row, col.company)
    if (companyRaw && matcher) {
      const { codes, ambiguous } = matcher(companyRaw)
      if (ambiguous || codes.length > 1) {
        ambiguousCompanies.add(companyRaw)
        continue
      }
      if (codes.length === 0) {
        unresolvedCompanies.add(companyRaw)
        continue
      }
      companyCode = codes[0]
    }

    const unit = cell(row, col.unit) || null
    const explicitCategory = cell(row, col.category)
    const category = explicitCategory || canonical?.category || currentCategory || "other"

    // Percent scale is genuinely ambiguous in a spreadsheet: a `%` unit over
    // the number 6 may be six percent or six hundred. Reported, never guessed —
    // a silent 100× is the worst thing this parser could do to a scenario.
    if (unit && unit.includes("%") && Math.abs(value) > 1) percentScaleSuspects.push(label)

    const dupKey = `${key}::${companyCode ?? ""}`
    seen.set(dupKey, (seen.get(dupKey) ?? 0) + 1)

    rows.push({
      key,
      label,
      value,
      unit,
      period: normalizePeriod(cell(row, col.period)),
      category,
      notes: cell(row, col.notes) || null,
      companyCode,
      keySource,
    })
  }

  for (const name of unresolvedCompanies) {
    warnings.push(`assumptions: company "${name}" is not in this organization — its rows were skipped.`)
  }
  for (const name of ambiguousCompanies) {
    warnings.push(`assumptions: company "${name}" matches more than one company — its rows were skipped.`)
  }
  const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k.split("::")[0])
  if (dupes.length > 0) {
    warnings.push(
      `assumptions: duplicate key(s) on this sheet — ${[...new Set(dupes)].join(", ")}. ` +
        "The last row of each wins; the tab will show them as ambiguous.",
    )
  }
  if (percentScaleSuspects.length > 0) {
    warnings.push(
      `assumptions: verify the scale of ${percentScaleSuspects.length} percent value(s) ` +
        `(${[...new Set(percentScaleSuspects)].slice(0, 5).join(", ")}${percentScaleSuspects.length > 5 ? ", …" : ""}) — ` +
        "a value above 1 under a % unit may be 6 meaning 6%, or 6 meaning 600%. Imported as written.",
    )
  }
  if (derivedKeyCount > 0) {
    warnings.push(
      `assumptions: ${derivedKeyCount} row(s) had no key column and no recognised driver, so the key ` +
        "was derived from the label. Those rows show on the tab but no formula or scenario looks them up.",
    )
  }
  if (rows.length === 0) warnings.push(`No assumptions parsed from "${sheetName}".`)
  return { rows, warnings }
}
