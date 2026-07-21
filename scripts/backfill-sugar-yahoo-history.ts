/**
 * Manual, free historical Sugar #11 backfill.
 *
 * Defaults to dry-run: it fetches the explicitly named Yahoo `SB=F` year and
 * prints source coverage, but never writes. `--apply` is required to invoke
 * the existing idempotent IntelDataPoint upsert path.
 *
 * No API key or provider credential is read or accepted.
 *
 * Usage:
 *   npx tsx scripts/backfill-sugar-yahoo-history.ts --org <organization-id> --year 2025
 *   npx tsx scripts/backfill-sugar-yahoo-history.ts --org <organization-id> --year 2025 --apply
 */

import { runSugarYahooHistoricalBackfill } from "../src/lib/intel/commodity/sugar-yahoo-backfill"

function readFlag(argv: string[], name: string): string | null {
  const index = argv.indexOf(name)
  if (index < 0) return null
  const value = argv[index + 1]
  return value && !value.startsWith("--") ? value : null
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const organizationId = readFlag(argv, "--org")
  const yearText = readFlag(argv, "--year")
  const apply = argv.includes("--apply")
  if (!organizationId || !yearText || !/^\d{4}$/.test(yearText)) {
    throw new Error(
      "Usage: npx tsx scripts/backfill-sugar-yahoo-history.ts --org <organization-id> --year <YYYY> [--apply]",
    )
  }

  // Keep the default dry-run entirely database-free: it validates the named
  // source range and coverage but does not even load Prisma's runtime module.
  // Apply alone needs an org existence check and a database client.
  let organizationLabel = organizationId
  let result: Awaited<ReturnType<typeof runSugarYahooHistoricalBackfill>>
  if (apply) {
    const { PrismaClient } = await import("@prisma/client")
    const prisma = new PrismaClient()
    try {
      const organization = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { id: true, name: true },
      })
      if (!organization) throw new Error(`Organization ${organizationId} was not found`)
      organizationLabel = `${organization.name} (${organization.id})`
      result = await runSugarYahooHistoricalBackfill({
        organizationId: organization.id,
        year: Number(yearText),
        apply: true,
        prisma,
      })
    } finally {
      await prisma.$disconnect()
    }
  } else {
    result = await runSugarYahooHistoricalBackfill({
      organizationId,
      year: Number(yearText),
    })
  }
  console.log(`${apply ? "APPLY" : "DRY RUN"} · ${organizationLabel}`)
  console.log(`Write status: ${result.writeStatus}`)
  console.log(`Source: ${result.source} · metric: ${result.metric}`)
  console.log(
    `Coverage: ${result.coverage.observedMonths.length}/12 months · ` +
      `${result.coverage.complete ? "complete" : `missing ${result.coverage.missingMonths.join(", ")}`}`,
  )
  console.log(`Points fetched: ${result.points.length}`)
  if (apply) console.log(`Points written: ${result.ingest?.pointsWritten ?? 0}`)
  if (!result.coverage.complete) {
    console.error("Coverage remains incomplete; no month was interpolated or synthesized.")
    process.exitCode = 2
  }
  if (result.errors.length > 0) {
    console.error("Errors:")
    for (const error of result.errors) console.error(`  - ${error}`)
    process.exitCode = 2
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
