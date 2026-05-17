/**
 * Phase 7.J — CBAR (Central Bank of Azerbaijan) FX **forward** curve.
 *
 * The TCMB adapter (`tcmb-fx.ts`) only pulls SPOT rates. For hedge
 * sizing CFO needs the implied 3 / 6 / 12-month forward AZN/USD
 * (and AZN/EUR) curve. CBAR doesn't publish a forward curve as a
 * structured feed, but the spot + Azerbaijan/US policy-rate
 * differential gives an interest-rate-parity (IRP) derived forward
 * that is the right magnitude for treasury hedge decisions.
 *
 * Forward rate (IRP):
 *   F(t) = S × (1 + r_AZN × t) / (1 + r_USD × t)
 *
 *   - S       = spot AZN/USD (pulled from existing TCMB adapter)
 *   - r_AZN   = Central Bank of Azerbaijan refinancing rate (latest;
 *               default 8.0% — current as of 2026-Q1 CBAR decision)
 *   - r_USD   = US Federal Funds upper bound (latest; default 4.75%)
 *   - t       = tenor in years (0.25 / 0.5 / 1.0)
 *
 * Output: one `IntelDataPoint` per tenor:
 *   metric: "FX_FORWARD_USD_AZN_3M" | "_6M" | "_12M"
 *   metric: "FX_FORWARD_EUR_AZN_3M" | "_6M" | "_12M"
 *
 * **Why IRP-derived, not market-quoted:**
 *   - There is no liquid USD/AZN forward market (AZN is a
 *     managed-peg currency; market makers don't quote tenors).
 *   - The IRP estimate is the textbook fair-value forward CFOs use
 *     for budget sensitivity.
 *   - If the client signs OTC NDF deals with a bank, swap to a
 *     bank-quoted feed by replacing this adapter — interface
 *     compatible.
 *
 * Update cadence: daily, same as TCMB spot.
 */

import type {
  CommodityAdapter,
  CommodityAdapterOptions,
  CommodityFetchResult,
  CommodityDataPoint,
} from "./types"

const CBAR_FORWARD_SOURCE = "cbar-fx-forward-irp"
const CBAR_FORWARD_LABEL = "CBAR-derived AZN forward curve (IRP)"

const SPOT_BY_QUOTE: Record<string, number> = {
  USD: 1.7, // AZN per 1 USD (managed peg; rarely deviates)
  EUR: 1.85, // ECB-derived cross
}

// Policy rate differentials (annualised %, decimal). Tweak as central
// banks move. Source: CBAR Q1 2026 decision + Fed FOMC Q1 2026.
const POLICY_RATES = {
  AZN: 0.08, // CBAR refinancing rate
  USD: 0.0475, // Fed funds upper bound
  EUR: 0.0275, // ECB deposit facility rate
}

const TENORS_MONTHS = [3, 6, 12] as const

/** Pure helper — pass in spot + rate diff, get tenor data points. */
export function buildForwardCurve(
  spot: Record<string, number>,
  rates: Record<string, number>,
  now: Date = new Date(),
): CommodityDataPoint[] {
  const points: CommodityDataPoint[] = []
  for (const quote of Object.keys(spot)) {
    const S = spot[quote]
    const r_AZN = rates.AZN ?? POLICY_RATES.AZN
    const r_q = rates[quote] ?? POLICY_RATES[quote as keyof typeof POLICY_RATES] ?? 0
    for (const m of TENORS_MONTHS) {
      const t = m / 12
      // Interest-rate parity: F = S × (1 + r_AZN × t) / (1 + r_q × t)
      const F = S * (1 + r_AZN * t) / (1 + r_q * t)
      points.push({
        sourceCode: CBAR_FORWARD_SOURCE,
        metric: `FX_FORWARD_${quote}_AZN_${m}M`,
        value: Math.round(F * 10000) / 10000,
        unit: `AZN/${quote}`,
        datetime: now,
      })
    }
  }
  return points
}

export function createCBARForwardAdapter(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  opts: CommodityAdapterOptions = {},
): CommodityAdapter {
  return {
    source: CBAR_FORWARD_SOURCE,
    label: CBAR_FORWARD_LABEL,
    async fetch(now?: Date): Promise<CommodityFetchResult> {
      const refNow = now ?? new Date()
      // v1: hardcoded spot + rates. v2: read latest TCMB spot from
      // IntelDataPoint, read CBAR + Fed rate from BudgetAssumption,
      // recompute live. Keeps adapter idempotent + deterministic.
      const dataPoints = buildForwardCurve(SPOT_BY_QUOTE, POLICY_RATES, refNow)
      return {
        source: CBAR_FORWARD_SOURCE,
        dataPoints,
        errors: [],
        fetched: true,
      }
    },
  }
}
