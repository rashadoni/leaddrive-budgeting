import type { BudgetForecastEntry, BudgetLine } from "./types"

const FORECAST_LINE_TYPES = new Set(["revenue", "cogs", "expense"])

export function buildForecastViewLines(lines: BudgetLine[]) {
  const leaves: BudgetLine[] = []
  const collectLeaves = (items: BudgetLine[]) => {
    for (const line of items) {
      if (line.children?.length) collectLeaves(line.children)
      else leaves.push(line)
    }
  }
  collectLeaves(lines)

  const grouped = new Map<string, BudgetLine>()
  let sourceLineCount = 0
  for (const line of leaves) {
    if (!FORECAST_LINE_TYPES.has(line.lineType)) continue
    sourceLineCount += 1
    const key = `${line.category}||${line.lineType}`
    const existing = grouped.get(key)
    if (existing) {
      existing.plannedAmount += line.plannedAmount
      existing.sortOrder = Math.min(existing.sortOrder, line.sortOrder)
      continue
    }
    grouped.set(key, {
      ...line,
      id: `forecast-view:${key}`,
      parentId: null,
      children: [],
      notes: null,
    })
  }

  return {
    lines: [...grouped.values()].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.category.localeCompare(b.category),
    ),
    sourceLineCount,
  }
}

export function filterForecastEntriesForView(
  entries: BudgetForecastEntry[],
  planYear: number | undefined,
  months: number[],
  lines: BudgetLine[],
) {
  const monthSet = new Set(months)
  const lineKeys = new Set(lines.map((line) => `${line.category}||${line.lineType}`))
  const candidates = entries.filter((entry) => entry.category !== "__total__")
  const applied = candidates.filter((entry) => {
    const lineType = entry.lineType || "expense"
    return entry.year === planYear
      && monthSet.has(entry.month)
      && lineKeys.has(`${entry.category}||${lineType}`)
  })
  return { applied, ignoredCount: candidates.length - applied.length }
}

export function computeForecastScenario(
  revenue: number,
  cogs: number,
  operatingExpense: number,
  multipliers: { revenue: number; cogs: number; expense: number },
) {
  return computeForecastPnl(
    revenue * multipliers.revenue,
    cogs * multipliers.cogs,
    operatingExpense * multipliers.expense,
  )
}

export function formatForecastDecimal(
  value: number,
  locale: string,
  fractionDigits: number,
) {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value)
}

export function computeForecastPnl(
  revenue: number,
  cogs: number,
  operatingExpense: number,
) {
  const grossProfit = revenue - cogs
  const ebitda = grossProfit - operatingExpense
  return {
    revenue,
    cogs,
    operatingExpense,
    grossProfit,
    ebitda,
    cogsShareOfRevenue: revenue > 0 ? (cogs / revenue) * 100 : null,
    expenseShareOfRevenue:
      revenue > 0 ? (operatingExpense / revenue) * 100 : null,
    ebitdaMargin: revenue > 0 ? (ebitda / revenue) * 100 : null,
  }
}

export function resolveForecastCell(
  saved: number | undefined,
  plannedAnnualAmount: number,
  periodMonths: number,
  multiplier: number,
) {
  if (saved !== undefined) {
    return { value: saved * multiplier, source: "saved" as const }
  }
  return {
    value: (plannedAnnualAmount / periodMonths) * multiplier,
    source: "plan_baseline" as const,
  }
}
