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
import { acquireImportLock, type ImportLock } from "@/lib/onboarding/import-lock"

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

  // 11.60 — this CLI was a SECOND door onto the same rows, and it neither
  // serialised nor attested: no import lock, so it could interleave with a
  // web apply and leave a full duplicate set (both are clean-slate, and
  // cash_flow_entries has no unique constraint to reject the copy); and no
  // runId, so it wrote no ImportBatchReport and the newest attestation kept
  // describing some earlier import.
  let cliLock: ImportLock | null = null
  if (apply) {
    cliLock = await acquireImportLock(org.id, year)
    if (!cliLock.acquired) {
      await cliLock.release()
      console.error(
        `\n✗ Another import is already running for ${org.id} / ${year} ` +
          `(${cliLock.scope}). Wait for it to finish — running both would ` +
          `duplicate every row they share.`,
      )
      process.exit(1)
    }
  }

  let result
  try {
    result = await runReportingPackImport(
      {
        workbook: wb,
        organizationId: org.id,
        year,
        mode: apply ? "apply" : "preview",
        ...(apply
          ? {
              runId: `reporting-pack-cli:${org.id}:${year}:${Date.now()}`,
              filenames: [file],
              actorUserId: null,
            }
          : {}),
      },
      {
        prisma,
        XLSX,
        onAfterApply: async (entityCodes) => {
          const affected = entityCodes
            .map((code) => codeToId.get(code))
            .filter((id): id is string => Boolean(id))
            .map((companyId) => ({ companyId, year }))
          console.log(`\nRecomputing indicators for ${affected.length} companies…`)
          // Same granularity as every other writer of these rows (11.40) —
          // the reset deletes month and quarter IndicatorValues too.
          const rc = await runRecomputeForCompanies(prisma, org.id, affected, {}, {
            granularity: "year+quarter+month",
          })
          console.log(`recompute: ${JSON.stringify(rc)}`)
        },
      },
    )
  } finally {
    // Swallowed: a throw here would mask the real outcome, and Postgres drops
    // a session lock when the connection dies anyway.
    try {
      await cliLock?.release()
    } catch {
      /* best-effort */
    }
  }

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
