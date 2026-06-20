/**
 * CLI importer for the FO Holding monthly reporting pack ("Reporting 2026.xlsx").
 *
 * Reads the detail sheets (Actual PLF / BS Actual / CF Actual → actuals plan;
 * Budget PLF / Budget CF → budget plan), splits each by the `BU` column into
 * the four operating entities (AZSF / EDEN / CPC / ProMalt; EJE skipped), and
 * loads them through the existing, audited production adapter handlers.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/import-reporting-pack.ts [file] [--year N] [--apply]
 *
 *   (default) preview — pure parse, ZERO DB writes. Prints a per-entity table.
 *   --apply           — commit in one transaction, then recompute indicators.
 *
 * Re-import is clean-slate per (entity, plan, period) via the reused batch
 * functions' collateral-guarded delete-then-insert.
 */
import "dotenv/config"
import * as fs from "node:fs"
import * as XLSX from "xlsx"
import { prisma } from "@/lib/prisma"
import { runReportingPackImport } from "@/lib/onboarding/adapters/reporting-pack-importer"
import { runRecomputeForCompanies } from "@/lib/risk/recompute-trigger"

function parseArgs(argv: string[]) {
  const positional: string[] = []
  let apply = false
  let year = 2026
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--apply") apply = true
    else if (a === "--year") year = Number(argv[++i])
    else positional.push(a)
  }
  return {
    file: positional[0] ?? "/Users/rashadrahimov/Downloads/Reporting 2026.xlsx",
    apply,
    year,
  }
}

async function main() {
  const { file, apply, year } = parseArgs(process.argv.slice(2))
  console.log(`\nReporting-pack import — ${apply ? "APPLY" : "PREVIEW"}  year=${year}`)
  console.log(`file: ${file}\n`)

  const org = await prisma.organization.findFirst({ select: { id: true, name: true } })
  if (!org) throw new Error("No organization found")
  console.log(`org: ${org.name} (${org.id})`)

  const wb = XLSX.read(fs.readFileSync(file), {
    cellFormula: false,
    cellHTML: false,
    type: "buffer",
  })

  // entityCode → companyId (for the post-apply recompute)
  const companies = await prisma.company.findMany({
    where: { organizationId: org.id, code: { startsWith: "AZSEKER" } },
    select: { id: true, code: true },
  })
  const codeToId = new Map(companies.map((c) => [c.code, c.id]))

  const result = await runReportingPackImport(
    { workbook: wb, organizationId: org.id, year, mode: apply ? "apply" : "preview" },
    {
      prisma,
      XLSX,
      onAfterApply: async (entityCodes) => {
        const affected = entityCodes
          .map((code) => codeToId.get(code))
          .filter((id): id is string => Boolean(id))
          .map((companyId) => ({ companyId, year }))
        console.log(`\nRecomputing indicators for ${affected.length} companies…`)
        const rc = await runRecomputeForCompanies(prisma, org.id, affected)
        console.log(`recompute: ${JSON.stringify(rc)}`)
      },
    },
  )

  const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s).padEnd(n)
  console.log(
    "\n" +
      pad("SHEET", 12) +
      pad("BU", 9) +
      pad("ENTITY", 16) +
      pad("PLAN", 8) +
      pad("LINES", 7) +
      pad("TOTAL", 16) +
      (apply ? "WROTE" : "") +
      "  STATUS",
  )
  console.log("-".repeat(92))
  for (const r of result.reports) {
    console.log(
      pad(r.sheetName, 12) +
        pad(r.buCode, 9) +
        pad(String(r.entityCode ?? "—"), 16) +
        pad(r.planKind, 8) +
        pad(String(r.lineCount), 7) +
        pad(r.total.toFixed(0), 16) +
        (apply ? pad(String(r.rowsWritten ?? 0), 6) : "") +
        (r.skipped ? "  · skipped" : "  → write"),
    )
  }

  console.log("\n── summary ──")
  console.log(`  mode             : ${result.mode}`)
  console.log(`  total lines      : ${result.totalLineCount}`)
  console.log(`  rows written     : ${result.totalRowsWritten}`)
  console.log(`  affected entities: ${result.affectedEntities.join(", ") || "(none)"}`)
  if (result.warnings.length) {
    console.log(`  warnings (${result.warnings.length}):`)
    for (const w of result.warnings.slice(0, 12)) console.log(`    - ${w}`)
  }
  console.log("")
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error("IMPORT FAILED:", e)
    await prisma.$disconnect()
    process.exit(1)
  })
