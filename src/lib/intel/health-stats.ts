/**
 * Phase 7.G Turn LXXXXIII (Phase 7.E #1 D.5d) — intel crawl health stats.
 *
 * Pure helpers for aggregating IntelItem rows into the admin
 * `/admin/intel-health` dashboard view. No Prisma dependency — caller
 * fetches rows + scheduling metadata, passes to these helpers.
 *
 * **Why pure:** keeps the page server-component-friendly + testable
 * without DB. The page can pass the Prisma query result directly; the
 * `IntelHealthStats` type encodes everything the UI needs.
 */

export type IntelHealthRowInput = {
  fetchedAt: Date
  sourceLabel: string
  industryTags: string[]
  relevanceScore: number
}

export type SourceCount = {
  source: string
  count: number
}

export type IndustryCount = {
  industry: string
  count: number
}

export type DailyCount = {
  date: string // YYYY-MM-DD UTC
  count: number
}

export type IntelHealthStats = {
  totalItems: number
  /** Most recent fetchedAt across all rows (null if no rows). */
  latestFetchedAt: Date | null
  /** Org's `settings.intelLastRunAt` ISO string (null if never run). */
  intelLastRunAt: string | null
  /** Org's `settings.intelLanguage` (en/ru/az) — null if unset. */
  intelLanguage: string | null
  /** Average relevance score across all rows (NaN if zero rows). */
  averageRelevance: number
  /** Sources with > 0 items, sorted by count desc, top 10. */
  topSources: SourceCount[]
  /** Industries with > 0 items, sorted by count desc, top 10. */
  topIndustries: IndustryCount[]
  /** Per-day item count for the last 7 days (UTC). Includes zero-count
   *  days for spark-line continuity. Oldest first. */
  last7Days: DailyCount[]
  /** Health status derived from intelLastRunAt + total items.
   *  - "healthy": last run < 25h ago AND total items > 0
   *  - "stale": last run > 25h ago OR no last run
   *  - "empty": last run < 25h ago BUT 0 total items (sources returned nothing) */
  status: "healthy" | "stale" | "empty"
}

const TOP_N = 10
const STALE_THRESHOLD_MS = 25 * 60 * 60 * 1000 // 25h gives 1h grace beyond 24h schedule

/** Build per-source counts (top N descending). */
function topSourcesFrom(rows: IntelHealthRowInput[]): SourceCount[] {
  const counts = new Map<string, number>()
  for (const r of rows) {
    counts.set(r.sourceLabel, (counts.get(r.sourceLabel) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_N)
}

/** Build per-industry counts (top N descending). One IntelItem can have
 *  multiple industry tags → counted in each. */
function topIndustriesFrom(rows: IntelHealthRowInput[]): IndustryCount[] {
  const counts = new Map<string, number>()
  for (const r of rows) {
    for (const ind of r.industryTags) {
      counts.set(ind, (counts.get(ind) ?? 0) + 1)
    }
  }
  return Array.from(counts.entries())
    .map(([industry, count]) => ({ industry, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_N)
}

/** Last-N-days count series (UTC bins). Oldest first. */
function last7DaysFrom(rows: IntelHealthRowInput[], now: Date = new Date()): DailyCount[] {
  // Build all 7 day buckets (oldest → newest), seeded zero
  const bins = new Map<string, number>()
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i))
    bins.set(d.toISOString().slice(0, 10), 0)
  }
  const cutoff = now.getTime() - 7 * 24 * 60 * 60 * 1000
  for (const r of rows) {
    if (r.fetchedAt.getTime() < cutoff) continue
    const dayKey = r.fetchedAt.toISOString().slice(0, 10)
    if (bins.has(dayKey)) {
      bins.set(dayKey, (bins.get(dayKey) ?? 0) + 1)
    }
  }
  return Array.from(bins.entries()).map(([date, count]) => ({ date, count }))
}

/** Latest fetchedAt across all rows. */
function latestFetchedAt(rows: IntelHealthRowInput[]): Date | null {
  let max: Date | null = null
  for (const r of rows) {
    if (max === null || r.fetchedAt > max) max = r.fetchedAt
  }
  return max
}

/** Average relevance across all rows. NaN if zero rows. */
function averageRelevance(rows: IntelHealthRowInput[]): number {
  if (rows.length === 0) return NaN
  const sum = rows.reduce((s, r) => s + r.relevanceScore, 0)
  return sum / rows.length
}

/** Health status derived from last-run + total items. */
function deriveStatus(
  intelLastRunAt: string | null,
  totalItems: number,
  now: Date = new Date(),
): "healthy" | "stale" | "empty" {
  if (!intelLastRunAt) return "stale"
  const lastRun = new Date(intelLastRunAt).getTime()
  const elapsed = now.getTime() - lastRun
  if (elapsed > STALE_THRESHOLD_MS) return "stale"
  if (totalItems === 0) return "empty"
  return "healthy"
}

/** Compute the full health stats for a given set of items + org metadata. */
export function computeIntelHealthStats(
  rows: IntelHealthRowInput[],
  meta: { intelLastRunAt: string | null; intelLanguage: string | null },
  now: Date = new Date(),
): IntelHealthStats {
  return {
    totalItems: rows.length,
    latestFetchedAt: latestFetchedAt(rows),
    intelLastRunAt: meta.intelLastRunAt,
    intelLanguage: meta.intelLanguage,
    averageRelevance: averageRelevance(rows),
    topSources: topSourcesFrom(rows),
    topIndustries: topIndustriesFrom(rows),
    last7Days: last7DaysFrom(rows, now),
    status: deriveStatus(meta.intelLastRunAt, rows.length, now),
  }
}
