/**
 * Phase 7.L — Crossing scan orchestrator.
 *
 * Runs on the scheduler tick (post-commodity-ingest). Pipeline:
 *   1. Pull recent IntelDataPoint rows (last 30 days) per org
 *   2. Build CrossingContext → evaluateCrossingRules() → matches
 *   3. Per match → resolveAffectedIndustries → findAffectedCompanies
 *   4. Per company → getCompanyFinancialsSnapshot → getOrCreateImpactForecast
 *   5. Aggregate counts; return summary
 *
 * Cost guards:
 *   - MAX_FORECASTS_PER_CYCLE = 20 (prevents runaway LLM burn)
 *   - Concurrency cap = 3 (serial-ish processing to bound rate-limit exposure)
 *   - Cache hit shortcuts via getOrCreateImpactForecast (7d TTL)
 *
 * Failure mode: per-company errors are isolated — one LLM failure
 * does NOT abort the run. Returned `errors[]` carries the per-step
 * details for audit.
 */
import type { PrismaClient } from "@prisma/client"
import {
  evaluateCrossingRules,
  type CrossingContext,
  type CrossingDataPoint,
  type CrossingMatch,
} from "./crossing-rules"
import { DEFAULT_CROSSING_RULES } from "./crossing-rules-default-pack"
import {
  resolveAffectedIndustries,
  findAffectedCompanies,
} from "@/lib/risk/commodity-sector-map"
import { getCompanyFinancialsSnapshot } from "@/lib/risk/company-financials-snapshot"
import {
  getOrCreateImpactForecast,
} from "@/lib/risk/impact-forecast-cache"
import type { ImpactForecastLanguage } from "@/lib/risk/impact-forecast"

const MAX_FORECASTS_PER_CYCLE = 20
/**
 * Days of IntelDataPoint history to load into the crossing context.
 * Calibrated for the slowest-cadence feeds we have:
 *   - FAO Food Price Index → monthly (datetime stamped at 1st-of-month)
 *   - AZ CPI → monthly
 *   - UN Comtrade → annual
 *   - WB Indicators → annual
 * 90 days covers ~3 monthly points so 7-day-shift rules have enough
 * lookback AND monthly feeds aren't filtered out for being "stale"
 * (datetime is the OBSERVATION date, not the fetch date). Annual
 * feeds will only have the latest point in window which is fine for
 * threshold rules.
 */
const RECENT_DAYS = 90
const DEFAULT_LANGUAGE: ImpactForecastLanguage = "en"

export interface RunCrossingScanResult {
  ok: boolean
  matchesFound: number
  forecastsAttempted: number
  forecastsGenerated: number
  cacheHits: number
  skippedNoFinancials: number
  skippedBudget: number
  errors: string[]
}

export interface RunCrossingScanOptions {
  prisma: PrismaClient
  now?: () => Date
  /** Language for generated forecasts (default: en). */
  language?: ImpactForecastLanguage
  /** Override `MAX_FORECASTS_PER_CYCLE`. */
  maxForecasts?: number
}

const EMPTY_RESULT: RunCrossingScanResult = {
  ok: true,
  matchesFound: 0,
  forecastsAttempted: 0,
  forecastsGenerated: 0,
  cacheHits: 0,
  skippedNoFinancials: 0,
  skippedBudget: 0,
  errors: [],
}

export async function runCrossingScan(
  organizationId: string,
  opts: RunCrossingScanOptions,
): Promise<RunCrossingScanResult> {
  const { prisma } = opts
  const now = opts.now ?? (() => new Date())
  const language = opts.language ?? DEFAULT_LANGUAGE
  const maxForecasts = opts.maxForecasts ?? MAX_FORECASTS_PER_CYCLE

  const result: RunCrossingScanResult = { ...EMPTY_RESULT, errors: [] }

  // 1. Recent IntelDataPoint rows (last 30d).
  const cutoff = new Date(now().getTime() - RECENT_DAYS * 24 * 60 * 60_000)
  const dataPoints = await prisma.intelDataPoint.findMany({
    where: {
      organizationId,
      datetime: { gte: cutoff },
    },
    select: {
      sourceCode: true,
      metric: true,
      datetime: true,
      value: true,
    },
    orderBy: { datetime: "desc" },
    take: 2000,
  })
  if (dataPoints.length === 0) return result

  const points: CrossingDataPoint[] = dataPoints.map((r) => ({
    sourceCode: r.sourceCode,
    metric: r.metric,
    datetime: r.datetime,
    value: r.value,
  }))

  // 2. Evaluate rules.
  const ctx: CrossingContext = { organizationId, points }
  const matches = evaluateCrossingRules(DEFAULT_CROSSING_RULES, ctx)
  result.matchesFound = matches.length
  if (matches.length === 0) return result

  // 3-4-5. For each match, find affected companies, snapshot financials,
  // call cached forecaster. Stop early at budget cap.
  for (const match of matches) {
    if (result.forecastsAttempted >= maxForecasts) {
      result.skippedBudget = matches.length - result.forecastsAttempted
      break
    }
    try {
      await processOneMatch(match, organizationId, language, opts, result, maxForecasts)
    } catch (e) {
      result.errors.push(
        `match-${match.ruleId}: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }

  return result
}

async function processOneMatch(
  match: CrossingMatch,
  organizationId: string,
  language: ImpactForecastLanguage,
  opts: RunCrossingScanOptions,
  result: RunCrossingScanResult,
  maxForecasts: number,
): Promise<void> {
  const { prisma } = opts
  const { industries, sensitivity, rationale } = resolveAffectedIndustries(
    match.metric,
  )
  if (industries.length === 0) return

  const companies = await findAffectedCompanies(
    prisma,
    organizationId,
    match.metric,
  )
  if (companies.length === 0) return

  // Use current year for budget snapshot lookup. Could be parameterised
  // for backfills if needed.
  const year = (opts.now ?? (() => new Date()))().getUTCFullYear()

  for (const co of companies) {
    if (result.forecastsAttempted >= maxForecasts) {
      result.skippedBudget += companies.length - companies.indexOf(co)
      break
    }
    result.forecastsAttempted++

    // Skip macro placeholders — they have no financials to anchor on.
    // The plan calls for "low confidence + zero P&L" rows but we save
    // tokens by skipping entirely. Surfacing placeholder limitation
    // happens via the empty Panel 4 state, not a token-burning LLM call.
    if (co.code.startsWith("DEMO-")) {
      result.skippedNoFinancials++
      continue
    }

    try {
      const financials = await getCompanyFinancialsSnapshot(
        prisma,
        co.id,
        year,
      )
      if (financials.revenueAZN == null) {
        result.skippedNoFinancials++
        continue
      }

      const forecastResult = await getOrCreateImpactForecast(
        {
          trigger: {
            sourceCode: match.sourceCode,
            metric: match.metric,
            value: match.triggerValue,
            baseline: match.baselineValue,
            deltaPct: match.deltaPct,
            observedAt: match.observedAt.toISOString(),
            rationale,
          },
          company: {
            code: co.code,
            name: co.name,
            industry: co.industry,
          },
          companyFinancials: financials,
          knownCostStructure: null, // v1 — industry defaults only
          sectorSensitivity: sensitivity,
          language,
        },
        {
          orgId: organizationId,
          ruleId: match.ruleId,
          affectedCompanyId: co.id,
        },
      )
      if (forecastResult.cacheHit) result.cacheHits++
      else result.forecastsGenerated++
    } catch (e) {
      result.errors.push(
        `forecast ${co.code} × ${match.metric}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      )
    }
  }
}
