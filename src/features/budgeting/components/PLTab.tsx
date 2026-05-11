"use client"

/**
 * Phase 7.G Turn LXVI — Phase 3.1 third slice: PLTab extracted from
 * `src/app/(dashboard)/budgeting/page.tsx` into its own feature module.
 *
 * Continues the LX (VarianceTab) + LXI (ComparisonTab) extraction
 * pattern. PLTab is the THIRD-largest tab and was filed in ROADMAP §3.1
 * as the next biggest payoff with concrete dep-audit blocker:
 *   - Cross-tab state coupling: useBudgetSections / useCreateBudgetSection
 *     / useDeleteBudgetSection (used by other budgeting tabs too — but
 *     re-importing in this file is fine, hooks have stable identity)
 *   - 4 inline sub-components defined INSIDE the function body via
 *     arrow-function closure (ExecBar / KPICard / WaterfallTooltip /
 *     DonutTooltip) — they capture closure variables (t / formatters /
 *     drilldown state), so they MUST stay inside the function. Extraction
 *     is a verbatim move; no sub-component split this turn.
 *
 * Pure refactor — zero behaviour change. tsc + vitest preserved
 * byte-for-byte (no new tests; existing inline tabs have none, setting
 * a precedent of test-only-on-extraction would block the extraction
 * itself per Turn LX rationale).
 *
 * After LXVI: page.tsx 4875 → ~3990 LOC (-885). Cumulative LX+LXI+LXVI:
 * 5479 → ~3990 (-1489 = -27% of original god-component).
 */

import React, { useState } from "react"
import { useTranslations } from "next-intl"
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, CartesianGrid, LabelList,
  ComposedChart, Line,
} from "recharts"
import {
  Banknote, ChevronDown, ChevronRight, DollarSign, LayoutGrid,
  List, Loader2, PiggyBank, Plus, Settings, Target, Trash2,
  TrendingDown, TrendingUp,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DataBoundary } from "@/components/ui/data-boundary"
import {
  useBudgetAnalytics,
  useBudgetSections,
  useCreateBudgetSection,
  useDeleteBudgetSection,
} from "@/lib/budgeting/hooks"
import {
  BUDGET_COLORS, ANIMATION, AXIS_TICK, fmtK,
} from "@/lib/budget-chart-theme"
import { AnimatedNumber } from "@/components/animated-number"
import { execPct } from "@/lib/budgeting/exec-pct"
import { SECTION_TYPES } from "@/lib/budgeting/types"
import { isContraRevenueCode } from "@/lib/budgeting/coa-role"
// Additional lucide icons not in initial import block (caught by tsc).
import { BarChart2, Settings2 } from "lucide-react"


