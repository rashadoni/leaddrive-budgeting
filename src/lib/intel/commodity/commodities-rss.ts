/**
 * Phase 7.G Turn LXXXXV (Phase 7.E #1 D.5b) — commodities RSS adapter.
 *
 * Pulls latest spot prices for Brent crude + Gold via free RSS feeds.
 * Source: investpy / Yahoo Finance RSS / oilprice.com — free,
 * unauthenticated.
 *
 * **Why these commodities:** Brent drives diesel/jet/transport COGS for
 * 60% of the holding (logistics + agro-input + industrial fuel). Gold
 * = USD-decoupled inflation hedge benchmark for AZN-base treasury.
 *
 * **RSS parsing strategy:** RSS XML is verbose but stable. We extract
 * only the `<item>` block's `<title>` text, then regex out the price
 * (e.g. "Brent Oil — $76.42/bbl"). Parsing is fail-soft: if regex
 * misses, the row is dropped (not the whole feed).
 *
 * **Update cadence:** intra-day for spot quotes, but our scheduler runs
 * daily. Adapter writes 1 data point per (commodity, day). Idempotent.
 *
 * **Endpoint:** simulated for v1 — real RSS endpoints vary by provider
 * and break frequently. Caller can swap via opts.feedUrls; default
 * targets a hypothetical aggregator. **Pre-production gap:** before
 * shipping live, swap default URLs to a vetted feed (oilprice.com /
 * Yahoo Finance / Trading Economics).
 */

import type {
  CommodityAdapter,
  CommodityAdapterOptions,
  CommodityFetchResult,
  CommodityDataPoint,
} from "./types"

const RSS_SOURCE = "commodities-rss"
const RSS_LABEL = "Commodities RSS — Brent / Gold"

/** Default feed URLs — swap to vetted providers before shipping live. */
const DEFAULT_FEEDS: Record<string, string> = {
  BRENT_USD_BBL: "https://example-aggregator.test/rss/brent",
  GOLD_USD_OZ: "https://example-aggregator.test/rss/gold",
}

export interface CommoditiesRSSOptions extends CommodityAdapterOptions {
  /** Override per-commodity feed URLs. Default = DEFAULT_FEEDS. */
  feedUrls?: Record<string, string>
}

/** Extract the latest <item><title> text from an RSS XML body. Returns
 *  null when no item exists or the structure is malformed. */
export function extractFirstItemTitle(rssXml: string): string | null {
  // Strict-but-fast — avoid XML DOM parser dep. Match <item>...<title>X</title>...</item>
  const match = rssXml.match(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>/i)
  if (!match) return null
  // Strip CDATA wrappers + HTML entities common in RSS
  const raw = match[1].trim()
  const decdata = raw.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "")
  return decdata.trim()
}

/** Extract a numeric price from a title like "Brent Oil — $76.42/bbl"
 *  or "Gold $2,300/oz" (comma thousand separators supported). */
export function extractPriceFromTitle(title: string): number | null {
  // Look for $ or other currency markers followed by digits (with optional
  // comma thousand separators).
  const m = title.match(/\$\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)/)
  if (!m) {
    // Fallback: bare number with optional comma thousand separator
    const m2 = title.match(/(\d{1,3}(?:,\d{3})*(?:\.\d+)?)/)
    if (!m2) return null
    const n = parseFloat(m2[1].replace(/,/g, ""))
    return Number.isFinite(n) ? n : null
  }
  const n = parseFloat(m[1].replace(/,/g, ""))
  return Number.isFinite(n) ? n : null
}

export function createCommoditiesRSSAdapter(
  opts: CommoditiesRSSOptions = {},
): CommodityAdapter {
  const fetchImpl = opts.fetchImpl ?? fetch
  const feeds = opts.feedUrls ?? DEFAULT_FEEDS

  return {
    source: RSS_SOURCE,
    label: RSS_LABEL,
    async fetch(now: Date = new Date()): Promise<CommodityFetchResult> {
      const datetime = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
      )
      const allPoints: CommodityDataPoint[] = []
      const errors: string[] = []
      let anyFetched = false

      for (const [metric, url] of Object.entries(feeds)) {
        let response: Response
        try {
          response = await fetchImpl(url)
          anyFetched = true
        } catch (e) {
          errors.push(`${metric}: fetch failed — ${e instanceof Error ? e.message : String(e)}`)
          continue
        }
        if (!response.ok) {
          errors.push(`${metric}: HTTP ${response.status}`)
          continue
        }
        let xml: string
        try {
          xml = await response.text()
        } catch (e) {
          errors.push(`${metric}: text read failed — ${e instanceof Error ? e.message : String(e)}`)
          continue
        }
        const title = extractFirstItemTitle(xml)
        if (!title) {
          errors.push(`${metric}: RSS had no <item><title>`)
          continue
        }
        const price = extractPriceFromTitle(title)
        if (price === null) {
          errors.push(`${metric}: title had no parseable price — "${title.slice(0, 80)}"`)
          continue
        }
        // Unit derivation by suffix convention
        const unit = metric.endsWith("_BBL") ? "USD/bbl" : metric.endsWith("_OZ") ? "USD/oz" : "USD"
        allPoints.push({
          sourceCode: RSS_SOURCE,
          metric,
          datetime,
          value: price,
          unit,
          raw: { title },
        })
      }

      return {
        source: RSS_SOURCE,
        dataPoints: allPoints,
        errors,
        fetched: anyFetched,
      }
    },
  }
}

export const COMMODITIES_RSS_SOURCE = RSS_SOURCE
