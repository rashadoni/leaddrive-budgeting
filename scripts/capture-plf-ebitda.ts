/**
 * Capture the source's OWN monthly EBITDA subtotal (PLF "EBITDA" row) from
 * Guvven Fin.xlsx into operational_facts as metric `pl_ebitda` (one row per
 * company per month). The recompute's budgetLine resolver then SUMS these per
 * period for context.ebitda (flow semantics), instead of mis-deriving EBITDA as
 * net (the 2026-05-31 audit found IND_EBITDA_MARGIN was showing net margin —
 * da_total=0 for PLF-format + opex lumps D&A/interest/tax).
 *
 * 2026-06-03 (user «просканируй все файлы»): now captures EVERY year present in
 * each PLF sheet (2023..2026), not just one hardcoded year. Earlier the script
 * pinned YEAR=2026, so 2025 (and prior) had NO captured `pl_ebitda` and fell
 * back to the DERIVED rev−cogs−opex EBITDA — which DROPS the source's
 * other-operating-income (e.g. EDEN's farming subsidies) and produced a 2025
 * EBITDA of −664K (−11.9% red) when the source's own 2025 EBITDA subtotal is
 * +1.56M (28% green). Capturing all years puts EVERY period on the SAME basis
 * (the client's reported EBITDA subtotal), which is the figure the terminal's
 * "full-year headline" (2025) must show.
 *
 * Idempotent: per company, deletes existing pl_ebitda across the captured year
 * span, then inserts the source subtotal for each detected year.
 *   DRY=1 npx tsx scripts/capture-plf-ebitda.ts   # parse + report, NO writes
 *         npx tsx scripts/capture-plf-ebitda.ts   # capture
 */
import { PrismaClient } from "@prisma/client"
import * as XLSX from "xlsx"
import { runRecomputeForCompanies } from "../src/lib/risk/recompute-trigger"

const prisma = new PrismaClient()
const SOURCE = "/Users/rashadrahimov/Documents/budget azersheker/Guvven Fin.xlsx"
const DRY = process.env.DRY === "1"
const METRIC = "pl_ebitda"

const JOBS = [
  { code: "AZSEKER-CPC", sheet: "PLF CPC" },
  { code: "AZSEKER-AZSF", sheet: "PLF AZSF" },
  { code: "AZSEKER-EDEN", sheet: "PLF EDEN" },
  { code: "AZSEKER-MALT", sheet: "PL Malt" },
]

/**
 * Detect ALL year columns in the header band. A single header row carries
 * every year side by side (e.g. 2023 cols 3..14, 2024 18..29, 2025 33..44,
 * 2026 48..59). Returns Map<year, number[12]> of month→column index for each
 * year that has all 12 months present. Excel serial-date range 40000..50000
 * spans ~2009..2036.
 */
function detectYearCols(aoa: unknown[][]): Map<number, number[]> {
  for (let i = 0; i < Math.min(aoa.length, 20); i++) {
    const byYear = new Map<number, number[]>()
    for (let k = 0; k < (aoa[i] || []).length; k++) {
      const v = (aoa[i] as unknown[])[k]
      const d = v instanceof Date ? v : (typeof v === "number" && v >= 40000 && v <= 50000 ? new Date((v - 25569) * 86400 * 1000) : null)
      if (d) {
        const y = d.getUTCFullYear(), m = d.getUTCMonth()
        const arr = byYear.get(y) ?? Array(12).fill(-1)
        if (arr[m] === -1) arr[m] = k
        byYear.set(y, arr)
      }
    }
    const full = new Map<number, number[]>()
    for (const [y, cols] of byYear) if (cols.every((x) => x !== -1)) full.set(y, cols)
    if (full.size > 0) return full
  }
  return new Map()
}

