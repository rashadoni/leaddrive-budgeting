"use client"

/**
 * Phase 7.G Turn LXI — Phase 3.1 second slice: ComparisonTab extracted from
 * `src/app/(dashboard)/budgeting/page.tsx` into its own feature module.
 *
 * Continues the Turn-LX VarianceTab extraction pattern. ComparisonTab is the
 * second-largest tab (~338 LOC; was 6th-overall after PLTab/WorkspaceTab/
 * ForecastTab/ImportTab/etc.). Multi-plan side-by-side analytics — orthogonal
 * to VarianceTab's single-plan plan-vs-actual focus.
 *
 * Component contract unchanged from inline version:
 *   - Reads `useBudgetPlans()` + 4× `useBudgetAnalytics(planId)` for up to
 *     4 selected plans (no new API surface; no schema change).
 *   - UX: card-grid plan picker (multi-select, max 4) → KPI comparison cards
 *     → grouped bar chart + variance distribution → variance table with
 *     materiality filter.
 *   - `COMPARISON_COLORS` palette extracted alongside (was sibling const in
 *     page.tsx).
 *
 * Extraction-only — zero behaviour change. tsc + vitest preserved
 * byte-for-byte.
 */

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, LabelList,
} from "recharts"
import { BarChart2, CheckCircle, FileSpreadsheet, TrendingUp } from "lucide-react"
import { DataBoundary } from "@/components/ui/data-boundary"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useBudgetPlans, useBudgetAnalytics, useExchangeRates } from "@/lib/budgeting/hooks"
import type { BudgetAnalytics, BudgetCategoryRow } from "@/lib/budgeting/types"
// Phase 3.1 v1.2 ext — shared 12-month sparkline. ComparisonTab uses
// the first selected plan's distribution as a single trend column.
import { MonthlySparkline } from "./monthly-sparkline"
import { BUDGET_COLORS, ANIMATION, AXIS_TICK, VBarGradient } from "@/lib/budget-chart-theme"
import { BudgetChartTooltip } from "@/components/budget-chart-tooltip"
import { BudgetBarLabel } from "@/components/budget-bar-label"
import { BudgetChartLegend } from "@/components/budget-chart-legend"
import { execPct } from "@/lib/budgeting/exec-pct"
import {
  categoryActualAvailable,
  chooseGuideComparisonPairIds,
  comparisonCategoryKey,
  formatComparisonAmount,
  formatComparisonDecimal,
  orderComparisonCategories,
  planHasRows,
  plansAreComparable,
  resolveLineTypeActualTotal,
} from "@/lib/budgeting/comparison-view"

// Phase 7.G Turn LXI extraction — `fmt` was a top-level helper in
// `src/app/(dashboard)/budgeting/page.tsx` (line 124). This is a PRIVATE
// copy scoped to ComparisonTab; `page.tsx:124` retains the canonical
// definition for the ~33 remaining inline-tab call sites
// (WorkspaceTab/PLTab/etc.). When the last consumer in page.tsx is
// extracted, dedup this + page.tsx copies into a shared utility.
// Architect Turn-LXI doc-correctness closure.
/** Phase 8 D3(m) (2026-05-28) — narrow an unknown row-cell to a finite
 *  number, defaulting to 0. Used by the materiality predicate which
 *  reads dynamic `row[pN_pct]` / `row[pN_variance]` keys. */
function asNum(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback
}

function asNullableNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null
}

/** Chart-row shape: one entry per category with a `category` key plus
 *  one numeric value per plan label. Recharts reads via dataKey =
 *  planLabels[i] so we keep the dynamic-key shape with a union. */
type ChartRow = { category: string } & Record<string, number | string | null>

/** Table-row shape: per-plan planned/actual/variance/pct keys plus the
 *  first plan's optional monthlyPlanned/monthlyActual sparkline arrays. */
type TableRow = {
  categoryKey: string
  category: string
  monthlyPlanned?: number[]
  monthlyActual?: number[]
  monthlyActualEvidence?: boolean
} & Record<string, boolean | null | number | number[] | string | undefined>

