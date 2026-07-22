// ForecastTab — extracted from `src/app/(dashboard)/budgeting/page.tsx`
// Turn LXXXIX (Phase 3.1 ninth slice; ForecastTab body 738 LOC).
//
// Pure refactor — zero functional change. Monthly forecast matrix with
// scenario multipliers (base/optimistic/pessimistic) + revenue/cogs/expense
// rollup with ChevronDown collapsible groups + ComposedChart trend viz.
//
// Closure-leak risk: NONE — all hooks/components are leaf imports.
// Inline TrendTooltip (recharts custom tooltip) stays as local closure
// inside ForecastTab function (uses outer-scope state).
"use client"

import React, { useState, useMemo } from "react"
import { useLocale, useTranslations } from "next-intl"
import {
  Banknote, BarChart2, CheckCircle, ChevronDown, ChevronRight, DollarSign,
  Loader2, Plus, Settings2, Sparkles, Target, TrendingDown, TrendingUp,
} from "lucide-react"
import {
  Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DataBoundary } from "@/components/ui/data-boundary"
import { AnimatedNumber } from "@/components/animated-number"
// Phase 3.1 v1.3 — shared period→months helper. Replaces inline logic
// that duplicated cost-model-map.getPeriodMonths semantics.
import { getPeriodMonths } from "@/lib/budgeting/cost-model-map"
import { ANIMATION, AXIS_TICK } from "@/lib/budget-chart-theme"
import {
  useBudgetAnalytics, useBudgetForecastEntries, useBudgetLines,
  useCreateBudgetLine, useExchangeRates, useUpsertBudgetForecast,
} from "@/lib/budgeting/hooks"
import { type BudgetLine } from "@/lib/budgeting/types"
import {
  buildForecastViewLines,
  computeForecastPnl,
  computeForecastScenario,
  filterForecastEntriesForView,
  formatForecastDecimal,
  resolveForecastCell,
} from "@/lib/budgeting/forecast-view"

function fmt(n: number, locale: string, currencyCode: string | null): string {
  const amount = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.round(n))
  return currencyCode ? `${amount} ${currencyCode}` : amount
}

function fmtCompact(n: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n)
}