async function main() {
  console.log(`${DRY ? "DRY (no writes)" : "CAPTURE"} — source EBITDA subtotal → ops_fact "${METRIC}", ALL years\n`)
  const wb = XLSX.readFile(SOURCE)
  const anyCo = await prisma.company.findFirst({ where: { code: { startsWith: "AZSEKER" } }, select: { organizationId: true } })
  if (!anyCo) throw new Error("no AZSEKER org")
  const orgId = anyCo.organizationId
  const affected: { companyId: string; year: number }[] = []

  for (const job of JOBS) {
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[job.sheet], { header: 1, raw: true, blankrows: false }) as unknown[][]
    const yearCols = detectYearCols(aoa)
    if (yearCols.size === 0) { console.log(`${job.code}: no year header — skip`); continue }
    // find the EBITDA subtotal row (label contains EBITDA, exclude any "EBITDA margin %")
    const ebitdaRow = aoa.find((r) => {
      const label = String((r as unknown[])[1] ?? "").toUpperCase()
      return label.includes("EBITDA") && !label.includes("MARGIN") && !label.includes("%")
    })
    if (!ebitdaRow) { console.log(`${job.code}: no EBITDA row found — skip`); continue }

    const co = await prisma.company.findFirst({ where: { code: job.code }, select: { id: true } })
    if (!co) { console.log(`${job.code}: company not in DB — skip`); continue }

    // Per-year monthly extraction. A year is captured only if it has at least
    // one non-trivial EBITDA month (skips empty pre-operational year columns).
    const years = [...yearCols.keys()].sort((a, b) => a - b)
    const minYear = years[0], maxYear = years[years.length - 1]
    const perYear: { year: number; monthly: { month: number; value: number }[] }[] = []
    for (const year of years) {
      const cols = yearCols.get(year)!
      const monthly: { month: number; value: number }[] = []
      for (let m = 0; m < 12; m++) {
        const v = (ebitdaRow as unknown[])[cols[m]]
        if (typeof v === "number" && Number.isFinite(v) && Math.abs(v) > 0.005) monthly.push({ month: m + 1, value: v })
      }
      if (monthly.length === 0) continue
      const annual = monthly.reduce((s, x) => s + x.value, 0)
      console.log(`${job.code} ${year}  EBITDA months=${monthly.length}  annual=${Math.round(annual).toLocaleString()}`)
      perYear.push({ year, monthly })
    }
    if (perYear.length === 0) { console.log(`${job.code}: no non-zero EBITDA in any year — skip`); continue }

    if (DRY) continue
    await prisma.$transaction(async (tx) => {
      // wipe the full captured span for this company, then re-insert every year
      await tx.operationalFact.deleteMany({
        where: { companyId: co.id, metric: METRIC, date: { gte: new Date(Date.UTC(minYear, 0, 1)), lt: new Date(Date.UTC(maxYear + 1, 0, 1)) } },
      })
      const data = perYear.flatMap((py) =>
        py.monthly.map((x) => ({
          organizationId: orgId,
          companyId: co.id,
          metric: METRIC,
          date: new Date(Date.UTC(py.year, x.month - 1, 1)),
          value: x.value,
          unit: "AZN",
          source: "import:plf-subtotal",
        })),
      )
      if (data.length > 0) await tx.operationalFact.createMany({ data })
    })
    const totalRows = perYear.reduce((s, py) => s + py.monthly.length, 0)
    console.log(`   → wrote ${totalRows} ${METRIC} facts across ${perYear.length} year(s)`)
    for (const py of perYear) affected.push({ companyId: co.id, year: py.year })
  }

  if (!DRY && affected.length > 0) {
    const yearsSet = [...new Set(affected.map((a) => a.year))].sort()
    console.log(`\nRecomputing ${affected.length} company-years (${yearsSet.join(",")}) so EBITDA indicators pick up pl_ebitda…`)
    const rc = await runRecomputeForCompanies(prisma, orgId, affected)
    console.log(`recompute: ${JSON.stringify(rc)}`)
  }
  await prisma.$disconnect()
  console.log(`\n${DRY ? "DRY done — re-run without DRY=1 to capture." : "DONE. Verify EBITDA: re-query IND_EBITDA_MARGIN."}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
