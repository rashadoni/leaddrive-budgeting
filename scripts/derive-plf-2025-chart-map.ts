/**
 * Re-derive `src/lib/onboarding/adapters/plf-2025-chart-map.generated.ts`
 * from the client workbook.
 *
 * The checked-in table is DATA. This is the RULE that produced it, run end to
 * end, so nobody has to take the table's word for itself:
 *
 *   npx tsx scripts/derive-plf-2025-chart-map.ts /path/actual-budget-v1.xlsx
 *
 * writes the file, prints the census, and exits non-zero on any ambiguity or
 * invariant violation. `--check` compares against the checked-in file instead
 * of writing it — which is exactly what `plf-2025-chart-rederive.test.ts` does
 * when the workbook is present.
 *
 * The workbook is client data and is not in the repository.
 */

import * as fs from "node:fs"
import * as path from "node:path"
import * as XLSX from "xlsx"
import { buildLeafPredicate } from "../src/lib/onboarding/adapters/plf-leaf-codes"
import {
  checkLegacyChartMap,
  deriveLegacyChartMap,
  legacyEntryKey,
  type LegacyChartEntry,
  type LegacyChartRow,
} from "../src/lib/onboarding/adapters/plf-legacy-chart"

/** The calendar year of the chart being translated. */
export const CHART_YEAR = 2025

export const LEGACY_SHEET = "PLF Actual 2025"
export const CURRENT_SHEETS = ["PLF Budget 2026", "PLF Actual 2026"] as const

const OUT = path.join(
  __dirname,
  "..",
  "src",
  "lib",
  "onboarding",
  "adapters",
  "plf-2025-chart-map.generated.ts",
)

/** First 12 numeric columns of a PLF sheet — the month band. */
const MONTH_COLS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]

export interface SheetChart {
  rows: LegacyChartRow[]
  /**
   * `legacyEntryKey(code, label)` → summed 12-month value across every BU
   * block. Keyed by the PAIR, not the code: `PLF.07.02.04` carries three
   * different subsidies on the 2025 sheet.
   */
  amounts: Map<string, number>
}

/**
 * Read one PLF sheet into a chart. Leafness comes from `buildLeafPredicate`
 * over the whole sheet — the same call the importer makes.
 */
export function readSheetChart(
  workbook: XLSX.WorkBook,
  sheetName: string,
): SheetChart {
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) throw new Error(`sheet "${sheetName}" not found`)
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
  }) as unknown[][]

  const codes: string[] = []
  const pairs: Array<{ code: string; label: string }> = []
  const amounts = new Map<string, number>()
  for (const row of aoa) {
    const raw = row?.[0]
    if (typeof raw !== "string" || !raw.trim()) continue
    const code = raw.trim()
    const label = String(row[1] ?? "").trim()
    codes.push(code)
    pairs.push({ code, label })
    let sum = 0
    for (const c of MONTH_COLS) {
      const v = row[c]
      if (typeof v === "number" && Number.isFinite(v)) sum += v
    }
    const key = legacyEntryKey(code, label)
    amounts.set(key, (amounts.get(key) ?? 0) + sum)
  }

  // Leafness needs the whole sheet; the row list keeps every distinct
  // (code, label) pair, in sheet order — that order decides which meaning
  // keeps a contended code.
  const isLeaf = buildLeafPredicate(codes)
  const seen = new Set<string>()
  const rows: LegacyChartRow[] = []
  for (const p of pairs) {
    const key = legacyEntryKey(p.code, p.label)
    if (seen.has(key)) continue
    seen.add(key)
    rows.push({ code: p.code, label: p.label, isLeaf: isLeaf(p.code) })
  }
  return { rows, amounts }
}

/**
 * The current chart is the union of the two 2026 sheets: the budget sheet
 * carries the full catalogue, the actuals sheet carries codes the budget never
 * planned. A code is a current leaf when EITHER sheet reads it as one.
 */
export function mergeCurrentCharts(charts: readonly SheetChart[]): LegacyChartRow[] {
  const byCode = new Map<string, LegacyChartRow>()
  for (const chart of charts) {
    for (const row of chart.rows) {
      const prior = byCode.get(row.code)
      if (!prior) {
        byCode.set(row.code, { ...row })
        continue
      }
      if (!prior.label && row.label) prior.label = row.label
      prior.isLeaf = prior.isLeaf || row.isLeaf
    }
  }
  return [...byCode.values()]
}

