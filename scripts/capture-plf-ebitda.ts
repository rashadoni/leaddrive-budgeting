/**
 * Capture the source's OWN monthly EBITDA subtotal (PLF.08 "EBITDA" row) from
 * Guvven Fin.xlsx into operational_facts as metric `pl_ebitda` (one row per
 * company per month). The recompute's budgetLine resolver then SUMS these per
 * period for context.ebitda (flow semantics), instead of mis-deriving EBITDA as
 * net (the 2026-05-31 audit found IND_EBITDA_MARGIN was showing net margin —
 * da_total=0 for PLF-format + opex lumps D&A/interest/tax).
 *
 * Idempotent: deletes existing pl_ebitda for the company+year, then inserts.
 *   DRY=1 npx tsx scripts/capture-plf-ebitda.ts   # parse + report, NO writes
 *         npx tsx scripts/capture-plf-ebitda.ts   # capture
 */
import { PrismaClient } from "@prisma/client"
import * as XLSX from "xlsx"
import { runRecomputeForCompanies } from "../src/lib/risk/recompute-trigger"

const prisma = new PrismaClient()
const SOURCE = "/Users/rashadrahimov/Documents/budget azersheker/Guvven Fin.xlsx"
const YEAR = 2026
const DRY = process.env.DRY === "1"
const METRIC = "pl_ebitda"

const JOBS = [
  { code: "AZSEKER-CPC", sheet: "PLF CPC" },
  { code: "AZSEKER-AZSF", sheet: "PLF AZSF" },
  { code: "AZSEKER-EDEN", sheet: "PLF EDEN" },
  { code: "AZSEKER-MALT", sheet: "PL Malt" },
]

function monthCols(aoa: unknown[][]): number[] | null {
  for (let i = 0; i < Math.min(aoa.length, 20); i++) {
    const c = Array(12).fill(-1)
    for (let k = 0; k < (aoa[i] || []).length; k++) {
      const v = (aoa[i] as unknown[])[k]
      const d = v instanceof Date ? v : (typeof v === "number" && v >= 44000 && v <= 48000 ? new Date((v - 25569) * 86400 * 1000) : null)
      if (d && d.getUTCFullYear() === YEAR && c[d.getUTCMonth()] === -1) c[d.getUTCMonth()] = k
    }
    if (c.every((x) => x !== -1)) return c
  }
  return null
}

async function main() {
  console.log(`${DRY ? "DRY (no writes)" : "CAPTURE"} — source EBITDA subtotal → ops_fact "${METRIC}", year ${YEAR}\n`)
  const wb = XLSX.readFile(SOURCE)
  const anyCo = await prisma.company.findFirst({ where: { code: { startsWith: "AZSEKER" } }, select: { organizationId: true } })
  if (!anyCo) throw new Error("no AZSEKER org")
  const orgId = anyCo.organizationId
  const affected: { companyId: string; year: number }[] = []

  for (const job of JOBS) {
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[job.sheet], { header: 1, raw: true, blankrows: false }) as unknown[][]
    const cols = monthCols(aoa)
    if (!cols) { console.log(`${job.code}: no ${YEAR} header — skip`); continue }
    // find the EBITDA subtotal row (label contains EBITDA, exclude any "EBITDA margin %")
    const ebitdaRow = aoa.find((r) => {
      const label = String((r as unknown[])[1] ?? "").toUpperCase()
      return label.includes("EBITDA") && !label.includes("MARGIN") && !label.includes("%")
    })
    if (!ebitdaRow) { console.log(`${job.code}: no EBITDA row found — skip`); continue }

    const co = await prisma.company.findFirst({ where: { code: job.code }, select: { id: true } })
    if (!co) { console.log(`${job.code}: company not in DB — skip`); continue }

    const monthly: { month: number; value: number }[] = []
    for (let m = 0; m < 12; m++) {
      const v = (ebitdaRow as unknown[])[cols[m]]
      if (typeof v === "number" && Number.isFinite(v) && Math.abs(v) > 0.005) monthly.push({ month: m + 1, value: v })
    }
    const annual = monthly.reduce((s, x) => s + x.value, 0)
    console.log(`${job.code}  EBITDA months=${monthly.length}  annual=${Math.round(annual).toLocaleString()}`)

    if (DRY) continue
    await prisma.$transaction(async (tx) => {
      await tx.operationalFact.deleteMany({
        where: { companyId: co.id, metric: METRIC, date: { gte: new Date(Date.UTC(YEAR, 0, 1)), lt: new Date(Date.UTC(YEAR + 1, 0, 1)) } },
      })
      if (monthly.length > 0) {
        await tx.operationalFact.createMany({
          data: monthly.map((x) => ({
            organizationId: orgId,
            companyId: co.id,
            metric: METRIC,
            date: new Date(Date.UTC(YEAR, x.month - 1, 1)),
            value: x.value,
            unit: "AZN",
            source: "import:plf-subtotal",
          })),
        })
      }
    })
    console.log(`   → wrote ${monthly.length} ${METRIC} facts`)
    affected.push({ companyId: co.id, year: YEAR })
  }

  if (!DRY && affected.length > 0) {
    console.log(`\nRecomputing ${affected.length} companies (so EBITDA indicators pick up pl_ebitda)…`)
    const rc = await runRecomputeForCompanies(prisma, orgId, affected)
    console.log(`recompute: ${JSON.stringify(rc)}`)
  }
  await prisma.$disconnect()
  console.log(`\n${DRY ? "DRY done — re-run without DRY=1 to capture." : "DONE. Verify EBITDA: re-query IND_EBITDA_MARGIN."}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
