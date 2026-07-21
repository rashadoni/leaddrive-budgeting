/**
 * Track 1.1C — safe manual Open-Meteo historical rainfall backfill.
 *
 * Dry-run is the default. Database writes require BOTH an explicit org and
 * `--apply`. The script never changes Company.settings; in particular it does
 * not choose an arbitrary primary region for a multi-region company.
 *
 * Examples:
 *   npx tsx scripts/backfill-weather-openmeteo-history.ts --org <id> --year 2025
 *   npx tsx scripts/backfill-weather-openmeteo-history.ts --org <id> --year 2025 --apply
 *   npx tsx scripts/backfill-weather-openmeteo-history.ts --org <id> --as-of 2025-12-31 --regions salyan,imishli
 */

import type { PrismaClient } from "@prisma/client"
import type { CommodityAdapter } from "../src/lib/intel/commodity/types"
import {
  buildLegacyRainfallWindow,
  buildMonthlyRainfallAnchors,
  createOpenMeteoHistoricalRainfallAdapter,
  executeHistoricalRainfallBackfill,
} from "../src/lib/intel/commodity/weather-openmeteo-history"
import {
  WEATHER_REGIONS,
  type WeatherRegionCode,
} from "../src/lib/intel/commodity/weather-openmeteo"

interface CliArgs {
  orgId: string
  anchorDates: string[]
  regionCodes: WeatherRegionCode[]
  apply: boolean
}

