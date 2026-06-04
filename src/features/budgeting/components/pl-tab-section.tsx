"use client"
/**
 * PLTab P&L section + KPI-card renderers — extracted from PLTab.tsx (Phase 8
 * D1 2026-05-29) to bring that monolithic component under the 1000-LOC line.
 * `renderSection` (+ its internal `ExecBar` / `execColor`) and `KPICard` were
 * closures capturing component state; the bodies are byte-identical — the
 * captured state/callbacks are now destructured from an explicit typed `ctx`
 * bag, so behaviour is unchanged. The component calls both in its JSX.
 */
import React from "react"
import type { Dispatch, SetStateAction } from "react"
import { ChevronDown, ChevronRight, TrendingDown, TrendingUp } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { AnimatedNumber } from "@/components/animated-number"
import { MonthlySparkline } from "./monthly-sparkline"
import { execPct } from "@/lib/budgeting/exec-pct"
import { fmtK } from "@/lib/budget-chart-theme"
import { type BudgetCategoryRow } from "@/lib/budgeting/types"

export interface PlSectionCtx {
  t: (key: string, values?: Record<string, string | number>) => string
  byCategory: BudgetCategoryRow[]
  collapsed: Set<string>
  toggleCollapse: (id: string) => void
  drilldown: string | null
  setDrilldown: Dispatch<SetStateAction<string | null>>
  pulseDrilldown: boolean
  plShowMaterialOnly: boolean
  isPlMaterial: (row: { planned: number; actual: number }) => boolean
  flashSection: string | null
  drillToSection: (barKey: string) => void
  getGroupActual: (parentName: string, childRows: BudgetCategoryRow[]) => number
  // False when per-category actuals aren't available for this plan (a budget
  // plan whose realized figures live in a different-taxonomy Actuals plan).
  // The actual / variance / execution cells then render "—" instead of a
  // misleading 0 / −planned; the aggregate headline stays in the KPI cards.
  perCategoryActualsAvailable: boolean
}

