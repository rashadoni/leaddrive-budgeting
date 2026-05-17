/**
 * Phase 7.K — Google Trends AZ adapter (stub-pattern).
 *
 * **Why a stub:** Google Trends does NOT offer a free official API.
 * The realistic options are:
 *   1. SerpAPI / ScrapingDog (paid bridges, ~$50/mo)
 *   2. Unofficial trends.google.com/trends/api/explore endpoint
 *      (brittle, XSSI-prefixed JSON, undocumented, may rate-limit)
 *   3. Manual weekly CSV export from trends.google.com (admin uploads)
 *
 * This adapter is **proxy-agnostic**: it expects a JSON-emitting
 * endpoint that follows the SerpAPI Google Trends response shape.
 * Admin wires it via `Organization.settings.apiKeys.gtrends` (Phase 5a).
 * If no proxy is configured, the adapter returns
 * `not_configured` gracefully without throwing.
 *
 * **Sector served**: retail (consumer demand signals), beverage,
 * entertainment.
 *
 * **Expected response shape** (SerpAPI-compatible):
 * ```json
 * {
 *   "interest_over_time": {
 *     "timeline_data": [
 *       { "date": "2026-05-10",
 *         "values": [{ "query": "food", "value": "75", ... }] },
 *       ...
 *     ]
 *   }
 * }
 * ```
 *
 * **Categories**: hardcoded keyword baskets per sector signal.
 * 4 metrics emitted, one per category, with the LATEST weekly value.
 *
 * **Metrics**:
 *   AZ_TREND_FOOD_RETAIL  — "food shopping" / "yemək" / "продукты" basket
 *   AZ_TREND_FASHION      — "fashion" / "moda" / "одежда" basket
 *   AZ_TREND_ELECTRONICS  — "electronics" / "iPhone" / "электроника"
 *   AZ_TREND_TRAVEL       — "travel" / "tour" / "путешествие"
 *
 * **Cadence**: weekly. Anchored to UTC start-of-week (Monday) for
 * idempotency.
 */

import type {
  CommodityAdapter,
  CommodityAdapterOptions,
  CommodityDataPoint,
  CommodityFetchResult,
} from "./types"

const TRENDS_SOURCE = "google-trends-az"
const TRENDS_LABEL = "Google Trends — Azerbaijan (proxy-gated)"

/** Default proxy base. Override via `opts.proxyUrl`. Examples:
 *    "https://serpapi.com/search.json?engine=google_trends&geo=AZ"
 *    "https://api.scrapingdog.com/google_trends?geo=AZ&data_type=TIMESERIES"
 *
 *  ScrapingDog is the current default since SerpAPI requires phone-SMS
 *  verification that fails for VoIP / virtual numbers — ScrapingDog
 *  signs up with email only and offers 1000 free credits/month.
 *
 *  The two proxies share the same JSON response shape
 *  (`interest_over_time.timeline_data[]`) but use DIFFERENT query
 *  parameter names: SerpAPI = `q`, ScrapingDog = `query`. The
 *  buildTrendsUrl helper below auto-detects via hostname and emits
 *  the correct param name. */
const DEFAULT_PROXY_URL = "https://api.scrapingdog.com/google_trends?geo=AZ&data_type=TIMESERIES"

interface TrendsCategory {
  metric: string
  query: string
}

export const TRENDS_CATEGORIES: readonly TrendsCategory[] = [
  // Combined keyword baskets joined by `,` — SerpAPI parses comma-
  // separated queries as one "topic" and returns a single interest
  // series. Multi-language basket boosts AZ coverage.
  { metric: "AZ_TREND_FOOD_RETAIL", query: "yemək,продукты,grocery" },
  { metric: "AZ_TREND_FASHION", query: "moda,одежда,fashion" },
  { metric: "AZ_TREND_ELECTRONICS", query: "iPhone,электроника,electronics" },
  { metric: "AZ_TREND_TRAVEL", query: "tour,путешествие,travel" },
]

interface SerpApiTimelineValue {
  query?: string
  value?: number | string
  extracted_value?: number | string
}
interface SerpApiTimelineEntry {
  date?: string
  /** Unix epoch seconds as string (provided by both SerpAPI and
   *  ScrapingDog). Preferred over `date` because some proxies emit
   *  weekly ranges like "May 11 – 17, 2025" which JS Date.parse fails
   *  to handle. */
  timestamp?: string
  values?: SerpApiTimelineValue[]
}
interface SerpApiResponse {
  interest_over_time?: {
    timeline_data?: SerpApiTimelineEntry[]
  }
}

export interface GoogleTrendsAdapterOptions extends CommodityAdapterOptions {
  /** API key for the proxy (SerpAPI / ScrapingDog / etc). Null disables
   *  the adapter (returns not_configured gracefully). */
  apiKey?: string | null
  /** Override the proxy base URL (without `&q=...&api_key=...`). */
  proxyUrl?: string
}

