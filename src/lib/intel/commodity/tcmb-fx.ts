/**
 * Phase 7.G Turn LXXXXV (Phase 7.E #1 D.5b) — TCMB FX adapter.
 *
 * Pulls latest FX rates for AZN base + USD/EUR/RUB/TRY quote pairs.
 * Source: exchangerate.host (free, unauthenticated, ECB-anchored). Switching
 * to TCMB EVDS (requires API key registration) is a 1-file swap when /
 * if a paid tier becomes warranted.
 *
 * **Why these pairs:** holding companies invoice in USD (CIF imports +
 * exports), report in AZN, hold inventory liabilities in RUB/TRY for
 * Russian/Turkish suppliers. Daily FX swing affects landed cost variance
 * on every COGS row in the variance explainer pipeline (#2 E.1b
 * intel-context fusion target).
 *
 * **Update cadence:** daily — the API publishes one rate per UTC day
 * (00:00). Adapter writes 1 data point per (metric, today). Idempotent
 * via Prisma `(orgId, sourceCode, metric, datetime)` unique constraint.
 *
 * **No-key + no-auth:** exchangerate.host is publicly callable. No env
 * var required. Production-safety: rate-limit the upstream by running
 * adapter once per day via the existing intel scheduler (D.5a).
 */

import type {
  CommodityAdapter,
  CommodityAdapterOptions,
  CommodityFetchResult,
  CommodityDataPoint,
} from "./types"

const TCMB_SOURCE = "tcmb-fx-rates"
const TCMB_LABEL = "TCMB / ECB FX Rates (AZN base)"
const TCMB_BASE = "AZN"
/** Quote currencies the adapter pulls per run. Order matters for forensics
 *  (data points are emitted in this order). */
const TCMB_QUOTE_PAIRS = ["USD", "EUR", "RUB", "TRY"] as const

/** exchangerate.host endpoint — public + free. Returns:
 *    {"success":true, "base":"AZN", "date":"2026-05-10",
 *     "rates":{"USD":0.5882, "EUR":0.5421, ...}}
 *  Spec: https://exchangerate.host/#/#docs */
const TCMB_API_URL = "https://api.exchangerate.host/latest"

interface TCMBResponse {
  success?: boolean
  base?: string
  date?: string
  rates?: Record<string, number>
}

/** Build the data points from a parsed response. Pure helper so tests can
 *  feed it canned JSON without HTTP. */
export function tcmbResponseToDataPoints(
  response: TCMBResponse,
  now: Date = new Date(),
): CommodityDataPoint[] {
  if (!response.rates || typeof response.rates !== "object") return []
  // Normalize datetime to today UTC midnight (idempotency anchor).
  const datetime = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  )
  const points: CommodityDataPoint[] = []
  for (const quote of TCMB_QUOTE_PAIRS) {
    const rate = response.rates[quote]
    if (typeof rate !== "number" || !Number.isFinite(rate)) continue
    points.push({
      sourceCode: TCMB_SOURCE,
      metric: `${TCMB_BASE}_${quote}`,
      datetime,
      value: rate,
      unit: `${quote}/${TCMB_BASE}`,
      raw: { date: response.date, rate },
    })
  }
  return points
}

export function createTCMBAdapter(opts: CommodityAdapterOptions = {}): CommodityAdapter {
  const fetchImpl = opts.fetchImpl ?? fetch
  return {
    source: TCMB_SOURCE,
    label: TCMB_LABEL,
    async fetch(now: Date = new Date()): Promise<CommodityFetchResult> {
      const url = `${TCMB_API_URL}?base=${TCMB_BASE}&symbols=${TCMB_QUOTE_PAIRS.join(",")}`
      const errors: string[] = []
      let response: Response
      try {
        response = await fetchImpl(url)
      } catch (e) {
        return {
          source: TCMB_SOURCE,
          dataPoints: [],
          errors: [`fetch failed: ${e instanceof Error ? e.message : String(e)}`],
          fetched: false,
        }
      }
      if (!response.ok) {
        return {
          source: TCMB_SOURCE,
          dataPoints: [],
          errors: [`HTTP ${response.status} from ${url}`],
          fetched: true,
        }
      }
      let parsed: TCMBResponse
      try {
        parsed = (await response.json()) as TCMBResponse
      } catch (e) {
        return {
          source: TCMB_SOURCE,
          dataPoints: [],
          errors: [`JSON parse failed: ${e instanceof Error ? e.message : String(e)}`],
          fetched: true,
        }
      }
      const dataPoints = tcmbResponseToDataPoints(parsed, now)
      if (dataPoints.length === 0) {
        errors.push(
          `Response had no usable rates (got: ${JSON.stringify(parsed.rates ?? null).slice(0, 100)})`,
        )
      }
      return { source: TCMB_SOURCE, dataPoints, errors, fetched: true }
    },
  }
}

export const TCMB_FX_SOURCE = TCMB_SOURCE