export function ForecastTab({ planId }: { planId: string }) {
  const t = useTranslations("budgeting")
  const locale = useLocale()
  const analyticsQuery = useBudgetAnalytics(planId)
  const forecastQuery = useBudgetForecastEntries(planId)
  const linesQuery = useBudgetLines(planId)
  const currencyQuery = useExchangeRates()
  const analytics = analyticsQuery.data
  const forecastEntries = forecastQuery.data ?? []
  const budgetLines = linesQuery.data ?? []
  const forecastView = useMemo(() => buildForecastViewLines(budgetLines), [budgetLines])
  const forecastLines = forecastView.lines
  const baseCurrency = currencyQuery.data?.currencies.find((currency) => currency.isBase)
  const currencyCode = baseCurrency?.code ?? null
  const compactAmount = (value: number) => {
    const amount = fmtCompact(value, locale)
    return currencyCode ? `${amount} ${currencyCode}` : amount
  }
  const upsertForecast = useUpsertBudgetForecast()
  const createLine = useCreateBudgetLine()

  const [editCell, setEditCell] = useState<{ category: string; lineType: string; month: number } | null>(null)
  const [editValue, setEditValue] = useState("")
  const [addingRevenue, setAddingRevenue] = useState(false)
  const [addingCogs, setAddingCogs] = useState(false)
  const [addingExpense, setAddingExpense] = useState(false)
  const [newCategory, setNewCategory] = useState("")
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set())
  const [fcCollapsed, setFcCollapsed] = useState<Set<string>>(() => new Set(["revenue", "cogs", "expense"]))
  const toggleFcSection = (key: string) => setFcCollapsed(prev => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next })
  const [scenario, setScenario] = useState<"base" | "optimistic" | "pessimistic">("base")
  const [showScenarioSettings, setShowScenarioSettings] = useState(false)
  const [scenarioMultipliers, setScenarioMultipliers] = useState({
    optimistic: { revenue: 110, cogs: 92, expense: 90 },
    pessimistic: { revenue: 90, cogs: 110, expense: 115 },
  })
  const scenarioName = scenario === "base"
    ? t("scenarioBase")
    : scenario === "optimistic"
      ? t("scenarioOptimistic")
      : t("scenarioPessimistic")

  const plan = analytics?.plan
  const year = plan?.year ?? new Date().getFullYear()

  // Determine months for this period. Phase 3.1 v1.3 — uses shared
  // `getPeriodMonths` helper (already covered by 7 unit tests in
  // cost-model-map.test.ts) instead of inline logic. Pre-plan fallback
  // = full year so the table doesn't collapse to 1 column on first
  // render before analytics resolves.
  const months = useMemo(() => {
    if (!plan) return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    return getPeriodMonths(plan).months
  }, [plan])

  const periodMonths = months.length

  const monthLabels = useMemo(() => {
    const all = t("monthsShort").split(",")
    return months.map(m => all[m - 1] || `M${m}`)
  }, [months, t])

  const forecastEntryScope = useMemo(
    () => filterForecastEntriesForView(forecastEntries, plan?.year, months, forecastLines),
    [forecastEntries, forecastLines, months, plan?.year],
  )

  // Build forecast lookup: category+lineType+month -> forecastAmount
  const forecastMap = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of forecastEntryScope.applied) {
      // `BudgetForecastEntry.lineType` is non-optional `string` per the
      // Prisma model + zod-validated route — defensively coerce empty
      // string to "expense" without an `as any` escape hatch.
      const lt = e.lineType || "expense"
      const key = `${e.category}||${lt}||${e.month}`
      m.set(key, (m.get(key) ?? 0) + e.forecastAmount)
    }
    return m
  }, [forecastEntryScope.applied])

  // Build lines map for default values (includes children)
  const linesMap = useMemo(() => {
    const m = new Map<string, BudgetLine>()
    for (const l of forecastLines) {
      m.set(`${l.category}||${l.lineType}`, l)
      if (l.children) {
        for (const c of l.children) m.set(`${c.category}||${c.lineType}`, c)
      }
    }
    return m
  }, [forecastLines])

  const revenueLines = useMemo(() => forecastLines.filter((l: BudgetLine) => l.lineType === "revenue"), [forecastLines])
  const cogsLines = useMemo(() => forecastLines.filter((l: BudgetLine) => l.lineType === "cogs"), [forecastLines])
  const expenseLines = useMemo(() => forecastLines.filter((l: BudgetLine) => l.lineType === "expense"), [forecastLines])

  // Scenario multiplier (editable)
  const getScenarioMultiplier = (lineType: string): number => {
    if (scenario === "base") return 1.0
    const m = scenarioMultipliers[scenario]
    if (lineType === "revenue") return m.revenue / 100
    if (lineType === "cogs") return m.cogs / 100
    return m.expense / 100
  }

  // Get cell value: saved forecast or default (planned / periodMonths), with scenario
  const getCellValue = (category: string, lineType: string, month: number): { value: number; isDefault: boolean } => {
    const key = `${category}||${lineType}||${month}`
    const saved = forecastMap.get(key)
    const multiplier = getScenarioMultiplier(lineType)
    const line = linesMap.get(`${category}||${lineType}`)
    if (!line) return { value: 0, isDefault: true }
    const resolved = resolveForecastCell(saved, line.plannedAmount, periodMonths, multiplier)
    return { value: resolved.value, isDefault: resolved.source === "plan_baseline" }
  }

  // Row total
  const getRowTotal = (category: string, lineType: string): number => {
    return months.reduce((s, m) => s + getCellValue(category, lineType, m).value, 0)
  }

  // Get all leaf lines from a set (expanding parent→children)
  const getLeafLines = (lines: BudgetLine[]): BudgetLine[] => {
    const result: BudgetLine[] = []
    for (const l of lines) {
      if (l.children?.length) {
        result.push(...l.children)
      } else {
        result.push(l)
      }
    }
    return result
  }

  // Column total for a set of lines (uses leaf lines to avoid double-counting)
  const getColTotal = (lines: BudgetLine[], month: number): number => {
    return getLeafLines(lines).reduce((s, l) => s + getCellValue(l.category, l.lineType, month).value, 0)
  }

  // Section total
  const getSectionTotal = (lines: BudgetLine[]): number => {
    return getLeafLines(lines).reduce((s, l) => s + getRowTotal(l.category, l.lineType), 0)
  }

  // Group row total (sum children)
  const getGroupColTotal = (children: BudgetLine[], month: number): number => {
    return children.reduce((s, c) => s + getCellValue(c.category, c.lineType, month).value, 0)
  }
  const getGroupRowTotal = (children: BudgetLine[]): number => {
    return children.reduce((s, c) => s + getRowTotal(c.category, c.lineType), 0)
  }

  // KPI values
  const totalRevenue = getSectionTotal(revenueLines)
  const totalCogs = getSectionTotal(cogsLines)
  const totalExpense = getSectionTotal(expenseLines)
  const savedEntryCount = forecastEntryScope.applied.length
  // Gross Profit = Revenue - COGS; EBITDA = Gross Profit - OpEx (totalExpense).
  // Earlier this block deducted OpEx from revenue only, which inflated EBITDA
  // by the full COGS amount (user saw 25.8M instead of -4.6M for the AAC demo).
  const totals = computeForecastPnl(totalRevenue, totalCogs, totalExpense)
  const totalGrossProfit = totals.grossProfit
  const totalMargin = totals.ebitda
  const getMonthlyPnl = (month: number) => computeForecastPnl(
    getColTotal(revenueLines, month),
    getColTotal(cogsLines, month),
    getColTotal(expenseLines, month),
  )

  // Inline edit handlers
  const startEdit = (category: string, lineType: string, month: number) => {
    if (scenario !== "base") return
    const { value } = getCellValue(category, lineType, month)
    setEditCell({ category, lineType, month })
    setEditValue(String(Math.round(value)))
  }

  const saveEdit = async () => {
    if (!editCell) return
    const val = Number(editValue)
    if (isNaN(val) || val < 0) { setEditCell(null); return }
    await upsertForecast.mutateAsync([{
      planId,
      month: editCell.month,
      year,
      category: editCell.category,
      lineType: editCell.lineType,
      forecastAmount: val,
    }])
    setEditCell(null)
    setEditValue("")
  }

  // Add new category
  const handleAddCategory = async (lineType: "revenue" | "expense" | "cogs") => {
    if (!newCategory.trim()) return
    await createLine.mutateAsync({
      planId,
      category: newCategory.trim(),
      lineType,
      plannedAmount: 0,
    })
    // Create zero forecast entries for each month
    const entries = months.map(m => ({
      planId,
      month: m,
      year,
      category: newCategory.trim(),
      forecastAmount: 0,
      lineType,
    }))
    await upsertForecast.mutateAsync(entries)
    setNewCategory("")
    setAddingRevenue(false)
    setAddingCogs(false)
    setAddingExpense(false)
  }

  const loading = analyticsQuery.isLoading || forecastQuery.isLoading || linesQuery.isLoading || currencyQuery.isLoading
  const loadError = analyticsQuery.error || forecastQuery.error || linesQuery.error
  if (loading) return <div data-testid="forecast-loading"><DataBoundary loading>{null}</DataBoundary></div>
  if (loadError) {
    return (
      <div data-testid="forecast-error">
        <DataBoundary error={t("forecastLoadError")}>{null}</DataBoundary>
      </div>
    )
  }
  if (!plan) {
    return (
      <div data-testid="forecast-error">
        <DataBoundary error={t("forecastPlanUnavailable")}>{null}</DataBoundary>
      </div>
    )
  }
  if (forecastLines.length === 0) {
    return (
      <Card data-testid="forecast-empty">
        <CardContent className="p-12 text-center">
          <TrendingUp className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium text-foreground">{t("forecastEmptyTitle")}</p>
          <p className="mx-auto mt-1 max-w-xl text-sm text-muted-foreground">{t("forecastEmptyDescription")}</p>
        </CardContent>
      </Card>
    )
  }

  const renderRow = (line: BudgetLine) => {
    const rowTotal = getRowTotal(line.category, line.lineType)
    const isChild = !!line.parentId
    return (
      <tr key={`${line.id}-${line.lineType}`} className="border-t border-border/50 hover:bg-muted/30">
        <td className="px-3 py-2 text-sm font-medium sticky left-0 bg-background z-10 min-w-[180px]">
          {isChild ? <span className="pl-5 text-muted-foreground">— {line.category}</span> : line.category}
        </td>
        {months.map(m => {
          const { value, isDefault } = getCellValue(line.category, line.lineType, m)
          const isEditing = editCell?.category === line.category && editCell?.lineType === line.lineType && editCell?.month === m
          return (
            <td key={m} className="px-2 py-2 text-right min-w-[90px]">
              {isEditing ? (
                <Input type="number" className="h-7 w-24 text-right text-xs ml-auto" value={editValue} autoFocus
                  onChange={e => setEditValue(e.target.value)}
                  onBlur={() => saveEdit()}
                  onKeyDown={e => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditCell(null) }} />
              ) : (
                 <button type="button"
                  // impeccable polish: purple-50/900 → primary tokens
                  // (AI-tell removal). Inline table-cell button kept
                  // as raw <button> — design-system <Button> doesn't
                  // fit editable-cell pattern.
                   className={`font-mono text-sm px-1 rounded border border-transparent transition-colors ${scenario === "base" ? "cursor-pointer hover:bg-primary/5 dark:hover:bg-primary/10 hover:border-primary/40" : "cursor-not-allowed opacity-70"} ${isDefault ? "text-muted-foreground italic" : ""}`}
                   disabled={scenario !== "base"}
                   title={scenario !== "base" ? t("forecastEditBaseOnly") : undefined}
                   onClick={() => startEdit(line.category, line.lineType, m)}>
                  {fmt(value, locale, currencyCode)}
                </button>
              )}
            </td>
          )
        })}
        <td className="px-3 py-2 text-right font-mono text-sm font-bold min-w-[100px]"><AnimatedNumber value={rowTotal} duration={400} /></td>
      </tr>
    )
  }

  const GROUP_COLORS: Record<string, string> = {
    "group:admin":      "bg-violet-500",
    "group:tech_infra": "bg-sky-500",
    "group:labor":      "bg-emerald-500",
    "group:risk":       "bg-amber-500",
  }

  const renderGroupHeaderRow = (line: BudgetLine) => {
    const children = line.children ?? []
    const groupTag = line.notes ?? ""
    const colorClass = GROUP_COLORS[groupTag] ?? "bg-muted-foreground/40"
    const isOpen = expandedGroups.has(groupTag.replace("group:", ""))
    const toggleGroup = () => {
      const key = groupTag.replace("group:", "")
      setExpandedGroups(prev => {
        const next = new Set(prev)
        next.has(key) ? next.delete(key) : next.add(key)
        return next
      })
    }

    return (
      <React.Fragment key={line.id}>
        <tr className="border-t border-border/40 bg-muted/20 hover:bg-muted/40 cursor-pointer select-none" onClick={toggleGroup}>
          <td className="px-3 py-2 sticky left-0 bg-muted/20 z-10 min-w-[180px]">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full shrink-0 ${colorClass}`} />
              {isOpen ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
              <span className="font-semibold text-sm">{line.category}</span>
              <Badge variant="outline" title={t("hintBadgeChildCount")} className="text-[10px] px-1 py-0">{children.length}</Badge>
            </div>
          </td>
          {months.map(m => (
            <td key={m} className="px-2 py-2 text-right font-mono text-sm font-semibold"><AnimatedNumber value={getGroupColTotal(children, m)} duration={400} /></td>
          ))}
          <td className="px-3 py-2 text-right font-mono text-sm font-bold"><AnimatedNumber value={getGroupRowTotal(children)} duration={500} /></td>
        </tr>
        {isOpen && children.map(child => renderRow(child))}
      </React.Fragment>
    )
  }

  const renderSection = (title: string, lines: BudgetLine[], isAdding: boolean, setIsAdding: (v: boolean) => void, lineType: "revenue" | "expense" | "cogs") => {
    const isFcCollapsed = fcCollapsed.has(lineType)
    return (
    <>
      {/* Clickable header with totals */}
      <tr className="bg-muted/40 hover:bg-muted/60 transition-colors select-none">
        <td className="px-3 py-1.5 sticky left-0 bg-muted/40 z-10">
          <button
            type="button"
            data-testid={
              lineType === "revenue"
                ? "forecast-section-revenue"
                : lineType === "cogs"
                  ? "forecast-section-cogs"
                  : "forecast-section-expense"
            }
            aria-expanded={!isFcCollapsed}
            onClick={() => toggleFcSection(lineType)}
            className="flex w-full items-center gap-2 text-left"
          >
            <svg className={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 ${isFcCollapsed ? "" : "rotate-90"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{title}</span>
            <span className="text-[10px] text-muted-foreground/60">{lines.length}</span>
          </button>
        </td>
        {months.map(m => (
          <td key={m} className="px-2 py-1.5 text-right font-mono text-xs font-bold"><AnimatedNumber value={getColTotal(lines, m)} duration={400} /></td>
        ))}
        <td className="px-3 py-1.5 text-right font-mono text-xs font-bold"><AnimatedNumber value={getSectionTotal(lines)} duration={500} /></td>
      </tr>
      {/* Detail rows */}
      {!isFcCollapsed && lines.map(l => {
        if (l.children && l.children.length > 0) return renderGroupHeaderRow(l)
        return renderRow(l)
      })}
      {/* Add row (only when expanded) */}
      {!isFcCollapsed && (isAdding ? (
        <tr className="border-t border-border/50 bg-green-50 dark:bg-green-900/10">
          <td className="px-3 py-1 sticky left-0 bg-green-50 dark:bg-green-900/10 z-10">
            <div className="flex items-center gap-1">
              <Input placeholder={t("placeholderCategoryShort")} className="h-7 text-xs" value={newCategory}
                onChange={e => setNewCategory(e.target.value)} autoFocus
                onKeyDown={e => { if (e.key === "Enter") handleAddCategory(lineType); if (e.key === "Escape") { setIsAdding(false); setNewCategory("") } }} />
              <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => handleAddCategory(lineType)}
                disabled={createLine.isPending}>
                {createLine.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => { setIsAdding(false); setNewCategory("") }}>
                {t("btnCancel")}
              </Button>
            </div>
          </td>
          <td colSpan={months.length + 1} />
        </tr>
      ) : (
        <tr className="border-t border-dashed border-border/30">
          <td colSpan={months.length + 2} className="px-3 py-1.5">
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={() => { setIsAdding(true); setNewCategory("") }}
              className="h-auto p-0 text-xs"
            >
              <Plus className="h-3.5 w-3.5" /> {t("btnAddRow")}
            </Button>
          </td>
        </tr>
      ))}
    </>
  )}

  return (
    <div className="space-y-6" data-testid="forecast-guide-root">
      <div data-testid="forecast-provenance" className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-800 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300">
        {t("forecastBaselineNotice", {
          saved: savedEntryCount,
          sourceLines: forecastView.sourceLineCount,
          categories: forecastLines.length,
          ignored: forecastEntryScope.ignoredCount,
        })}
      </div>
      <div
        data-testid={currencyCode ? "forecast-currency-known" : "forecast-currency-unknown"}
        className={`rounded-lg border px-3 py-2 text-xs ${currencyCode ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300" : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"}`}
      >
        {currencyCode
          ? t("forecastCurrencyKnown", { code: currencyCode })
          : currencyQuery.error
            ? t("forecastCurrencyUnavailable")
            : t("forecastCurrencyUnknown")}
      </div>
      {/* Scenario toggle */}
      <div className="flex items-center gap-3" data-testid="forecast-scenario-controls">
        <span className="text-sm font-semibold">{t("scenarioLabel")}</span>
        <div className="flex gap-1">
          {(["base", "optimistic", "pessimistic"] as const).map(s => (
            <Button key={s} data-testid={s === "base" ? "forecast-scenario-base" : s === "optimistic" ? "forecast-scenario-optimistic" : "forecast-scenario-pessimistic"} size="sm" variant={scenario === s ? "default" : "outline"} className="h-8 text-sm px-4"
              title={s === "base" ? t("hintScenarioBase") : s === "optimistic" ? t("hintScenarioOptimistic") : t("hintScenarioPessimistic")}
              onClick={() => setScenario(s)}>
              {s === "base" ? t("scenarioBase") : s === "optimistic" ? t("scenarioOptimistic") : t("scenarioPessimistic")}
            </Button>
          ))}
        </div>
        {scenario !== "base" && (
          <Badge variant="secondary" className="text-xs">
            {scenario === "optimistic" ? t("hintScenarioOptimistic") : t("hintScenarioPessimistic")}
          </Badge>
        )}
        <Button data-testid="forecast-settings-toggle" aria-expanded={showScenarioSettings} size="sm" variant="ghost" className="h-8 text-xs ml-auto" onClick={() => setShowScenarioSettings(v => !v)}>
          <Settings2 className="h-3.5 w-3.5 mr-1" />
          {showScenarioSettings ? t("forecastSettingsHide") : t("forecastSettingsShow")}
        </Button>
      </div>

      {/* KPI Cards — Soft Tinted style */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="forecast-kpis">
        <div data-testid="forecast-kpi-revenue" className="rounded-xl bg-gradient-to-br from-indigo-50 to-indigo-100 border border-indigo-200 dark:from-indigo-950/30 dark:to-indigo-900/20 dark:border-indigo-800 p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">{t("forecastRevenueTotal")}</span>
            <div className="h-9 w-9 rounded-full flex items-center justify-center bg-indigo-200 dark:bg-indigo-800">
              <TrendingUp className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            </div>
          </div>
          <div className="text-2xl font-bold tabular-nums text-indigo-700 dark:text-indigo-300">{compactAmount(totalRevenue)}</div>
          <div className="text-xs text-muted-foreground mt-1">{scenario !== "base" ? `${scenario === "optimistic" ? t("scenarioOptimistic") : t("scenarioPessimistic")} · ×${formatForecastDecimal(getScenarioMultiplier("revenue"), locale, 2)}` : t("forecastBaseScenario")}</div>
        </div>
        <div data-testid="forecast-kpi-cogs" className="rounded-xl bg-gradient-to-br from-cyan-50 to-cyan-100 border border-cyan-200 dark:from-cyan-950/30 dark:to-cyan-900/20 dark:border-cyan-800 p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">{t("sectionCOGS")}</span>
            <div className="h-9 w-9 rounded-full flex items-center justify-center bg-cyan-200 dark:bg-cyan-800">
              <DollarSign className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
            </div>
          </div>
          <div className="text-2xl font-bold tabular-nums text-cyan-700 dark:text-cyan-300">{compactAmount(totalCogs)}</div>
          <div className="text-xs text-muted-foreground mt-1">{totals.cogsShareOfRevenue !== null ? t("forecastShareOfRevenue", { value: formatForecastDecimal(totals.cogsShareOfRevenue, locale, 1) }) : "—"}</div>
        </div>
        <div data-testid="forecast-kpi-expense" className="rounded-xl bg-gradient-to-br from-orange-50 to-orange-100 border border-orange-200 dark:from-orange-950/30 dark:to-orange-900/20 dark:border-orange-800 p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">{t("forecastExpenseTotal")}</span>
            <div className="h-9 w-9 rounded-full flex items-center justify-center bg-orange-200 dark:bg-orange-800">
              <Banknote className="h-4 w-4 text-orange-600 dark:text-orange-400" />
            </div>
          </div>
          <div className="text-2xl font-bold tabular-nums text-orange-700 dark:text-orange-300">{compactAmount(totalExpense)}</div>
          <div className="text-xs text-muted-foreground mt-1">{totals.expenseShareOfRevenue !== null ? t("forecastShareOfRevenue", { value: formatForecastDecimal(totals.expenseShareOfRevenue, locale, 1) }) : "—"}</div>
        </div>
        <div data-testid="forecast-kpi-ebitda" className={`rounded-xl p-5 ${totalMargin >= 0 ? "bg-gradient-to-br from-emerald-50 to-emerald-100 border border-emerald-200 dark:from-emerald-950/30 dark:to-emerald-900/20 dark:border-emerald-800" : "bg-gradient-to-br from-red-50 to-red-100 border border-red-200 dark:from-red-950/30 dark:to-red-900/20 dark:border-red-800"}`}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">EBITDA</span>
            <div className={`h-9 w-9 rounded-full flex items-center justify-center ${totalMargin >= 0 ? "bg-purple-200 dark:bg-purple-800" : "bg-red-200 dark:bg-red-800"}`}>
              {totalMargin >= 0 ? <Target className="h-4 w-4 text-purple-600 dark:text-purple-400" /> : <TrendingDown className="h-4 w-4 text-red-600 dark:text-red-400" />}
            </div>
          </div>
          <div className={`text-2xl font-bold tabular-nums ${totalMargin >= 0 ? "text-purple-700 dark:text-purple-300" : "text-red-700 dark:text-red-300"}`}>{totalMargin < 0 ? `(${compactAmount(Math.abs(totalMargin))})` : compactAmount(totalMargin)}</div>
          <div className="text-xs text-muted-foreground mt-1">{totals.ebitdaMargin !== null ? t("forecastEbitdaMargin", { value: formatForecastDecimal(totals.ebitdaMargin, locale, 1) }) : "—"}</div>
        </div>
      </div>

      {/* ── FORECAST CHARTS: Monthly Trend + Scenario Comparison ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Monthly Forecast Trend — 3/5 */}
        <Card className="lg:col-span-3 border-0 shadow-md" data-testid="forecast-monthly-trend">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <BarChart2 className="h-4 w-4 text-indigo-500" />
              {t("fcMonthlyTrend")}
            </CardTitle>
            <p className="text-xs text-muted-foreground">{t("fcMonthlyTrendSubtitle", { scenario: scenarioName })}</p>
          </CardHeader>
          <CardContent className="pt-0">
            {(() => {
              const trendData = months.map((m, i) => {
                const monthly = getMonthlyPnl(m)
                return {
                  name: monthLabels[i],
                  revenue: monthly.revenue,
                  expenses: monthly.cogs + monthly.operatingExpense,
                  profit: monthly.ebitda,
                }
              })

              // Phase 8 D3(y) (2026-05-28) — Recharts Tooltip content
              // callback; mirror only the fields we render.
              type TrendTooltipProps = {
                active?: boolean
                label?: string
                payload?: Array<{ dataKey: string | number; color?: string; value?: number }>
              }
              const TrendTooltip = ({ active, payload, label }: TrendTooltipProps) => {
                if (!active || !payload?.length) return null
                return (
                  <div className="bg-popover/95 backdrop-blur-sm border border-border rounded-xl p-3 shadow-xl text-sm min-w-[180px]">
                    <div className="font-semibold text-popover-foreground mb-2 border-b border-border/50 pb-1.5">{label}</div>
                    {payload.map((p) => (
                      <div key={String(p.dataKey)} className="flex justify-between items-center gap-4 py-0.5">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: p.color }} />
                          <span className="text-xs text-muted-foreground">
                            {p.dataKey === "revenue" ? t("forecastLegendRevenue") : p.dataKey === "expenses" ? t("forecastLegendExpenses") : t("forecastLegendEbitda")}
                          </span>
                        </div>
                        <span className="font-mono font-bold text-popover-foreground text-xs">{compactAmount(p.value ?? 0)}</span>
                      </div>
                    ))}
                  </div>
                )
              }

              return (
                <ResponsiveContainer width="100%" height={220}>
                  <ComposedChart data={trendData} margin={{ left: 5, right: 5, top: 15, bottom: 0 }}>
                    <defs>
                      <linearGradient id="fc-rev-grad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#22c55e" stopOpacity={0.9} />
                        <stop offset="100%" stopColor="#22c55e" stopOpacity={0.5} />
                      </linearGradient>
                      <linearGradient id="fc-exp-grad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f97316" stopOpacity={0.9} />
                        <stop offset="100%" stopColor="#f97316" stopOpacity={0.5} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted-foreground/15" vertical={false} />
                    <XAxis dataKey="name" tick={{ ...AXIS_TICK, fontWeight: 500 }} axisLine={false} tickLine={false} />
                    <YAxis tick={AXIS_TICK} tickFormatter={v => fmtCompact(v, locale)} axisLine={false} tickLine={false} />
                    <Tooltip content={<TrendTooltip />} cursor={{ fill: "hsl(var(--muted))", opacity: 0.3 }} />
                    <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} />
                    <Bar dataKey="revenue" fill="url(#fc-rev-grad)" radius={[3, 3, 0, 0]} animationDuration={ANIMATION.duration} name={t("forecastLegendRevenue")} />
                    <Bar dataKey="expenses" fill="url(#fc-exp-grad)" radius={[3, 3, 0, 0]} animationDuration={ANIMATION.duration} name={t("forecastLegendExpenses")} />
                    <Line type="monotone" dataKey="profit" stroke="#8b5cf6" strokeWidth={2.5} dot={{ r: 3, fill: "#8b5cf6" }} name={t("forecastLegendEbitda")} animationDuration={ANIMATION.duration} />
                  </ComposedChart>
                </ResponsiveContainer>
              )
            })()}
          </CardContent>
        </Card>

        {/* Scenario Comparison — 2/5 */}
        <Card className="lg:col-span-2 border-0 shadow-md" data-testid="forecast-scenario-comparison">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-purple-500" />
              {t("fcScenarioComparison")}
            </CardTitle>
            <p className="text-xs text-muted-foreground">{t("fcScenarioComparisonSubtitle")}</p>
          </CardHeader>
          <CardContent className="pt-0">
            {(() => {
              // Calculate the unmultiplied category baseline once, then apply
              // line-type-specific multipliers through the canonical P&L helper.
              const calcBaseTotal = (lt: string) => {
                return getLeafLines(lt === "revenue" ? revenueLines : lt === "cogs" ? cogsLines : expenseLines)
                  .reduce((s, l) => {
                    const key = `${l.category}||${l.lineType}`
                    // Get base value (without scenario multiplier)
                    const baseVal = months.reduce((ms, m) => {
                      const k = `${key}||${m}`
                      const saved = forecastMap.get(k)
                      if (saved !== undefined) return ms + saved
                      const line = linesMap.get(`${l.category}||${l.lineType}`)
                      return ms + (line ? line.plannedAmount / periodMonths : 0)
                    }, 0)
                    return s + baseVal
                  }, 0)
              }

              const sm = scenarioMultipliers
              const baseRevenue = calcBaseTotal("revenue")
              const baseCogs = calcBaseTotal("cogs")
              const baseExpense = calcBaseTotal("expense")
              const scenarios = [
                {
                  key: "pessimistic",
                  name: t("scenarioPessimistic"),
                  pnl: computeForecastScenario(baseRevenue, baseCogs, baseExpense, {
                    revenue: sm.pessimistic.revenue / 100,
                    cogs: sm.pessimistic.cogs / 100,
                    expense: sm.pessimistic.expense / 100,
                  }),
                  color: "#ef4444",
                },
                {
                  key: "base",
                  name: t("scenarioBase"),
                  pnl: computeForecastScenario(baseRevenue, baseCogs, baseExpense, {
                    revenue: 1,
                    cogs: 1,
                    expense: 1,
                  }),
                  color: "#6366f1",
                },
                {
                  key: "optimistic",
                  name: t("scenarioOptimistic"),
                  pnl: computeForecastScenario(baseRevenue, baseCogs, baseExpense, {
                    revenue: sm.optimistic.revenue / 100,
                    cogs: sm.optimistic.cogs / 100,
                    expense: sm.optimistic.expense / 100,
                  }),
                  color: "#22c55e",
                },
              ].map(s => ({
                ...s,
                revenue: s.pnl.revenue,
                costs: s.pnl.cogs + s.pnl.operatingExpense,
                profit: s.pnl.ebitda,
              }))

              return (
                <div className="space-y-3 mt-2">
                  {scenarios.map((s, i) => {
                    const maxProfit = Math.max(...scenarios.map(x => Math.abs(x.profit)), 1)
                    const barW = Math.abs(s.profit) / maxProfit * 100
                    return (
                      <div key={i} data-testid={`forecast-comparison-${s.key}`}>
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                            <span className="text-sm font-medium">{s.name}</span>
                          </div>
                          <span className={`text-sm font-bold font-mono ${s.profit < 0 ? "text-red-500" : "text-emerald-600 dark:text-emerald-400"}`}>
                            {s.profit < 0 ? `−${compactAmount(Math.abs(s.profit))}` : `+${compactAmount(s.profit)}`}
                          </span>
                        </div>
                        <div className="w-full h-2.5 bg-muted rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-700" style={{ width: `${barW}%`, backgroundColor: s.color, opacity: 0.7 }} />
                        </div>
                        <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                          <span>{t("fcRevAbbrev")}: {compactAmount(s.revenue)}</span>
                          <span>{t("fcCostsAbbrev")}: {compactAmount(s.costs)}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })()}
          </CardContent>
        </Card>
      </div>

      {/* Scenario Settings Panel */}
      {showScenarioSettings && (
        <Card className="border-0 shadow-md" data-testid="forecast-settings-panel">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-slate-500" />
              {t("fcScenarioMultipliersTitle")}
            </CardTitle>
            <p className="text-xs text-muted-foreground">{t("fcScenarioMultipliersSubtitle")}</p>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Optimistic */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                  <span className="text-sm font-semibold">{t("scenarioOptimistic")}</span>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">{t("fcRevenuePct")}</label>
                    <Input type="number" className="h-8 text-sm text-center" value={scenarioMultipliers.optimistic.revenue}
                      onChange={e => setScenarioMultipliers(prev => ({ ...prev, optimistic: { ...prev.optimistic, revenue: Number(e.target.value) } }))} />
                  </div>
                  <div>
                    <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">{t("fcCogsPct")}</label>
                    <Input type="number" className="h-8 text-sm text-center" value={scenarioMultipliers.optimistic.cogs}
                      onChange={e => setScenarioMultipliers(prev => ({ ...prev, optimistic: { ...prev.optimistic, cogs: Number(e.target.value) } }))} />
                  </div>
                  <div>
                    <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">{t("fcExpensesPct")}</label>
                    <Input type="number" className="h-8 text-sm text-center" value={scenarioMultipliers.optimistic.expense}
                      onChange={e => setScenarioMultipliers(prev => ({ ...prev, optimistic: { ...prev.optimistic, expense: Number(e.target.value) } }))} />
                  </div>
                </div>
              </div>
              {/* Pessimistic */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
                  <span className="text-sm font-semibold">{t("scenarioPessimistic")}</span>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">{t("fcRevenuePct")}</label>
                    <Input type="number" className="h-8 text-sm text-center" value={scenarioMultipliers.pessimistic.revenue}
                      onChange={e => setScenarioMultipliers(prev => ({ ...prev, pessimistic: { ...prev.pessimistic, revenue: Number(e.target.value) } }))} />
                  </div>
                  <div>
                    <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">{t("fcCogsPct")}</label>
                    <Input type="number" className="h-8 text-sm text-center" value={scenarioMultipliers.pessimistic.cogs}
                      onChange={e => setScenarioMultipliers(prev => ({ ...prev, pessimistic: { ...prev.pessimistic, cogs: Number(e.target.value) } }))} />
                  </div>
                  <div>
                    <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">{t("fcExpensesPct")}</label>
                    <Input type="number" className="h-8 text-sm text-center" value={scenarioMultipliers.pessimistic.expense}
                      onChange={e => setScenarioMultipliers(prev => ({ ...prev, pessimistic: { ...prev.pessimistic, expense: Number(e.target.value) } }))} />
                  </div>
                </div>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground mt-3">{t("fcMultipliersHelpText")}</p>
          </CardContent>
        </Card>
      )}

      {/* Monthly P&L Summary (sticky at top so user doesn't have to scroll) */}
      <Card className="border-0 shadow-md overflow-hidden" data-testid="forecast-pnl-summary">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[#1a3050]">
                <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-white/80 sticky left-0 bg-[#1a3050] z-10 min-w-[120px]">{t("fcPnlSummaryHeader")}</th>
                {monthLabels.map((label, i) => (
                  <th key={i} className="px-2 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-sky-300/70 min-w-[80px]">{label}</th>
                ))}
                <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wider text-amber-300 min-w-[90px]">{t("totalLabel")}</th>
              </tr>
            </thead>
            <tbody className="text-xs font-mono">
              <tr className="border-b border-border/30 bg-emerald-50/50 dark:bg-emerald-950/10">
                <td className="px-3 py-1.5 font-semibold text-emerald-700 dark:text-emerald-400 sticky left-0 bg-emerald-50/50 dark:bg-emerald-950/10 z-10">{t("fcPnlRowRevenue")}</td>
                {months.map(m => (
                  <td key={m} className="px-2 py-1.5 text-right">{fmtCompact(getColTotal(revenueLines, m), locale)}</td>
                ))}
                <td className="px-3 py-1.5 text-right font-bold">{fmtCompact(totalRevenue, locale)}</td>
              </tr>
              <tr className="border-b border-border/30">
                <td className="px-3 py-1.5 font-semibold text-muted-foreground sticky left-0 bg-background z-10">{t("fcPnlRowCosts")}</td>
                {months.map(m => {
                  const costs = getColTotal(cogsLines, m) + getColTotal(expenseLines, m)
                  return <td key={m} className="px-2 py-1.5 text-right">{fmtCompact(costs, locale)}</td>
                })}
                <td className="px-3 py-1.5 text-right font-bold">{fmtCompact(totalCogs + totalExpense, locale)}</td>
              </tr>
              <tr data-testid="forecast-pnl-ebitda" className={`${totalMargin >= 0 ? "bg-purple-50/50 dark:bg-purple-950/10" : "bg-red-50/50 dark:bg-red-950/10"}`}>
                <td className={`px-3 py-1.5 font-bold sticky left-0 z-10 ${totalMargin >= 0 ? "text-purple-700 dark:text-purple-400 bg-purple-50/50 dark:bg-purple-950/10" : "text-red-600 dark:text-red-400 bg-red-50/50 dark:bg-red-950/10"}`}>EBITDA</td>
                {months.map(m => {
                  const profit = getMonthlyPnl(m).ebitda
                  return <td key={m} className={`px-2 py-1.5 text-right font-bold ${profit < 0 ? "text-red-500" : ""}`}>{fmtCompact(profit, locale)}</td>
                })}
                <td className={`px-3 py-1.5 text-right font-bold ${totalMargin < 0 ? "text-red-500" : ""}`}>{fmtCompact(totalMargin, locale)}</td>
              </tr>
              <tr className="bg-purple-50/30 dark:bg-purple-950/5">
                <td className="px-3 py-1 text-[11px] font-medium text-purple-600 dark:text-purple-400 sticky left-0 z-10 bg-purple-50/30 dark:bg-purple-950/5">{t("ebitdaMarginPct")}</td>
                {months.map(m => {
                  const ebitdaMargin = getMonthlyPnl(m).ebitdaMargin
                  const pct = ebitdaMargin !== null ? formatForecastDecimal(ebitdaMargin, locale, 1) : "—"
                  return <td key={m} className={`px-2 py-1 text-right text-[11px] font-medium ${ebitdaMargin !== null && ebitdaMargin < 0 ? "text-red-500" : "text-purple-600 dark:text-purple-400"}`}>{pct}{pct !== "—" ? "%" : ""}</td>
                })}
                <td className={`px-3 py-1 text-right text-[11px] font-bold ${totalMargin < 0 ? "text-red-500" : "text-purple-600 dark:text-purple-400"}`}>{totals.ebitdaMargin !== null ? `${formatForecastDecimal(totals.ebitdaMargin, locale, 1)}%` : "—"}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      {/* Monthly matrix table */}
      <Card data-testid="forecast-matrix">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-[#1a3050] border-b-2 border-white/10">
                <tr>
                  <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white/90 sticky left-0 bg-[#1a3050] z-20 min-w-[180px]">{t("colCategory")}</th>
                  {monthLabels.map((label, i) => (
                    <th key={i} className="px-2 py-3 text-right text-xs font-semibold uppercase tracking-wider text-sky-300/80 min-w-[90px]">{label}</th>
                  ))}
                  <th className="px-3 py-3 text-right text-xs font-bold uppercase tracking-wider text-amber-300 min-w-[100px]">{t("totalLabel")}</th>
                </tr>
              </thead>
              <tbody>
                {renderSection(t("sectionRevenues"), revenueLines, addingRevenue, setAddingRevenue, "revenue")}
                {renderSection(t("sectionCOGS"), cogsLines, addingCogs, setAddingCogs, "cogs")}

                {/* Gross Profit row */}
                <tr data-testid="forecast-matrix-gross-profit" className={`border-t-2 ${totalGrossProfit < 0 ? "border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/10" : "border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/10"}`}>
                  <td className={`px-3 py-2 font-bold text-sm sticky left-0 z-10 ${totalGrossProfit < 0 ? "bg-red-50 dark:bg-red-900/10" : "bg-emerald-50 dark:bg-emerald-900/10"}`}>{t("grossProfit")}</td>
                  {months.map(m => {
                    const gpVal = getMonthlyPnl(m).grossProfit
                    return (
                    <td key={m} className={`px-2 py-2 text-right font-mono text-sm font-bold ${gpVal < 0 ? "text-red-600 dark:text-red-400" : ""}`}>
                      <AnimatedNumber value={gpVal} duration={500} />
                    </td>
                    )
                  })}
                  <td className={`px-3 py-2 text-right font-mono text-sm font-bold ${totalGrossProfit < 0 ? "text-red-600 dark:text-red-400" : ""}`}><AnimatedNumber value={totalGrossProfit} duration={600} /></td>
                </tr>

                {renderSection(t("sectionExpenses"), expenseLines, addingExpense, setAddingExpense, "expense")}

                {/* EBITDA row */}
                <tr data-testid="forecast-matrix-ebitda" className={`border-t-2 ${totalMargin < 0 ? "border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/10" : "border-purple-300 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/10"}`}>
                  <td className={`px-3 py-2 font-bold text-sm sticky left-0 z-10 ${totalMargin < 0 ? "bg-red-50 dark:bg-red-900/10" : "bg-purple-50 dark:bg-purple-900/10"}`}>EBITDA</td>
                  {months.map(m => {
                    const opVal = getMonthlyPnl(m).ebitda
                    return (
                    <td key={m} className={`px-2 py-2 text-right font-mono text-sm font-bold ${opVal < 0 ? "text-red-600 dark:text-red-400" : ""}`}>
                      <AnimatedNumber value={opVal} duration={500} />
                    </td>
                    )
                  })}
                  <td className={`px-3 py-2 text-right font-mono text-sm font-bold ${totalMargin < 0 ? "text-red-600 dark:text-red-400" : ""}`}><AnimatedNumber value={totalMargin} duration={600} /></td>
                </tr>
                {/* {t("ebitdaMarginPct")} row */}
                <tr className={`${totalMargin < 0 ? "bg-red-50/50 dark:bg-red-900/5" : "bg-purple-50/50 dark:bg-purple-900/5"}`}>
                  <td className={`px-3 py-1 text-[11px] font-medium sticky left-0 z-10 ${totalMargin < 0 ? "text-red-500 bg-red-50/50 dark:bg-red-900/5" : "text-purple-600 dark:text-purple-400 bg-purple-50/50 dark:bg-purple-900/5"}`}>{t("ebitdaMarginPct")}</td>
                  {months.map(m => {
                    const ebitdaMargin = getMonthlyPnl(m).ebitdaMargin
                    const pct = ebitdaMargin !== null ? formatForecastDecimal(ebitdaMargin, locale, 1) : "—"
                    return (
                    <td key={m} className={`px-2 py-1 text-right text-[11px] font-medium ${ebitdaMargin !== null && ebitdaMargin < 0 ? "text-red-500" : "text-purple-600 dark:text-purple-400"}`}>
                      {pct}{pct !== "—" ? "%" : ""}
                    </td>
                    )
                  })}
                  <td className={`px-3 py-1 text-right text-[11px] font-bold ${totalMargin < 0 ? "text-red-500" : "text-purple-600 dark:text-purple-400"}`}>{totals.ebitdaMargin !== null ? `${formatForecastDecimal(totals.ebitdaMargin, locale, 1)}%` : "—"}</td>
                </tr>

                {/* Empty state */}
                {budgetLines.length === 0 && (
                  <tr>
                    <td colSpan={months.length + 2} className="text-center py-12 text-muted-foreground">
                      {t("emptyNoLines")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ─── Templates Tab ───────────────────────────────────────────────────────────