/**
 * Build the per-category URL. Pure helper for testability.
 *
 * Auto-detects the proxy vendor by hostname and emits the correct
 * query parameter name:
 *   - scrapingdog.com → `query=`
 *   - serpapi.com     → `q=`
 *   - everything else → `q=` (SerpAPI-compat default)
 */
export function buildTrendsUrl(
  category: TrendsCategory,
  apiKey: string,
  proxyUrl: string = DEFAULT_PROXY_URL,
): string {
  const queryParam = /scrapingdog\.com/i.test(proxyUrl) ? "query" : "q"
  const sep = proxyUrl.includes("?") ? "&" : "?"
  return `${proxyUrl}${sep}${queryParam}=${encodeURIComponent(category.query)}&api_key=${encodeURIComponent(apiKey)}`
}

/**
 * Convert SerpAPI response → latest data point for the given category.
 */
export function trendsResponseToDataPoint(
  response: SerpApiResponse,
  category: TrendsCategory,
): CommodityDataPoint | null {
  const timeline = response?.interest_over_time?.timeline_data
  if (!Array.isArray(timeline) || timeline.length === 0) return null

  // Pick latest entry with a numeric value.
  let best: { d: Date; v: number } | null = null
  for (const entry of timeline) {
    if (!Array.isArray(entry.values) || entry.values.length === 0) continue
    // Resolve datetime — prefer the unix `timestamp` field (both
    // SerpAPI and ScrapingDog emit it; format is seconds-since-epoch
    // as string). Falls back to `date` parsing for proxies that omit
    // timestamp. ScrapingDog uses weekly ranges like "May 11 – 17,
    // 2025" with em-dash that Date.parse cannot handle.
    let d: Date | null = null
    if (entry.timestamp) {
      const sec = Number(entry.timestamp)
      if (Number.isFinite(sec) && sec > 0) {
        d = new Date(sec * 1000)
      }
    }
    if (!d && entry.date) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) {
        d = new Date(`${entry.date}T00:00:00Z`)
      } else {
        const parsed = Date.parse(entry.date)
        if (!Number.isNaN(parsed)) d = new Date(parsed)
      }
    }
    if (!d || Number.isNaN(d.getTime())) continue
    const v = Number(entry.values[0].extracted_value ?? entry.values[0].value)
    if (!Number.isFinite(v)) continue
    if (!best || d.getTime() > best.d.getTime()) best = { d, v }
  }
  if (!best) return null
  // Anchor to UTC start-of-week (Monday) for idempotency.
  const day = best.d.getUTCDay()
  const offset = day === 0 ? 6 : day - 1
  const monday = new Date(
    Date.UTC(best.d.getUTCFullYear(), best.d.getUTCMonth(), best.d.getUTCDate() - offset),
  )
  return {
    sourceCode: TRENDS_SOURCE,
    metric: category.metric,
    datetime: monday,
    value: best.v,
    unit: "index",
    raw: { query: category.query, weekOf: best.d.toISOString().slice(0, 10) },
  }
}

export function createGoogleTrendsAzAdapter(
  opts: GoogleTrendsAdapterOptions = {},
): CommodityAdapter {
  const fetchImpl = opts.fetchImpl ?? fetch
  const apiKey = opts.apiKey ?? null
  const proxyUrl = opts.proxyUrl ?? DEFAULT_PROXY_URL
  return {
    source: TRENDS_SOURCE,
    label: TRENDS_LABEL,
    async fetch(): Promise<CommodityFetchResult> {
      if (!apiKey) {
        return {
          source: TRENDS_SOURCE,
          dataPoints: [],
          errors: [
            "not_configured — set Organization.settings.apiKeys.gtrends to a SerpAPI / ScrapingDog key, or proxyUrl to a custom Trends bridge",
          ],
          fetched: false,
        }
      }
      const allPoints: CommodityDataPoint[] = []
      const errors: string[] = []
      let anyFetched = false
      for (const cat of TRENDS_CATEGORIES) {
        const url = buildTrendsUrl(cat, apiKey, proxyUrl)
        let response: Response
        try {
          response = await fetchImpl(url)
        } catch (e) {
          errors.push(
            `${cat.metric}: fetch failed: ${e instanceof Error ? e.message : String(e)}`,
          )
          continue
        }
        anyFetched = true
        if (!response.ok) {
          errors.push(`${cat.metric}: HTTP ${response.status}`)
          continue
        }
        let parsed: SerpApiResponse
        try {
          parsed = (await response.json()) as SerpApiResponse
        } catch (e) {
          errors.push(
            `${cat.metric}: JSON parse failed: ${e instanceof Error ? e.message : String(e)}`,
          )
          continue
        }
        const point = trendsResponseToDataPoint(parsed, cat)
        if (!point) {
          errors.push(`${cat.metric}: no usable timeline rows`)
          continue
        }
        allPoints.push(point)
      }
      return {
        source: TRENDS_SOURCE,
        dataPoints: allPoints,
        errors,
        fetched: anyFetched,
      }
    },
  }
}

export const GOOGLE_TRENDS_AZ_SOURCE = TRENDS_SOURCE