/** Recharts LabelList content callback props. Recharts ships x/y/
 *  width/height as `string | number | undefined` (SVG-friendly), so
 *  we mirror that shape and coerce to number when invoking
 *  BudgetBarLabel (which needs numeric pixel values). */
/** Matches Recharts' `RenderableText = string | number | boolean | null | undefined`
 *  for `value`, plus their SVG-coord `string | number | undefined` for the
 *  positional props. We coerce these to numeric pixels at the call site. */
interface BarLabelContentProps {
  x?: string | number
  y?: string | number
  width?: string | number
  height?: string | number
  value?: string | number | boolean | null
  index?: number
}

function toPx(v: string | number | undefined): number {
  if (typeof v === "number") return v
  if (typeof v === "string") {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

function toLabelValue(v: BarLabelContentProps["value"]): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string") {
    const n = Number(v)
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

// ─── Comparison Tab ────────────────────────────────────────────────────────────

const COMPARISON_COLORS = BUDGET_COLORS.comparison

export function ComparisonTab() {
  const t = useTranslations("budgeting")
  const locale = useLocale()
  const { data: plans = [], isLoading } = useBudgetPlans()
  const currencyQuery = useExchangeRates()
  const currencyCode = currencyQuery.data?.currencies.find((currency) => currency.isBase)?.code ?? null
  const amount = (value: number) => formatComparisonAmount(value, locale, currencyCode)
  const compactAmount = (value: number) => formatComparisonAmount(value, locale, currencyCode, true)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [materialityPct, setMaterialityPct] = useState(5)
  const [materialityAbs, setMaterialityAbs] = useState(500)
  const [showAll, setShowAll] = useState(true)

  // Load analytics for each selected plan
  const a0 = useBudgetAnalytics(selectedIds[0] || "")
  const a1 = useBudgetAnalytics(selectedIds[1] || "")
  const a2 = useBudgetAnalytics(selectedIds[2] || "")
  const a3 = useBudgetAnalytics(selectedIds[3] || "")
  const analyticsQueries = [a0, a1, a2, a3].slice(0, selectedIds.length)
  const analyticsLoading = selectedIds.length >= 2 && analyticsQueries.some((query) => query.isLoading)
  const analyticsError = analyticsQueries.find((query) => query.error)?.error
  const analyticsReady = selectedIds.length >= 2 && analyticsQueries.every((query) => Boolean(query.data))
  // Only consume this array after `analyticsReady` is true. Keeping positional
  // slots intact prevents a later plan's response from shifting onto an earlier
  // plan while requests settle out of order.
  const analyticsArr = analyticsReady
    ? analyticsQueries.map((query) => query.data as BudgetAnalytics)
    : []

  const togglePlan = (id: string) => {
    setSelectedIds(prev => {
      if (prev.includes(id)) return prev.filter(p => p !== id)
      if (prev.length >= 4) return prev
      const candidate = plans.find((plan) => plan.id === id)
      const baseline = plans.find((plan) => plan.id === prev[0])
      if (!candidate || !planHasRows(candidate) || (baseline && !plansAreComparable(baseline, candidate))) return prev
      return [...prev, id]
    })
  }

  if (isLoading) return <DataBoundary loading>{null}</DataBoundary>

  if (plans.length < 2) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        <BarChart2 className="h-12 w-12 mx-auto mb-3 opacity-30" />
        <p className="font-medium">{t("emptyNotEnoughData")}</p>
        <p className="text-sm mt-1">{t("emptyNotEnoughDataSub")}</p>
      </div>
    )
  }

  // Build chart data from all selected plans' byCategory
  const allCategories = orderComparisonCategories(analyticsArr)
  const topCategories = allCategories.slice(0, 10)

  // Build unique plan labels (deduplicate same names)
  const planLabels: string[] = selectedIds.map((id, i) => {
    const plan = plans.find(p => p.id === id)
    const baseName = plan?.name || `${t("colPlan")} ${i + 1}`
    const dupeCount = selectedIds.slice(0, i).filter(prevId => plans.find(p => p.id === prevId)?.name === baseName).length
    return dupeCount > 0 ? `${baseName} (${dupeCount + 1})` : baseName
  })
  const baselinePlan = plans.find((plan) => plan.id === selectedIds[0])
  const isActualBasis = baselinePlan?.kind === "actual"

  const chartData: ChartRow[] = topCategories.map(cat => {
    const row: ChartRow = { category: cat.accountCode ? `${cat.accountCode} · ${cat.label}` : cat.label }
    analyticsArr.forEach((a, i) => {
      const found = a.byCategory.find((c: BudgetCategoryRow) => comparisonCategoryKey(c) === cat.key)
      row[planLabels[i]] = found ? found.planned : null
    })
    return row
  })

  // Variance table rows
  const tableCategories: TableRow[] = allCategories.map(cat => {
    const row: TableRow = {
      categoryKey: cat.key,
      category: cat.accountCode ? `${cat.accountCode} · ${cat.label}` : cat.label,
    }
    analyticsArr.forEach((a, i) => {
      const found = a.byCategory.find((c: BudgetCategoryRow) => comparisonCategoryKey(c) === cat.key)
      const actualAvailable = found ? categoryActualAvailable(a, found) : false
      row[`p${i}_planned`] = found ? found.planned : null
      row[`p${i}_actual`] = found && actualAvailable ? found.actual : null
      row[`p${i}_variance`] = found && actualAvailable ? found.variance : null
      row[`p${i}_pct`] = found && actualAvailable ? found.variancePct : null
      // Phase 3.1 v1.2 ext — carry first-selected-plan's monthly arrays
      // through to the table render so the Trend column can render a
      // 12-month sparkline per row. Only the first plan to keep visual
      // density manageable across N-plan comparisons.
      if (i === 0) {
        row.monthlyPlanned = found?.monthlyPlanned
        row.monthlyActual = found && actualAvailable ? found.monthlyActual : undefined
        row.monthlyActualEvidence = actualAvailable
      }
    })
    return row
  })

  // Materiality filter
  const isMaterial = (row: TableRow) => {
    if (showAll) return true
    for (let i = 0; i < analyticsArr.length; i++) {
      const pct = asNullableNum(row[`p${i}_pct`])
      const variance = asNullableNum(row[`p${i}_variance`])
      if ((pct !== null && Math.abs(pct) >= materialityPct) || (variance !== null && Math.abs(variance) >= materialityAbs)) return true
    }
    return false
  }

  // Compute per-plan summaries for KPI cards
  const planSummaries = selectedIds.map((id, i) => {
    const a = analyticsArr[i]
    const plan = plans.find(p => p.id === id)
    const actualEvidence = a ? resolveLineTypeActualTotal(a, "expense") : { available: false, amount: 0 }
    return {
      id, name: plan?.name || `${t("colPlan")} ${i + 1}`, year: plan?.year,
      planned: a?.totalExpensePlanned ?? 0, actual: actualEvidence.amount,
      variance: a ? a.totalExpensePlanned - actualEvidence.amount : 0,
      categories: a?.byCategory?.length ?? 0,
      actualAvailable: actualEvidence.available,
      actualMonthsCovered: a?.actualMonthsCovered,
      periodMonths: a?.periodMonths,
      color: COMPARISON_COLORS[i],
    }
  })

  // Find the "winner" plan (highest planned budget)
  const maxPlanned = Math.max(...planSummaries.map(p => p.planned), 1)
  const guidePairIds = chooseGuideComparisonPairIds(plans)
  const monthLabels = t("monthsShort").split(",")
  const statusLabel = (status: string | null | undefined) => {
    if (status === "approved") return t("compStatusApproved")
    if (status === "pending_approval") return t("compStatusPending")
    if (status === "rejected") return t("compStatusRejected")
    return t("compStatusDraft")
  }
  const cellAmount = (value: unknown) => {
    const numeric = asNullableNum(value)
    return numeric === null ? "—" : amount(numeric)
  }
  const cellPercent = (value: unknown) => {
    const numeric = asNullableNum(value)
    return numeric === null ? "—" : `${formatComparisonDecimal(numeric, locale)}%`
  }

  return (
    <div className="space-y-6" data-testid="comparison-guide-root">
      <div data-testid="comparison-provenance" className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-800 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300">
        {t("compProvenance")}
      </div>
      <div
        data-testid={currencyCode ? "comparison-currency-known" : "comparison-currency-unknown"}
        className={`rounded-lg border px-3 py-2 text-xs ${currencyCode ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300" : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"}`}
      >
        {currencyCode
          ? t("compCurrencyKnown", { code: currencyCode })
          : currencyQuery.error
            ? t("compCurrencyUnavailable")
            : t("compCurrencyUnknown")}
      </div>
      {/* Plan selector — interactive cards */}
      <div data-testid="comparison-plan-picker">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">{t("selectPlansTitle")}</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {plans.map((p, idx) => {
            const isSelected = selectedIds.includes(p.id)
            const isPopulated = planHasRows(p)
            const isCompatible = isPopulated && (!baselinePlan || isSelected || plansAreComparable(baselinePlan, p))
            const colorIdx = isSelected ? selectedIds.indexOf(p.id) : -1
            const borderColor = isSelected ? COMPARISON_COLORS[colorIdx] : "transparent"
            return (
              <button
                key={p.id}
                type="button"
                data-testid={`comparison-plan-option-${idx}`}
                data-guide-slot={guidePairIds[0] === p.id ? "primary" : guidePairIds[1] === p.id ? "secondary" : undefined}
                data-plan-kind={p.kind ?? "budget"}
                data-plan-period={p.periodType ?? "annual"}
                data-plan-year={p.year}
                data-plan-empty={!isPopulated}
                aria-pressed={isSelected}
                disabled={!isCompatible}
                onClick={() => togglePlan(p.id)}
                // Phase 3.3 hover pattern — full plan name on hover.
                title={isPopulated ? (isCompatible ? `${p.year} · ${p.name}` : t("compIncompatiblePlan")) : t("compEmptyPlan")}
                // impeccable polish: violet AI-gradient → primary-tint
                // surface; selection state communicated via border color
                // (per-plan from COMPARISON_COLORS) + scale, not via
                // bg gradient. Whole-card-tappable = raw <button>.
                className={`relative rounded-xl p-4 text-left transition-all duration-200 border-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 ${isCompatible ? "cursor-pointer motion-safe:hover:scale-[1.01]" : "cursor-not-allowed opacity-45"} ${isSelected ? "shadow-lg motion-safe:scale-[1.02] bg-primary/5 dark:bg-primary/10" : "shadow-sm hover:shadow-md bg-card text-card-foreground"}`}
                style={{ borderColor }}>
                {isSelected && (
                  <div className="absolute top-2 right-2">
                    <CheckCircle className="h-4 w-4" style={{ color: COMPARISON_COLORS[colorIdx] }} />
                  </div>
                )}
                <div className="text-xs font-semibold uppercase tracking-wider mb-1" style={isSelected ? { color: COMPARISON_COLORS[colorIdx] } : { opacity: 0.5 }}>
                  {p.year}
                </div>
                <div className={`text-sm font-bold truncate ${isSelected ? "text-violet-700 dark:text-violet-300" : ""}`}>{p.name}</div>
                <div className={`text-[10px] mt-1 ${isSelected ? "text-muted-foreground" : "text-muted-foreground"}`}>
                  {p.periodType === "annual"
                    ? t("periodAnnual")
                    : p.periodType === "quarterly"
                    ? t("periodQuarterly", { n: p.quarter ?? 0 })
                    : t("periodMonthly", { n: p.month ?? 0 })}
                  {p.status && ` · ${statusLabel(p.status)}`}
                </div>
              </button>
            )
          })}
        </div>
      </div>
      <div data-testid="comparison-basis" className="text-xs text-muted-foreground">
        {baselinePlan
          ? t("compBasisSelected", {
              kind: baselinePlan.kind === "actual" ? t("compKindActual") : t("compKindBudget"),
              period: baselinePlan.periodType === "monthly"
                ? t("periodMonthly", { n: baselinePlan.month ?? 0 })
                : baselinePlan.periodType === "quarterly"
                  ? t("periodQuarterly", { n: baselinePlan.quarter ?? 0 })
                  : t("periodAnnual"),
            })
          : t("compBasisPrompt")}
      </div>

      {selectedIds.length >= 2 && analyticsLoading && (
        <div data-testid="comparison-loading"><DataBoundary loading>{null}</DataBoundary></div>
      )}

      {selectedIds.length >= 2 && !analyticsLoading && (analyticsError || !analyticsReady) && (
        <div data-testid="comparison-error"><DataBoundary error={t("errorLoading")}>{null}</DataBoundary></div>
      )}

      {selectedIds.length >= 2 && !analyticsLoading && !analyticsError && analyticsReady && (
        <>
          {/* KPI Comparison Cards — one per selected plan */}
          <div data-testid="comparison-kpis" className={`grid gap-3 ${selectedIds.length === 2 ? "grid-cols-2" : selectedIds.length === 3 ? "grid-cols-3" : "grid-cols-4"}`}>
            {planSummaries.map((ps, i) => {
              const budgetShare = maxPlanned > 0 ? (ps.planned / maxPlanned * 100) : 0
              return (
                <div key={ps.id} className="rounded-xl bg-gradient-to-br from-violet-50 to-violet-100 border border-violet-200 dark:from-violet-950/30 dark:to-violet-900/20 dark:border-violet-800 p-5" style={{ borderTop: `3px solid ${ps.color}` }}>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">{ps.name}</span>
                    <div className="h-8 w-8 rounded-full flex items-center justify-center" style={{ backgroundColor: `${ps.color}30` }}>
                      <span className="text-xs font-bold" style={{ color: ps.color }}>{t("compPlanBadge", { number: i + 1 })}</span>
                    </div>
                  </div>
                  <div className="text-xl font-bold tabular-nums text-violet-700 dark:text-violet-300">{compactAmount(ps.planned)}</div>
                  <div className="text-[10px] text-muted-foreground">{isActualBasis ? t("compRealizedExpense") : t("compExpenseBudget")}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {isActualBasis
                      ? t("compCategoriesCount", { count: ps.categories })
                      : `${t("compCategoriesCount", { count: ps.categories })} · ${ps.actualAvailable ? t("compActualAmount", { amount: compactAmount(ps.actual) }) : t("compNoActuals")}`}
                  </div>
                  {ps.actualAvailable && typeof ps.actualMonthsCovered === "number" && typeof ps.periodMonths === "number" && (
                    <div className="text-[10px] text-muted-foreground mt-1">
                      {t("compActualCoverage", { covered: ps.actualMonthsCovered, total: ps.periodMonths })}
                    </div>
                  )}
                  {/* Budget share bar */}
                  <div className="mt-3 space-y-1">
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>{t("compRelativeSize")}</span>
                      <span>{formatComparisonDecimal(budgetShare, locale, 0)}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-violet-200 dark:bg-violet-800 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${budgetShare}%`, backgroundColor: ps.color }} />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Charts row: Grouped bar + Variance distribution */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            {/* Grouped bar chart — 3/5 */}
            <Card data-testid="comparison-category-chart" className="lg:col-span-3 border-0 shadow-md overflow-hidden">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <BarChart2 className="h-4 w-4 text-indigo-500" />
                  {t("chartComparisonByCategory")}
                </CardTitle>
                <p className="text-xs text-muted-foreground">{isActualBasis ? t("compActualChartSubtitle") : t("compChartCategorySubtitle")}</p>
              </CardHeader>
              <CardContent className="pt-0">
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={chartData} margin={{ left: 10, right: 10, top: 20, bottom: 5 }}>
                    <defs>
                      {selectedIds.map((_, i) => (
                        <VBarGradient key={i} id={`comp-grad-${i}`} color={COMPARISON_COLORS[i]} />
                      ))}
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted-foreground/15" horizontal={true} vertical={false} />
                    <XAxis dataKey="category" tick={{ fontSize: 10, fill: "#94a3b8" }} angle={-25} textAnchor="end" height={60} axisLine={false} tickLine={false} />
                    <YAxis tick={AXIS_TICK} tickFormatter={(v: number) => formatComparisonAmount(v, locale, null, true)} axisLine={false} tickLine={false} />
                    <Tooltip content={<BudgetChartTooltip mode="comparison" formatValue={amount} />} cursor={{ fill: "hsl(var(--muted))", opacity: 0.3 }} />
                    {selectedIds.map((id, i) => (
                      <Bar key={id} dataKey={planLabels[i]} fill={`url(#comp-grad-${i})`} radius={[4, 4, 0, 0]}
                        animationDuration={ANIMATION.duration} animationEasing={ANIMATION.easing} barSize={20}>
                        <LabelList content={(props: BarLabelContentProps) => (
                          <BudgetBarLabel
                            x={toPx(props.x)}
                            y={toPx(props.y)}
                            width={toPx(props.width)}
                            height={toPx(props.height)}
                            value={toLabelValue(props.value)}
                            index={props.index}
                            horizontal={false}
                            formatter={compactAmount}
                          />
                        )} />
                      </Bar>
                    ))}
                  </BarChart>
                </ResponsiveContainer>
                <BudgetChartLegend items={selectedIds.map((id, i) => ({
                  label: plans.find(p => p.id === id)?.name || `${t("colPlan")} ${i + 1}`,
                  color: COMPARISON_COLORS[i],
                }))} />
              </CardContent>
            </Card>

            {/* Variance Butterfly / Diverging bars — 2/5 */}
            <Card data-testid="comparison-opex-totals" className="lg:col-span-2 border-0 shadow-md">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-emerald-500" />
                  {isActualBasis ? t("compActualTotalsTitle") : t("compPlanTotalsTitle")}
                </CardTitle>
                <p className="text-xs text-muted-foreground">{isActualBasis ? t("compActualTotalsSubtitle") : t("compPlanTotalsSubtitle")}</p>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="space-y-4 mt-2">
                  {planSummaries.map((ps, i) => {
                    const barW = maxPlanned > 0 ? (ps.planned / maxPlanned * 100) : 0
                    // Budget-fill bar: planned is always positive here (plan total).
                    const pctOfPlan = !isActualBasis && ps.actualAvailable ? execPct(ps.actual, ps.planned) : null
                    return (
                      <div key={ps.id}>
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: ps.color }} />
                            <span className="text-sm font-semibold">{ps.name}</span>
                          </div>
                          <span className="text-sm font-bold font-mono">{compactAmount(ps.planned)}</span>
                        </div>
                        {/* Budget bar */}
                        <div className="w-full h-3 bg-muted rounded-full overflow-hidden mb-1">
                          <div className="h-full rounded-full transition-all duration-700" style={{ width: `${barW}%`, backgroundColor: ps.color, opacity: 0.8 }} />
                        </div>
                        {isActualBasis ? (
                          <div className="text-[10px] text-muted-foreground">{t("compRealizedSource")}</div>
                        ) : (
                          <div className="flex justify-between text-[10px] text-muted-foreground">
                            <span>{t("compActualLabel")}: {ps.actualAvailable ? compactAmount(ps.actual) : "—"}</span>
                            <span>{pctOfPlan !== null ? `${pctOfPlan}% ${t("compExecutionSuffix")}` : t("compNoActuals")}</span>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* Delta of the first (baseline) plan vs EACH other selected plan
                    — so a 3-/4-plan comparison shows all deltas, not just the
                    first pair. Baseline = first selected (the focus year). */}
                {planSummaries.length >= 2 && (
                  <div className="mt-4 pt-4 border-t border-border/50">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 font-semibold">{isActualBasis ? t("compActualDeltaLabel") : t("compDeltaLabel")}: {planSummaries[0].name}</div>
                    <div className="space-y-1.5">
                      {planSummaries.slice(1).map((ps) => {
                        const delta = planSummaries[0].planned - ps.planned
                        const deltaPct = ps.planned !== 0 ? ((delta / ps.planned) * 100) : null
                        return (
                          <div key={ps.id} className="flex items-center justify-between gap-3">
                            <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: ps.color }} />
                              {t("compVersus", { name: ps.name })}
                            </span>
                            <div className="flex items-center gap-2">
                              <span className="text-base font-bold font-mono text-foreground">
                                {delta >= 0 ? "+" : ""}{compactAmount(delta)}
                              </span>
                              <Badge variant="outline" className="text-xs">
                                {deltaPct === null ? "—" : `${delta >= 0 ? "+" : ""}${formatComparisonDecimal(deltaPct, locale)}%`}
                              </Badge>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* P4-04: Materiality filter */}
          {!isActualBasis && <div data-testid="comparison-materiality-controls" className="flex flex-wrap items-center gap-3 text-sm">
            <span className="font-medium">{t("materialityThreshold")}</span>
            <div className="flex items-center gap-1">
              <Input data-testid="comparison-materiality-pct" type="number" value={materialityPct} onChange={e => setMaterialityPct(Number(e.target.value))} className="h-7 w-16 text-xs text-right" /> %
            </div>
            <div className="flex items-center gap-1">
              <Input data-testid="comparison-materiality-amount" type="number" value={materialityAbs} onChange={e => setMaterialityAbs(Number(e.target.value))} className="h-7 w-20 text-xs text-right" /> {currencyCode ?? ""}
            </div>
            <Button data-testid="comparison-materiality-toggle" aria-pressed={!showAll} size="sm" variant="outline" className="text-xs h-7" onClick={() => setShowAll(!showAll)}>
              {showAll ? t("btnHideMaterial") : t("btnShowAll")}
            </Button>
          </div>}

          {tableCategories.some((row) => selectedIds.some((_id, i) => asNullableNum(row[`p${i}_actual`]) === null)) && (
            <div data-testid="comparison-actuals-absence" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
              {isActualBasis ? t("compActualPeriodAbsence") : t("compActualsAbsence")}
            </div>
          )}

          {/* P4-03: Variance table */}
          <Card data-testid="comparison-table" className="border-0 shadow-md">
            <CardHeader><CardTitle className="text-sm flex items-center gap-2"><FileSpreadsheet className="h-4 w-4 text-slate-500" />{t("tableComparison")}</CardTitle></CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 z-10 bg-[#1a3050] border-b-2 border-white/10">
                    <tr>
                      <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white/90 sticky left-0 bg-[#1a3050]">{t("colCategory")}</th>
                      {selectedIds.map((id, i) => {
                        const name = plans.find(p => p.id === id)?.name || `${t("colPlan")} ${i + 1}`
                        return isActualBasis ? [
                          <th key={`${id}-actual`} className="px-2 py-3 text-right text-xs font-semibold uppercase tracking-wider" style={{ color: COMPARISON_COLORS[i] }}>{name} {t("colActual")}</th>,
                        ] : [
                          <th key={`${id}-p`} className="px-2 py-3 text-right text-xs font-semibold uppercase tracking-wider" style={{ color: COMPARISON_COLORS[i] }}>{name} {t("colBudget")}</th>,
                          <th key={`${id}-a`} className="px-2 py-3 text-right text-xs font-semibold uppercase tracking-wider" style={{ color: COMPARISON_COLORS[i] }}>{name} {t("colActual")}</th>,
                          <th key={`${id}-v`} className="px-2 py-3 text-right text-xs font-semibold uppercase tracking-wider" style={{ color: COMPARISON_COLORS[i] }}>{t("colVarianceShort")} %</th>,
                        ]
                      })}
                      {/* Phase 3.1 v1.2 ext — 12-month sparkline of first
                          selected plan. Single column kept density
                          manageable for N-plan comparisons; user can
                          re-order plans to put the "reference" plan first. */}
                      <th
                        className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white/70"
                        title={t("compTrendTitle")}
                      >
                        {t("varianceColTrend")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableCategories.filter((row) => isActualBasis || isMaterial(row)).map(row => (
                      <tr key={row.categoryKey} className="border-t border-border/50 hover:bg-muted/30">
                        <td className="px-3 py-1.5 font-medium sticky left-0 bg-background">{row.category}</td>
                        {selectedIds.map((_id, i) => isActualBasis ? [
                          <td key={`${row.category}-p${i}-actual`} className="px-2 py-1.5 text-right font-mono">{cellAmount(row[`p${i}_planned`])}</td>,
                        ] : [
                          <td key={`${row.category}-p${i}-p`} className="px-2 py-1.5 text-right font-mono">{cellAmount(row[`p${i}_planned`])}</td>,
                          <td key={`${row.category}-p${i}-a`} className="px-2 py-1.5 text-right font-mono" title={asNullableNum(row[`p${i}_actual`]) === null ? t("compNoCategoryActual") : undefined}>{cellAmount(row[`p${i}_actual`])}</td>,
                          <td key={`${row.category}-p${i}-v`} className={`px-2 py-1.5 text-right font-mono font-bold ${asNullableNum(row[`p${i}_variance`]) === null ? "text-muted-foreground" : asNum(row[`p${i}_variance`]) >= 0 ? "text-[#065f46] dark:text-[#6ee7b7]" : "text-red-500"}`}>
                            {cellPercent(row[`p${i}_pct`])}
                          </td>,
                        ])}
                        <td className="px-3 py-1.5">
                          <MonthlySparkline
                            values={row.monthlyPlanned}
                            actuals={isActualBasis ? undefined : row.monthlyActual}
                            actualEvidence={isActualBasis ? undefined : row.monthlyActualEvidence}
                            monthLabels={monthLabels}
                            planLabel={isActualBasis ? t("colActual") : t("colPlan")}
                            actualLabel={t("colActual")}
                            distributionLabel={t("compTrendDistribution")}
                            valueFormatter={compactAmount}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t-2 border-border bg-muted/30">
                    <tr>
                      <td className="px-3 py-2 font-bold sticky left-0 bg-muted/30">{isActualBasis ? t("compRealizedExpenseTotal") : t("compExpenseTotal")}</td>
                      {selectedIds.map((_id, i) => {
                        const a = analyticsArr[i]
                        return isActualBasis ? [
                          <td key={`total-p${i}-actual`} className="px-2 py-2 text-right font-mono font-bold">{amount(a.totalExpensePlanned)}</td>,
                        ] : [
                          <td key={`total-p${i}-p`} className="px-2 py-2 text-right font-mono font-bold">{amount(a.totalExpensePlanned)}</td>,
                          <td key={`total-p${i}-a`} className="px-2 py-2 text-right font-mono font-bold">{planSummaries[i]?.actualAvailable ? amount(planSummaries[i].actual) : "—"}</td>,
                          <td key={`total-p${i}-v`} className={`px-2 py-2 text-right font-mono font-bold ${!planSummaries[i]?.actualAvailable ? "text-muted-foreground" : planSummaries[i].variance >= 0 ? "text-[#065f46] dark:text-[#6ee7b7]" : "text-red-500"}`}>
                            {planSummaries[i]?.actualAvailable && a.totalExpensePlanned ? `${formatComparisonDecimal((planSummaries[i].variance / a.totalExpensePlanned) * 100, locale)}%` : "—"}
                          </td>,
                        ]
                      })}
                      <td className="px-3 py-2" />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {selectedIds.length < 2 && selectedIds.length > 0 && (
        <div className="text-center py-8 text-muted-foreground text-sm">{t("emptySelectMorePlans")}</div>
      )}
    </div>
  )
}
