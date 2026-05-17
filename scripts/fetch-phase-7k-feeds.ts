/**
 * Phase 7.K live-feed activator (TypeScript native).
 *
 * Pulls real data from all 8 free Phase 7.K adapters and writes to
 * IntelDataPoint. Skips the 3 key-gated adapters (eia / usda / gtrends).
 *
 * Run:
 *   DATABASE_URL=... npx tsx scripts/fetch-phase-7k-feeds.ts
 */
import { PrismaClient } from "@prisma/client"
import { getCommodityAdapters } from "../src/lib/intel/commodity"

const prisma = new PrismaClient()

const PHASE_7K_FREE = [
  "cbar-official-fx",
  "fao-food-prices",
  "yahoo-grains",
  "yahoo-metals",
  "yahoo-fuel-bdi",
  "openmeteo-forecast",
  "az-stat-cpi",
  "un-comtrade-az",
  "wb-indicators",
]

function pad(s: string | number, n: number): string {
  const str = String(s ?? "")
  return str.length >= n ? str.slice(0, n - 1) + " " : str + " ".repeat(n - str.length)
}

async function main() {
  console.log("Loading adapter factory...")
  const adapters = getCommodityAdapters({})
  console.log(`Loaded ${adapters.length} adapters.\n`)

  const org = await prisma.organization.findFirst({
    select: { id: true, name: true },
  })
  if (!org) throw new Error("No organization found")
  console.log(`Target org: ${org.name} (${org.id})\n`)

  console.log("─".repeat(110))
  console.log(
    `${pad("SOURCE", 22)}${pad("STATUS", 10)}${pad("POINTS", 8)}${pad("DURATION", 10)}NOTES`,
  )
  console.log("─".repeat(110))

  for (const src of PHASE_7K_FREE) {
    const adapter = adapters.find((a) => a.source === src)
    if (!adapter) {
      console.log(`${pad(src, 22)}${pad("MISSING", 10)}${pad("0", 8)}${pad("-", 10)}adapter not in factory`)
      continue
    }
    const start = Date.now()
    let result
    try {
      result = await adapter.fetch(new Date())
    } catch (e) {
      const ms = Date.now() - start
      console.log(
        `${pad(src, 22)}${pad("THREW", 10)}${pad("0", 8)}${pad(ms + "ms", 10)}${(e as Error).message?.slice(0, 60)}`,
      )
      continue
    }
    const ms = Date.now() - start

    if (!result.fetched || result.dataPoints.length === 0) {
      const errSnippet = (result.errors || []).slice(0, 2).join(" · ").slice(0, 60)
      console.log(
        `${pad(src, 22)}${pad(result.fetched ? "EMPTY" : "NO-FETCH", 10)}${pad("0", 8)}${pad(ms + "ms", 10)}${errSnippet}`,
      )
      continue
    }

    let written = 0
    for (const dp of result.dataPoints) {
      try {
        await prisma.intelDataPoint.upsert({
          where: {
            organizationId_sourceCode_metric_datetime: {
              organizationId: org.id,
              sourceCode: dp.sourceCode,
              metric: dp.metric,
              datetime: dp.datetime,
            },
          },
          update: { value: dp.value, unit: dp.unit, raw: (dp.raw ?? {}) as never },
          create: {
            organizationId: org.id,
            sourceCode: dp.sourceCode,
            metric: dp.metric,
            datetime: dp.datetime,
            value: dp.value,
            unit: dp.unit,
            raw: (dp.raw ?? {}) as never,
          },
        })
        written++
      } catch {
        // continue
      }
    }
    const errSnippet =
      result.errors && result.errors.length > 0
        ? `${result.errors.length} err: ${result.errors[0]?.slice(0, 40)}`
        : "ok"
    console.log(
      `${pad(src, 22)}${pad("FETCHED", 10)}${pad(String(written), 8)}${pad(ms + "ms", 10)}${errSnippet}`,
    )
  }
  console.log("─".repeat(110))

  // Final snapshot
  console.log("\nFinal IntelDataPoint state per source:")
  const rows = await prisma.intelDataPoint.groupBy({
    by: ["sourceCode"],
    _count: { _all: true },
    _max: { fetchedAt: true },
    where: { organizationId: org.id },
    orderBy: { sourceCode: "asc" },
  })
  for (const r of rows) {
    console.log(
      `  ${pad(r.sourceCode, 24)} ${pad(String(r._count._all), 6)} points  · last fetch: ${r._max.fetchedAt?.toISOString()}`,
    )
  }
  console.log()
}

main()
  .catch((e) => {
    console.error("Script error:", e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
