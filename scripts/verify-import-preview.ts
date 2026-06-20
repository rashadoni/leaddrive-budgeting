/**
 * verify-import-preview — dry-run a multi-company P&L import WITHOUT touching
 * the DB or the LLM. Mirrors the wizard's generic path (split by entity →
 * parse per entity → control-total + validation per entity) so you can confirm
 * a NEW client file imports cleanly BEFORE running the real import in the app.
 *
 *   npx tsx scripts/verify-import-preview.ts <file.xlsx> <sheet> [--year 2026] [--bu BU]
 *
 * Builds a DETERMINISTIC structural proposal (no LLM): col 0 = code, the first
 * string column after it = label, columns with a month-name OR Excel
 * date-serial header = months (year parsed off the serial), and the `--bu`
 * column = entity. For arbitrary non-P&L shapes the real wizard (LLM mapper) is
 * the path; this verifies the common code+label+months+BU case end-to-end.
 *
 * Exit 0 when every real entity is parseable + not validation-blocked; 1 otherwise.
 */
import * as XLSX from "xlsx"
import fs from "fs"
import { applyProposalByEntity } from "../src/lib/onboarding/ai-mapper/entity-split"
import { computeControlTotals } from "../src/lib/onboarding/ai-mapper/control-totals"
import { validateImport } from "../src/lib/onboarding/ai-mapper/validate-import"
import type { ColumnMappingProposal, MappingProposal } from "../src/lib/onboarding/ai-mapper/types"

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const EXCEL_EPOCH = Date.UTC(1899, 11, 30)

function arg(flag: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : dflt
}

const file = process.argv[2]
const sheet = process.argv[3]
if (!file || !sheet) {
  console.error("usage: tsx scripts/verify-import-preview.ts <file.xlsx> <sheet> [--year N] [--bu BU]")
  process.exit(2)
}
const year = Number(arg("--year", String(new Date().getUTCFullYear())))
const buHeader = arg("--bu", "BU")!

const wb = XLSX.read(fs.readFileSync(file), { type: "buffer" })
if (!wb.Sheets[sheet]) {
  console.error(`Sheet "${sheet}" not found. Sheets: ${wb.SheetNames.join(", ")}`)
  process.exit(2)
}
const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheet], { header: 1, blankrows: false, defval: null }) as unknown[][]
const header = aoa[0] ?? []

// Detect month columns + the BU column from the header row.
const columns: ColumnMappingProposal[] = [
  { sourceIndex: 0, role: "code", confidence: 1, reasoning: "" },
  { sourceIndex: 1, role: "label", confidence: 1, reasoning: "" },
]
let buCol = -1
const monthYearsSeen = new Set<number>()
for (let c = 0; c < header.length; c++) {
  const v = header[c]
  const s = String(v ?? "").trim()
  if (s === buHeader) { buCol = c; continue }
  // Excel date serial → month + year.
  if (typeof v === "number" && v >= 40000 && v <= 60000) {
    const d = new Date(EXCEL_EPOCH + v * 86400000)
    columns.push({ sourceIndex: c, role: `amount:${MONTH_NAMES[d.getUTCMonth()]}${d.getUTCFullYear()}` as const, confidence: 1, reasoning: "" })
    monthYearsSeen.add(d.getUTCFullYear())
    continue
  }
  // Month-name header (any of the 12, optionally with a 4-digit year).
  const low = s.toLowerCase()
  const mi = MONTHS.findIndex((m) => low.startsWith(m))
  if (mi >= 0) {
    const ym = low.match(/(20\d{2})/)
    columns.push({ sourceIndex: c, role: `amount:${MONTH_NAMES[mi]}${ym ? ym[1] : ""}` as const, confidence: 1, reasoning: "" })
    if (ym) monthYearsSeen.add(Number(ym[1]))
  }
}
if (buCol < 0) {
  console.error(`No "${buHeader}" column found in the header — pass --bu <header>. This script handles the multi-company (BU) shape.`)
  process.exit(2)
}
columns.push({ sourceIndex: buCol, role: "entity", confidence: 1, reasoning: "" })

const proposal: MappingProposal = {
  sourceFile: file, sourceSheet: sheet, columns,
  accountTypeOverrides: [], anomalies: [], overallConfidence: 0.9, summary: "structural",
}

console.log(`File: ${file}`)
console.log(`Sheet: ${sheet}  | BU col: ${buCol}  | month years in header: ${[...monthYearsSeen].sort().join(", ") || "(bare)"}  | target year: ${year}\n`)

const out = applyProposalByEntity(wb, sheet, proposal, XLSX, undefined, { preferYear: year })
if ("error" in out) { console.error("PARSE ERROR:", out.error); process.exit(1) }

console.log(`entities: ${out.entityValues.map((e) => e || "(blank)").join(", ")}\n`)
let ok = true
for (const p of out.perEntity) {
  if (!("result" in p)) { console.log(`  ${(p.entityValue || "(blank)").padEnd(12)} PARSE-ERROR: ${p.error}`); ok = false; continue }
  const r = p.result
  const control = computeControlTotals(r.parentRollupsDropped, r.parentRollupsUnallocated)
  const v = validateImport(r, control)
  const sign = r.signConventions ? [r.signConventions.cogs?.convention, r.signConventions.expense?.convention].filter(Boolean).join("/") : "—"
  const blockers = v.findings.filter((f) => f.severity === "blocker").map((f) => f.category)
  const blank = p.entityValue === ""
  // The blank bucket + 0-line entities are informational, not failures.
  if (!blank && r.lines.length > 0 && v.verdict === "blocked") ok = false
  console.log(`  ${(p.entityValue || "(blank)").padEnd(12)} lines=${String(r.lines.length).padStart(4)}  control=${control.verdict.padEnd(6)}  sign=${(sign || "—").padEnd(20)}  verdict=${v.verdict.padEnd(13)}${blockers.length ? "  BLOCKERS: " + blockers.join(",") : ""}`)
}
console.log(`\nVERDICT: ${ok ? "PASS — every entity with data parses + is not validation-blocked (preview only, 0 DB writes)" : "REVIEW NEEDED — see blockers above"}`)
console.log(
  "\nNote: this uses a DETERMINISTIC structural proposal (no LLM accountType\n" +
  "overrides), so it is intentionally SOFTER than the wizard. A control_total\n" +
  "blocker here usually means parent/leaf rollups don't reconcile under the bare\n" +
  "structural mapping — the wizard (LLM types + human review) resolves these.\n" +
  "For AzerSheker's OWN files use the bespoke reporting-pack importer; this tool\n" +
  "is a quick 0-DB safety check for genuinely-new files + the multi-company shape.",
)
process.exit(ok ? 0 : 1)
