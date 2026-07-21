/**
 * Explicit, dry-run-first operations path for free Yahoo Sugar #11 history.
 *
 * This module has no credentials, provider keys, scheduler registration, or
 * implicit current-date behaviour. A caller must supply both organization and
 * historical year. `apply` is opt-in; the default returns a source-backed
 * coverage plan without persisting anything.
 */

import type { PrismaClient } from "@prisma/client"
import type { IngestResult } from "./ingest"
import {
  createSugarYahooHistoricalAdapter,
  sugarYahooHistoryRangeForYear,
} from "./sugar-yahoo"
import type { CommodityAdapterOptions, CommodityDataPoint } from "./types"

export interface SugarYahooHistoricalCoverage {
  year: number
  expectedMonths: string[]
  observedMonths: string[]
  missingMonths: string[]
  /** More than one point for a canonical month means coverage is not auditable. */
  duplicateMonths: string[]
  /** In-range points not anchored to UTC month-start are never valid coverage. */
  nonCanonicalPointCount: number
  complete: boolean
}

export interface SugarYahooHistoricalBackfillOptions extends CommodityAdapterOptions {
  organizationId: string
  year: number
  /** False by default: fetch + evidence only, with no database writes. */
  apply?: boolean
  /** Test/ops seam for the existing idempotent IntelDataPoint upsert pipeline. */
  prisma?: PrismaClient
}

export interface SugarYahooHistoricalBackfillResult {
  /** True only when every fetched source point passed through the write path. */
  applied: boolean
  /** Distinguishes intentional dry-run, blocked apply, complete write and a partial write. */
  writeStatus: "dry_run" | "not_applied" | "complete" | "partial"
  source: string
  metric: string
  points: CommodityDataPoint[]
  errors: string[]
  coverage: SugarYahooHistoricalCoverage
  ingest?: IngestResult
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`
}

function expectedMonths(year: number): string[] {
  return Array.from({ length: 12 }, (_, month) =>
    monthKey(new Date(Date.UTC(year, month, 1))),
  )
}

function isExactUtcMonthStart(date: Date): boolean {
  return (
    date.getUTCDate() === 1 &&
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0
  )
}

export function assessSugarYahooHistoricalCoverage(
  year: number,
  points: CommodityDataPoint[],
): SugarYahooHistoricalCoverage {
  // Validates the year and keeps this pure helper aligned with the adapter's
  // exact `[Jan-1, next-Jan-1)` contract.
  const range = sugarYahooHistoryRangeForYear(year)
  const expected = expectedMonths(year)
  const inRange = points.filter(
    (point) => point.datetime >= range.start && point.datetime < range.end,
  )
  const canonical = inRange.filter((point) => isExactUtcMonthStart(point.datetime))
  const counts = new Map<string, number>()
  for (const point of canonical) {
    const month = monthKey(point.datetime)
    counts.set(month, (counts.get(month) ?? 0) + 1)
  }
  const observed = new Set(
    canonical.map((point) => monthKey(point.datetime)),
  )
  const observedMonths = expected.filter((month) => observed.has(month))
  const missingMonths = expected.filter((month) => !observed.has(month))
  const duplicateMonths = expected.filter((month) => (counts.get(month) ?? 0) > 1)
  const nonCanonicalPointCount = inRange.length - canonical.length
  return {
    year,
    expectedMonths: expected,
    observedMonths,
    missingMonths,
    duplicateMonths,
    nonCanonicalPointCount,
    complete:
      missingMonths.length === 0 &&
      duplicateMonths.length === 0 &&
      nonCanonicalPointCount === 0,
  }
}

/**
 * Fetch an exact historical calendar year once. Applying reuses the captured
 * response through the existing `(org, source, metric, datetime)` upsert
 * pipeline, so no second provider call is made and reruns are idempotent.
 */
export async function runSugarYahooHistoricalBackfill(
  opts: SugarYahooHistoricalBackfillOptions,
): Promise<SugarYahooHistoricalBackfillResult> {
  if (!opts.organizationId.trim()) {
    throw new Error("organizationId is required for sugar history backfill")
  }
  const adapter = createSugarYahooHistoricalAdapter(opts.year, {
    fetchImpl: opts.fetchImpl,
  })
  const fetched = await adapter.fetch()
  const coverage = assessSugarYahooHistoricalCoverage(opts.year, fetched.dataPoints)
  if (!opts.apply) {
    return {
      applied: false,
      writeStatus: "dry_run",
      source: adapter.source,
      metric: fetched.dataPoints[0]?.metric ?? "SUGAR_RAW_USD_TONNE",
      points: fetched.dataPoints,
      errors: fetched.errors,
      coverage,
    }
  }

  // An apply must be fail-safe: an upstream error or zero usable bars is not
  // a successful historical import, even if an empty ingest would technically
  // return without throwing.
  if (fetched.errors.length > 0 || fetched.dataPoints.length === 0) {
    return {
      applied: false,
      writeStatus: "not_applied",
      source: adapter.source,
      metric: fetched.dataPoints[0]?.metric ?? "SUGAR_RAW_USD_TONNE",
      points: fetched.dataPoints,
      errors: [
        ...fetched.errors,
        "Backfill was not applied because Yahoo returned errors or zero usable historical points",
      ],
      coverage,
    }
  }

  // Feed the already-captured result to ingest; this prevents a dry-run/apply
  // implementation from accidentally re-querying Yahoo with a different bar.
  // Dynamic import is intentional: dry-run must not initialize the Prisma
  // backed ingest module or attempt any database connection.
  const { ingestCommodityData } = await import("./ingest")
  const replayAdapter = {
    ...adapter,
    fetch: async () => fetched,
  }
  const ingest = await ingestCommodityData(
    opts.organizationId,
    [replayAdapter],
    {
      ...(opts.prisma ? { prisma: opts.prisma } : {}),
      // A manual historical import must never call an ephemeral in-memory
      // fallback a successful persistence. If the IntelDataPoint table is
      // unavailable (for example P2021), every affected point is reported as
      // unwritten and the operator can safely fix the schema then rerun.
      allowInMemoryFallback: false,
    },
  )
  const completeWrite =
    ingest.errors.length === 0 && ingest.pointsWritten === fetched.dataPoints.length
  const errors = [...fetched.errors, ...ingest.errors]
  if (!completeWrite) {
    errors.push(
      `Backfill apply was partial: wrote ${ingest.pointsWritten}/${fetched.dataPoints.length} fetched point(s)`,
    )
  }
  return {
    applied: completeWrite,
    writeStatus: completeWrite ? "complete" : "partial",
    source: adapter.source,
    metric: fetched.dataPoints[0]?.metric ?? "SUGAR_RAW_USD_TONNE",
    points: fetched.dataPoints,
    errors,
    coverage,
    ingest,
  }
}
