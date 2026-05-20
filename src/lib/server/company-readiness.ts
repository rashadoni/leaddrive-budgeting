/**
 * Phase 7.M Step 5 (2026-05-19) — per-company data-readiness score.
 *
 * What this is
 * ────────────
 * One number per operating company saying "how complete is this entity's
 * data". Drives:
 *   • CompanyTree visual badge — finance reviewer sees "35%" next to
 *     the company name, knows where the holes are.
 *   • HeatMap banner when active company < 50% — tells the user
 *     "AI / risk indicators will be unreliable here, you need more
 *     data".
 *   • Variance Explainer prompt context — when readiness is low, the
 *     LLM is instructed to say "data insufficient for an accurate
 *     analysis" instead of hallucinating numbers.
 *
 * Pure vs DB
 * ──────────
 * This file exports the PURE scoring function — accepts a flat
 * `ReadinessInputs` struct of booleans/counts and returns the score.
 * The DB-reader version (which actually queries Prisma) is wired in
 * `getCompanyReadiness` for the matrix endpoint to call. Pure logic
 * stays testable without a database.
 */

export interface ReadinessInputs {
  /** Number of non-archived budget_lines for the company-period. */
  budgetLineCount: number
  /** Number of distinct lineTypes (revenue / cogs / expense) the budget
   *  lines cover. 3 = ideal, 1-2 = partial. */
  budgetLineTypeCount: number
  /** Has at least one balance_sheet_line for the company's plan. */
  hasBalanceSheet: boolean
  /** Number of customer counterparties (role='customer'). */
  customerCount: number
  /** Number of supplier counterparties (role='supplier'). */
  supplierCount: number
  /** Number of distinct operational_fact metrics for this company. */
  operationalFactMetricCount: number
  /** Length of the `settings.strategicNarrative` string (or 0). */
  strategicNarrativeLength: number
  /** Count of IV rows with status != 'unknown'. */
  computedIndicatorCount: number
  /** Has at least one budget_line with currencyCode != base + an
   *  exchangeRate (i.e. real foreign-currency exposure tracked). */
  hasForeignCurrencyTags: boolean
}

export interface ReadinessArea {
  id: string
  weight: number // 0-100
  earned: number // 0-100
  label: string
  missing: string | null
}

export interface ReadinessResult {
  /** Total 0-100, rounded to integer. */
  score: number
  /** Tier label for UI styling. */
  tier: "complete" | "good" | "partial" | "thin" | "empty"
  /** Per-area breakdown so the UI can render a checklist of gaps. */
  areas: ReadonlyArray<ReadinessArea>
}

/**
 * Weight allocation totals 100. Tightening a weight requires updating
 * its sibling so the total stays 100; the runtime asserts this at
 * boot via `READINESS_WEIGHTS_SUM` so a refactor can't accidentally
 * shift the scale.
 */
const W = {
  pnl: 25,
  bs: 15,
  counterparties: 15,
  opKpis: 15,
  narrative: 10,
  indicators: 10,
  fxTags: 10,
} as const

export const READINESS_WEIGHTS_SUM = Object.values(W).reduce((a, b) => a + b, 0)
if (READINESS_WEIGHTS_SUM !== 100) {
  throw new Error(
    `company-readiness: weights sum to ${READINESS_WEIGHTS_SUM}, must be 100`,
  )
}

/**
 * Linear ramp helper — `at` clamps inputs to [0, target] and scales
 * to [0, weight]. Saves repetitive `Math.min` math.
 */
function ramp(actual: number, target: number, weight: number): number {
  if (target <= 0) return weight
  return Math.min(weight, Math.max(0, (actual / target) * weight))
}

