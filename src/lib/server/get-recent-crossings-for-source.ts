/**
 * Phase 7.L — Server-side reader for recent crossings per source.
 *
 * Used by the admin Data Sources page widget. Aggregates recent
 * `FeedImpactForecast` rows by (ruleId × observedAt) and counts how
 * many companies were affected by each crossing event.
 */
import type { PrismaClient } from "@prisma/client"

export interface RecentCrossingSummary {
  ruleId: string
  triggerMetric: string
  /** Latest observed value rounded to the same bucket as the cache key. */
  triggerValueRounded: number
  /** ISO date of the trigger observation. */
  triggerObservedAt: string
  /** ISO date of the latest forecast generation in this crossing event. */
  latestGeneratedAt: string
  /** Number of distinct affected company codes. */
  affectedCompanyCount: number
}

export async function getRecentCrossingsForSource(
  prisma: Pick<PrismaClient, "feedImpactForecast">,
  organizationId: string,
  sourceCode: string,
  limit = 5,
): Promise<RecentCrossingSummary[]> {
  // We need: most-recent generatedAt per (ruleId, triggerObservedAt)
  // tuple, plus a count of distinct affected companies. Use a raw
  // findMany then aggregate in-process — the row volume is small
  // (typically <100 per source per month).
  const rows = await prisma.feedImpactForecast.findMany({
    where: { organizationId, triggerSourceCode: sourceCode },
    select: {
      ruleId: true,
      triggerMetric: true,
      triggerValueRounded: true,
      triggerObservedAt: true,
      affectedCompanyCode: true,
      generatedAt: true,
    },
    orderBy: { generatedAt: "desc" },
    take: 500, // bound — admin demo, not analytics workload
  })

  // Group by (ruleId + triggerObservedAt ISO).
  const grouped = new Map<
    string,
    {
      ruleId: string
      triggerMetric: string
      triggerValueRounded: number
      triggerObservedAt: Date
      latestGeneratedAt: Date
      companies: Set<string>
    }
  >()
  for (const r of rows) {
    const key = `${r.ruleId}|${r.triggerObservedAt.toISOString()}`
    const existing = grouped.get(key)
    if (existing) {
      existing.companies.add(r.affectedCompanyCode)
      if (r.generatedAt.getTime() > existing.latestGeneratedAt.getTime()) {
        existing.latestGeneratedAt = r.generatedAt
      }
    } else {
      grouped.set(key, {
        ruleId: r.ruleId,
        triggerMetric: r.triggerMetric,
        triggerValueRounded: r.triggerValueRounded,
        triggerObservedAt: r.triggerObservedAt,
        latestGeneratedAt: r.generatedAt,
        companies: new Set([r.affectedCompanyCode]),
      })
    }
  }
  const summaries: RecentCrossingSummary[] = []
  for (const v of grouped.values()) {
    summaries.push({
      ruleId: v.ruleId,
      triggerMetric: v.triggerMetric,
      triggerValueRounded: v.triggerValueRounded,
      triggerObservedAt: v.triggerObservedAt.toISOString(),
      latestGeneratedAt: v.latestGeneratedAt.toISOString(),
      affectedCompanyCount: v.companies.size,
    })
  }
  summaries.sort(
    (a, b) =>
      new Date(b.latestGeneratedAt).getTime() -
      new Date(a.latestGeneratedAt).getTime(),
  )
  return summaries.slice(0, limit)
}
