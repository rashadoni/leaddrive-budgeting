/**
 * One-off restore: re-import the lost AzerSheker Balance Sheet for
 * CPC / AZSF / EDEN from `Guvven Fin.xlsx` via the PRODUCTION BS handler
 * (`makeBsHandler` → `runBalanceSheetBatch`, now companyId-scoped so it no
 * longer cross-archives siblings). MALT's BS is already live and untouched.
 *
 * The 2026-05-26 multi-import created then immediately cross-archived these
 * three entities' BS (planId-scoped reset bug, fixed 2026-05-31). This restores
 * them from the source of truth via the corrected path, then recomputes.
 *
 *   DRY=1 npx tsx scripts/reimport-azseker-bs.ts   # parse + report, NO writes
 *         npx tsx scripts/reimport-azseker-bs.ts   # real re-import + recompute
 *
 * Verify after with: npx tsx scripts/verify-azseker-vs-source.ts
 */
import { PrismaClient, type Prisma } from "@prisma/client"
import * as XLSX from "xlsx"
import { resolveOrgContext } from "../src/lib/onboarding/ai-import/prod-adapter-context"
import {
  makeBsHandler,
  makeCfHandler,
} from "../src/lib/onboarding/ai-import/production-adapter-handlers-financial"
import type { AdapterHandler } from "../src/lib/onboarding/ai-import/adapter-registry"
import { runRecomputeForCompanies } from "../src/lib/risk/recompute-trigger"

const prisma = new PrismaClient()
const SOURCE = "/Users/rashadrahimov/Documents/budget azersheker/Guvven Fin.xlsx"
const YEAR = 2026
const DRY = process.env.DRY === "1"
const MODE = (process.env.MODE || "both").toLowerCase() // "bs" | "cf" | "both"

const BS_JOBS = [
  { entityCode: "AZSEKER-CPC", sheet: "BS CPC" },
  { entityCode: "AZSEKER-AZSF", sheet: "BS AZSF" },
  { entityCode: "AZSEKER-EDEN", sheet: "BS EDEN" },
]
const CF_JOBS = [
  { entityCode: "AZSEKER-CPC", sheet: "CF CPC" },
  { entityCode: "AZSEKER-AZSF", sheet: "CF AZSF" },
  { entityCode: "AZSEKER-EDEN", sheet: "CF EDEN" },
]

async function main() {
  console.log(`${DRY ? "DRY RUN (no writes)" : "LIVE RE-IMPORT"} — MODE=${MODE}, year ${YEAR}\n`)
  const wb = XLSX.readFile(SOURCE)

  const anyCo = await prisma.company.findFirst({
    where: { code: { startsWith: "AZSEKER" } },
    select: { organizationId: true },
  })
  if (!anyCo) throw new Error("no AZSEKER org found")
  const orgId = anyCo.organizationId

  const ctx = await resolveOrgContext(prisma, orgId, YEAR)
  const ctxRef = { value: ctx as typeof ctx | null }
  const bsHandler = makeBsHandler(prisma, ctxRef, async () => ctx)
  const cfHandler = makeCfHandler(prisma, ctxRef, async () => ctx)

  const affected: { companyId: string; year: number }[] = []

  async function runJobs(
    label: string,
    handler: AdapterHandler,
    jobs: { entityCode: string; sheet: string }[],
  ): Promise<void> {
    console.log(`\n--- ${label} ---`)
    for (const job of jobs) {
      const input = {
        workbook: wb,
        sheetName: job.sheet,
        entityCode: job.entityCode,
        year: YEAR,
        organizationId: orgId,
        XLSX,
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await handler(input as any)
      console.log(`${job.entityCode}  "${job.sheet}": ${res.summary} (rows to write = ${res.itemCount})`)
      if (res.warnings.length) console.log(`   warnings: ${res.warnings.slice(0, 3).join("; ")}`)
      if (DRY) continue
      const applied = (await prisma.$transaction((tx) =>
        res.applyToDb(tx as unknown as Prisma.TransactionClient),
      )) as { rowsInserted: number }
      console.log(`   → rowsInserted = ${applied.rowsInserted}`)
      const id = ctx.codeToId.get(job.entityCode)
      if (id) affected.push({ companyId: id, year: YEAR })
    }
  }

  if (MODE === "bs" || MODE === "both") await runJobs("BALANCE SHEET", bsHandler, BS_JOBS)
  if (MODE === "cf" || MODE === "both") await runJobs("CASH FLOW", cfHandler, CF_JOBS)

  if (!DRY && affected.length > 0) {
    console.log(`\nRecomputing indicators for ${affected.length} companies…`)
    const rc = await runRecomputeForCompanies(prisma, orgId, affected)
    console.log(`recompute result: ${JSON.stringify(rc)}`)
  }

  await prisma.$disconnect()
  console.log(`\n${DRY ? "DRY RUN complete — no writes. Re-run without DRY=1 to apply." : "DONE. Verify: npx tsx scripts/verify-azseker-vs-source.ts"}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
