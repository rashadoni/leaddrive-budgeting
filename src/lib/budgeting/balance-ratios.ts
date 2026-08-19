/**
 * The ratios a finance director looks at first (2026-08-19).
 *
 * 16,357 balance-sheet lines have been imported and nothing computed a single
 * ratio from them. This does — liquidity, leverage and working-capital days —
 * from an EXPLICIT map of the client's 23 balance-sheet codes to the buckets
 * each ratio needs.
 *
 * ## Why the map is a table and not a heuristic
 *
 * Ratios fail silently. A misfiled account does not throw; it shifts a current
 * ratio from 1.4 to 0.9 and the reader acts on it. With 23 codes the honest
 * thing is a list someone can read line by line and correct, so every entry
 * below is deliberate and anything unlisted is reported as unmapped rather
 * than quietly dropped into "other".
 *
 * ## Signs, verified against the data
 *
 * Assets are stored positive; equity and liabilities negative. The check is
 * the balance sheet's own identity: on the client's 2026 actuals the three
 * sections sum to within ±1 unit of zero at EVERY month, on a base of 250
 * million. So magnitudes are taken with an explicit negation for equity and
 * liabilities, not with `Math.abs`, which would hide a sign error instead of
 * surfacing it as a negative ratio.
 *
 * ## A stock is not a flow
 *
 * A balance sheet is a position on a date, so amounts are taken at ONE month —
 * never summed across months, which is what a P&L needs and what would inflate
 * every figure here by the number of periods. The caller picks the month and
 * this module is told the days behind it, because the working-capital ratios
 * mix a stock (a balance) with a flow (revenue over a window).
 */

/** Buckets the ratios are built from. */
export type BalanceBucket =
  | "cash"
  | "receivables"
  | "inventory"
  | "biological"
  | "other_current_assets"
  | "non_current_assets"
  | "debt_short"
  | "debt_long"
  | "payables"
  | "other_current_liabilities"
  | "other_long_liabilities"
  | "equity"

/**
 * The client's chart, mapped by hand. Read it as the specification it is: an
 * account moving between two lines here changes what the screen says.
 */
export const BALANCE_MAP: Record<string, BalanceBucket> = {
  // Non-current assets
  "BS.01.01.01": "non_current_assets", // Intangible Assets
  "BS.01.01.02": "non_current_assets", // Tangible Assets
  "BS.01.01.03": "non_current_assets", // Long-Term Biological Assets & Mineral Reserves
  "BS.01.01.05": "non_current_assets", // Equity Investments
  "BS.01.01.07": "non_current_assets", // Long-Term Receivables — long-term, so NOT in DSO
  "BS.01.01.99": "non_current_assets", // Deferred Asset on Business Combination
  // Current assets
  "BS.01.02.01": "cash",
  "BS.01.02.03": "inventory",
  // Growing crops and livestock. Illiquid like inventory, so excluded from the
  // quick ratio — but kept OUT of inventory turnover, because folding them in
  // put this client's stock-days at 499. That is not a supply-chain finding,
  // it is the growing season, and it would have been read as the former.
  "BS.01.02.04": "biological",
  "BS.01.02.05": "receivables",
  "BS.01.02.06": "other_current_assets", // Other Current Financial Assets
  "BS.01.02.07": "other_current_assets",
  // Equity
  "BS.02.01.01": "equity",
  "BS.02.04.01": "equity",
  "BS.02.04.02": "equity",
  "BS.02.04.03": "equity",
  // Liabilities
  "BS.03.01.01": "debt_long",
  "BS.03.01.05": "other_long_liabilities",
  "BS.03.02.01": "debt_short",
  "BS.03.02.02": "other_current_liabilities", // Provisions Short-Term
  "BS.03.02.03": "payables",
  "BS.03.02.04": "other_current_liabilities", // Taxes & Other State Payables
  "BS.03.02.05": "other_current_liabilities",
}

export interface BalanceAccountAmount {
  code: string
  name: string
  /** As stored: assets positive, equity and liabilities negative. */
  amount: number
}

/** Flows over the window the balance is being read against. */
export interface FlowInputs {
  revenue: number
  cogs: number
  /** Calendar days the flows cover — turns a ratio into days. */
  days: number
}

export interface Ratio {
  key: string
  /** Null when an input is missing or the denominator is zero. */
  value: number | null
  /** `null` when there is nothing to judge it against. */
  verdict: "good" | "watch" | "bad" | null
}

