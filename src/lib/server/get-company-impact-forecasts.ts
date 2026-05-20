/**
 * Phase 7.L — Server-side reader for FeedImpactForecast rows.
 *
 * Returns the N most-recent forecasts for one company. Used by:
 *   - Risk Terminal Panel 4 (CompanySnapshot) → 3 most recent
 *   - Admin Data Sources widget → top-5 per source (different helper)
 *
 * Phase 7.L 2026-05-18 — each row is enriched with up to 3 related
 * `IntelItem` news articles that match the affected company's industry
 * (tag overlap) and were published within the last 30 days. This
 * restores the clickable news-citation experience users had with the
 * older intel feed surface — and duplicates the vendor source link so
 * admins can audit a forecast without leaving the terminal.
 *
 * Window is relative to NOW (not to triggerObservedAt) because slow-
 * moving monthly feeds (FAO, AZ CPI) can have an observation date a
 * month back while sector-relevant news still continues to surface.
 * The forecast remains current; news should remain current too.
 */
import type { PrismaClient } from "@prisma/client"
import type {
  ImpactForecastOutput,
} from "@/lib/risk/impact-forecast"

export interface ImpactForecastRelatedNews {
  id: string
  title: string
  url: string
  sourceLabel: string
  publishedAt: string | null
  relevanceScore: number
}

export interface CompanyImpactForecastRow {
  id: string
  triggerSourceCode: string
  triggerMetric: string
  triggerValueRounded: number
  triggerObservedAt: string // ISO
  ruleId: string
  scenarios: ImpactForecastOutput["scenarios"]
  recommendations: ImpactForecastOutput["recommendations"]
  confidence: ImpactForecastOutput["confidence"]
  language: string
  generatedAt: string // ISO
  relatedNews: ImpactForecastRelatedNews[]
}

const RELATED_NEWS_PER_FORECAST = 3
const RELATED_NEWS_WINDOW_DAYS = 30

export async function getCompanyImpactForecasts(
  prisma: Pick<PrismaClient, "feedImpactForecast" | "company" | "intelItem">,
  organizationId: string,
  companyCode: string,
  limit = 3,
  language?: "en" | "ru" | "az",
): Promise<CompanyImpactForecastRow[]> {
  const rows = await prisma.feedImpactForecast.findMany({
    where: {
      organizationId,
      affectedCompanyCode: companyCode,
      ...(language ? { language } : {}),
    },
    orderBy: { generatedAt: "desc" },
    take: limit,
    select: {
      id: true,
      triggerSourceCode: true,
      triggerMetric: true,
      triggerValueRounded: true,
      triggerObservedAt: true,
      ruleId: true,
      scenarios: true,
      recommendations: true,
      confidence: true,
      language: true,
      generatedAt: true,
    },
  })

  if (rows.length === 0) return []

  // Resolve the affected company's industry so we can tag-match against
  // intel_items.industryTags. If the company is missing or has no industry,
  // we skip the join and return empty `relatedNews`.
  const company = await prisma.company.findFirst({
    where: { organizationId, code: companyCode },
    select: { industry: true },
  })
  const industry = company?.industry ?? null

  // Fetch the top-N sector-relevant news once. The same shortlist is
  // attached to every forecast row in this batch — that's intentional:
  // when a user is looking at 3 stacked forecasts for the same company,
  // they expect to see the same set of "what's happening in this
  // sector right now" articles below each card, not three disjoint
  // mini-feeds.
  const cutoff = new Date(
    Date.now() - RELATED_NEWS_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  )
  const candidateNews = industry
    ? await prisma.intelItem.findMany({
        where: {
          organizationId,
          industryTags: { has: industry },
          OR: [
            { publishedAt: { gte: cutoff } },
            { publishedAt: null, fetchedAt: { gte: cutoff } },
          ],
        },
        orderBy: [
          { relevanceScore: "desc" },
          { publishedAt: "desc" },
        ],
        take: RELATED_NEWS_PER_FORECAST,
        select: {
          id: true,
          title: true,
          url: true,
          sourceLabel: true,
          publishedAt: true,
          fetchedAt: true,
          relevanceScore: true,
        },
      })
    : []

  const sharedRelatedNews: ImpactForecastRelatedNews[] = candidateNews.map(
    (n) => ({
      id: n.id,
      title: n.title,
      url: n.url,
      sourceLabel: n.sourceLabel,
      publishedAt: (n.publishedAt ?? n.fetchedAt).toISOString(),
      relevanceScore: n.relevanceScore,
    }),
  )

  return rows.map((r) => {
    const relatedNews = sharedRelatedNews

    return {
      id: r.id,
      triggerSourceCode: r.triggerSourceCode,
      triggerMetric: r.triggerMetric,
      triggerValueRounded: r.triggerValueRounded,
      triggerObservedAt: r.triggerObservedAt.toISOString(),
      ruleId: r.ruleId,
      scenarios: r.scenarios as unknown as ImpactForecastOutput["scenarios"],
      recommendations:
        r.recommendations as unknown as ImpactForecastOutput["recommendations"],
      confidence: r.confidence as ImpactForecastOutput["confidence"],
      language: r.language,
      generatedAt: r.generatedAt.toISOString(),
      relatedNews,
    }
  })
}
