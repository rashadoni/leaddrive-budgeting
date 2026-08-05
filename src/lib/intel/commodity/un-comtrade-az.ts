/**
 * Phase 7.K — UN Comtrade adapter (AZ trade flows).
 *
 * **Sector served**: services (cross-border-services-adjacent),
 * logistics (import/export volume drives freight demand), retail
 * (imports influence inventory mix), industrial (export demand).
 *
 * UN Comtrade focuses on **goods** trade (services trade is in UN
 * STS, a separate dataset). Goods trade is the most consistent
 * cross-country dataset and serves as the macro signal for the
 * downstream sectors.
 *
 * **Source**: UN Comtrade v1 public preview endpoint
 *   https://comtradeapi.un.org/public/v1/preview/C/A/HS
 * Free, no key required for low-volume (≤100/hr) "preview" tier.
 *
 * **Reporter**: AZ country code = 031.
 * **Period**: annual (latest 2 years), so we always have a
 * year-over-year comparison.
 *
 * **Metrics emitted**:
 *   AZ_GOODS_EXPORTS_USD   — total exports value (annual)
 *   AZ_GOODS_IMPORTS_USD   — total imports value (annual)
 *   AZ_TRADE_BALANCE_USD   — exports minus imports (derived)
 *
 * Anchored to UTC 1st-of-January for the reported year.
 *
 * **Cadence**: monthly polling (Comtrade revises ~quarterly with a lag
 * of 2-3 months). Idempotent via the unique constraint.
 */

import { fetchWithRateLimitRetry } from "./outbound-agent"
import type {
  CommodityAdapter,
  CommodityAdapterOptions,
  CommodityDataPoint,
  CommodityFetchResult,
} from "./types"

const COMTRADE_SOURCE = "un-comtrade-az"
const COMTRADE_LABEL = "UN Comtrade — Azerbaijan trade flows"
const COMTRADE_BASE = "https://comtradeapi.un.org/public/v1/preview/C/A/HS"

/** AZ reporter code in UN M49 country list. */
const AZ_REPORTER = "031"

interface ComtradeRow {
  period?: number | string
  flowCode?: string | number
  flowDesc?: string
  primaryValue?: number
  partnerCode?: number | string
  cmdCode?: string
}

interface ComtradeResponse {
  data?: ComtradeRow[]
  count?: number
}

/**
 * Build the Comtrade URL for AZ totals, last 2 reported years.
 * Pure helper for testability.
 */
export function buildComtradeUrl(now: Date = new Date()): string {
  const year = now.getUTCFullYear()
  // Comtrade lags 2-3 months; we ask for last 2 years to maximize
  // the chance of getting at least one populated row.
  const periods = [year - 1, year - 2].join(",")
  const params = new URLSearchParams({
    reporterCode: AZ_REPORTER,
    period: periods,
    partnerCode: "0", // 0 = World
    motCode: "0", // 0 = All modes of transport
    customsCode: "C00", // C00 = All
    flowCode: "M,X", // M = imports, X = exports
    cmdCode: "TOTAL", // TOTAL = all commodities
    format: "JSON",
  })
  return `${COMTRADE_BASE}?${params.toString()}`
}

/**
 * Convert Comtrade payload → 3 normalized data points (exports +
 * imports + balance) for the most recent year whose data passes
 * plausibility checks. Pure helper for testability.
 *
 * Plausibility checks (Phase 7.L 2026-05-18 — added after the
 * 2025 partial-year crash where exports came back at $1.18B and
 * imports at $24.4B, yielding a -$23B "balance" that broadcast
 * across the holding's services entities and dominated the
 * Top-3 Worst panel):
 *
 *   1. Both legs must be ≥ MIN_LEG_USD (defaults to $5B). AZ
 *      total trade is ~$30-45B p.a.; either leg below $5B means
 *      the source has only published a fragment of the year.
 *   2. Exports/imports ratio must fall in [0.4, 4.0]. AZ has run
 *      a structural surplus for 20+ years (X > M); a ratio below
 *      0.4 means imports have been over-reported via partner
 *      mirror-stats while exports have not been self-reported.
 *
 * If the most recent year fails either check, we fall back to the
 * next year down (year-1, year-2) until we find one that passes
 * or we run out. This trades freshness for correctness — better
 * to show last year's confirmed surplus than this year's bogus
 * deficit.
 */

/** Minimum plausible value (USD) for either annual flow. AZ
 * trade is ~$30-45B p.a.; partial-year reports often come in
 * under $5B. */
export const COMTRADE_MIN_LEG_USD = 5_000_000_000
/** AZ surplus has run X/M ≈ 1.5-2.5 historically; allow [0.4, 4.0]
 * to tolerate cyclical years without admitting partial reports. */
export const COMTRADE_RATIO_MIN = 0.4
export const COMTRADE_RATIO_MAX = 4.0

export interface ComtradePlausibilityIssue {
  year: number
  reason: string
}