export function computeCompanyReadiness(
  inputs: ReadinessInputs,
): ReadinessResult {
  // P&L coverage — 50 lines × 3 line types = "ideal". Below 50 lines
  // earn proportional weight; type coverage adds a soft floor.
  const pnlLines = ramp(inputs.budgetLineCount, 50, W.pnl * 0.7)
  const pnlTypes = (inputs.budgetLineTypeCount / 3) * (W.pnl * 0.3)
  const pnl = Math.min(W.pnl, pnlLines + pnlTypes)

  // Balance sheet — boolean (either you have BS or you don't).
  const bs = inputs.hasBalanceSheet ? W.bs : 0

  // Counterparties — 3 customers + 3 suppliers earn full weight.
  const cust = ramp(inputs.customerCount, 3, W.counterparties / 2)
  const sup = ramp(inputs.supplierCount, 3, W.counterparties / 2)
  const counterparties = cust + sup

  // Operational KPIs — 3 distinct metric keys = "ideal" (e.g. for agro:
  // hectares + yield + harvest; for hospitality: occupancy + adr + revpar).
  const opKpis = ramp(inputs.operationalFactMetricCount, 3, W.opKpis)

  // Strategic narrative — 300 chars (~50-60 words) is the minimum for
  // a useful AI prompt context.
  const narrative = ramp(
    inputs.strategicNarrativeLength,
    300,
    W.narrative,
  )

  // Computed indicators — 10 indicators with status≠unknown is enough
  // for HeatMap to show meaningful coverage.
  const indicators = ramp(inputs.computedIndicatorCount, 10, W.indicators)

  // FX currency tags — boolean. Either you've populated currencyCode
  // on imports or you haven't.
  const fxTags = inputs.hasForeignCurrencyTags ? W.fxTags : 0

  const total = pnl + bs + counterparties + opKpis + narrative + indicators + fxTags
  const score = Math.round(Math.max(0, Math.min(100, total)))

  const tier: ReadinessResult["tier"] =
    score >= 85
      ? "complete"
      : score >= 65
        ? "good"
        : score >= 40
          ? "partial"
          : score >= 15
            ? "thin"
            : "empty"

  const areas: ReadinessArea[] = [
    {
      id: "pnl",
      weight: W.pnl,
      earned: Math.round(pnl),
      label: "P&L (budget lines)",
      missing:
        inputs.budgetLineCount < 50
          ? `${inputs.budgetLineCount} of 50 lines`
          : null,
    },
    {
      id: "bs",
      weight: W.bs,
      earned: bs,
      label: "Balance Sheet",
      missing: inputs.hasBalanceSheet ? null : "no BS rows",
    },
    {
      id: "counterparties",
      weight: W.counterparties,
      earned: Math.round(counterparties),
      label: "Counterparties",
      missing:
        inputs.customerCount < 3 || inputs.supplierCount < 3
          ? `${inputs.customerCount} customers / ${inputs.supplierCount} suppliers`
          : null,
    },
    {
      id: "opKpis",
      weight: W.opKpis,
      earned: Math.round(opKpis),
      label: "Operational KPIs",
      missing:
        inputs.operationalFactMetricCount < 3
          ? `${inputs.operationalFactMetricCount} of 3 metric keys`
          : null,
    },
    {
      id: "narrative",
      weight: W.narrative,
      earned: Math.round(narrative),
      label: "Strategic narrative",
      missing:
        inputs.strategicNarrativeLength < 300
          ? inputs.strategicNarrativeLength === 0
            ? "missing"
            : `${inputs.strategicNarrativeLength} of 300 chars`
          : null,
    },
    {
      id: "indicators",
      weight: W.indicators,
      earned: Math.round(indicators),
      label: "Computed indicators",
      missing:
        inputs.computedIndicatorCount < 10
          ? `${inputs.computedIndicatorCount} of 10 indicators`
          : null,
    },
    {
      id: "fxTags",
      weight: W.fxTags,
      earned: fxTags,
      label: "FX currency tags",
      missing: inputs.hasForeignCurrencyTags
        ? null
        : "no foreign-currency budget lines",
    },
  ]

  return { score, tier, areas }
}