export function renderGeneratedFile(entries: readonly LegacyChartEntry[]): string {
  const body = entries
    .map((e) => {
      const parts = [
        `code: ${JSON.stringify(e.code)}`,
        `label: ${JSON.stringify(e.label)}`,
        `kind: ${JSON.stringify(e.kind)}`,
        `storedCode: ${JSON.stringify(e.storedCode)}`,
      ]
      if (e.via) parts.push(`via: ${JSON.stringify(e.via)}`)
      // The reason travels INTO the table. A correction whose justification
      // lives only in a commit message is a magic line six months from now.
      if (e.overrideReason)
        parts.push(`overrideReason: ${JSON.stringify(e.overrideReason)}`)
      if (e.mintedBecause)
        parts.push(`mintedBecause: ${JSON.stringify(e.mintedBecause)}`)
      if (e.duplicateOfCurrentCodes)
        parts.push(
          `duplicateOfCurrentCodes: ${JSON.stringify(e.duplicateOfCurrentCodes)}`,
        )
      return `  { ${parts.join(", ")} },`
    })
    .join("\n")

  return `/**
 * GENERATED — do not edit by hand.
 *
 *   npx tsx scripts/derive-plf-2025-chart-map.ts <actual-budget-v1.xlsx>
 *
 * The rule that produced every line lives in \`plf-legacy-chart.ts\`
 * (\`deriveLegacyChartMap\`): match the normalised LABEL among codes the leaf
 * rule accepts on both sides, and where two candidates exist keep the 2025
 * code's own section. \`plf-2025-chart-rederive.test.ts\` re-runs the script
 * against the workbook and fails if this file is not what comes out.
 *
 * Source: \`PLF Actual 2025\` (legacy) against \`PLF Budget 2026\` +
 * \`PLF Actual 2026\` (current), from \`actual-budget-v1.xlsx\`.
 */

import { legacyEntryKey, type LegacyChartEntry } from "./plf-legacy-chart"

/** The calendar year whose chart of accounts these entries describe. */
export const PLF_LEGACY_CHART_YEAR = ${CHART_YEAR}

export const PLF_2025_CHART_ENTRIES: readonly LegacyChartEntry[] = [
${body}
]

/**
 * Indexed for the importer's per-row lookup. The key is the (code, LABEL)
 * pair — \`PLF.07.02.04\` carries three different subsidies on the 2025 sheet.
 */
export const PLF_2025_CHART_BY_KEY: ReadonlyMap<string, LegacyChartEntry> =
  new Map(PLF_2025_CHART_ENTRIES.map((e) => [legacyEntryKey(e.code, e.label), e]))
`
}

export interface DerivationRun {
  entries: LegacyChartEntry[]
  rendered: string
  census: Record<string, number>
  moneyCensus: Record<string, number>
  ambiguous: { code: string; label: string; candidates: string[] }[]
  violations: { kind: string; code: string; detail: string }[]
  unmatchedOverrides: { code: string; label: string; reason: string }[]
}

/**
 * Merges already seen by a person, keyed by the code they land on.
 *
 * A merge means two of the client's 2025 accounts post to one 2026 account, so
 * the split between them stops existing. Being on this list records only that
 * someone has LOOKED — never that the merge is right. Two of these are known
 * to be wrong and are waiting on the client:
 *
 * Two entries that were on this list are FIXED rather than pending, by the
 * hand corrections in `LEGACY_CHART_OVERRIDES` — the owner approved them on
 * 2026-08-19: farming's other-products cost returns to `PLF.02.01.99`, and the
 * mislabelled elimination row returns to `PLF.01.01.99`. Group totals do not
 * move; only the attribution does.
 *
 *   PLF.04.05.02  "Consulting Fees & Due Diligence"  −6,171 + −6,365
 *                 Collapses the client's Sales-&-Marketing / Head-Office
 *                 split. Small, but the split is deliberate.
 *   PLF.05.13.01  "Revaluation of Fixed & Intangible Assets"   both zero
 *   PLF.05.13.02  "Revaluation of Inventory"                   both zero
 *
 * A merge NOT on this list fails the run, because the way this was missed the
 * first time was that nothing said anything at all.
 */