export function isComtradeYearPlausible(
  exportsUsd: number,
  importsUsd: number,
): { ok: boolean; reason?: string } {
  if (exportsUsd < COMTRADE_MIN_LEG_USD) {
    return {
      ok: false,
      reason: `exports $${(exportsUsd / 1e9).toFixed(2)}B below $${COMTRADE_MIN_LEG_USD / 1e9}B minimum (partial-year report?)`,
    }
  }
  if (importsUsd < COMTRADE_MIN_LEG_USD) {
    return {
      ok: false,
      reason: `imports $${(importsUsd / 1e9).toFixed(2)}B below $${COMTRADE_MIN_LEG_USD / 1e9}B minimum`,
    }
  }
  const ratio = exportsUsd / importsUsd
  if (ratio < COMTRADE_RATIO_MIN || ratio > COMTRADE_RATIO_MAX) {
    return {
      ok: false,
      reason: `X/M ratio ${ratio.toFixed(2)} outside plausible [${COMTRADE_RATIO_MIN}, ${COMTRADE_RATIO_MAX}] band — likely asymmetric reporting`,
    }
  }
  return { ok: true }
}

export function comtradeResponseToDataPoints(
  response: ComtradeResponse,
): { dataPoints: CommodityDataPoint[]; skipped: ComtradePlausibilityIssue[] } {
  const rows = response?.data
  if (!Array.isArray(rows) || rows.length === 0) {
    return { dataPoints: [], skipped: [] }
  }

  // Group by year → { exports, imports }
  const byYear = new Map<number, { exports?: number; imports?: number }>()
  for (const row of rows) {
    const year = Number(row.period)
    if (!Number.isFinite(year)) continue
    const value = Number(row.primaryValue)
    if (!Number.isFinite(value)) continue
    const code = String(row.flowCode ?? row.flowDesc ?? "").toUpperCase()
    if (!byYear.has(year)) byYear.set(year, {})
    const bucket = byYear.get(year)!
    if (code === "X" || code === "2" || /EXPORT/.test(code)) bucket.exports = value
    else if (code === "M" || code === "1" || /IMPORT/.test(code)) bucket.imports = value
  }

  // Walk years newest → oldest, skip any that fail plausibility.
  const sortedYears = Array.from(byYear.keys()).sort((a, b) => b - a)
  const skipped: ComtradePlausibilityIssue[] = []
  let chosenYear: number | null = null
  for (const y of sortedYears) {
    const b = byYear.get(y)!
    if (b.exports == null || b.imports == null) {
      skipped.push({ year: y, reason: "one of exports/imports missing" })
      continue
    }
    const check = isComtradeYearPlausible(b.exports, b.imports)
    if (!check.ok) {
      skipped.push({ year: y, reason: check.reason ?? "plausibility failed" })
      continue
    }
    chosenYear = y
    break
  }
  if (chosenYear == null) return { dataPoints: [], skipped }
  const { exports, imports } = byYear.get(chosenYear)!
  const datetime = new Date(Date.UTC(chosenYear, 0, 1))

  return {
    dataPoints: [
      {
        sourceCode: COMTRADE_SOURCE,
        metric: "AZ_GOODS_EXPORTS_USD",
        datetime,
        value: Math.round(exports!),
        unit: "USD",
        raw: { year: chosenYear, flowCode: "X" },
      },
      {
        sourceCode: COMTRADE_SOURCE,
        metric: "AZ_GOODS_IMPORTS_USD",
        datetime,
        value: Math.round(imports!),
        unit: "USD",
        raw: { year: chosenYear, flowCode: "M" },
      },
      {
        sourceCode: COMTRADE_SOURCE,
        metric: "AZ_TRADE_BALANCE_USD",
        datetime,
        value: Math.round(exports! - imports!),
        unit: "USD",
        raw: { year: chosenYear, derived: true },
      },
    ],
    skipped,
  }
}

export function createUnComtradeAzAdapter(
  opts: CommodityAdapterOptions = {},
): CommodityAdapter {
  const fetchImpl = opts.fetchImpl ?? fetch
  return {
    source: COMTRADE_SOURCE,
    label: COMTRADE_LABEL,
    async fetch(now: Date = new Date()): Promise<CommodityFetchResult> {
      const url = buildComtradeUrl(now)
      let response: Response
      try {
        response = await fetchWithRateLimitRetry(fetchImpl, url, opts.sleep)
      } catch (e) {
        return {
          source: COMTRADE_SOURCE,
          dataPoints: [],
          errors: [`fetch failed: ${e instanceof Error ? e.message : String(e)}`],
          fetched: false,
        }
      }
      if (!response.ok) {
        return {
          source: COMTRADE_SOURCE,
          dataPoints: [],
          errors: [`HTTP ${response.status} from Comtrade`],
          fetched: true,
        }
      }
      let parsed: ComtradeResponse
      try {
        parsed = (await response.json()) as ComtradeResponse
      } catch (e) {
        return {
          source: COMTRADE_SOURCE,
          dataPoints: [],
          errors: [`JSON parse failed: ${e instanceof Error ? e.message : String(e)}`],
          fetched: true,
        }
      }
      const { dataPoints, skipped } = comtradeResponseToDataPoints(parsed)
      const errors: string[] = []
      for (const s of skipped) {
        errors.push(`skipped ${s.year}: ${s.reason}`)
      }
      if (dataPoints.length === 0) {
        errors.push(
          "Comtrade returned no year passing plausibility checks (publishing lag is normal — re-check next month)",
        )
      }
      return { source: COMTRADE_SOURCE, dataPoints, errors, fetched: true }
    },
  }
}

export const UN_COMTRADE_AZ_SOURCE = COMTRADE_SOURCE
