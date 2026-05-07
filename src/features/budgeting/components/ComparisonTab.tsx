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
import { useTranslations } from "next-intl"
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, LabelList,
} from "recharts"
import { Loader2, BarChart2, CheckCircle, FileSpreadsheet, TrendingUp } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useBudgetPlans, useBudgetAnalytics } from "@/lib/budgeting/hooks"
import { BUDGET_COLORS, ANIMATION, AXIS_TICK, VBarGradient, fmtK } from "@/lib/budget-chart-theme"
import { BudgetChartTooltip } from "@/components/budget-chart-tooltip"
import { BudgetBarLabel } from "@/components/budget-bar-label"
import { BudgetChartLegend } from "@/components/budget-chart-legend"
import { execPct } from "@/lib/budgeting/exec-pct"

// Phase 7.G Turn LXI extraction — `fmt` was a top-level helper in
// `src/app/(dashboard)/budgeting/page.tsx` (line 124, pre-LXI). Pulled
// in privately here rather than extracting to a shared utility because
// ComparisonTab is the only consumer + the function is trivial.
function fmt(n: number): string {
  return Math.round(n).toLocaleString() + " ₼"
}

// ─── Comparison Tab ────────────────────────────────────────────────────────────

const COMPARISON_COLORS = BUDGET_COLORS.comparison

