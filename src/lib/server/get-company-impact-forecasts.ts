/**
 * Phase 7.L — Server-side reader for FeedImpactForecast rows.
 *
 * Returns the N most-recent forecasts for one company. Used by:
 *   - Risk Terminal Panel 4 (CompanySnapshot) → 3 most recent
 *   - Admin Data Sources widget → top-5 per source (different helper)
 */
import type { PrismaClient } from "@prisma/client"
import type {
  ImpactForecastOutput,
} from "@/lib/risk/impact-forecast"

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
}

export async function getCompanyImpactForecasts(
  prisma: Pick<PrismaClient, "feedImpactForecast">,
  organizationId: string,
  companyCode: string,
  limit = 3,
): Promise<CompanyImpactForecastRow[]> {
  const rows = await prisma.feedImpactForecast.findMany({
    where: {
      organizationId,
      affectedCompanyCode: companyCode,
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
  return rows.map((r) => ({
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
  }))
}