const MERGES_PENDING_DECISION = new Set([
  "PLF.04.05.02",
  "PLF.05.13.01",
  "PLF.05.13.02",
])

/** The whole derivation, workbook path in, everything the test needs out. */
export function deriveFromWorkbook(workbookPath: string): DerivationRun {
  const wb = XLSX.readFile(workbookPath)
  const legacy = readSheetChart(wb, LEGACY_SHEET)
  const currentCharts = CURRENT_SHEETS.map((s) => readSheetChart(wb, s))
  const current = mergeCurrentCharts(currentCharts)

  const map = deriveLegacyChartMap(legacy.rows, current, CHART_YEAR)
  const violations = checkLegacyChartMap(map, current)
  const unmatchedOverrides = map.unmatchedOverrides ?? []

  const census: Record<string, number> = {
    identical: 0,
    renumbered: 0,
    own_account: 0,
  }
  const moneyCensus: Record<string, number> = {
    identical: 0,
    renumbered: 0,
    own_account: 0,
  }
  for (const e of map.entries) {
    census[e.kind] += 1
    const amount = legacy.amounts.get(legacyEntryKey(e.code, e.label)) ?? 0
    if (Math.abs(amount) >= 1) moneyCensus[e.kind] += 1
  }

  return {
    entries: map.entries,
    rendered: renderGeneratedFile(map.entries),
    census,
    moneyCensus,
    ambiguous: map.ambiguous,
    violations,
    unmatchedOverrides,
  }
}

function main(): void {
  const args = process.argv.slice(2)
  const check = args.includes("--check")
  const workbookPath = args.find((a) => !a.startsWith("--"))
  if (!workbookPath) {
    console.error(
      "usage: npx tsx scripts/derive-plf-2025-chart-map.ts <workbook.xlsx> [--check]",
    )
    process.exit(2)
  }

  const run = deriveFromWorkbook(workbookPath)
  console.log("legacy leaves mapped :", run.entries.length)
  console.log("  identical          :", run.census.identical)
  console.log("  renumbered         :", run.census.renumbered)
  console.log("  own_account        :", run.census.own_account)
  console.log("carrying money (>=1) :", JSON.stringify(run.moneyCensus))
  console.log("ambiguous            :", run.ambiguous.length)
  for (const a of run.ambiguous) {
    console.log(`   ${a.code}  "${a.label}"  ->  ${a.candidates.join(", ")}`)
  }
  console.log("invariant violations :", run.violations.length)
  for (const v of run.violations) console.log(`   [${v.kind}] ${v.detail}`)

  if (check) {
    const existing = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : ""
    if (existing !== run.rendered) {
      console.error(`\n${OUT} is STALE — re-run without --check`)
      process.exit(1)
    }
    console.log(`\n${path.basename(OUT)} matches the workbook`)
  } else {
    fs.writeFileSync(OUT, run.rendered)
    console.log(`\nwrote ${OUT}`)
  }

  if (run.unmatchedOverrides.length > 0) {
    console.error("\nA hand correction matched no row on the sheet:")
    for (const o of run.unmatchedOverrides) {
      console.error(`   ${o.code} "${o.label}" — ${o.reason}`)
    }
    console.error(
      "\nThe workbook moved under it, or the override is mistyped. Fix or remove it;" +
        " a correction that silently stops applying is how the mapping it fixes came back.",
    )
  }

  const unknownMerges = run.violations.filter(
    (v) => v.kind === "merge" && !MERGES_PENDING_DECISION.has(v.code),
  )
  if (unknownMerges.length > 0) {
    console.error("\nNEW merge — two 2025 accounts would become one, and nobody has decided that:")
    for (const v of unknownMerges) console.error(`   ${v.detail}`)
    console.error(
      "\nAdd it to MERGES_PENDING_DECISION with a note, or change the mapping so the two stay apart.",
    )
  }

  // A `duplicate` violation is a statement about the client's chart, not a bug
  // in the derivation: it is reported, warned on at import, and does not block.
  // A `merge` blocks unless it is already on the list above — the list records
  // that a human has SEEN it, never that it is correct.
  if (
    run.ambiguous.length > 0 ||
    run.violations.some((v) => v.kind !== "duplicate" && v.kind !== "merge") ||
    unknownMerges.length > 0 ||
    run.unmatchedOverrides.length > 0
  ) {
    process.exit(1)
  }
}

if (require.main === module) main()