function parseFlags(argv: readonly string[]): Map<string, string | true> {
  const flags = new Map<string, string | true>()
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`)
    const equal = token.indexOf("=")
    if (equal >= 0) {
      flags.set(token.slice(2, equal), token.slice(equal + 1))
      continue
    }
    const key = token.slice(2)
    const next = argv[index + 1]
    if (next && !next.startsWith("--")) {
      flags.set(key, next)
      index += 1
    } else {
      flags.set(key, true)
    }
  }
  return flags
}

function requiredString(flags: Map<string, string | true>, key: string): string {
  const value = flags.get(key)
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`--${key} is required`)
  }
  return value.trim()
}

function parseCli(argv: readonly string[]): CliArgs {
  const flags = parseFlags(argv)
  const allowed = new Set(["org", "year", "as-of", "regions", "apply"])
  for (const key of flags.keys()) {
    if (!allowed.has(key)) throw new Error(`Unknown flag: --${key}`)
  }

  const orgId = requiredString(flags, "org")
  const yearRaw = flags.get("year")
  const asOfRaw = flags.get("as-of")
  if ((typeof yearRaw === "string") === (typeof asOfRaw === "string")) {
    throw new Error("Provide exactly one of --year YYYY or --as-of YYYY-MM-DD")
  }
  const anchorDates = typeof yearRaw === "string"
    ? buildMonthlyRainfallAnchors(Number(yearRaw))
    : [buildLegacyRainfallWindow(String(asOfRaw)).windowEnd]

  const configuredCodes = new Set<string>(WEATHER_REGIONS.map((region) => region.code))
  const regionsRaw = flags.get("regions")
  const regionCodes = typeof regionsRaw === "string"
    ? [...new Set(regionsRaw.split(",").map((value) => value.trim()).filter(Boolean))].map((code) => {
        if (!configuredCodes.has(code)) throw new Error(`Unknown canonical region: ${code}`)
        return code as WeatherRegionCode
      })
    : WEATHER_REGIONS.map((region) => region.code)
  if (regionCodes.length === 0) throw new Error("--regions must contain at least one canonical region")

  return { orgId, anchorDates, regionCodes, apply: flags.get("apply") === true }
}

async function main(): Promise<void> {
  const args = parseCli(process.argv.slice(2))
  console.log(`[weather-history] mode=${args.apply ? "APPLY" : "DRY-RUN"}`)
  console.log(`[weather-history] org=${args.orgId}`)
  console.log(`[weather-history] anchors=${args.anchorDates[0]}..${args.anchorDates.at(-1)} (${args.anchorDates.length})`)
  console.log(`[weather-history] regions=${args.regionCodes.join(",")}`)

  let prisma: PrismaClient | null = null
  try {
    if (args.apply) {
      // Keep dry-run genuinely database-free: loading the Prisma runtime and
      // opening a client are both apply-only operations.
      const { PrismaClient } = await import("@prisma/client")
      prisma = new PrismaClient()
      const org = await prisma.organization.findUnique({
        where: { id: args.orgId },
        select: { id: true, name: true },
      })
      if (!org) throw new Error(`Organization not found: ${args.orgId}`)
      console.log(`[weather-history] target=${org.name} (${org.id})`)
    }

    const adapter = createOpenMeteoHistoricalRainfallAdapter({
      anchorDates: args.anchorDates,
      regionCodes: args.regionCodes,
    })
    const execution = await executeHistoricalRainfallBackfill({
      adapter,
      anchorDates: args.anchorDates,
      regionCodes: args.regionCodes,
      apply: args.apply,
      persist: args.apply
        ? async (fetched) => {
            if (!prisma) throw new Error("Internal error: apply mode has no Prisma client")
            // Runtime-only import: a dry-run never initializes the application's
            // Prisma wrapper or its development schema check.
            const { ingestCommodityData } = await import("../src/lib/intel/commodity/ingest")
            const frozenAdapter: CommodityAdapter = {
              source: adapter.source,
              label: adapter.label,
              fetch: async () => fetched,
            }
            const ingested = await ingestCommodityData(
              args.orgId,
              [frozenAdapter],
              // A manual historical import must never report an ephemeral
              // pre-migration memory fallback as a completed production write.
              { prisma, allowInMemoryFallback: false },
            )
            return {
              pointsWritten: ingested.pointsWritten,
              errors: ingested.errors,
            }
          }
        : undefined,
    })
    const { fetched, assessment } = execution
    console.log(
      `[weather-history] fetched=${assessment.actualCount}/${assessment.expectedCount} errors=${assessment.upstreamErrors.length}`,
    )
    if (!assessment.ok) {
      for (const error of assessment.upstreamErrors) console.error(`[weather-history] ${error}`)
      if (assessment.missingKeys.length > 0) {
        console.error(`[weather-history] missing=${assessment.missingKeys.join(",")}`)
      }
      if (assessment.unexpectedKeys.length > 0) {
        console.error(`[weather-history] unexpected=${assessment.unexpectedKeys.join(",")}`)
      }
      if (assessment.duplicateKeys.length > 0) {
        console.error(`[weather-history] duplicates=${assessment.duplicateKeys.join(",")}`)
      }
      throw new Error("Historical rainfall batch is incomplete; no rows were written")
    }

    const first = fetched.dataPoints[0]
    const last = fetched.dataPoints.at(-1)
    console.log(
      `[weather-history] evidence first=${first.metric}@${first.datetime.toISOString()} value=${first.value}${first.unit ?? ""}`,
    )
    console.log(
      `[weather-history] evidence last=${last?.metric}@${last?.datetime.toISOString()} value=${last?.value}${last?.unit ?? ""}`,
    )
    if (!execution.writeAttempted) {
      console.log("[weather-history] dry-run complete; add --apply for idempotent upserts")
      return
    }

    const persistence = execution.persistence
    if (!persistence) throw new Error("Internal error: write attempted without persistence result")
    if (persistence.errors.length > 0 || persistence.pointsWritten !== assessment.expectedCount) {
      for (const error of persistence.errors) console.error(`[weather-history] ${error}`)
      throw new Error(
        `Ingest incomplete: wrote ${persistence.pointsWritten}/${assessment.expectedCount}`,
      )
    }
    console.log(`[weather-history] applied ${persistence.pointsWritten} idempotent upserts`)
  } finally {
    await prisma?.$disconnect()
  }
}

void main().catch((error) => {
  console.error(`[weather-history] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
