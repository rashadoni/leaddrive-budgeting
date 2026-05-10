/**
 * Phase 7.G Turn LXXXXVI (Phase 7.E #2 v2 E.1b) — intel context fusion.
 *
 * Pure helper that aggregates the latest FX / CPI / commodity data points
 * for a given org, packages them into an `IntelContextSnapshot` the variance
 * explainer can include in its prompt. Lets the LLM cite "AZN/USD spiked
 * 8% MoM" when explaining a foreign-input cost variance — closes the
 * intel→explainer loop.
 *
 * **Why pure:** consumer (variance-explainer) stays decoupled from data
 * fetching. Caller (route handler) builds the context once + passes to
 * cache layer + explainer.
 *
 * **Storage:** post-migrate reads from Prisma `IntelDataPoint`. Pre-migrate
 * reads from in-memory store via `getInMemoryDataPoints`. Identical shape
 * regardless of source.
 *
 * **Filtering strategy v1:** include ALL recent points (last 60 days),
 * limit per metric to 3 latest observations. LLM picks what's relevant.
 * Per-indicator filtering heuristic (e.g. "REV indicators get FX, COGS
 * indicators get CPI") deferred to v2 once we have data on which signals
 * land.
 */

import { tryPrismaThenFallback } from "@/lib/prisma-promotion"
import { prisma as defaultPrisma } from "@/lib/prisma"
import { getInMemoryDataPoints } from "@/lib/intel/commodity"
import type { CommodityDataPoint } from "@/lib/intel/commodity"

/** Window for intel relevance — older points get dropped from the snapshot.
 *  60 days is wide enough to span a quarterly indicator's lookback while
 *  short enough to keep the prompt small. */
export const INTEL_CONTEXT_WINDOW_MS = 60 * 24 * 60 * 60 * 1000
/** Max observations per metric — gives the LLM a small trend (last 3 days
 *  for FX, last 3 months for CPI). Beyond 3 the prompt bloats without value. */
export const INTEL_CONTEXT_MAX_PER_METRIC = 3

export interface IntelDataObservation {
  metric: string
  datetime: string // ISO
  value: number
  unit?: string
}

export interface IntelContextSnapshot {
  /** FX rate observations — typically AZN_USD / AZN_EUR / AZN_RUB / AZN_TRY. */
  fx: IntelDataObservation[]
  /** CPI YoY observations — typically AZ_CPI_YOY / RU_CPI_YOY / etc. */
  cpi: IntelDataObservation[]
  /** Commodity prices — typically BRENT_USD_BBL / GOLD_USD_OZ. */
  commodities: IntelDataObservation[]
  /** Stable hash of the snapshot's load-bearing fields. Used by the
   *  explainer-cache snapshotHash so fresh intel invalidates cached
   *  explanations automatically. */
  signature: string
  /** Was the snapshot built from real data, or did we find none? Empty=true
   *  signals the explainer to omit the intel block entirely (avoids
   *  prompting "FX context: (none)" noise). */
  empty: boolean
}

/** Source-code → snapshot bucket mapping. Keep in sync with
 *  `src/lib/intel/commodity/{tcmb-fx,worldbank-cpi,commodities-rss}.ts` */
const SOURCE_TO_BUCKET: Record<string, "fx" | "cpi" | "commodities"> = {
  "tcmb-fx-rates": "fx",
  "worldbank-cpi": "cpi",
  "commodities-rss": "commodities",
}

import { createHash } from "node:crypto"

/** Deterministic signature over the snapshot's data points (excludes raw,
 *  excludes datetime millisecond noise). Used by explainer-cache.snapshotHash. */
export function computeSignature(snapshot: Omit<IntelContextSnapshot, "signature">): string {
  const flat = [...snapshot.fx, ...snapshot.cpi, ...snapshot.commodities]
    .map((o) => `${o.metric}@${o.datetime}=${o.value}`)
    .sort()
  return createHash("sha256").update(flat.join("|")).digest("hex").slice(0, 16)
}