export function PLTab({ planId, companyId }: { planId: string; companyId?: string | null }) {
  const t = useTranslations("budgeting")
  const { data: analytics, isLoading: analyticsLoading } = useBudgetAnalytics(planId, companyId)
  const { data: sections = [], isLoading: sectionsLoading } = useBudgetSections(planId)
  const createSection = useCreateBudgetSection()
  const deleteSection = useDeleteBudgetSection()
  const collapsedInitRef = React.useRef(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [showAddSection, setShowAddSection] = useState(false)
  const [newSectionName, setNewSectionName] = useState("")
  const [newSectionType, setNewSectionType] = useState("expense")
  const [drilldown, setDrilldown] = useState<string | null>(null)
  const [allExpanded, setAllExpanded] = useState(false)
  const [plShowMaterialOnly, setPlShowMaterialOnly] = useState(false)
  const [plMaterialityPct, setPlMaterialityPct] = useState(5)
  const [plMaterialityAbs, setPlMaterialityAbs] = useState(500)

  const isPlMaterial = (row: { planned: number; actual: number }) => {
    const varianceAbsVal = Math.abs(row.planned - row.actual)
    const variancePctVal = row.planned > 0 ? (varianceAbsVal / row.planned) * 100 : 0
    return variancePctVal >= plMaterialityPct || varianceAbsVal >= plMaterialityAbs
  }

  const toggleCollapse = (id: string) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const byCategory = analytics?.byCategory ?? []

  const parentCategories = new Set(byCategory.filter(c => c.parentCategory).map(c => c.parentCategory!))
  const leafRows = byCategory.filter(c => !parentCategories.has(c.category) || c.parentCategory)

  // Parent row map: parent category name → its byCategory entry (has auto-actual values)
  const parentRowMap = new Map<string, typeof byCategory[0]>()
  for (const row of byCategory) {
    if (parentCategories.has(row.category) && !row.parentCategory) {
      parentRowMap.set(row.category, row)
    }
  }

  const revRows = leafRows.filter(c => c.lineType === "revenue")
  const cogsRows = leafRows.filter(c => c.lineType === "cogs")
  const expRows = leafRows.filter(c => c.lineType === "expense")

  // Split expenses into Direct Costs (labor + tech_infra) and Indirect/Overhead (admin + risk + standalone)
  const DIRECT_GROUPS = new Set(["Direct Labor Costs", "Technical Infrastructure"])
  const directExpRowsRaw = expRows.filter(c => c.parentCategory && DIRECT_GROUPS.has(c.parentCategory))
  const indirectExpRowsRaw = expRows.filter(c => !c.parentCategory || !DIRECT_GROUPS.has(c.parentCategory))

  // Fallback for non-IT workloads (e.g. cement/manufacturing imports):
  // if the imported P&L doesn't use the "Direct Labor Costs" / "Technical
  // Infrastructure" parent groups at all, treat cogs-typed rows as Direct
  // Costs. Overhead becomes ONLY the 711 (sales) and 721 (admin) expense
  // rows — items below EBITDA (depreciation 731, finance 741/751, tax 771,
  // 761/801) are collected separately and subtracted AFTER EBITDA so the
  // displayed "EBITDA" is the real metric, not a mislabelled Net Profit.
  const hasITStructure = directExpRowsRaw.length > 0
  const BELOW_EBITDA_PREFIXES = ["731", "741", "751", "761", "771", "801"]
  const rowCode = (r: typeof byCategory[number]) => (r as any).accountCode ?? r.category ?? ""
  const isBelowEBITDA = (r: typeof byCategory[number]) =>
    BELOW_EBITDA_PREFIXES.some((p) => rowCode(r).startsWith(p))
  const directExpRows = hasITStructure ? directExpRowsRaw : cogsRows
  const indirectExpRows = hasITStructure
    ? indirectExpRowsRaw
    : expRows.filter((r) => !isBelowEBITDA(r))
  const belowEbitdaRows = hasITStructure ? [] : expRows.filter(isBelowEBITDA)

  // Helper: get group actual — use parent's auto-actual if children sum to 0
  const getGroupActual = (parentName: string, childRows: typeof byCategory): number => {
    const childSum = childRows.reduce((s, r) => s + r.actual, 0)
    if (childSum > 0) return childSum
    const parentRow = parentRowMap.get(parentName)
    return parentRow?.actual ?? 0
  }

  const buildGrouped = (rows: typeof byCategory) => {
    const groups: { parent: string; children: typeof byCategory }[] = []
    const standalone: typeof byCategory = []
    const groupMap = new Map<string, typeof byCategory>()
    for (const r of rows) {
      if (r.parentCategory) {
        const existing = groupMap.get(r.parentCategory) ?? []
        existing.push(r)
        groupMap.set(r.parentCategory, existing)
      } else {
        standalone.push(r)
      }
    }
    for (const [parent, children] of groupMap) {
      groups.push({ parent, children })
    }
    return { groups, standalone }
  }

  const revGrouped = buildGrouped(revRows)
  const directGrouped = buildGrouped(directExpRows)
  const indirectGrouped = buildGrouped(indirectExpRows)
  const belowEbitdaGrouped = buildGrouped(belowEbitdaRows)

  const categoryCount = byCategory.length
  const sectionCount = sections.length
  React.useEffect(() => {
    if (collapsedInitRef.current || categoryCount === 0) return
    collapsedInitRef.current = true
    setCollapsed(prev => {
      const ids = new Set(prev)
      ids.add("auto-revenue")
      ids.add("auto-direct")
      ids.add("auto-indirect")
      return ids
    })
  }, [categoryCount, sectionCount])

  const toggleAll = () => {
    if (allExpanded) {
      const ids = new Set<string>()
      ids.add("auto-revenue")
      ids.add("auto-direct")
      ids.add("auto-indirect")
      setCollapsed(ids)
      setAllExpanded(false)
    } else {
      setCollapsed(new Set())
      setAllExpanded(true)
    }
  }

  if (analyticsLoading || sectionsLoading) {
    return <DataBoundary loading>{null}</DataBoundary>
  }

  // Revenue totals — also account for parent auto-actuals.
  // Contra-revenue rows (SAP 602 = returns, 603 = discounts) reduce net sales
  // rather than add to them. Without subtracting them here the Plan view shows
  // gross sales (18.4M) while the P&L Report shows net revenue (18.0M),
  // confusing finance reviewers.
  // Phase 7.G Turn LXXV (Phase 5.1) — delegates to canonical
  // `isContraRevenueCode` (single source of truth for prefix matching).
  const isContraRevenue = (r: typeof byCategory[number]) => isContraRevenueCode(rowCode(r))
  const revGross = revRows.filter((r) => !isContraRevenue(r)).reduce((s, r) => s + r.planned, 0)
  const revContra = revRows.filter(isContraRevenue).reduce((s, r) => s + r.planned, 0)
  const totalRevenuePlanned = revGross - revContra
  const revLeafActual = revRows.filter((r) => !isContraRevenue(r)).reduce((s, r) => s + r.actual, 0)
    - revRows.filter(isContraRevenue).reduce((s, r) => s + r.actual, 0)
  const totalRevenueActual = revLeafActual > 0 ? revLeafActual : revGrouped.groups.reduce((s, g) => s + getGroupActual(g.parent, g.children), 0) + revGrouped.standalone.reduce((s, r) => s + r.actual, 0)
  // Direct costs: labor + tech infrastructure — use parent auto-actuals when children have 0
  const totalDirectPlanned = directExpRows.reduce((s, r) => s + r.planned, 0)
  const totalDirectActual = directGrouped.groups.reduce((s, g) => s + getGroupActual(g.parent, g.children), 0) + directGrouped.standalone.reduce((s, r) => s + r.actual, 0)
  // Indirect costs: admin overhead + risk + standalone expense lines
  const totalIndirectPlanned = indirectExpRows.reduce((s, r) => s + r.planned, 0)
  const totalBelowEbitdaPlanned = belowEbitdaRows.reduce((s, r) => s + r.planned, 0)
  const totalBelowEbitdaActual = belowEbitdaRows.reduce((s, r) => s + r.actual, 0)
  const totalIndirectActual = indirectGrouped.groups.reduce((s, g) => s + getGroupActual(g.parent, g.children), 0) + indirectGrouped.standalone.reduce((s, r) => s + r.actual, 0)
  // Total all expenses (for KPI)
  const totalExpensePlanned = totalDirectPlanned + totalIndirectPlanned
  const totalExpenseActual = totalDirectActual + totalIndirectActual
  // P&L: Gross Profit = Revenue - Direct Costs
  const grossProfitPlanned = totalRevenuePlanned - totalDirectPlanned
  const grossProfitActual = totalRevenueActual - totalDirectActual
  // EBITDA = Gross Profit - Indirect Costs
  const opProfitPlanned = grossProfitPlanned - totalIndirectPlanned
  const opProfitActual = grossProfitActual - totalIndirectActual

  // execPct is imported from @/lib/budgeting/exec-pct (sign-aware, unit-tested).
  // NOTE: thresholds assume planned > 0. Behavior is undefined for the
  // (planned < 0, isExpense=true) edge case (e.g. budget for net refund −100,
  // actual −50 = under-recovery — execPct=150 reads "overrun" red here, but
  // semantically it's "less recovery than expected"). Not hit on AZMADE today;
  // revisit Phase 7.G if a customer chart of accounts produces negative-cost
  // rows.
  const execColor = (pct: number, isExpense: boolean) => {
    if (isExpense) return pct > 110 ? "bg-red-500" : pct > 90 ? "bg-amber-500" : "bg-emerald-500"
    return pct >= 90 ? "bg-emerald-500" : pct >= 70 ? "bg-amber-500" : "bg-red-500"
  }

  // Mini execution bar component
  const ExecBar = ({ actual, planned, isExpense = false, className = "" }: { actual: number; planned: number; isExpense?: boolean; className?: string }) => {
    const pct = execPct(actual, planned)
    const color = execColor(pct, isExpense)
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
        </div>
        <span className="text-[10px] font-mono text-muted-foreground w-8">{pct}%</span>
      </div>
    )
  }

  // Soft Tinted KPI scorecard
  const KPICard = ({ title, planned, actual, iconEl, accentClass, isExpense = false, marginPct, conditionalBg, valueColorClass }: {
    title: string; planned: number; actual: number; iconEl: React.ReactNode; accentClass: string; isExpense?: boolean; marginPct?: string; conditionalBg?: string; valueColorClass?: string
  }) => {
    const variance = isExpense ? planned - actual : actual - planned
    const pct = execPct(actual, planned)
    const bgClass = conditionalBg || "bg-gradient-to-br from-blue-50 to-blue-100 border border-blue-200 dark:from-blue-950/30 dark:to-blue-900/20 dark:border-blue-800"
    const valColor = valueColorClass || "text-blue-700 dark:text-blue-300"
    return (
      <div className={`rounded-xl p-5 ${bgClass}`}>
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">{title}</span>
          <div className={`h-9 w-9 rounded-full flex items-center justify-center ${accentClass}`}>
            {iconEl}
          </div>
        </div>
        <div className={`text-2xl font-bold tabular-nums ${valColor}`}>
          {actual < 0 ? `(${fmtK(Math.abs(actual))})` : fmtK(actual)} ₼
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          {t("kpiPlan").toLowerCase()}: {fmtK(planned)} ₼ · {pct}% {t("kpiExecution").toLowerCase()}
        </div>
        {marginPct && <div className="text-[10px] text-muted-foreground mt-0.5">{marginPct}</div>}
      </div>
    )
  }

  const renderSection = (title: string, rawRows: typeof byCategory, sectionId: string, sectionIcon: React.ReactNode, sectionColor: string, isCalculated = false, calcPlanned = 0, calcActual = 0, isExpense = false, rawGrouped?: { groups: { parent: string; children: typeof byCategory }[]; standalone: typeof byCategory }) => {
    const isCollapsed = collapsed.has(sectionId)
    // Apply materiality filter if enabled
    const rows = plShowMaterialOnly ? rawRows.filter(r => isPlMaterial(r)) : rawRows
    const grouped = rawGrouped ? {
      groups: (plShowMaterialOnly
        ? rawGrouped.groups.map(g => ({ ...g, children: g.children.filter(r => isPlMaterial(r)) })).filter(g => g.children.length > 0)
        : rawGrouped.groups),
      standalone: plShowMaterialOnly ? rawGrouped.standalone.filter(r => isPlMaterial(r)) : rawGrouped.standalone,
    } : rawGrouped
    const secPlanned = isCalculated ? calcPlanned : rows.reduce((s, r) => s + r.planned, 0)
    const secActual = isCalculated ? calcActual : rows.reduce((s, r) => s + r.actual, 0)
    const secVariance = isExpense ? secPlanned - secActual : secActual - secPlanned
    const secExecPct = execPct(secActual, secPlanned)
    const sectionTotal = secPlanned // for % of total per row

    return (
      <div key={sectionId} className="border border-border rounded-xl overflow-hidden mb-3 shadow-sm transition-all hover:shadow-md">
        <div
          className={`flex items-center justify-between px-4 py-3.5 cursor-pointer transition-colors ${sectionColor}`}
          onClick={() => toggleCollapse(sectionId)}
        >
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 font-bold text-sm">
              {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              {sectionIcon}
              {title}
            </div>
            {!isCalculated && rows.length > 0 && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-mono">{rows.length}</Badge>
            )}
          </div>
          <div className="flex items-center gap-4">
            {/* Execution bar in header */}
            <div className="hidden sm:flex items-center gap-2">
              <div className="w-20 h-2 bg-black/10 dark:bg-white/10 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-500 ${execColor(secExecPct, isExpense)}`} style={{ width: `${Math.min(secExecPct, 100)}%` }} />
              </div>
              <span className="text-[10px] font-mono opacity-70">{secExecPct}%</span>
            </div>
            <div className="flex gap-6 text-sm font-mono font-bold">
              <AnimatedNumber value={secPlanned} className="text-right min-w-[100px]" duration={800} />
              <AnimatedNumber value={secActual} className={`text-right min-w-[100px] ${secActual >= 0 ? "" : "text-red-600 dark:text-red-400"}`} duration={800} />
              <AnimatedNumber value={secVariance} duration={600}
                formatter={(n) => `${n >= 0 ? "+" : ""}${Math.round(n).toLocaleString()} ₼`}
                className={`text-right min-w-[80px] text-xs self-center ${secVariance >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-red-600 dark:text-red-400"}`} />
            </div>
          </div>
        </div>
        {!isCollapsed && !isCalculated && (
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-[#1a3050] border-b-2 border-white/10">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-white/90">{t("colCategory")}</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-sky-300">{t("colBudget")}</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-purple-300">{t("colForecast")}</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-emerald-300">{t("colActual")}</th>
                <th className="px-4 py-2.5 text-center text-xs font-semibold uppercase tracking-wider text-cyan-300">%</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-amber-300">{t("colVarianceShort")}</th>
              </tr>
            </thead>
            <tbody>
              {grouped ? (
                <>
                  {grouped.groups.map(g => {
                    const gPlanned = g.children.reduce((s, r) => s + r.planned, 0)
                    const gForecast = g.children.reduce((s, r) => s + r.forecast, 0)
                    const gActual = getGroupActual(g.parent, g.children)
                    const gVariance = isExpense ? gPlanned - gActual : gActual - gPlanned
                    const gPctOfTotal = sectionTotal > 0 ? Math.round((gPlanned / sectionTotal) * 100) : 0
                    const isGroupOpen = !collapsed.has(`pl-group-${g.parent}`)
                    return (
                      <React.Fragment key={g.parent}>
                        <tr className="border-t border-border/30 bg-muted/10 cursor-pointer hover:bg-muted/30 transition-colors"
                          onClick={() => toggleCollapse(`pl-group-${g.parent}`)}>
                          <td className="px-4 py-2.5 font-semibold">
                            <div className="flex items-center gap-2">
                              {isGroupOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                              {g.parent}
                              <Badge variant="outline" title={t("hintBadgeChildCount")} className="text-[10px] px-1 py-0">{g.children.length}</Badge>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-sm font-bold"><AnimatedNumber value={gPlanned} duration={700} /></td>
                          <td className="px-4 py-2.5 text-right font-mono text-sm font-bold"><AnimatedNumber value={gForecast} duration={700} /></td>
                          <td className="px-4 py-2.5 text-right font-mono text-sm font-bold"><AnimatedNumber value={gActual} duration={700} /></td>
                          <td className="px-4 py-2.5 text-center">
                            <span className="inline-block bg-muted/80 rounded-full px-2 py-0.5 text-[10px] font-mono font-bold">{gPctOfTotal}%</span>
                          </td>
                          <td className={`px-4 py-2.5 text-right font-mono text-sm font-bold ${gVariance >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-red-600 dark:text-red-400"}`}>
                            <div className="flex items-center justify-end gap-1.5">
                              {gVariance >= 0
                                ? <TrendingUp className="h-3 w-3" />
                                : <TrendingDown className="h-3 w-3" />}
                              <AnimatedNumber value={gVariance} duration={600} formatter={(n) => `${n >= 0 ? "+" : ""}${Math.round(n).toLocaleString()} ₼`} />
                            </div>
                          </td>
                        </tr>
                        {isGroupOpen && g.children.map((row, i) => {
                          const rowPct = gPlanned > 0 ? Math.round((row.planned / gPlanned) * 100) : 0
                          const isActive = drilldown === row.category
                          return (
                            <tr key={i} className={`border-t border-border/20 cursor-pointer transition-colors ${isActive ? "bg-primary/5" : "hover:bg-muted/20"}`}
                              onClick={() => setDrilldown(isActive ? null : row.category)}>
                              <td className="px-4 py-2 pl-10">
                                <div className="flex items-center gap-2 text-muted-foreground">
                                  <span className={`w-1.5 h-1.5 rounded-full ${isActive ? "bg-primary" : "bg-muted-foreground/30"}`} />
                                  {row.category}
                                </div>
                              </td>
                              <td className="px-4 py-2 text-right font-mono text-sm"><AnimatedNumber value={row.planned} duration={500} /></td>
                              <td className="px-4 py-2 text-right font-mono text-sm text-purple-600 dark:text-purple-400"><AnimatedNumber value={row.forecast} duration={500} /></td>
                              <td className="px-4 py-2 text-right font-mono text-sm"><AnimatedNumber value={row.actual} duration={500} /></td>
                              <td className="px-4 py-2 text-center">
                                <ExecBar actual={row.actual} planned={row.planned} isExpense={isExpense} />
                              </td>
                              <td className={`px-4 py-2 text-right font-mono text-sm font-semibold ${row.variance >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-red-600 dark:text-red-400"}`}>
                                <AnimatedNumber value={row.variance} duration={400} formatter={(n) => `${n >= 0 ? "+" : ""}${Math.round(n).toLocaleString()} ₼`} />
                              </td>
                            </tr>
                          )
                        })}
                      </React.Fragment>
                    )
                  })}
                  {grouped.standalone.map((row, i) => {
                    const isActive = drilldown === row.category
                    return (
                      <tr key={`s-${i}`} className={`border-t border-border/30 cursor-pointer transition-colors ${isActive ? "bg-primary/5" : "hover:bg-muted/20"}`}
                        onClick={() => setDrilldown(isActive ? null : row.category)}>
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            <span className={`w-1.5 h-1.5 rounded-full ${isActive ? "bg-primary" : "bg-muted-foreground/30"}`} />
                            {row.category}
                          </div>
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-sm"><AnimatedNumber value={row.planned} duration={500} /></td>
                        <td className="px-4 py-2 text-right font-mono text-sm text-purple-600 dark:text-purple-400"><AnimatedNumber value={row.forecast} duration={500} /></td>
                        <td className="px-4 py-2 text-right font-mono text-sm"><AnimatedNumber value={row.actual} duration={500} /></td>
                        <td className="px-4 py-2 text-center">
                          <ExecBar actual={row.actual} planned={row.planned} isExpense={isExpense} />
                        </td>
                        <td className={`px-4 py-2 text-right font-mono text-sm font-semibold ${row.variance >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-red-600 dark:text-red-400"}`}>
                          <AnimatedNumber value={row.variance} duration={400} formatter={(n) => `${n >= 0 ? "+" : ""}${Math.round(n).toLocaleString()} ₼`} />
                        </td>
                      </tr>
                    )
                  })}
                </>
              ) : (
                rows.map((row, i) => {
                  const isActive = drilldown === row.category
                  return (
                    <tr key={i} className={`border-t border-border/30 cursor-pointer transition-colors ${isActive ? "bg-primary/5" : "hover:bg-muted/20"}`}
                      onClick={() => setDrilldown(isActive ? null : row.category)}>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <span className={`w-1.5 h-1.5 rounded-full ${isActive ? "bg-primary" : "bg-muted-foreground/30"}`} />
                          {row.category}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-sm"><AnimatedNumber value={row.planned} duration={500} /></td>
                      <td className="px-4 py-2 text-right font-mono text-sm text-purple-600 dark:text-purple-400"><AnimatedNumber value={row.forecast} duration={500} /></td>
                      <td className="px-4 py-2 text-right font-mono text-sm"><AnimatedNumber value={row.actual} duration={500} /></td>
                      <td className="px-4 py-2 text-center">
                        <ExecBar actual={row.actual} planned={row.planned} isExpense={isExpense} />
                      </td>
                      <td className={`px-4 py-2 text-right font-mono text-sm font-semibold ${row.variance >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-red-600 dark:text-red-400"}`}>
                        <AnimatedNumber value={row.variance} duration={400} formatter={(n) => `${n >= 0 ? "+" : ""}${Math.round(n).toLocaleString()} ₼`} />
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* KPI Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPICard
          title={t("plRevenue")}
          planned={totalRevenuePlanned}
          actual={totalRevenueActual}
          iconEl={<DollarSign className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />}
          accentClass="bg-indigo-200 dark:bg-indigo-800"
          conditionalBg="bg-gradient-to-br from-indigo-50 to-indigo-100 border border-indigo-200 dark:from-indigo-950/30 dark:to-indigo-900/20 dark:border-indigo-800"
          valueColorClass="text-indigo-700 dark:text-indigo-300"
        />
        <KPICard
          title={t("grossProfit")}
          planned={grossProfitPlanned}
          actual={grossProfitActual}
          iconEl={grossProfitActual < 0 ? <TrendingDown className="h-4 w-4 text-red-600 dark:text-red-400" /> : <TrendingUp className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />}
          accentClass={grossProfitActual < 0 ? "bg-red-200 dark:bg-red-800" : "bg-emerald-200 dark:bg-emerald-800"}
          conditionalBg={grossProfitActual < 0
            ? "bg-gradient-to-br from-red-50 to-red-100 border border-red-200 dark:from-red-950/30 dark:to-red-900/20 dark:border-red-800"
            : "bg-gradient-to-br from-emerald-50 to-emerald-100 border border-emerald-200 dark:from-emerald-950/30 dark:to-emerald-900/20 dark:border-emerald-800"}
          valueColorClass={grossProfitActual < 0 ? "text-red-700 dark:text-red-300" : "text-emerald-700 dark:text-emerald-300"}
          marginPct={totalRevenuePlanned > 0 ? `Gross Margin: ${((grossProfitPlanned / totalRevenuePlanned) * 100).toFixed(1)}% (plan)` : undefined}
        />
        <KPICard
          title={t("plExpenses")}
          planned={totalExpensePlanned}
          actual={totalExpenseActual}
          iconEl={<Banknote className="h-4 w-4 text-orange-600 dark:text-orange-400" />}
          accentClass="bg-orange-200 dark:bg-orange-800"
          conditionalBg="bg-gradient-to-br from-orange-50 to-orange-100 border border-orange-200 dark:from-orange-950/30 dark:to-orange-900/20 dark:border-orange-800"
          valueColorClass="text-orange-700 dark:text-orange-300"
          isExpense
        />
        <KPICard
          title="EBITDA"
          planned={opProfitPlanned}
          actual={opProfitActual}
          iconEl={opProfitActual < 0 ? <TrendingDown className="h-4 w-4 text-red-600 dark:text-red-400" /> : <Target className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />}
          accentClass={opProfitActual < 0 ? "bg-red-200 dark:bg-red-800" : "bg-emerald-200 dark:bg-emerald-800"}
          conditionalBg={opProfitPlanned < 0
            ? "bg-gradient-to-br from-red-50 to-red-100 border border-red-200 dark:from-red-950/30 dark:to-red-900/20 dark:border-red-800"
            : "bg-gradient-to-br from-emerald-50 to-emerald-100 border border-emerald-200 dark:from-emerald-950/30 dark:to-emerald-900/20 dark:border-emerald-800"}
          valueColorClass={opProfitPlanned < 0 ? "text-red-700 dark:text-red-300" : "text-emerald-700 dark:text-emerald-300"}
          marginPct={totalRevenuePlanned > 0 ? `EBITDA Margin: ${((opProfitPlanned / totalRevenuePlanned) * 100).toFixed(1)}% (plan)` : undefined}
        />
      </div>

      {/* ── P&L INFOGRAPHICS: Waterfall + Expense Donut ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* P&L Waterfall Chart — 3/5 width */}
        <Card className="lg:col-span-3 border-0 shadow-md">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <BarChart2 className="h-4 w-4 text-indigo-500" />
              {t("pnlWaterfallTitle")}
            </CardTitle>
            <p className="text-xs text-muted-foreground">{t("pnlWaterfallSubtitle")}</p>
          </CardHeader>
          <CardContent className="pt-0">
            {(() => {
              const waterfallData = [
                { key: "Revenue", name: t("pnlWfRevenue"), value: totalRevenuePlanned, base: 0, isStart: true, color: BUDGET_COLORS.planIndigo },
                { key: "Direct Costs", name: t("pnlWfDirectCosts"), value: totalDirectPlanned, base: totalRevenuePlanned - totalDirectPlanned, positive: false, color: BUDGET_COLORS.negative },
                { key: "Gross Profit", name: t("pnlWfGrossProfit"), value: grossProfitPlanned, base: 0, isTotal: true, color: grossProfitPlanned >= 0 ? BUDGET_COLORS.actualGreen : BUDGET_COLORS.negative },
                { key: "Overhead", name: t("pnlWfOverhead"), value: totalIndirectPlanned, base: grossProfitPlanned - totalIndirectPlanned, positive: false, color: BUDGET_COLORS.warning },
                { key: "EBITDA", name: t("pnlWfEbitda"), value: opProfitPlanned, base: 0, isTotal: true, color: opProfitPlanned >= 0 ? BUDGET_COLORS.planViolet : BUDGET_COLORS.negative },
              ]
              const gpMargin = totalRevenuePlanned > 0 ? ((grossProfitPlanned / totalRevenuePlanned) * 100).toFixed(1) : "0"
              const ebitdaMargin = totalRevenuePlanned > 0 ? ((opProfitPlanned / totalRevenuePlanned) * 100).toFixed(1) : "0"

              const WaterfallTooltip = ({ active, payload }: any) => {
                if (!active || !payload?.length) return null
                const d = payload[0].payload
                return (
                  <div className="bg-popover/95 backdrop-blur-sm border border-border rounded-xl p-3 shadow-xl text-sm min-w-[180px]">
                    <div className="flex items-center gap-2 mb-1.5 border-b border-border/50 pb-1.5">
                      <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: d.color }} />
                      <span className="font-semibold text-popover-foreground">{d.name}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground text-xs">{t("pnlAmountLabel")}</span>
                      <span className="font-mono font-bold text-popover-foreground">{fmtK(Math.abs(d.value))} ₼</span>
                    </div>
                    {d.key === "Gross Profit" && (
                      <div className="text-[10px] text-muted-foreground mt-1">{t("pnlMarginLabel")}: {gpMargin}%</div>
                    )}
                    {d.key === "EBITDA" && (
                      <div className="text-[10px] text-muted-foreground mt-1">{t("pnlMarginLabel")}: {ebitdaMargin}%</div>
                    )}
                  </div>
                )
              }

              const WaterfallLabel = (props: any) => {
                const { x, y, width, index } = props
                const item = waterfallData[index]
                if (!item) return null
                const label = item.value < 0 ? `(${fmtK(Math.abs(item.value))})` : fmtK(item.value)
                return (
                  <text x={x + width / 2} y={y - 8} fill="#94a3b8" textAnchor="middle" fontSize={10} fontWeight={500} fontFamily="monospace">
                    {label} ₼
                  </text>
                )
              }

              return (
                <ResponsiveContainer width="100%" height={240}>
                  <ComposedChart data={waterfallData} margin={{ left: 5, right: 5, top: 25, bottom: 0 }}>
                    <defs>
                      {waterfallData.map((entry, i) => (
                        <linearGradient key={i} id={`pl-wf-${i}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={entry.color} stopOpacity={1} />
                          <stop offset="100%" stopColor={entry.color} stopOpacity={0.6} />
                        </linearGradient>
                      ))}
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted-foreground/15" vertical={false} />
                    <XAxis dataKey="name" tick={{ ...AXIS_TICK, fontWeight: 500 }} axisLine={{ stroke: "#e2e8f0", strokeWidth: 1 }} tickLine={false} />
                    <YAxis tick={AXIS_TICK} tickFormatter={v => fmtK(v)} axisLine={false} tickLine={false} />
                    <Tooltip content={<WaterfallTooltip />} cursor={{ fill: "hsl(var(--muted))", opacity: 0.3 }} />
                    <Bar dataKey="base" stackId="wf" fill="transparent" animationDuration={0} />
                    <Bar dataKey="value" stackId="wf" radius={[4, 4, 0, 0]} animationDuration={ANIMATION.duration} animationEasing={ANIMATION.easing}>
                      {waterfallData.map((_, i) => (
                        <Cell key={i} fill={`url(#pl-wf-${i})`} />
                      ))}
                      <LabelList content={WaterfallLabel} />
                    </Bar>
                  </ComposedChart>
                </ResponsiveContainer>
              )
            })()}
          </CardContent>
        </Card>

        {/* Expense Breakdown Donut — 2/5 width */}
        <Card className="lg:col-span-2 border-0 shadow-md">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <PiggyBank className="h-4 w-4 text-amber-500" />
              {t("pnlExpenseBreakdownTitle")}
            </CardTitle>
            <p className="text-xs text-muted-foreground">{t("pnlExpenseBreakdownSubtitle")}</p>
          </CardHeader>
          <CardContent className="pt-0">
            {(() => {
              const DONUT_COLORS = [
                "#6366f1", "#8b5cf6", "#a78bfa", "#c084fc",
                "#f472b6", "#fb923c", "#fbbf24", "#34d399",
                "#22d3ee", "#60a5fa", "#818cf8", "#e879f9",
              ]
              // Build expense categories from both direct and indirect groups
              const expenseItems: { name: string; value: number }[] = []
              for (const g of directGrouped.groups) {
                const total = g.children.reduce((s, r) => s + r.planned, 0)
                if (total > 0) expenseItems.push({ name: g.parent, value: total })
              }
              for (const r of directGrouped.standalone) {
                if (r.planned > 0) expenseItems.push({ name: r.category, value: r.planned })
              }
              for (const g of indirectGrouped.groups) {
                const total = g.children.reduce((s, r) => s + r.planned, 0)
                if (total > 0) expenseItems.push({ name: g.parent, value: total })
              }
              for (const r of indirectGrouped.standalone) {
                if (r.planned > 0) expenseItems.push({ name: r.category, value: r.planned })
              }
              // Sort by value descending
              expenseItems.sort((a, b) => b.value - a.value)
              const totalExp = expenseItems.reduce((s, e) => s + e.value, 0)

              if (expenseItems.length === 0) {
                return <div className="flex items-center justify-center h-[240px] text-sm text-muted-foreground">{t("pnlNoExpenseData")}</div>
              }

              const DonutTooltip = ({ active, payload }: any) => {
                if (!active || !payload?.length) return null
                const d = payload[0]
                const pct = totalExp > 0 ? ((d.value / totalExp) * 100).toFixed(1) : "0"
                return (
                  <div className="bg-popover/95 backdrop-blur-sm border border-border rounded-xl p-3 shadow-xl text-sm min-w-[160px]">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="w-3 h-3 rounded-full" style={{ backgroundColor: d.payload.fill }} />
                      <span className="font-semibold text-popover-foreground text-xs">{d.name}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="font-mono font-bold text-popover-foreground">{fmtK(d.value)} ₼</span>
                      <Badge variant="secondary" className="text-[10px] ml-2">{pct}%</Badge>
                    </div>
                  </div>
                )
              }

              const DonutLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }: any) => {
                if (percent < 0.05) return null
                const RADIAN = Math.PI / 180
                const radius = innerRadius + (outerRadius - innerRadius) * 0.5
                const x = cx + radius * Math.cos(-midAngle * RADIAN)
                const y = cy + radius * Math.sin(-midAngle * RADIAN)
                return (
                  <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight="bold">
                    {(percent * 100).toFixed(0)}%
                  </text>
                )
              }

              return (
                <div className="flex flex-col items-center">
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie
                        data={expenseItems}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={85}
                        dataKey="value"
                        nameKey="name"
                        animationDuration={ANIMATION.duration}
                        animationEasing={ANIMATION.easing}
                        labelLine={false}
                        label={DonutLabel}
                      >
                        {expenseItems.map((_, i) => (
                          <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip content={<DonutTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  {/* Legend below donut */}
                  <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 mt-1">
                    {expenseItems.slice(0, 6).map((item, i) => (
                      <div key={i} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                        <span className="truncate max-w-[80px]">{item.name}</span>
                      </div>
                    ))}
                    {expenseItems.length > 6 && (
                      <span className="text-[10px] text-muted-foreground">+{expenseItems.length - 6} more</span>
                    )}
                  </div>
                </div>
              )
            })()}
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{t("plTitle")}</h2>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={toggleAll} className="text-xs">
            {allExpanded ? <List className="h-3.5 w-3.5 mr-1" /> : <LayoutGrid className="h-3.5 w-3.5 mr-1" />}
            {allExpanded ? "Collapse All" : "Expand All"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowAddSection(v => !v)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> {t("btnAddSection")}
          </Button>
        </div>
      </div>

      {showAddSection && (
        <Card className="p-4">
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <label className="text-xs font-medium mb-1 block">{t("plSectionNameLabel")}</label>
              <Input value={newSectionName} onChange={e => setNewSectionName(e.target.value)} placeholder={t("plSectionNamePlaceholder")} />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">{t("plTypeLabel")}</label>
              <select value={newSectionType} onChange={e => setNewSectionType(e.target.value)}
                className="border border-border rounded-md px-3 py-2 text-sm bg-background">
                {SECTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <Button size="sm" onClick={async () => {
              if (!newSectionName) return
              await createSection.mutateAsync({ planId, name: newSectionName, sectionType: newSectionType })
              setNewSectionName("")
              setShowAddSection(false)
            }} disabled={createSection.isPending}>
              {createSection.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("btnCreate")}
            </Button>
          </div>
        </Card>
      )}

      {/* Materiality filter */}
      <div className="flex flex-wrap items-center gap-3 text-sm mb-3">
        <Button size="sm" variant={plShowMaterialOnly ? "default" : "outline"} className="h-8 text-xs"
          onClick={() => setPlShowMaterialOnly(!plShowMaterialOnly)}>
          {t("filterMaterial")}
        </Button>
        {plShowMaterialOnly && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>≥</span>
            <Input type="number" value={plMaterialityPct} onChange={e => setPlMaterialityPct(Number(e.target.value))} className="h-7 w-14 text-xs text-right" />
            <span>%</span>
            <span>{t("or")}</span>
            <Input type="number" value={plMaterialityAbs} onChange={e => setPlMaterialityAbs(Number(e.target.value))} className="h-7 w-20 text-xs text-right" />
            <span>₼</span>
          </div>
        )}
      </div>

      {/* P&L Income Statement — no COGS (allocated costs shown in Profitability module) */}
      {renderSection(t("plRevenue"), revRows, "auto-revenue", <DollarSign className="h-4 w-4" />, "bg-primary/[0.04]", true, totalRevenuePlanned, totalRevenueActual, false, revGrouped)}
      {renderSection("Direct Costs", directExpRows, "auto-direct", <Settings2 className="h-4 w-4" />, "bg-orange-50/60 dark:bg-orange-950/20", false, 0, 0, true, directGrouped)}

      {/* Gross Profit = Revenue - Direct Costs */}
      <div className={`border-2 rounded-xl overflow-hidden mb-3 ${grossProfitActual < 0 ? "border-red-400/50 dark:border-red-500/50 bg-gradient-to-r from-red-50 to-rose-50 dark:from-red-950/40 dark:to-rose-950/30" : "border-emerald-500/50 dark:border-emerald-600/50 bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/40 dark:to-teal-950/30"}`}>
        <div className="flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${grossProfitActual < 0 ? "bg-red-100 dark:bg-red-900/50" : "bg-emerald-100 dark:bg-emerald-900/50"}`}>
              {grossProfitActual < 0 ? <TrendingDown className="h-4 w-4 text-red-600 dark:text-red-400" /> : <TrendingUp className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />}
            </div>
            <div>
              <div className="font-bold text-base">{t("grossProfit")}</div>
              {totalRevenuePlanned > 0 && (
                <div className="text-xs text-muted-foreground mt-0.5">
                  {t("pnlGrossMarginLine", { planPct: ((grossProfitPlanned / totalRevenuePlanned) * 100).toFixed(1), actualPct: totalRevenueActual > 0 ? ((grossProfitActual / totalRevenueActual) * 100).toFixed(1) : "—" })}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-6 font-mono font-bold text-base">
            <AnimatedNumber value={grossProfitPlanned} duration={600} />
            <span className={grossProfitActual >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-red-600 dark:text-red-400"}>
              <AnimatedNumber value={grossProfitActual} duration={600} />
            </span>
            <span className={`text-sm ${grossProfitActual - grossProfitPlanned >= 0 ? "text-emerald-600" : "text-red-500"}`}>
              <AnimatedNumber value={grossProfitActual - grossProfitPlanned} duration={400} formatter={(n) => `${n >= 0 ? "+" : ""}${Math.round(n).toLocaleString()} ₼`} />
            </span>
          </div>
        </div>
      </div>

      {renderSection("Overhead Expenses", indirectExpRows, "auto-indirect", <Banknote className="h-4 w-4" />, "bg-amber-50/60 dark:bg-amber-950/20", false, 0, 0, true, indirectGrouped)}

      {/* EBITDA */}
      <div className={`border-2 rounded-xl overflow-hidden mb-3 ${opProfitActual < 0 ? "border-red-400/50 dark:border-red-500/50 bg-gradient-to-r from-red-50 to-rose-50 dark:from-red-950/40 dark:to-rose-950/30" : "border-purple-400/50 dark:border-purple-500/50 bg-gradient-to-r from-muted/50 to-purple-50 dark:from-purple-950/30 dark:to-purple-950/30"}`}>
        <div className="flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${opProfitActual < 0 ? "bg-red-100 dark:bg-red-900/50" : "bg-purple-100 dark:bg-purple-900/50"}`}>
              {opProfitActual < 0 ? <TrendingDown className="h-4 w-4 text-red-600 dark:text-red-400" /> : <Target className="h-4 w-4 text-purple-600 dark:text-purple-400" />}
            </div>
            <div>
              <div className="font-bold text-base">{t("operatingProfit")} (EBITDA)</div>
              {totalRevenuePlanned > 0 && (
                <div className="text-xs text-muted-foreground mt-0.5">
                  {t("pnlEbitdaMarginLine", { planPct: ((opProfitPlanned / totalRevenuePlanned) * 100).toFixed(1), actualPct: totalRevenueActual > 0 ? ((opProfitActual / totalRevenueActual) * 100).toFixed(1) : "—" })}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-6 font-mono font-bold text-base">
            <AnimatedNumber value={opProfitPlanned} duration={600} />
            <span className={opProfitActual >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-red-600 dark:text-red-400"}>
              <AnimatedNumber value={opProfitActual} duration={600} />
            </span>
            <span className={`text-sm ${opProfitActual - opProfitPlanned >= 0 ? "text-emerald-600" : "text-red-500"}`}>
              <AnimatedNumber value={opProfitActual - opProfitPlanned} duration={400} formatter={(n) => `${n >= 0 ? "+" : ""}${Math.round(n).toLocaleString()} ₼`} />
            </span>
          </div>
        </div>
      </div>

      {/* D&A / Finance / Tax — below-EBITDA items */}
      {belowEbitdaRows.length > 0 && (
        <>
          {renderSection("D&A, Finance & Tax", belowEbitdaRows, "auto-below-ebitda", <Banknote className="h-4 w-4" />, "bg-slate-50/60 dark:bg-slate-950/20", false, 0, 0, true, belowEbitdaGrouped)}

          {/* Net Profit */}
          {(() => {
            const netPlanned = opProfitPlanned - totalBelowEbitdaPlanned
            const netActual = opProfitActual - totalBelowEbitdaActual
            return (
              <div className={`border-2 rounded-xl overflow-hidden mb-3 ${netActual < 0 ? "border-red-400/50 dark:border-red-500/50 bg-gradient-to-r from-red-50 to-rose-50 dark:from-red-950/40 dark:to-rose-950/30" : "border-emerald-400/50 dark:border-emerald-500/50 bg-gradient-to-r from-emerald-50 to-muted/50 dark:from-emerald-950/30 dark:to-muted/50"}`}>
                <div className="flex items-center justify-between px-5 py-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${netActual < 0 ? "bg-red-100 dark:bg-red-900/50" : "bg-emerald-100 dark:bg-emerald-900/50"}`}>
                      {netActual < 0 ? <TrendingDown className="h-4 w-4 text-red-600 dark:text-red-400" /> : <Target className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />}
                    </div>
                    <div>
                      <div className="font-bold text-base">{t("pnlNetProfitLoss")}</div>
                      {totalRevenuePlanned > 0 && (
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {t("pnlNetMarginLine", { planPct: ((netPlanned / totalRevenuePlanned) * 100).toFixed(1) })}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-6 font-mono font-bold text-base">
                    <AnimatedNumber value={netPlanned} duration={600} />
                    <span className={netActual >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-red-600 dark:text-red-400"}>
                      <AnimatedNumber value={netActual} duration={600} />
                    </span>
                    <span className={`text-sm ${netActual - netPlanned >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                      <AnimatedNumber value={netActual - netPlanned} duration={400} formatter={(n) => `${n >= 0 ? "+" : ""}${Math.round(n).toLocaleString()} ₼`} />
                    </span>
                  </div>
                </div>
              </div>
            )
          })()}
        </>
      )}

      {/* Custom sections */}
      {sections.map(sec => (
        <div key={sec.id} className="border border-border rounded-xl overflow-hidden mb-3">
          <div className="flex items-center justify-between px-4 py-3 bg-muted/40">
            <span className="font-medium text-sm">{sec.name}</span>
            <button onClick={() => deleteSection.mutate({ id: sec.id, planId })}
              className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-muted-foreground hover:text-red-600">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ))}

      {/* Drill-down panel */}
      {drilldown && (
        <Card className="border-primary/20 bg-primary/[0.04] shadow-lg">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm text-primary flex items-center gap-2">
                <BarChart2 className="h-4 w-4" />
                {drilldown}
              </CardTitle>
              <button onClick={() => setDrilldown(null)} className="text-muted-foreground hover:text-foreground text-xs px-2 py-1 rounded hover:bg-muted transition-colors">✕ {t("btnClose")}</button>
            </div>
          </CardHeader>
          <CardContent>
            {(() => {
              const row = byCategory.find(r => r.category === drilldown)
              if (!row) return <p className="text-sm text-muted-foreground">{t("emptyNoData")}</p>
              const isExp = row.lineType === "expense" || row.lineType === "cogs"
              const maxVal = Math.max(row.planned, row.forecast, row.actual, 1)
              const items = [
                { label: t("colBudget"), value: row.planned, color: "#3b82f6" },
                { label: t("colForecast"), value: row.forecast, color: "#a855f7" },
                { label: t("colActual"), value: row.actual, color: "#10b981" },
              ]
              return (
                <div className="space-y-4">
                  {/* Visual bar comparison */}
                  <div className="space-y-2">
                    {items.map((item) => (
                      <div key={item.label} className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground w-20 text-right">{item.label}</span>
                        <div className="flex-1 h-6 bg-muted/40 rounded-md overflow-hidden relative">
                          <div
                            className="h-full rounded-md transition-all duration-700 flex items-center justify-end pr-2"
                            style={{ width: `${Math.max((item.value / maxVal) * 100, 2)}%`, backgroundColor: item.color }}
                          >
                            <span className="text-[10px] font-mono font-bold text-white drop-shadow-sm">
                              <AnimatedNumber value={item.value} duration={500} />
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* Stats grid */}
                  <div className="grid grid-cols-3 gap-4 pt-2 border-t border-border/30">
                    <div className="text-center">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{t("colVariance")}</p>
                      <p className={`font-bold font-mono text-sm ${row.variance >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>
                        <AnimatedNumber value={row.variance} duration={400} formatter={(n) => `${n >= 0 ? "+" : ""}${Math.round(n).toLocaleString()} ₼`} />
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{t("pnlDeviation")}</p>
                      <p className={`font-bold font-mono text-sm ${row.variancePct >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>
                        {row.variancePct >= 0 ? "+" : ""}{row.variancePct.toFixed(1)}%
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{t("pnlExecution")}</p>
                      <p className="font-bold font-mono text-sm">
                        {row.planned > 0 ? Math.round((row.actual / row.planned) * 100) : 0}%
                      </p>
                    </div>
                  </div>
                </div>
              )
            })()}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
