/**
 * Phase 7.K — CBAR Official FX Adapter.
 *
 * Replaces the broken `tcmb-fx-rates` adapter (exchangerate.host moved
 * to paid tier in 2024-2025). CBAR publishes the daily official AZN
 * cross-rates as an XML file at:
 *
 *   https://cbar.az/currencies/<DD.MM.YYYY>.xml
 *
 * Format (truncated):
 *
 *   <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
 *   <ValCurs Date="17.05.2026" Name="Official exchange rates">
 *     <ValType Type="Xarici valyutalar">
 *       <Valute Code="USD"><Nominal>1</Nominal><Name>1 ABŞ dolları</Name><Value>1.7000</Value></Valute>
 *       <Valute Code="EUR"><Nominal>1</Nominal><Name>1 Avro</Name><Value>1.8543</Value></Valute>
 *       ...
 *     </ValType>
 *   </ValCurs>
 *
 * Cadence: daily (CBAR publishes overnight ~22:00 UTC).
 * Auth: none — public official feed.
 * Rate-limit: no documented quota; we run once daily per scheduler.
 *
 * Idempotency: each run upserts `(orgId, sourceCode='cbar-official-fx',
 * metric='AZN_<QUOTE>', datetime=UTC-midnight-of-today)`. Re-runs same
 * day overwrite the value (the rate may revise within trading hours).
 */

import type {
  CommodityAdapter,
  CommodityAdapterOptions,
  CommodityFetchResult,
  CommodityDataPoint,
} from "./types"

const CBAR_SOURCE = "cbar-official-fx"
const CBAR_LABEL = "CBAR Official FX (AZN base)"
const CBAR_BASE = "AZN"
/** Quote currencies we extract. The XML carries ~50 currencies; we pick
 *  the ones the holding actually transacts in (per BudgetLine.currencyCode
 *  audit). Add a code here to surface it in the indicator pipeline. */
const CBAR_QUOTE_PAIRS = ["USD", "EUR", "RUB", "TRY", "GBP", "CNY"] as const

const CBAR_BASE_URL = "https://cbar.az/currencies"

/** Format Date → "DD.MM.YYYY" (CBAR's URL pattern). UTC anchored so a
 *  late-night scheduler run doesn't roll over a day boundary mid-fetch. */
function formatCbarDate(d: Date): string {
  const day = String(d.getUTCDate()).padStart(2, "0")
  const month = String(d.getUTCMonth() + 1).padStart(2, "0")
  const year = d.getUTCFullYear()
  return `${day}.${month}.${year}`
}

/** Parse the CBAR XML into a {Code → Value} map. Pure helper so tests
 *  can feed canned XML strings without HTTP.
 *
 *  Why a regex parser (vs xml2js / DOMParser): the XML is tiny (~5KB)
 *  and the schema is locked for 20+ years. A regex is faster, has zero
 *  deps, and we don't have to add an XML lib to the bundle. */
export function parseCbarXml(xml: string): Record<string, number> {
  const out: Record<string, number> = {}
  // Match every <Valute Code="XXX">...<Value>NN.NNN</Value></Valute> block.
  const re = /<Valute\b[^>]*\bCode="([A-Z]{3})"[^>]*>[\s\S]*?<Value>\s*([\d.]+)\s*<\/Value>\s*<\/Valute>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    const code = m[1]
    const val = Number(m[2])
    if (Number.isFinite(val) && val > 0) {
      out[code] = val
    }
  }
  return out
}

/** Build the data points from a parsed rates map. */
export function cbarRatesToDataPoints(
  rates: Record<string, number>,
  now: Date = new Date(),
): CommodityDataPoint[] {
  const datetime = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  )
  const points: CommodityDataPoint[] = []
  for (const quote of CBAR_QUOTE_PAIRS) {
    const rate = rates[quote]
    if (typeof rate !== "number" || !Number.isFinite(rate)) continue
    points.push({
      sourceCode: CBAR_SOURCE,
      metric: `${CBAR_BASE}_${quote}`,
      datetime,
      value: rate,
      unit: `AZN/${quote}`,
      raw: { quote, rate },
    })
  }
  return points
}

export function createCBARFXAdapter(opts: CommodityAdapterOptions = {}): CommodityAdapter {
  const fetchImpl = opts.fetchImpl ?? fetch
  return {
    source: CBAR_SOURCE,
    label: CBAR_LABEL,
    async fetch(now: Date = new Date()): Promise<CommodityFetchResult> {
      const url = `${CBAR_BASE_URL}/${formatCbarDate(now)}.xml`
      let response: Response
      try {
        response = await fetchImpl(url)
      } catch (e) {
        return {
          source: CBAR_SOURCE,
          dataPoints: [],
          errors: [`fetch failed: ${e instanceof Error ? e.message : String(e)}`],
          fetched: false,
        }
      }
      if (!response.ok) {
        // CBAR returns 404 on holidays / weekends when no new rate is
        // published. The scheduler should attempt yesterday's URL on a
        // 404 — but v1 we just log and return empty (idempotency anchor
        // means yesterday's value stays in IntelDataPoint). v1.1: retry
        // with `now - 1 day` on 404.
        return {
          source: CBAR_SOURCE,
          dataPoints: [],
          errors: [`HTTP ${response.status} from ${url}`],
          fetched: true,
        }
      }
      let xml: string
      try {
        xml = await response.text()
      } catch (e) {
        return {
          source: CBAR_SOURCE,
          dataPoints: [],
          errors: [`response body read failed: ${e instanceof Error ? e.message : String(e)}`],
          fetched: true,
        }
      }
      const rates = parseCbarXml(xml)
      const dataPoints = cbarRatesToDataPoints(rates, now)
      const errors: string[] = []
      if (dataPoints.length === 0) {
        errors.push(
          `Parsed XML produced 0 usable rates (got: ${Object.keys(rates).slice(0, 10).join(",") || "<none>"}; expected ${CBAR_QUOTE_PAIRS.join(",")}).`,
        )
      }
      return { source: CBAR_SOURCE, dataPoints, errors, fetched: true }
    },
  }
}

export const CBAR_FX_SOURCE = CBAR_SOURCE
