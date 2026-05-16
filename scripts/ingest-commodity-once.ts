/**
 * Phase 7.I Track B — manual commodity ingest trigger.
 *
 * One-shot script: pulls all configured commodity adapters (TCMB FX,
 * WorldBank CPI, Commodities RSS, Open-Meteo weather, Sugar Yahoo Finance)
 * and persists `IntelDataPoint` rows for the target organization. Used to
 * bootstrap data before the scheduler's first scheduled run lands, and as
 * a runbook tool when an org admin wants fresh data on demand.
 *
 * Usage:
 *   npx tsx scripts/ingest-commodity-once.ts                      # first org
 *   npx tsx scripts/ingest-commodity-once.ts --org <id>           # specific org
 *
 * Failures from one adapter don't abort the others — per-source errors
 * are summarized at exit. Exit code 1 only on hard failures (DB unreachable).
 */
import { PrismaClient } from "@prisma/client"
import { ingestCommodityData, getCommodityAdapters } from "../src/lib/intel/commodity"

const prisma = new PrismaClient()

function parseArgs(argv: string[]) {
  const args: Record<string, string | true> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith("--")) {
      const k = a.slice(2)
      const v = argv[i + 1]
      if (!v || v.startsWith("--")) args[k] = true
      else { args[k] = v; i++ }
    }
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const org = args.org && typeof args.org === "string"
    ? await prisma.organization.findUnique({ where: { id: args.org }, select: { id: true, name: true } })
    : await prisma.organization.findFirst({ select: { id: true, name: true } })
  if (!org) {
    console.error("No organization found.")
    process.exit(1)
  }
  console.log("Org:", org.name, `(${org.id})`)
  const adapters = getCommodityAdapters()
  console.log("Adapters:", adapters.map((a) => a.source).join(", "))
  const result = await ingestCommodityData(org.id, adapters, { prisma })
  console.log("")
  console.log(`Points written: ${result.pointsWritten}`)
  if (result.errors.length > 0) {
    console.log("Errors:")
    for (const e of result.errors) console.log("  -", e)
  } else {
    console.log("No errors.")
  }
  // Summary per source.
  console.log("")
  console.log("Per source:")
  for (const r of result.perSource) {
    console.log(`  ${r.source}: ${r.dataPoints.length} datapoints · errors=${r.errors.length} · fetched=${r.fetched}`)
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