/** Filter + group raw data points into snapshot buckets, capping per-metric. */
export function bucketizeDataPoints(
  rows: Array<Pick<CommodityDataPoint, "sourceCode" | "metric" | "datetime" | "value" | "unit">>,
  now: Date = new Date(),
): IntelContextSnapshot {
  const cutoff = now.getTime() - INTEL_CONTEXT_WINDOW_MS
  const buckets: Record<"fx" | "cpi" | "commodities", IntelDataObservation[]> = {
    fx: [],
    cpi: [],
    commodities: [],
  }
  // Group by metric → latest-N
  const byMetric = new Map<string, typeof rows>()
  for (const r of rows) {
    if (r.datetime.getTime() < cutoff) continue
    const bucket = SOURCE_TO_BUCKET[r.sourceCode]
    if (!bucket) continue
    if (!byMetric.has(r.metric)) byMetric.set(r.metric, [])
    byMetric.get(r.metric)!.push(r)
  }
  // Sort latest first per metric, take INTEL_CONTEXT_MAX_PER_METRIC
  for (const [metric, points] of byMetric.entries()) {
    points.sort((a, b) => b.datetime.getTime() - a.datetime.getTime())
    const latest = points.slice(0, INTEL_CONTEXT_MAX_PER_METRIC)
    const bucket = SOURCE_TO_BUCKET[latest[0].sourceCode]
    for (const p of latest) {
      buckets[bucket].push({
        metric,
        datetime: p.datetime.toISOString(),
        value: p.value,
        unit: p.unit,
      })
    }
  }
  // Sort each bucket by metric for deterministic output
  for (const k of Object.keys(buckets) as Array<keyof typeof buckets>) {
    buckets[k].sort((a, b) =>
      a.metric === b.metric ? b.datetime.localeCompare(a.datetime) : a.metric.localeCompare(b.metric),
    )
  }
  const empty = buckets.fx.length === 0 && buckets.cpi.length === 0 && buckets.commodities.length === 0
  const partial: Omit<IntelContextSnapshot, "signature"> = { ...buckets, empty }
  return { ...partial, signature: computeSignature(partial) }
}

export interface BuildIntelContextOptions {
  /** Override the time window. Default = INTEL_CONTEXT_WINDOW_MS. */
  windowMs?: number
  /** Override "now" for deterministic tests. */
  now?: Date
  /** Test seam — inject Prisma. Default = real prisma. */
  prisma?: typeof defaultPrisma
}

/**
 * Build an `IntelContextSnapshot` for an org. Reads from Prisma
 * `IntelDataPoint` (post-migrate) or in-memory store (pre-migrate, via
 * the same `tryPrismaThenFallback` pattern used by ingest).
 */
export async function buildIntelContext(
  orgId: string,
  opts: BuildIntelContextOptions = {},
): Promise<IntelContextSnapshot> {
  const now = opts.now ?? new Date()
  const windowMs = opts.windowMs ?? INTEL_CONTEXT_WINDOW_MS
  const cutoff = new Date(now.getTime() - windowMs)
  const prisma = opts.prisma ?? defaultPrisma

  const rows = await tryPrismaThenFallback<
    Array<Pick<CommodityDataPoint, "sourceCode" | "metric" | "datetime" | "value" | "unit">>
  >(
    async () => {
      const r = await prisma.intelDataPoint.findMany({
        where: { organizationId: orgId, datetime: { gte: cutoff } },
        select: { sourceCode: true, metric: true, datetime: true, value: true, unit: true },
        orderBy: { datetime: "desc" },
      })
      return r.map((row: { sourceCode: string; metric: string; datetime: Date; value: number; unit: string | null }) => ({
        sourceCode: row.sourceCode,
        metric: row.metric,
        datetime: row.datetime,
        value: row.value,
        unit: row.unit ?? undefined,
      }))
    },
    () => {
      // In-memory fallback — read all sources for org, pre-filter by cutoff
      // (bucketize also enforces 60-day window; explicit pre-filter here so
      // a custom windowMs is respected before bucketize's broader window).
      return getInMemoryDataPoints(orgId)
        .filter((p) => p.datetime.getTime() >= cutoff.getTime())
        .map((p) => ({
          sourceCode: p.sourceCode,
          metric: p.metric,
          datetime: p.datetime,
          value: p.value,
          unit: p.unit,
        }))
    },
  )

  // Bucketize uses its own 60-day default; pre-filter above already enforced
  // the (potentially tighter) custom window.
  return bucketizeDataPoints(rows, now)
}

/** Format a snapshot for inclusion in the variance-explainer prompt.
 *  Returns null when snapshot is empty (caller omits the intel block). */
export function formatIntelContextForPrompt(snapshot: IntelContextSnapshot): string | null {
  if (snapshot.empty) return null
  const lines: string[] = []
  if (snapshot.fx.length > 0) {
    lines.push("FX rates (most recent first):")
    for (const o of snapshot.fx) {
      lines.push(`  ${o.metric} = ${o.value} ${o.unit ?? ""} (${o.datetime.slice(0, 10)})`)
    }
  }
  if (snapshot.cpi.length > 0) {
    lines.push("CPI YoY (regional):")
    for (const o of snapshot.cpi) {
      lines.push(`  ${o.metric} = ${o.value}${o.unit ?? "%"} (${o.datetime.slice(0, 10)})`)
    }
  }
  if (snapshot.commodities.length > 0) {
    lines.push("Commodity spot prices:")
    for (const o of snapshot.commodities) {
      lines.push(`  ${o.metric} = ${o.value} ${o.unit ?? ""} (${o.datetime.slice(0, 10)})`)
    }
  }
  return lines.join("\n")
}
