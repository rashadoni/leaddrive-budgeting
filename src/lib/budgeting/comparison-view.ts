import type { BudgetAnalytics, BudgetCategoryRow, BudgetPlan } from "./types"

export function formatComparisonAmount(
  value: number,
  locale: string,
  currencyCode: string | null,
  compact = false,
): string {
  const amount = new Intl.NumberFormat(locale, compact
    ? { notation: "compact", maximumFractionDigits: 1 }
    : { maximumFractionDigits: 0 },
  ).format(compact ? value : Math.round(value))
  return currencyCode ? `${amount} ${currencyCode}` : amount
}

export function formatComparisonDecimal(value: number, locale: string, digits = 1): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value)
}

export function categoryActualAvailable(
  analytics: BudgetAnalytics,
  row: BudgetCategoryRow,
): boolean {
  if (typeof row.actualAvailable === "boolean") return row.actualAvailable
  if (analytics.plan?.kind === "actual") return true
  if (row.actual !== 0) return true
  return analytics.perCategoryActualsAvailable === true
}

export function aggregateActualAvailable(analytics: BudgetAnalytics): boolean {
  if (analytics.plan?.kind === "actual") return true
  if ((analytics.actualMonthsCovered ?? 0) > 0) return true
  if (analytics.byCategory.some((row) => categoryActualAvailable(analytics, row))) return true
  // Backward compatibility for an older/cached response that predates the
  // evidence flags. A non-zero aggregate is still positive evidence; zero is
  // unavailable unless one of the explicit signals above proves it.
  return analytics.totalActual !== 0
}

export function lineTypeActualAvailable(
  analytics: BudgetAnalytics,
  lineType: "revenue" | "cogs" | "expense",
): boolean {
  return resolveLineTypeActualTotal(analytics, lineType).available
}

export function resolveLineTypeActualTotal(
  analytics: BudgetAnalytics,
  lineType: "revenue" | "cogs" | "expense",
): { available: boolean; amount: number } {
  const rows = analytics.byCategory.filter((row) => row.lineType === lineType)
  if (rows.length > 0 && rows.every((row) => categoryActualAvailable(analytics, row))) {
    return { available: true, amount: rows.reduce((sum, row) => sum + row.actual, 0) }
  }
  // Backward compatibility only when no category rows were returned at all.
  // A partial category set must fail closed rather than present a partial total.
  const total = lineType === "revenue"
    ? analytics.totalRevenueActual
    : lineType === "cogs"
      ? analytics.totalCOGSActual
      : analytics.totalExpenseActual
  if (rows.length === 0 && typeof total === "number" && Number.isFinite(total) && total !== 0) {
    return { available: true, amount: total }
  }
  return { available: false, amount: 0 }
}

export function comparisonBasisKey(plan: BudgetPlan): string {
  const kind = plan.kind ?? "budget"
  const periodType = plan.periodType ?? "annual"
  const periodSlot = periodType === "monthly"
    ? plan.month ?? "missing"
    : periodType === "quarterly"
      ? plan.quarter ?? "missing"
      : "annual"
  return `${kind}||${periodType}||${periodSlot}`
}

export function plansAreComparable(a: BudgetPlan, b: BudgetPlan): boolean {
  return comparisonBasisKey(a) === comparisonBasisKey(b)
}

export function planHasRows(plan: BudgetPlan): boolean {
  // Current API always includes the live count. Treat an omitted legacy/cache
  // count as unknown-compatible, but an evidenced zero as empty/disabled.
  return plan._count ? plan._count.lines > 0 : true
}

export function chooseGuideComparisonPairIds(plans: BudgetPlan[]): string[] {
  const populated = plans.filter(planHasRows)
  const annualBudgets = populated.filter((plan) => (plan.kind ?? "budget") === "budget" && (plan.periodType ?? "annual") === "annual")
  if (annualBudgets.length >= 2) return annualBudgets.slice(0, 2).map((plan) => plan.id)
  const annualActuals = populated.filter((plan) => plan.kind === "actual" && (plan.periodType ?? "annual") === "annual")
  if (annualActuals.length >= 2) return annualActuals.slice(0, 2).map((plan) => plan.id)
  for (const plan of populated) {
    const pair = populated.filter((candidate) => plansAreComparable(plan, candidate))
    if (pair.length >= 2) return pair.slice(0, 2).map((candidate) => candidate.id)
  }
  return []
}

export interface ComparisonCategoryIdentity {
  key: string
  label: string
  accountCode: string | null
  lineType: string
}

export function comparisonCategoryKey(row: BudgetCategoryRow): string {
  const code = row.accountCode?.trim()
  return code
    ? `code:${code}||${row.lineType}`
    : `name:${row.category}||${row.lineType}`
}

export function orderComparisonCategories(analytics: BudgetAnalytics[]): ComparisonCategoryIdentity[] {
  const categories = new Map<string, ComparisonCategoryIdentity & { magnitude: number }>()
  for (const item of analytics) {
    for (const row of item.byCategory) {
      const key = comparisonCategoryKey(row)
      const previous = categories.get(key)
      const magnitude = Math.max(previous?.magnitude ?? 0, Math.abs(row.planned))
      categories.set(key, {
        key,
        label: previous?.label ?? row.category,
        accountCode: previous?.accountCode ?? row.accountCode ?? null,
        lineType: row.lineType,
        magnitude,
      })
    }
  }
  return [...categories.values()]
    .sort((a, b) => b.magnitude - a.magnitude || a.key.localeCompare(b.key))
    .map(({ magnitude: _magnitude, ...identity }) => identity)
}
