export type PnlPerformanceMetric = "revenue" | "cogs" | "opex" | "ebitda" | "netProfit"

export interface PnlPerformancePoint {
  month: string
  budget: number
  actual: number
  variance: number
  executionPct: number | null
}

export interface EbitdaBridgeInput {
  budget: {
    revenue: number
    cogs: number
    opex: number
    da: number
    ebitda: number
  }
  actual: {
    revenue: number
    cogs: number
    opex: number
    da: number
    ebitda: number
  }
}

/**
 * A single step of the EBITDA bridge. `key` is the stable identifier the
 * renderer resolves into a localized axis label — the helper stays
 * locale-agnostic so it can run in pure unit tests and on the server.
 */
export interface EbitdaBridgeStep {
  key: "budget" | "revenue" | "cogs" | "opex" | "da" | "actual"
  range: [number, number]
  delta: number
  value: number
  kind: "endpoint" | "positive" | "negative"
}

export function executionPct(actual: number, budget: number): number | null {
  if (budget === 0) return actual === 0 ? null : 100
  return (actual / budget) * 100
}

export function buildPnlPerformancePoint(args: {
  month: string
  budget: number
  actual: number
}): PnlPerformancePoint {
  return {
    month: args.month,
    budget: args.budget,
    actual: args.actual,
    variance: args.actual - args.budget,
    executionPct: executionPct(args.actual, args.budget),
  }
}

export function buildEbitdaBridge(input: EbitdaBridgeInput): EbitdaBridgeStep[] {
  const steps: EbitdaBridgeStep[] = [
    {
      key: "budget",
      range: rangeFromZero(input.budget.ebitda),
      delta: 0,
      value: input.budget.ebitda,
      kind: "endpoint",
    },
  ]

  let running = input.budget.ebitda
  const addStep = (
    key: Exclude<EbitdaBridgeStep["key"], "budget" | "actual">,
    delta: number,
  ) => {
    const from = running
    const to = running + delta
    steps.push({
      key,
      range: [Math.min(from, to), Math.max(from, to)],
      delta,
      value: to,
      kind: delta >= 0 ? "positive" : "negative",
    })
    running = to
  }

  addStep("revenue", input.actual.revenue - input.budget.revenue)
  addStep("cogs", input.budget.cogs - input.actual.cogs)
  addStep("opex", input.budget.opex - input.actual.opex)
  addStep("da", input.actual.da - input.budget.da)

  steps.push({
    key: "actual",
    range: rangeFromZero(input.actual.ebitda),
    delta: 0,
    value: input.actual.ebitda,
    kind: "endpoint",
  })

  return steps
}

function rangeFromZero(value: number): [number, number] {
  return value >= 0 ? [0, value] : [value, 0]
}