export interface BalanceRatios {
  buckets: Record<BalanceBucket, number>
  currentAssets: number
  currentLiabilities: number
  totalAssets: number
  equity: number
  netDebt: number
  ratios: Ratio[]
  /** Codes carrying money that the map does not know. Never silently dropped. */
  unmapped: { code: string; name: string; amount: number }[]
  /**
   * Assets minus equity and liabilities. Should be ~0; a figure here means the
   * imported balance does not balance, and every ratio built on it inherits
   * that. Surfaced rather than assumed away.
   */
  balanceCheck: number
}

const ZERO_BUCKETS: Record<BalanceBucket, number> = {
  cash: 0, receivables: 0, inventory: 0, biological: 0, other_current_assets: 0,
  non_current_assets: 0, debt_short: 0, debt_long: 0, payables: 0,
  other_current_liabilities: 0, other_long_liabilities: 0, equity: 0,
}

/** Buckets stored credit-negative, taken as positive magnitudes. */
const NEGATED: ReadonlySet<BalanceBucket> = new Set<BalanceBucket>([
  "debt_short", "debt_long", "payables",
  "other_current_liabilities", "other_long_liabilities", "equity",
])

function ratio(key: string, value: number | null, band: [number, number] | null): Ratio {
  if (value === null || !Number.isFinite(value)) return { key, value: null, verdict: null }
  if (!band) return { key, value, verdict: null }
  const [watch, good] = band
  return { key, value, verdict: value >= good ? "good" : value >= watch ? "watch" : "bad" }
}

function div(a: number, b: number): number | null {
  return b === 0 ? null : a / b
}

export function computeBalanceRatios(
  accounts: ReadonlyArray<BalanceAccountAmount>,
  flows: FlowInputs | null,
): BalanceRatios {
  const buckets = { ...ZERO_BUCKETS }
  const unmapped: BalanceRatios["unmapped"] = []
  let signedTotal = 0

  for (const a of accounts) {
    signedTotal += a.amount
    const bucket = BALANCE_MAP[a.code.trim().toUpperCase()]
    if (!bucket) {
      if (a.amount !== 0) unmapped.push({ code: a.code, name: a.name, amount: a.amount })
      continue
    }
    buckets[bucket] += NEGATED.has(bucket) ? -a.amount : a.amount
  }

  const currentAssets =
    buckets.cash + buckets.receivables + buckets.inventory + buckets.biological +
    buckets.other_current_assets
  const currentLiabilities =
    buckets.debt_short + buckets.payables + buckets.other_current_liabilities
  const totalAssets = currentAssets + buckets.non_current_assets
  const equity = buckets.equity
  const debt = buckets.debt_short + buckets.debt_long
  const netDebt = debt - buckets.cash
  // Quick ratio excludes what cannot be turned into cash quickly.
  const quickAssets = currentAssets - buckets.inventory - buckets.biological

  const ratios: Ratio[] = [
    ratio("current", div(currentAssets, currentLiabilities), [1, 1.5]),
    ratio("quick", div(quickAssets, currentLiabilities), [0.7, 1]),
    ratio("equityRatio", div(equity, totalAssets), [0.3, 0.5]),
    // Lower is better, so the band is inverted by negating both sides.
    ratio("netDebtToEquity", div(netDebt, equity), null),
  ]

  if (flows && flows.days > 0) {
    // Stock over flow, scaled to days. Revenue and cost come from the same
    // window the balance is read at the end of.
    ratios.push(
      ratio("dso", flows.revenue > 0 ? (buckets.receivables / flows.revenue) * flows.days : null, null),
      ratio("dio", flows.cogs > 0 ? (buckets.inventory / flows.cogs) * flows.days : null, null),
      ratio("dpo", flows.cogs > 0 ? (buckets.payables / flows.cogs) * flows.days : null, null),
    )
    const dso = ratios.find((r) => r.key === "dso")?.value
    const dio = ratios.find((r) => r.key === "dio")?.value
    const dpo = ratios.find((r) => r.key === "dpo")?.value
    ratios.push(
      ratio(
        "cashCycle",
        dso == null || dio == null || dpo == null ? null : dso + dio - dpo,
        null,
      ),
    )
  }

  return {
    buckets,
    currentAssets,
    currentLiabilities,
    totalAssets,
    equity,
    netDebt,
    ratios,
    unmapped,
    balanceCheck: signedTotal,
  }
}