export function makePlSection(ctx: PlSectionCtx) {
  const {
    t, byCategory, collapsed, toggleCollapse, drilldown, setDrilldown,
    pulseDrilldown, plShowMaterialOnly, isPlMaterial, flashSection, drillToSection,
    getGroupActual, perCategoryActualsAvailable,
  } = ctx

  // "—" placeholder for actual / variance / execution cells when per-category
  // actuals aren't available. Keeps the column's right-alignment + width so
  // the table doesn't reflow. `extra` carries the cell's min-width class.
  const naDash = (extra = "") => (
    <span className={`text-muted-foreground/50 font-mono ${extra}`}>—</span>
  )

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
      <div
        key={sectionId}
        // Phase 3.3 ext — DOM anchor for drillToSection's smooth scroll.
        id={`pl-section-${sectionId}`}
        className={`border border-border rounded-xl overflow-hidden mb-3 shadow-sm transition-all hover:shadow-md ${flashSection === sectionId ? "ring-2 ring-indigo-500" : ""}`}
      >
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
            {/* Execution bar in header — only meaningful with real actuals */}
            {perCategoryActualsAvailable && (
              <div className="hidden sm:flex items-center gap-2">
                <div className="w-20 h-2 bg-black/10 dark:bg-white/10 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-500 ${execColor(secExecPct, isExpense)}`} style={{ width: `${Math.min(secExecPct, 100)}%` }} />
                </div>
                <span className="text-[10px] font-mono opacity-70">{secExecPct}%</span>
              </div>
            )}
            <div className="flex gap-6 text-sm font-mono font-bold">
              <AnimatedNumber value={secPlanned} className="text-right min-w-[100px]" duration={800} />
              {perCategoryActualsAvailable
                ? <AnimatedNumber value={secActual} className={`text-right min-w-[100px] ${secActual >= 0 ? "" : "text-red-600 dark:text-red-400"}`} duration={800} />
                : naDash("text-right min-w-[100px]")}
              {perCategoryActualsAvailable
                ? <AnimatedNumber value={secVariance} duration={600}
                    formatter={(n) => `${n >= 0 ? "+" : ""}${Math.round(n).toLocaleString()} ₼`}
                    className={`text-right min-w-[80px] text-xs self-center ${secVariance >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-red-600 dark:text-red-400"}`} />
                : naDash("text-right min-w-[80px] text-xs self-center")}
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
                          <td className="px-4 py-2.5 text-right font-mono text-sm font-bold">{perCategoryActualsAvailable ? <AnimatedNumber value={gActual} duration={700} /> : naDash()}</td>
                          <td className="px-4 py-2.5 text-center">
                            <span className="inline-block bg-muted/80 rounded-full px-2 py-0.5 text-[10px] font-mono font-bold">{gPctOfTotal}%</span>
                          </td>
                          <td className={`px-4 py-2.5 text-right font-mono text-sm font-bold ${perCategoryActualsAvailable ? (gVariance >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-red-600 dark:text-red-400") : ""}`}>
                            {perCategoryActualsAvailable ? (
                              <div className="flex items-center justify-end gap-1.5">
                                {gVariance >= 0
                                  ? <TrendingUp className="h-3 w-3" />
                                  : <TrendingDown className="h-3 w-3" />}
                                <AnimatedNumber value={gVariance} duration={600} formatter={(n) => `${n >= 0 ? "+" : ""}${Math.round(n).toLocaleString()} ₼`} />
                              </div>
                            ) : naDash()}
                          </td>
                        </tr>
                        {isGroupOpen && g.children.map((row, i) => {
                          const rowPct = gPlanned > 0 ? Math.round((row.planned / gPlanned) * 100) : 0
                          const isActive = drilldown === row.category
                          const rowMonthly = row.monthlyPlanned
                          const rowMonthlyActual = row.monthlyActual
                          return (
                            <React.Fragment key={i}>
                            <tr
                              data-pl-category={row.category}
                              className={`border-t border-border/20 cursor-pointer transition-colors ${isActive ? "bg-primary/5" : "hover:bg-muted/20"} ${isActive && pulseDrilldown ? "shadow-[inset_0_0_0_2px_rgb(99,102,241)]" : ""}`}
                              onClick={() => setDrilldown(isActive ? null : row.category)}>
                              <td className="px-4 py-2 pl-10">
                                <div className="flex items-center gap-2 text-muted-foreground">
                                  <span className={`w-1.5 h-1.5 rounded-full ${isActive ? "bg-primary" : "bg-muted-foreground/30"}`} />
                                  {row.category}
                                </div>
                              </td>
                              <td className="px-4 py-2 text-right font-mono text-sm"><AnimatedNumber value={row.planned} duration={500} /></td>
                              <td className="px-4 py-2 text-right font-mono text-sm text-purple-600 dark:text-purple-400"><AnimatedNumber value={row.forecast} duration={500} /></td>
                              <td className="px-4 py-2 text-right font-mono text-sm">{(row.actualAvailable ?? perCategoryActualsAvailable) ? <AnimatedNumber value={row.actual} duration={500} /> : naDash()}</td>
                              <td className="px-4 py-2 text-center">
                                {(row.actualAvailable ?? perCategoryActualsAvailable) ? <ExecBar actual={row.actual} planned={row.planned} isExpense={isExpense} /> : naDash()}
                              </td>
                              <td className={`px-4 py-2 text-right font-mono text-sm font-semibold ${(row.actualAvailable ?? perCategoryActualsAvailable) ? (row.variance >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-red-600 dark:text-red-400") : ""}`}>
                                {(row.actualAvailable ?? perCategoryActualsAvailable) ? <AnimatedNumber value={row.variance} duration={400} formatter={(n) => `${n >= 0 ? "+" : ""}${Math.round(n).toLocaleString()} ₼`} /> : naDash()}
                              </td>
                            </tr>
                            {/* Phase 3.1 v1.2 ext — drill expansion row.
                                Shows the row's 12-month plan + actual
                                sparkline so the user sees seasonality
                                without leaving PLTab. */}
                            {isActive && rowMonthly && (
                              <tr
                                className="border-t-0 bg-primary/[0.02]"
                                data-pl-drill-row={row.category}
                              >
                                <td colSpan={6} className="px-4 py-2 pl-14">
                                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                                    <span className="uppercase tracking-wider">12-month</span>
                                    <MonthlySparkline values={rowMonthly} actuals={rowMonthlyActual} width={220} height={28} />
                                  </div>
                                </td>
                              </tr>
                            )}
                            </React.Fragment>
                          )
                        })}
                      </React.Fragment>
                    )
                  })}
                  {grouped.standalone.map((row, i) => {
                    const isActive = drilldown === row.category
                    const rowMonthly = row.monthlyPlanned
                    const rowMonthlyActual = row.monthlyActual
                    return (
                      <React.Fragment key={`s-${i}`}>
                      <tr
                        data-pl-category={row.category}
                        className={`border-t border-border/30 cursor-pointer transition-colors ${isActive ? "bg-primary/5" : "hover:bg-muted/20"} ${isActive && pulseDrilldown ? "shadow-[inset_0_0_0_2px_rgb(99,102,241)]" : ""}`}
                        onClick={() => setDrilldown(isActive ? null : row.category)}>
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            <span className={`w-1.5 h-1.5 rounded-full ${isActive ? "bg-primary" : "bg-muted-foreground/30"}`} />
                            {row.category}
                          </div>
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-sm"><AnimatedNumber value={row.planned} duration={500} /></td>
                        <td className="px-4 py-2 text-right font-mono text-sm text-purple-600 dark:text-purple-400"><AnimatedNumber value={row.forecast} duration={500} /></td>
                        <td className="px-4 py-2 text-right font-mono text-sm">{(row.actualAvailable ?? perCategoryActualsAvailable) ? <AnimatedNumber value={row.actual} duration={500} /> : naDash()}</td>
                        <td className="px-4 py-2 text-center">
                          {(row.actualAvailable ?? perCategoryActualsAvailable) ? <ExecBar actual={row.actual} planned={row.planned} isExpense={isExpense} /> : naDash()}
                        </td>
                        <td className={`px-4 py-2 text-right font-mono text-sm font-semibold ${(row.actualAvailable ?? perCategoryActualsAvailable) ? (row.variance >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-red-600 dark:text-red-400") : ""}`}>
                          {(row.actualAvailable ?? perCategoryActualsAvailable) ? <AnimatedNumber value={row.variance} duration={400} formatter={(n) => `${n >= 0 ? "+" : ""}${Math.round(n).toLocaleString()} ₼`} /> : naDash()}
                        </td>
                      </tr>
                      {isActive && rowMonthly && (
                        <tr className="border-t-0 bg-primary/[0.02]" data-pl-drill-row={row.category}>
                          <td colSpan={6} className="px-4 py-2 pl-6">
                            <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                              <span className="uppercase tracking-wider">12-month</span>
                              <MonthlySparkline values={rowMonthly} actuals={rowMonthlyActual} width={220} height={28} />
                            </div>
                          </td>
                        </tr>
                      )}
                      </React.Fragment>
                    )
                  })}
                </>
              ) : (
                rows.map((row, i) => {
                  const isActive = drilldown === row.category
                  const rowMonthly = row.monthlyPlanned
                  const rowMonthlyActual = row.monthlyActual
                  return (
                    <React.Fragment key={i}>
                    <tr
                      data-pl-category={row.category}
                      className={`border-t border-border/30 cursor-pointer transition-colors ${isActive ? "bg-primary/5" : "hover:bg-muted/20"} ${isActive && pulseDrilldown ? "shadow-[inset_0_0_0_2px_rgb(99,102,241)]" : ""}`}
                      onClick={() => setDrilldown(isActive ? null : row.category)}>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <span className={`w-1.5 h-1.5 rounded-full ${isActive ? "bg-primary" : "bg-muted-foreground/30"}`} />
                          {row.category}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-sm"><AnimatedNumber value={row.planned} duration={500} /></td>
                      <td className="px-4 py-2 text-right font-mono text-sm text-purple-600 dark:text-purple-400"><AnimatedNumber value={row.forecast} duration={500} /></td>
                      <td className="px-4 py-2 text-right font-mono text-sm">{(row.actualAvailable ?? perCategoryActualsAvailable) ? <AnimatedNumber value={row.actual} duration={500} /> : naDash()}</td>
                      <td className="px-4 py-2 text-center">
                        {(row.actualAvailable ?? perCategoryActualsAvailable) ? <ExecBar actual={row.actual} planned={row.planned} isExpense={isExpense} /> : naDash()}
                      </td>
                      <td className={`px-4 py-2 text-right font-mono text-sm font-semibold ${(row.actualAvailable ?? perCategoryActualsAvailable) ? (row.variance >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-red-600 dark:text-red-400") : ""}`}>
                        {(row.actualAvailable ?? perCategoryActualsAvailable) ? <AnimatedNumber value={row.variance} duration={400} formatter={(n) => `${n >= 0 ? "+" : ""}${Math.round(n).toLocaleString()} ₼`} /> : naDash()}
                      </td>
                    </tr>
                    {isActive && rowMonthly && (
                      <tr className="border-t-0 bg-primary/[0.02]" data-pl-drill-row={row.category}>
                        <td colSpan={6} className="px-4 py-2 pl-6">
                          <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                            <span className="uppercase tracking-wider">12-month</span>
                            <MonthlySparkline values={rowMonthly} actuals={rowMonthlyActual} width={220} height={28} />
                          </div>
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  )
                })
              )}
            </tbody>
          </table>
        )}
      </div>
    )
  }

  return { renderSection, KPICard }
}