export function ComparisonTab() {
  const t = useTranslations("budgeting")
  const { data: plans = [], isLoading } = useBudgetPlans()
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [materialityPct, setMaterialityPct] = useState(5)
  const [materialityAbs, setMaterialityAbs] = useState(500)
  const [showAll, setShowAll] = useState(true)

  // Load analytics for each selected plan
  const a0 = useBudgetAnalytics(selectedIds[0] || "")
  const a1 = useBudgetAnalytics(selectedIds[1] || "")
  const a2 = useBudgetAnalytics(selectedIds[2] || "")
  const a3 = useBudgetAnalytics(selectedIds[3] || "")
  const analyticsArr = [a0.data, a1.data, a2.data, a3.data].filter(Boolean).slice(0, selectedIds.length)

  const togglePlan = (id: string) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : prev.length < 4 ? [...prev, id] : prev
    )
  }

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-purple-500" /></div>

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
  const allCategories = new Set<string>()
  for (const a of analyticsArr) {
    if (a?.byCategory) a.byCategory.forEach((c: any) => allCategories.add(c.category))
  }
  const topCategories = Array.from(allCategories).slice(0, 10)

  // Build unique plan labels (deduplicate same names)
  const planLabels: string[] = selectedIds.map((id, i) => {
    const plan = plans.find(p => p.id === id)
    const baseName = plan?.name || `${t("colPlan")} ${i + 1}`
    const dupeCount = selectedIds.slice(0, i).filter(prevId => plans.find(p => p.id === prevId)?.name === baseName).length
    return dupeCount > 0 ? `${baseName} (${dupeCount + 1})` : baseName
  })

  const chartData = topCategories.map(cat => {
    const row: any = { category: cat }
    analyticsArr.forEach((a, i) => {
      const found = a?.byCategory?.find((c: any) => c.category === cat)
      row[planLabels[i]] = found?.planned ?? 0
    })
    return row
  })

  // Variance table rows
  const tableCategories = topCategories.map(cat => {
    const row: any = { category: cat }
    analyticsArr.forEach((a, i) => {
      const found = a?.byCategory?.find((c: any) => c.category === cat)
      row[`p${i}_planned`] = found?.planned ?? 0
      row[`p${i}_actual`] = found?.actual ?? 0
      row[`p${i}_variance`] = found?.variance ?? 0
      row[`p${i}_pct`] = found?.variancePct ?? 0
    })
    return row
  })

  // Materiality filter
  const isMaterial = (row: any) => {
    if (showAll) return true
    for (let i = 0; i < analyticsArr.length; i++) {
      if (Math.abs(row[`p${i}_pct`] ?? 0) >= materialityPct || Math.abs(row[`p${i}_variance`] ?? 0) >= materialityAbs) return true
    }
    return false
  }

  // Compute per-plan summaries for KPI cards
  const planSummaries = selectedIds.map((id, i) => {
    const a = analyticsArr[i]
    const plan = plans.find(p => p.id === id)
    return {
      id, name: plan?.name || `Plan ${i + 1}`, year: plan?.year,
      planned: a?.totalPlanned ?? 0, actual: a?.totalActual ?? 0,
      variance: a?.totalVariance ?? 0, categories: a?.byCategory?.length ?? 0,
      color: COMPARISON_COLORS[i],
    }
  })

  // Find the "winner" plan (highest planned budget)
  const maxPlanned = Math.max(...planSummaries.map(p => p.planned), 1)

  return (
    <div className="space-y-6">
      {/* Plan selector — interactive cards */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">{t("selectPlansTitle")}</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {plans.map((p, idx) => {
            const isSelected = selectedIds.includes(p.id)
            const colorIdx = isSelected ? selectedIds.indexOf(p.id) : -1
            const borderColor = isSelected ? COMPARISON_COLORS[colorIdx] : "transparent"
            return (
              <button key={p.id} onClick={() => togglePlan(p.id)}
                className={`relative rounded-xl p-4 text-left transition-all duration-200 border-2 ${isSelected ? "shadow-lg scale-[1.02]" : "shadow-sm hover:shadow-md hover:scale-[1.01]"} ${isSelected ? "bg-gradient-to-br from-violet-50 to-violet-100 dark:from-violet-950/30 dark:to-violet-900/20" : "bg-card text-card-foreground"}`}
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
                  {p.periodType === "annual" ? "Annual" : p.periodType === "quarterly" ? `Q${p.quarter}` : `M${p.month}`}
                  {p.status && ` · ${p.status}`}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {selectedIds.length >= 2 && analyticsArr.length >= 2 && (
        <>
          {/* KPI Comparison Cards — one per selected plan */}
          <div className={`grid gap-3 ${selectedIds.length === 2 ? "grid-cols-2" : selectedIds.length === 3 ? "grid-cols-3" : "grid-cols-4"}`}>
            {planSummaries.map((ps, i) => {
              const budgetShare = maxPlanned > 0 ? (ps.planned / maxPlanned * 100) : 0
              return (
                <div key={ps.id} className="rounded-xl bg-gradient-to-br from-violet-50 to-violet-100 border border-violet-200 dark:from-violet-950/30 dark:to-violet-900/20 dark:border-violet-800 p-5" style={{ borderTop: `3px solid ${ps.color}` }}>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">{ps.name}</span>
                    <div className="h-8 w-8 rounded-full flex items-center justify-center" style={{ backgroundColor: `${ps.color}30` }}>
                      <span className="text-xs font-bold" style={{ color: ps.color }}>P{i + 1}</span>
                    </div>
                  </div>
                  <div className="text-xl font-bold tabular-nums text-violet-700 dark:text-violet-300">{fmtK(ps.planned)} ₼</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {ps.categories} categories · {ps.actual > 0 ? `${fmtK(ps.actual)} ₼ actual` : "no actuals"}
                  </div>
                  {/* Budget share bar */}
                  <div className="mt-3 space-y-1">
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>{t("compRelativeSize")}</span>
                      <span>{budgetShare.toFixed(0)}%</span>
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
            <Card className="lg:col-span-3 border-0 shadow-md overflow-hidden">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <BarChart2 className="h-4 w-4 text-indigo-500" />
                  {t("chartComparisonByCategory")}
                </CardTitle>
                <p className="text-xs text-muted-foreground">{t("compChartCategorySubtitle")}</p>
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
                    <YAxis tick={AXIS_TICK} tickFormatter={(v: number) => fmtK(v)} axisLine={false} tickLine={false} />
                    <Tooltip content={<BudgetChartTooltip mode="comparison" />} cursor={{ fill: "hsl(var(--muted))", opacity: 0.3 }} />
                    {selectedIds.map((id, i) => (
                      <Bar key={id} dataKey={planLabels[i]} fill={`url(#comp-grad-${i})`} radius={[4, 4, 0, 0]}
                        animationDuration={ANIMATION.duration} animationEasing={ANIMATION.easing} barSize={20}>
                        <LabelList content={(props: any) => <BudgetBarLabel {...props} horizontal={false} />} />
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
            <Card className="lg:col-span-2 border-0 shadow-md">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-emerald-500" />
                  {t("compPlanTotalsTitle")}
                </CardTitle>
                <p className="text-xs text-muted-foreground">{t("compPlanTotalsSubtitle")}</p>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="space-y-4 mt-2">
                  {planSummaries.map((ps, i) => {
                    const barW = maxPlanned > 0 ? (ps.planned / maxPlanned * 100) : 0
                    // Budget-fill bar: planned is always positive here (plan total).
                    const pctOfPlan = execPct(ps.actual, ps.planned)
                    return (
                      <div key={ps.id}>
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: ps.color }} />
                            <span className="text-sm font-semibold">{ps.name}</span>
                          </div>
                          <span className="text-sm font-bold font-mono">{fmtK(ps.planned)} ₼</span>
                        </div>
                        {/* Budget bar */}
                        <div className="w-full h-3 bg-muted rounded-full overflow-hidden mb-1">
                          <div className="h-full rounded-full transition-all duration-700" style={{ width: `${barW}%`, backgroundColor: ps.color, opacity: 0.8 }} />
                        </div>
                        <div className="flex justify-between text-[10px] text-muted-foreground">
                          <span>{t("compActualLabel")}: {ps.actual > 0 ? `${fmtK(ps.actual)} ₼` : "—"}</span>
                          <span>{pctOfPlan > 0 ? `${pctOfPlan}% ${t("compExecutionSuffix")}` : t("compNoActuals")}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Delta between first two plans */}
                {planSummaries.length >= 2 && (
                  <div className="mt-4 pt-4 border-t border-border/50">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 font-semibold">{t("compDeltaLabel")}: {planSummaries[0].name} vs {planSummaries[1].name}</div>
                    {(() => {
                      const delta = planSummaries[0].planned - planSummaries[1].planned
                      const deltaPct = planSummaries[1].planned > 0 ? ((delta / planSummaries[1].planned) * 100) : 0
                      return (
                        <div className="flex items-center gap-3">
                          <span className={`text-lg font-bold font-mono ${delta >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                            {delta >= 0 ? "+" : ""}{fmtK(delta)} ₼
                          </span>
                          <Badge variant={delta >= 0 ? "default" : "destructive"} className="text-xs">
                            {delta >= 0 ? "+" : ""}{deltaPct.toFixed(1)}%
                          </Badge>
                        </div>
                      )
                    })()}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* P4-04: Materiality filter */}
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="font-medium">{t("materialityThreshold")}</span>
            <div className="flex items-center gap-1">
              <Input type="number" value={materialityPct} onChange={e => setMaterialityPct(Number(e.target.value))} className="h-7 w-16 text-xs text-right" /> %
            </div>
            <div className="flex items-center gap-1">
              <Input type="number" value={materialityAbs} onChange={e => setMaterialityAbs(Number(e.target.value))} className="h-7 w-20 text-xs text-right" /> ₼
            </div>
            <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => setShowAll(!showAll)}>
              {showAll ? t("btnHideMaterial") : t("btnShowAll")}
            </Button>
          </div>

          {/* P4-03: Variance table */}
          <Card className="border-0 shadow-md">
            <CardHeader><CardTitle className="text-sm flex items-center gap-2"><FileSpreadsheet className="h-4 w-4 text-slate-500" />{t("tableComparison")}</CardTitle></CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 z-10 bg-[#1a3050] border-b-2 border-white/10">
                    <tr>
                      <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white/90 sticky left-0 bg-[#1a3050]">{t("colCategory")}</th>
                      {selectedIds.map((id, i) => {
                        const name = plans.find(p => p.id === id)?.name || `${t("colPlan")} ${i + 1}`
                        return [
                          <th key={`${id}-p`} className="px-2 py-3 text-right text-xs font-semibold uppercase tracking-wider" style={{ color: COMPARISON_COLORS[i] }}>{name} {t("colBudget")}</th>,
                          <th key={`${id}-a`} className="px-2 py-3 text-right text-xs font-semibold uppercase tracking-wider" style={{ color: COMPARISON_COLORS[i] }}>{name} {t("colActual")}</th>,
                          <th key={`${id}-v`} className="px-2 py-3 text-right text-xs font-semibold uppercase tracking-wider" style={{ color: COMPARISON_COLORS[i] }}>{t("colVarianceShort")} %</th>,
                        ]
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {tableCategories.filter(isMaterial).map(row => (
                      <tr key={row.category} className="border-t border-border/50 hover:bg-muted/30">
                        <td className="px-3 py-1.5 font-medium sticky left-0 bg-background">{row.category}</td>
                        {selectedIds.map((_id, i) => [
                          <td key={`${row.category}-p${i}-p`} className="px-2 py-1.5 text-right font-mono">{fmt(row[`p${i}_planned`])}</td>,
                          <td key={`${row.category}-p${i}-a`} className="px-2 py-1.5 text-right font-mono">{fmt(row[`p${i}_actual`])}</td>,
                          <td key={`${row.category}-p${i}-v`} className={`px-2 py-1.5 text-right font-mono font-bold ${(row[`p${i}_variance`] ?? 0) >= 0 ? "text-[#065f46] dark:text-[#6ee7b7]" : "text-red-500"}`}>
                            {(row[`p${i}_pct`] ?? 0).toFixed(1)}%
                          </td>,
                        ])}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t-2 border-border bg-muted/30">
                    <tr>
                      <td className="px-3 py-2 font-bold sticky left-0 bg-muted/30">{t("totalLabel")}</td>
                      {selectedIds.map((_id, i) => {
                        const a = analyticsArr[i]
                        return [
                          <td key={`total-p${i}-p`} className="px-2 py-2 text-right font-mono font-bold">{fmt(a?.totalPlanned ?? 0)}</td>,
                          <td key={`total-p${i}-a`} className="px-2 py-2 text-right font-mono font-bold">{fmt(a?.totalActual ?? 0)}</td>,
                          <td key={`total-p${i}-v`} className={`px-2 py-2 text-right font-mono font-bold ${(a?.totalVariance ?? 0) >= 0 ? "text-[#065f46] dark:text-[#6ee7b7]" : "text-red-500"}`}>
                            {a?.totalPlanned ? ((a.totalVariance / a.totalPlanned) * 100).toFixed(1) : "0.0"}%
                          </td>,
                        ]
                      })}
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
