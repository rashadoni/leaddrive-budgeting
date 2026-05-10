"use client"

import React, { useState, useMemo, useRef, useCallback } from "react"
import { useTranslations } from "next-intl"
import { useSession as useSessionHook } from "next-auth/react"
import { useSearchParams, useRouter } from "next/navigation"
import { ColorStatCard } from "@/components/color-stat-card"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  PiggyBank, Plus, Trash2, Pencil, Loader2, TrendingUp, TrendingDown,
  CheckCircle, AlertCircle, BarChart2, DollarSign, Link2,
  ChevronDown, ChevronRight, MessageSquare, Target, Brain, Sparkles, Settings2,
  LayoutGrid, List, Banknote, FileSpreadsheet, Upload,
} from "lucide-react"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Progress } from "@/components/ui/progress"
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, CartesianGrid, LabelList,
  ComposedChart, ReferenceLine, Line,
} from "recharts"
import { BUDGET_COLORS, ANIMATION, AXIS_TICK, GRID_STYLE, HBarGradient, VBarGradient, fmtK } from "@/lib/budget-chart-theme"
import { BudgetChartTooltip } from "@/components/budget-chart-tooltip"
import { BudgetBarLabel } from "@/components/budget-bar-label"
import { BudgetChartLegend } from "@/components/budget-chart-legend"
import { AnimatedNumber, fmtManat } from "@/components/animated-number"
import { PeriodLockBadge } from "@/features/budgeting/components/PeriodLockBadge"
import {
  useBudgetPlans,
  useCreateBudgetPlan,
  useUpdateBudgetPlan,
  useDeleteBudgetPlan,
  useBudgetLines,
  useBudgetLineCount,
  useCreateBudgetLine,
  useBudgetAnalytics,
  useBudgetSections,
  useCreateBudgetSection,
  useDeleteBudgetSection,
  useBudgetForecastEntries,
  useUpsertBudgetForecast,
  useBudgetTemplates,
  useCreateBudgetTemplate,
  useUpdateBudgetTemplate,
  useDeleteBudgetTemplate,
  useBudgetVersions,
  useCreateBudgetVersion,
  useBudgetDiff,
  useExchangeRates,
  useCreateRollingPlan,
} from "@/lib/budgeting/hooks"
import { VarianceTab } from "@/features/budgeting/components/VarianceTab"
import { ComparisonTab } from "@/features/budgeting/components/ComparisonTab"
import { PLTab } from "@/features/budgeting/components/PLTab"
import { PlansTab } from "@/features/budgeting/components/PlansTab"
import { ImportTab } from "@/features/budgeting/components/ImportTab"
import { CashFlowTab } from "@/features/budgeting/components/CashFlowTab"
import { RollingTab } from "@/features/budgeting/components/RollingTab"
import { WorkspaceTab } from "@/features/budgeting/components/WorkspaceTab"
import {
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_REVENUE_CATEGORIES,
  DEPARTMENTS,
  SECTION_TYPES,
  type BudgetLine,
  type BudgetDirectionTemplate,
} from "@/lib/budgeting/types"
import { COST_MODEL_KEY_OPTIONS, TEMPLATE_CATEGORY_MAP } from "@/lib/budgeting/cost-model-map"
import { BudgetConfigTab } from "@/components/budget-config-tab"
import { SalesForecastTab } from "@/components/sales-forecast-tab"
import { ExpenseForecastTab } from "@/components/expense-forecast-tab"
import { BudgetDepartmentAccess } from "@/components/budget-department-access"
import { BudgetApprovalWorkflow } from "@/components/budget-approval-workflow"
import { BudgetApprovalHistory } from "@/components/budget-approval-history"
import { BudgetVersionHistory } from "@/components/budget-version-history"
import { AIAnalyticsPanel } from "@/components/ai-analytics-panel"
import { SECTION_LABELS, type Section } from "@/lib/ai/section-context"
import { execPct } from "@/lib/budgeting/exec-pct"
import { BudgetVersionDiff } from "@/components/budget-version-diff"
import { BudgetMarginSummary } from "@/components/budget-margin-summary"
import { InfoHint } from "@/components/info-hint"
import { BudgetPnlView } from "@/components/budget-pnl-view"
import { SalesBudgetTable } from "@/components/sales-budget-table"
import { COGSCalculator } from "@/components/cogs-calculator"
import { BudgetBalanceSheet } from "@/components/budget-balance-sheet"
import { BudgetAssumptions } from "@/components/budget-assumptions"
import { BudgetExcelImport } from "@/components/budget-excel-import"
import { toast } from "sonner"

const PIE_COLORS = BUDGET_COLORS.pie

function fmt(n: number): string {
  return Math.round(n).toLocaleString() + " ₼"
}

function statusBadge(status: string, t: (key: string) => string) {
  if (status === "pending_approval") return <Badge title={t("hintStatusPending")} className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">{t("statusPending")}</Badge>
  if (status === "approved") return <Badge title={t("hintStatusApproved")} className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">{t("statusApproved")}</Badge>
  if (status === "rejected") return <Badge title={t("hintStatusRejected")} className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">{t("statusRejected")}</Badge>
  if (status === "closed") return <Badge title={t("hintStatusClosed")} className="bg-muted text-muted-foreground">{t("statusClosed")}</Badge>
  return <Badge title={t("hintStatusDraft")} className="bg-muted text-muted-foreground">{t("statusDraft")}</Badge>
}

function periodLabel(plan: any, t: (key: string) => string): string {
  if (plan.periodType === "monthly" && plan.month) {
    const months = t("monthsShort").split(",")
    return `${months[plan.month - 1]} ${plan.year}`
  }
  if (plan.periodType === "quarterly" && plan.quarter) return `Q${plan.quarter} ${plan.year}`
  return `${plan.year}`
}

// ─── Combined Import Tab ─────────────────────────────────────────────────────

// ─── F1: ImportTab — extracted to ./components/ImportTab.tsx (Turn LXXXII) ────

// ─── F4: RollingTab — extracted to ./components/RollingTab.tsx (Turn LXXXIV)

// ─── F6: CashFlowTab — extracted to ./components/CashFlowTab.tsx (Turn LXXXIII)

// ─── Create Plan Dialog ───────────────────────────────────────────────────────

function CreatePlanDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations("budgeting")
  const create = useCreateBudgetPlan()
  const [name, setName] = useState("")
  const [periodType, setPeriodType] = useState<"monthly" | "quarterly" | "annual">("monthly")
  const [year, setYear] = useState(new Date().getFullYear())
  const [month, setMonth] = useState(new Date().getMonth() + 1)
  const [quarter, setQuarter] = useState(1)
  const [error, setError] = useState("")

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    try {
      await create.mutateAsync({
        name,
        periodType,
        year,
        month: periodType === "monthly" ? month : undefined,
        quarter: periodType === "quarterly" ? quarter : undefined,
      })
      onClose()
    } catch (err: any) {
      setError(err?.message || "Failed to create plan")
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t("dlgCreateTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
            )}
            <div>
              <label className="text-sm font-medium mb-1 block">{t("dlgName")}</label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder={t("dlgNamePlaceholder")} required />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">{t("dlgPeriodType")}</label>
              <select value={periodType} onChange={e => setPeriodType(e.target.value as any)}
                className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background">
                <option value="monthly">{t("periodMonthly")}</option>
                <option value="quarterly">{t("periodQuarterly")}</option>
                <option value="annual">{t("periodAnnual")}</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">{t("dlgYear")}</label>
              <Input type="number" value={year} onChange={e => setYear(Number(e.target.value))} min={2020} max={2030} required />
            </div>
            {periodType === "monthly" && (
              <div>
                <label className="text-sm font-medium mb-1 block">{t("dlgMonth")}</label>
                <select value={month} onChange={e => setMonth(Number(e.target.value))}
                  className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background">
                  {t("monthsFull").split(",").map((m, i) => (
                    <option key={i} value={i + 1}>{m}</option>
                  ))}
                </select>
              </div>
            )}
            {periodType === "quarterly" && (
              <div>
                <label className="text-sm font-medium mb-1 block">{t("dlgQuarter")}</label>
                <select value={quarter} onChange={e => setQuarter(Number(e.target.value))}
                  className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background">
                  <option value={1}>Q1</option>
                  <option value={2}>Q2</option>
                  <option value={3}>Q3</option>
                  <option value={4}>Q4</option>
                </select>
              </div>
            )}
            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={create.isPending} className="flex-1">
                {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("btnCreate")}
              </Button>
              <Button type="button" variant="outline" onClick={onClose} className="flex-1">{t("btnCancel")}</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

// ─── AddLineForm — DELETED Turn LXXXVI (dead code; was sole-consumer LinesTab also dead) ──

// AddActualForm — moved into ActualsTab.tsx as private helper (Turn LXXXV)

// ─── Workspace Tab (G-01 through G-09) ───────────────────────────────────────

// ─── WorkspaceTab — extracted to ./components/WorkspaceTab.tsx (Turn LXXXVIII)
// ─── Overview Tab ─────────────────────────────────────────────────────────────

// ─── OverviewTab — DELETED Turn LXXXVI (dead code; no tab route, no consumers) ──

// ─── LinesTab — DELETED Turn LXXXVI (dead code; no tab route, no consumers) ──

// ─── Forecast Tab (Monthly Matrix) ───────────────────────────────────────────

function ForecastTab({ planId, companyId }: { planId: string; companyId?: string | null }) {
  const t = useTranslations("budgeting")
  const { data: analytics, isLoading: analyticsLoading } = useBudgetAnalytics(planId, companyId)
  const { data: forecastEntries = [] } = useBudgetForecastEntries(planId)
  const { data: budgetLines = [], isLoading: linesLoading } = useBudgetLines(planId)
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

  const plan = analytics?.plan
  const year = plan?.year ?? new Date().getFullYear()

  // Determine months for this period
  const months = useMemo(() => {
    if (!plan) return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    if (plan.periodType === "quarterly" && plan.quarter) {
      const start = (plan.quarter - 1) * 3 + 1
      return [start, start + 1, start + 2]
    }
    if (plan.periodType === "monthly" && plan.month) {
      return [plan.month]
    }
    return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
  }, [plan])

  const periodMonths = months.length

  const monthLabels = useMemo(() => {
    const all = t("monthsShort").split(",")
    return months.map(m => all[m - 1] || `M${m}`)
  }, [months, t])

  // Build forecast lookup: category+lineType+month -> forecastAmount
  const forecastMap = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of forecastEntries) {
      if (e.category === "__total__") continue
      const lt = (e as any).lineType || "expense"
      const key = `${e.category}||${lt}||${e.month}`
      m.set(key, (m.get(key) ?? 0) + e.forecastAmount)
    }
    return m
  }, [forecastEntries])

  // Build lines map for default values (includes children)
  const linesMap = useMemo(() => {
    const m = new Map<string, BudgetLine>()
    for (const l of budgetLines) {
      m.set(l.category, l)
      if (l.children) {
        for (const c of l.children) m.set(c.category, c)
      }
    }
    return m
  }, [budgetLines])

  const revenueLines = useMemo(() => budgetLines.filter((l: BudgetLine) => l.lineType === "revenue"), [budgetLines])
  const cogsLines = useMemo(() => budgetLines.filter((l: BudgetLine) => l.lineType === "cogs"), [budgetLines])
  const expenseLines = useMemo(() => budgetLines.filter((l: BudgetLine) => l.lineType === "expense"), [budgetLines])

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
    if (saved !== undefined) return { value: saved * multiplier, isDefault: false }
    const line = linesMap.get(category)
    if (line) return { value: (line.plannedAmount / periodMonths) * multiplier, isDefault: true }
    return { value: 0, isDefault: true }
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
  // Gross Profit = Revenue - COGS; EBITDA = Gross Profit - OpEx (totalExpense).
  // Earlier this block deducted OpEx from revenue only, which inflated EBITDA
  // by the full COGS amount (user saw 25.8M instead of -4.6M for the AAC demo).
  const totalGrossProfit = totalRevenue - totalCogs
  const totalMargin = totalGrossProfit - totalExpense

  // Inline edit handlers
  const startEdit = (category: string, lineType: string, month: number) => {
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
    }))
    await upsertForecast.mutateAsync(entries)
    setNewCategory("")
    setAddingRevenue(false)
    setAddingExpense(false)
  }

  if (analyticsLoading || linesLoading) return (
    <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-purple-500" /></div>
  )

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
                  className={`font-mono text-sm cursor-pointer hover:bg-purple-50 dark:hover:bg-purple-900/20 px-1 rounded border border-transparent hover:border-purple-300 dark:hover:border-purple-700 transition-colors ${isDefault ? "text-muted-foreground italic" : ""}`}
                  onClick={() => startEdit(line.category, line.lineType, m)}>
                  {fmt(value)}
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
      <tr className="bg-muted/40 cursor-pointer hover:bg-muted/60 transition-colors select-none" onClick={() => toggleFcSection(lineType)}>
        <td className="px-3 py-1.5 sticky left-0 bg-muted/40 z-10">
          <div className="flex items-center gap-2">
            <svg className={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 ${isFcCollapsed ? "" : "rotate-90"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{title}</span>
            <span className="text-[10px] text-muted-foreground/60">{lines.length}</span>
          </div>
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
            <button onClick={() => { setIsAdding(true); setNewCategory("") }}
              className="text-xs text-purple-600 dark:text-purple-400 hover:underline flex items-center gap-1">
              <Plus className="h-3.5 w-3.5" /> {t("btnAddRow")}
            </button>
          </td>
        </tr>
      ))}
    </>
  )}

  return (
    <div className="space-y-6">
      {/* Scenario toggle */}
      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold">{t("scenarioLabel")}</span>
        <div className="flex gap-1">
          {(["base", "optimistic", "pessimistic"] as const).map(s => (
            <Button key={s} size="sm" variant={scenario === s ? "default" : "outline"} className="h-8 text-sm px-4"
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
        <Button size="sm" variant="ghost" className="h-8 text-xs ml-auto" onClick={() => setShowScenarioSettings(v => !v)}>
          <Settings2 className="h-3.5 w-3.5 mr-1" />
          {showScenarioSettings ? "Hide" : "Settings"}
        </Button>
      </div>

      {/* KPI Cards — Soft Tinted style */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl bg-gradient-to-br from-indigo-50 to-indigo-100 border border-indigo-200 dark:from-indigo-950/30 dark:to-indigo-900/20 dark:border-indigo-800 p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">{t("forecastRevenueTotal") || "Revenue Forecast"}</span>
            <div className="h-9 w-9 rounded-full flex items-center justify-center bg-indigo-200 dark:bg-indigo-800">
              <TrendingUp className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            </div>
          </div>
          <div className="text-2xl font-bold tabular-nums text-indigo-700 dark:text-indigo-300">{fmtK(totalRevenue)} ₼</div>
          <div className="text-xs text-muted-foreground mt-1">{scenario !== "base" ? `${scenario} · ×${getScenarioMultiplier("revenue").toFixed(2)}` : "base scenario"}</div>
        </div>
        <div className="rounded-xl bg-gradient-to-br from-cyan-50 to-cyan-100 border border-cyan-200 dark:from-cyan-950/30 dark:to-cyan-900/20 dark:border-cyan-800 p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">{t("sectionCOGS")}</span>
            <div className="h-9 w-9 rounded-full flex items-center justify-center bg-cyan-200 dark:bg-cyan-800">
              <DollarSign className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
            </div>
          </div>
          <div className="text-2xl font-bold tabular-nums text-cyan-700 dark:text-cyan-300">{fmtK(totalCogs)} ₼</div>
          <div className="text-xs text-muted-foreground mt-1">{totalRevenue > 0 ? `${((totalCogs / totalRevenue) * 100).toFixed(1)}% of revenue` : "—"}</div>
        </div>
        <div className="rounded-xl bg-gradient-to-br from-orange-50 to-orange-100 border border-orange-200 dark:from-orange-950/30 dark:to-orange-900/20 dark:border-orange-800 p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">{t("forecastExpenseTotal") || "Expenses Forecast"}</span>
            <div className="h-9 w-9 rounded-full flex items-center justify-center bg-orange-200 dark:bg-orange-800">
              <Banknote className="h-4 w-4 text-orange-600 dark:text-orange-400" />
            </div>
          </div>
          <div className="text-2xl font-bold tabular-nums text-orange-700 dark:text-orange-300">{fmtK(totalExpense)} ₼</div>
          <div className="text-xs text-muted-foreground mt-1">{totalRevenue > 0 ? `${((totalExpense / totalRevenue) * 100).toFixed(1)}% of revenue` : "—"}</div>
        </div>
        <div className={`rounded-xl p-5 ${totalMargin >= 0 ? "bg-gradient-to-br from-emerald-50 to-emerald-100 border border-emerald-200 dark:from-emerald-950/30 dark:to-emerald-900/20 dark:border-emerald-800" : "bg-gradient-to-br from-red-50 to-red-100 border border-red-200 dark:from-red-950/30 dark:to-red-900/20 dark:border-red-800"}`}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">EBITDA</span>
            <div className={`h-9 w-9 rounded-full flex items-center justify-center ${totalMargin >= 0 ? "bg-purple-200 dark:bg-purple-800" : "bg-red-200 dark:bg-red-800"}`}>
              {totalMargin >= 0 ? <Target className="h-4 w-4 text-purple-600 dark:text-purple-400" /> : <TrendingDown className="h-4 w-4 text-red-600 dark:text-red-400" />}
            </div>
          </div>
          <div className={`text-2xl font-bold tabular-nums ${totalMargin >= 0 ? "text-purple-700 dark:text-purple-300" : "text-red-700 dark:text-red-300"}`}>{totalMargin < 0 ? `(${fmtK(Math.abs(totalMargin))})` : fmtK(totalMargin)} ₼</div>
          <div className="text-xs text-muted-foreground mt-1">{totalRevenue > 0 ? `EBITDA Margin: ${((totalMargin / totalRevenue) * 100).toFixed(1)}%` : "—"}</div>
        </div>
      </div>

      {/* ── FORECAST CHARTS: Monthly Trend + Scenario Comparison ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Monthly Forecast Trend — 3/5 */}
        <Card className="lg:col-span-3 border-0 shadow-md">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <BarChart2 className="h-4 w-4 text-indigo-500" />
              {t("fcMonthlyTrend")}
            </CardTitle>
            <p className="text-xs text-muted-foreground">{t("fcMonthlyTrendSubtitle", { scenario })}</p>
          </CardHeader>
          <CardContent className="pt-0">
            {(() => {
              const trendData = months.map((m, i) => ({
                name: monthLabels[i],
                revenue: getColTotal(revenueLines, m),
                expenses: getColTotal(expenseLines, m) + getColTotal(cogsLines, m),
                profit: getColTotal(revenueLines, m) - getColTotal(expenseLines, m) - getColTotal(cogsLines, m),
              }))

              const TrendTooltip = ({ active, payload, label }: any) => {
                if (!active || !payload?.length) return null
                return (
                  <div className="bg-popover/95 backdrop-blur-sm border border-border rounded-xl p-3 shadow-xl text-sm min-w-[180px]">
                    <div className="font-semibold text-popover-foreground mb-2 border-b border-border/50 pb-1.5">{label}</div>
                    {payload.map((p: any) => (
                      <div key={p.dataKey} className="flex justify-between items-center gap-4 py-0.5">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: p.color }} />
                          <span className="text-xs text-muted-foreground capitalize">{p.dataKey}</span>
                        </div>
                        <span className="font-mono font-bold text-popover-foreground text-xs">{fmtK(p.value)} ₼</span>
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
                    <YAxis tick={AXIS_TICK} tickFormatter={v => fmtK(v)} axisLine={false} tickLine={false} />
                    <Tooltip content={<TrendTooltip />} cursor={{ fill: "hsl(var(--muted))", opacity: 0.3 }} />
                    <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} />
                    <Bar dataKey="revenue" fill="url(#fc-rev-grad)" radius={[3, 3, 0, 0]} animationDuration={ANIMATION.duration} name="Revenue" />
                    <Bar dataKey="expenses" fill="url(#fc-exp-grad)" radius={[3, 3, 0, 0]} animationDuration={ANIMATION.duration} name="Expenses" />
                    <Line type="monotone" dataKey="profit" stroke="#8b5cf6" strokeWidth={2.5} dot={{ r: 3, fill: "#8b5cf6" }} name="EBITDA" animationDuration={ANIMATION.duration} />
                  </ComposedChart>
                </ResponsiveContainer>
              )
            })()}
          </CardContent>
        </Card>

        {/* Scenario Comparison — 2/5 */}
        <Card className="lg:col-span-2 border-0 shadow-md">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-purple-500" />
              {t("fcScenarioComparison")}
            </CardTitle>
            <p className="text-xs text-muted-foreground">{t("fcScenarioComparisonSubtitle")}</p>
          </CardHeader>
          <CardContent className="pt-0">
            {(() => {
              // Calculate totals for all 3 scenarios
              const calcTotal = (lt: string, mult: number) => {
                return getLeafLines(lt === "revenue" ? revenueLines : lt === "cogs" ? cogsLines : expenseLines)
                  .reduce((s, l) => {
                    const key = `${l.category}||${l.lineType}`
                    // Get base value (without scenario multiplier)
                    const baseVal = months.reduce((ms, m) => {
                      const k = `${key}||${m}`
                      const saved = forecastMap.get(k)
                      if (saved !== undefined) return ms + saved
                      const line = linesMap.get(l.category)
                      return ms + (line ? line.plannedAmount / periodMonths : 0)
                    }, 0)
                    return s + baseVal * mult
                  }, 0)
              }

              const sm = scenarioMultipliers
              const scenarios = [
                {
                  name: t("scenarioPessimistic"),
                  revenue: calcTotal("revenue", sm.pessimistic.revenue / 100),
                  costs: calcTotal("cogs", sm.pessimistic.cogs / 100) + calcTotal("expense", sm.pessimistic.expense / 100),
                  color: "#ef4444",
                },
                {
                  name: t("scenarioBase"),
                  revenue: calcTotal("revenue", 1),
                  costs: calcTotal("cogs", 1) + calcTotal("expense", 1),
                  color: "#6366f1",
                },
                {
                  name: t("scenarioOptimistic"),
                  revenue: calcTotal("revenue", sm.optimistic.revenue / 100),
                  costs: calcTotal("cogs", sm.optimistic.cogs / 100) + calcTotal("expense", sm.optimistic.expense / 100),
                  color: "#22c55e",
                },
              ].map(s => ({ ...s, profit: s.revenue - s.costs }))

              return (
                <div className="space-y-3 mt-2">
                  {scenarios.map((s, i) => {
                    const maxProfit = Math.max(...scenarios.map(x => Math.abs(x.profit)), 1)
                    const barW = Math.abs(s.profit) / maxProfit * 100
                    return (
                      <div key={i}>
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                            <span className="text-sm font-medium">{s.name}</span>
                          </div>
                          <span className={`text-sm font-bold font-mono ${s.profit < 0 ? "text-red-500" : "text-emerald-600 dark:text-emerald-400"}`}>
                            {s.profit < 0 ? `−${fmtK(Math.abs(s.profit))}` : `+${fmtK(s.profit)}`} ₼
                          </span>
                        </div>
                        <div className="w-full h-2.5 bg-muted rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-700" style={{ width: `${barW}%`, backgroundColor: s.color, opacity: 0.7 }} />
                        </div>
                        <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                          <span>{t("fcRevAbbrev")}: {fmtK(s.revenue)} ₼</span>
                          <span>{t("fcCostsAbbrev")}: {fmtK(s.costs)} ₼</span>
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
        <Card className="border-0 shadow-md">
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
      <Card className="border-0 shadow-md overflow-hidden">
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
                  <td key={m} className="px-2 py-1.5 text-right">{fmtK(getColTotal(revenueLines, m))}</td>
                ))}
                <td className="px-3 py-1.5 text-right font-bold">{fmtK(totalRevenue)}</td>
              </tr>
              <tr className="border-b border-border/30">
                <td className="px-3 py-1.5 font-semibold text-muted-foreground sticky left-0 bg-background z-10">{t("fcPnlRowCosts")}</td>
                {months.map(m => {
                  const costs = getColTotal(cogsLines, m) + getColTotal(expenseLines, m)
                  return <td key={m} className="px-2 py-1.5 text-right">{fmtK(costs)}</td>
                })}
                <td className="px-3 py-1.5 text-right font-bold">{fmtK(totalCogs + totalExpense)}</td>
              </tr>
              <tr className={`${totalMargin >= 0 ? "bg-purple-50/50 dark:bg-purple-950/10" : "bg-red-50/50 dark:bg-red-950/10"}`}>
                <td className={`px-3 py-1.5 font-bold sticky left-0 z-10 ${totalMargin >= 0 ? "text-purple-700 dark:text-purple-400 bg-purple-50/50 dark:bg-purple-950/10" : "text-red-600 dark:text-red-400 bg-red-50/50 dark:bg-red-950/10"}`}>EBITDA</td>
                {months.map(m => {
                  const profit = getColTotal(revenueLines, m) - getColTotal(cogsLines, m) - getColTotal(expenseLines, m)
                  return <td key={m} className={`px-2 py-1.5 text-right font-bold ${profit < 0 ? "text-red-500" : ""}`}>{fmtK(profit)}</td>
                })}
                <td className={`px-3 py-1.5 text-right font-bold ${totalMargin < 0 ? "text-red-500" : ""}`}>{fmtK(totalMargin)}</td>
              </tr>
              <tr className="bg-purple-50/30 dark:bg-purple-950/5">
                <td className="px-3 py-1 text-[11px] font-medium text-purple-600 dark:text-purple-400 sticky left-0 z-10 bg-purple-50/30 dark:bg-purple-950/5">{t("ebitdaMarginPct")}</td>
                {months.map(m => {
                  const rev = getColTotal(revenueLines, m)
                  const ebitda = rev - getColTotal(cogsLines, m) - getColTotal(expenseLines, m)
                  const pct = rev > 0 ? ((ebitda / rev) * 100).toFixed(1) : "—"
                  return <td key={m} className={`px-2 py-1 text-right text-[11px] font-medium ${Number(pct) < 0 ? "text-red-500" : "text-purple-600 dark:text-purple-400"}`}>{pct}{pct !== "—" ? "%" : ""}</td>
                })}
                <td className={`px-3 py-1 text-right text-[11px] font-bold ${totalMargin < 0 ? "text-red-500" : "text-purple-600 dark:text-purple-400"}`}>{totalRevenue > 0 ? `${((totalMargin / totalRevenue) * 100).toFixed(1)}%` : "—"}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      {/* Monthly matrix table */}
      <Card>
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
                <tr className={`border-t-2 ${totalGrossProfit < 0 ? "border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/10" : "border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/10"}`}>
                  <td className={`px-3 py-2 font-bold text-sm sticky left-0 z-10 ${totalGrossProfit < 0 ? "bg-red-50 dark:bg-red-900/10" : "bg-emerald-50 dark:bg-emerald-900/10"}`}>{t("grossProfit")}</td>
                  {months.map(m => {
                    const gpVal = getColTotal(revenueLines, m) - getColTotal(expenseLines, m)
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
                <tr className={`border-t-2 ${totalMargin < 0 ? "border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/10" : "border-purple-300 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/10"}`}>
                  <td className={`px-3 py-2 font-bold text-sm sticky left-0 z-10 ${totalMargin < 0 ? "bg-red-50 dark:bg-red-900/10" : "bg-purple-50 dark:bg-purple-900/10"}`}>EBITDA</td>
                  {months.map(m => {
                    const opVal = getColTotal(revenueLines, m) - getColTotal(expenseLines, m)
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
                    const rev = getColTotal(revenueLines, m)
                    const ebitda = rev - getColTotal(expenseLines, m)
                    const pct = rev > 0 ? ((ebitda / rev) * 100).toFixed(1) : "—"
                    return (
                    <td key={m} className={`px-2 py-1 text-right text-[11px] font-medium ${Number(pct) < 0 ? "text-red-500" : "text-purple-600 dark:text-purple-400"}`}>
                      {pct}{pct !== "—" ? "%" : ""}
                    </td>
                    )
                  })}
                  <td className={`px-3 py-1 text-right text-[11px] font-bold ${totalMargin < 0 ? "text-red-500" : "text-purple-600 dark:text-purple-400"}`}>{totalRevenue > 0 ? `${((totalMargin / totalRevenue) * 100).toFixed(1)}%` : "—"}</td>
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

function TemplatesTab() {
  const t = useTranslations("budgeting")
  const { data: templates = [], isLoading } = useBudgetTemplates()
  const createTemplate = useCreateBudgetTemplate()
  const updateTemplate = useUpdateBudgetTemplate()
  const deleteTemplate = useDeleteBudgetTemplate()

  const [adding, setAdding] = useState(false)
  const [newTpl, setNewTpl] = useState({ name: "", lineType: "expense" as "revenue" | "expense" | "cogs", lineSubtype: "service", defaultAmount: "" })
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const handleAdd = async () => {
    if (!newTpl.name) return
    await createTemplate.mutateAsync({
      name: newTpl.name,
      lineType: newTpl.lineType,
      lineSubtype: newTpl.lineSubtype,
      defaultAmount: Number(newTpl.defaultAmount) || 0,
    })
    setNewTpl({ name: "", lineType: "expense", lineSubtype: "service", defaultAmount: "" })
    setAdding(false)
  }

  const toggleActive = async (tpl: BudgetDirectionTemplate) => {
    await updateTemplate.mutateAsync({ id: tpl.id, isActive: !tpl.isActive })
  }

  const handleDelete = async (id: string) => {
    await deleteTemplate.mutateAsync(id)
    setConfirmDelete(null)
  }

  if (isLoading) return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>

  const subtypeLabel = (s: string | null | undefined) => {
    if (s === "service") return t("subtypeService")
    if (s === "product") return t("subtypeProduct")
    if (s === "cogs") return t("subtypeCogs")
    return s || "—"
  }

  const typeLabel = (lt: string) => {
    if (lt === "revenue") return t("revenue")
    if (lt === "cogs") return "COGS"
    return t("expense")
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">{t("templatesTitle")}</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">{t("templatesDescription")}</p>
            </div>
            {!adding && (
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4 mr-1" /> {t("btnAddTemplate")}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#1a3050] border-b-2 border-white/10">
                <tr>
                  <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white/90"><span className="inline-flex items-center gap-1.5">{t("templateName")} <InfoHint text={t("hintTemplateName")} size={12} /></span></th>
                  <th className="px-2 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white/70">{t("templateType")}</th>
                  <th className="px-2 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white/70">{t("templateSubtype")}</th>
                  <th className="px-2 py-3 text-right text-xs font-semibold uppercase tracking-wider text-emerald-300">{t("templateAmount")}</th>
                  <th className="px-2 py-3 text-center text-xs font-semibold uppercase tracking-wider text-white/70"><span className="inline-flex items-center gap-1.5 justify-center">{t("templateActive")} <InfoHint text={t("hintTemplateActive")} size={12} /></span></th>
                  <th className="px-2 py-3 w-20" />
                </tr>
              </thead>
              <tbody>
                {adding && (
                  <tr className="border-b border-border/50 bg-green-50 dark:bg-green-900/10">
                    <td className="px-2 py-1">
                      <Input className="h-7 text-xs" placeholder={t("templateName")} value={newTpl.name}
                        onChange={e => setNewTpl(d => ({ ...d, name: e.target.value }))}
                        onKeyDown={e => e.key === "Enter" && handleAdd()} autoFocus />
                    </td>
                    <td className="px-2 py-1">
                      <select value={newTpl.lineType} onChange={e => setNewTpl(d => ({ ...d, lineType: e.target.value as any }))}
                        className="h-7 w-full rounded-md border border-input bg-background px-1 text-xs">
                        <option value="expense">{t("expense")}</option>
                        <option value="revenue">{t("revenue")}</option>
                        <option value="cogs">COGS</option>
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <select value={newTpl.lineSubtype} onChange={e => setNewTpl(d => ({ ...d, lineSubtype: e.target.value }))}
                        className="h-7 w-full rounded-md border border-input bg-background px-1 text-xs">
                        <option value="service">{t("subtypeService")}</option>
                        <option value="product">{t("subtypeProduct")}</option>
                        <option value="cogs">{t("subtypeCogs")}</option>
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <Input type="number" className="h-7 text-xs text-right" placeholder="0" value={newTpl.defaultAmount}
                        onChange={e => setNewTpl(d => ({ ...d, defaultAmount: e.target.value }))}
                        onKeyDown={e => e.key === "Enter" && handleAdd()} />
                    </td>
                    <td />
                    <td className="px-2 py-1 text-center">
                      <div className="flex gap-1 justify-center">
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={handleAdd} disabled={createTemplate.isPending}>
                          {createTemplate.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setAdding(false)}>{t("btnCancel")}</Button>
                      </div>
                    </td>
                  </tr>
                )}
                {templates.map((tpl: BudgetDirectionTemplate) => (
                  <tr key={tpl.id} className="border-b border-border/50 hover:bg-muted/20">
                    <td className="px-3 py-1.5 text-xs font-medium">{tpl.name}</td>
                    <td className="px-2 py-1.5 text-xs">
                      <Badge variant="outline" className="text-[10px]">{typeLabel(tpl.lineType)}</Badge>
                    </td>
                    <td className="px-2 py-1.5 text-xs text-muted-foreground">{subtypeLabel(tpl.lineSubtype)}</td>
                    <td className="px-2 py-1.5 text-xs text-right font-mono">{fmt(tpl.defaultAmount)}</td>
                    <td className="px-2 py-1.5 text-center">
                      <button onClick={() => toggleActive(tpl)} className={`inline-block w-8 h-4 rounded-full transition-colors ${tpl.isActive ? "bg-green-500" : "bg-muted-foreground/40"}`}>
                        <span className={`block w-3 h-3 rounded-full bg-white transition-transform mx-0.5 ${tpl.isActive ? "translate-x-4" : "translate-x-0"}`} />
                      </button>
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      {confirmDelete === tpl.id ? (
                        <div className="flex gap-1 justify-center">
                          <Button size="sm" variant="destructive" className="h-6 text-[10px] px-2" onClick={() => handleDelete(tpl.id)}>
                            {deleteTemplate.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Trash2 className="h-3 w-3 mr-0.5" /> {t("btnOk")}</>}
                          </Button>
                          <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2" onClick={() => setConfirmDelete(null)}>{t("btnCancel")}</Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setConfirmDelete(tpl.id)}>
                          <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-red-500" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
                {templates.length === 0 && !adding && (
                  <tr>
                    <td colSpan={6} className="text-center py-8 text-muted-foreground text-xs">{t("emptyNoLines")}</td>
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

// ─── Apply Templates Dialog ─────────────────────────────────────────────────

// ─── ApplyTemplatesButton — moved into WorkspaceTab.tsx as private helper (Turn LXXXVIII)

// ─── Template Seeder ──────────────────────────────────────────────────────────

function TemplateSeedButton({ planId }: { planId: string }) {
  const t = useTranslations("budgeting")
  const createLine = useCreateBudgetLine()
  // Count-only hook avoids prefetching 4.3 MB of BudgetLines just to
  // evaluate `if (lines.length > 0)`. Mounted in page header so fires
  // on every /budgeting tab. Turn-38-sub12 architect Round-1 closure.
  const { data: countData } = useBudgetLineCount(planId)
  const lineCount = countData?.count ?? 0
  const [seeding, setSeeding] = useState(false)

  if (lineCount > 0) return null

  const seed = async () => {
    setSeeding(true)

    // Collect all costModelKeys to resolve from cost model
    const allCategories = [...DEFAULT_EXPENSE_CATEGORIES, ...DEFAULT_REVENUE_CATEGORIES]
    const keysToResolve = allCategories
      .map(cat => TEMPLATE_CATEGORY_MAP[cat])
      .filter(Boolean) as string[]

    // Resolve cost model values in one API call
    let costValues: Record<string, number> = {}
    if (keysToResolve.length > 0) {
      try {
        const res = await fetch("/api/budgeting/resolve-costs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keys: keysToResolve }),
        })
        const json = await res.json()
        if (json.success) costValues = json.data
      } catch { /* fallback to 0 if cost model unavailable */ }
    }

    const expenseLines = DEFAULT_EXPENSE_CATEGORIES.map((category, i) => {
      const cmKey = TEMPLATE_CATEGORY_MAP[category] || undefined
      const cmValue = cmKey ? (costValues[cmKey] ?? 0) : 0
      return {
        planId,
        category,
        lineType: "expense" as const,
        plannedAmount: cmValue,
        forecastAmount: cmValue || undefined,
        sortOrder: i,
        costModelKey: cmKey,
        isAutoActual: !!cmKey,
      }
    })
    const revenueLines = DEFAULT_REVENUE_CATEGORIES.map((category, i) => {
      const cmKey = TEMPLATE_CATEGORY_MAP[category] || undefined
      const cmValue = cmKey ? (costValues[cmKey] ?? 0) : 0
      return {
        planId,
        category,
        lineType: "revenue" as const,
        plannedAmount: cmValue,
        forecastAmount: cmValue || undefined,
        sortOrder: i + 100,
        costModelKey: cmKey,
        isAutoActual: !!cmKey,
      }
    })
    for (const line of [...expenseLines, ...revenueLines]) {
      await createLine.mutateAsync(line)
    }
    setSeeding(false)
  }

  return (
    <button onClick={seed} disabled={seeding}
      className="ml-2 text-xs text-purple-600 dark:text-purple-400 underline underline-offset-2 hover:no-underline disabled:opacity-50">
      {seeding ? t("templateLoading") : t("templateReady")}
    </button>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BudgetingPage() {
  const t = useTranslations("budgeting")
  const router = useRouter()
  const searchParams = useSearchParams()
  const { data: plans = [], isLoading: plansLoading } = useBudgetPlans()
  const [activePlanId, setActivePlanId] = useState<string>("")
  const [showCreate, setShowCreate] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  React.useEffect(() => setMounted(true), [])
  const activeTab = searchParams.get("tab") || "workspace"
  const setActiveTab = (tab: string) => router.push(`/budgeting?tab=${tab}`)

  // Auto-select first plan
  const resolvedPlanId = activePlanId || (plans[0]?.id ?? "")

  // Turn 30: per-daughter-company filter. Reads from URL `?company=X` so
  // selection survives navigation; null = org-wide consolidated view (the
  // pre-Turn-30 default). Companies fetched org-scoped from /api/companies.
  const selectedCompanyId = searchParams.get("company")
  const setSelectedCompanyId = (id: string | null) => {
    const params = new URLSearchParams(searchParams.toString())
    if (id) params.set("company", id)
    else params.delete("company")
    router.push(`/budgeting?${params.toString()}`)
  }
  const [companies, setCompanies] = useState<Array<{ id: string; code: string; name: string; level: number; parentCompanyId: string | null }>>([])
  React.useEffect(() => {
    fetch("/api/companies")
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        const list = body?.data || body
        if (Array.isArray(list)) {
          // Flatten: top-level companies + their embedded children. /api/companies
          // returns level=1 with `children` arrays; we want a flat list for the
          // dropdown (preserving level so we can indent children visually).
          const flat: Array<{ id: string; code: string; name: string; level: number; parentCompanyId: string | null }> = []
          for (const c of list) {
            flat.push({ id: c.id, code: c.code, name: c.name, level: c.level, parentCompanyId: c.parentCompanyId })
            if (Array.isArray(c.children)) {
              for (const child of c.children) {
                flat.push({ id: child.id, code: child.code, name: child.name, level: child.level, parentCompanyId: child.parentCompanyId })
              }
            }
          }
          setCompanies(flat)
        }
      })
      .catch(() => {})
  }, [])

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-500 text-white">
            <PiggyBank className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold">{t("title")}</h1>
            <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {plansLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-purple-500" />
          ) : plans.length > 0 ? (
            <>
              <select value={resolvedPlanId} onChange={e => {
                  setActivePlanId(e.target.value)
                  const selected = (plans as any[]).find(p => p.id === e.target.value)
                  if (selected?.isRolling) setActiveTab("rolling")
                }}
                className="border border-border rounded-md px-3 py-1.5 text-sm bg-background min-w-[180px]">
                {plans.map(p => (
                  <option key={p.id} value={p.id}>{p.name} — {periodLabel(p, t)}</option>
                ))}
              </select>
              {/* Phase 7.G Turn LXXIV — Phase 4.2 indicator UI badge.
                  Shows lock-icon + period + tooltip when the active plan's
                  period is locked at the org level. Renders nothing if
                  not locked (no layout shift). */}
              <PeriodLockBadge plan={(plans as any[]).find(p => p.id === resolvedPlanId) ?? null} />
            </>
          ) : null}
          {/* Turn 30: per-daughter-company drilldown selector. Org-wide default;
              level-1 sub-groups indented with — prefix; level-2 ops indented
              with —— prefix. Selecting a sub-group rolls up its children. */}
          {companies.length > 0 && (
            <select
              value={selectedCompanyId ?? ""}
              onChange={(e) => setSelectedCompanyId(e.target.value || null)}
              className="border border-border rounded-md px-3 py-1.5 text-sm bg-background min-w-[200px]"
              title={t("companyFilterTitle")}
            >
              <option value="">{t("companyFilterAllConsolidated")}</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.level === 1 ? "— " : "—— "}{c.code} {c.name && c.name !== c.code ? `· ${c.name}` : ""}
                </option>
              ))}
            </select>
          )}
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-1" /> {t("createPlan")}
          </Button>
        </div>
      </div>

      {/* No plans state — only render after mount to avoid hydration mismatch with searchParams */}
      {mounted && !plansLoading && plans.length === 0 && (
        activeTab === "integrations" ? (
          <BudgetExcelImport onImported={(planId) => { setActivePlanId(planId); setActiveTab("pnl-report") }} />
        ) : activeTab === "plans" ? (
          <PlansTab activePlanId="" onSelect={id => { setActivePlanId(id); setActiveTab("workspace") }} onShowCreate={() => setShowCreate(true)} />
        ) : (
          <div className="text-center py-20 text-muted-foreground">
            <FileSpreadsheet className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">{t("noPlansEmptyTitle")}</p>
            <p className="text-sm mt-1">{t("noPlansEmptyHint")}</p>
            <div className="flex gap-2 justify-center mt-4">
              <Button onClick={() => setActiveTab("integrations")}><Upload className="h-4 w-4 mr-1" /> {t("noPlansImportButton")}</Button>
              <Button variant="outline" onClick={() => setShowCreate(true)}><Plus className="h-4 w-4 mr-1" /> {t("noPlansCreateButton")}</Button>
            </div>
          </div>
        )
      )}

      {/* Main content — when a plan is selected */}
      {resolvedPlanId && (
        <>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>{t("activePlan")}</span>
            <span className="font-medium text-foreground">{plans.find(p => p.id === resolvedPlanId)?.name}</span>
            {statusBadge(plans.find(p => p.id === resolvedPlanId)?.status || "draft", t)}
            <TemplateSeedButton planId={resolvedPlanId} />
          </div>

          {activeTab === "pnl-report" && <BudgetPnlView planId={resolvedPlanId} companyId={selectedCompanyId} />}
          {activeTab === "sales-budget" && <SalesBudgetTable planId={resolvedPlanId} />}
          {activeTab === "cogs" && <COGSCalculator planId={resolvedPlanId} />}
          {activeTab === "balance-sheet" && <BudgetBalanceSheet planId={resolvedPlanId} />}
          {activeTab === "cash-flow" && <CashFlowTab />}
          {activeTab === "assumptions" && <BudgetAssumptions planId={resolvedPlanId} />}
          {activeTab === "workspace" && <WorkspaceTab planId={resolvedPlanId} companyId={selectedCompanyId} onNavigateTab={setActiveTab} />}
          {activeTab === "pl" && <PLTab planId={resolvedPlanId} companyId={selectedCompanyId} />}
          {activeTab === "forecast" && <ForecastTab planId={resolvedPlanId} companyId={selectedCompanyId} />}
          {activeTab === "comparison" && <ComparisonTab />}
          {activeTab === "variance" && <VarianceTab />}
          {activeTab === "plans" && <PlansTab activePlanId={resolvedPlanId} onSelect={id => { setActivePlanId(id); setActiveTab("workspace") }} onShowCreate={() => setShowCreate(true)} />}
          {activeTab === "sales-forecast" && <SalesForecastTab />}
          {activeTab === "expense-forecast" && <ExpenseForecastTab />}
          {activeTab === "integrations" && <ImportTab planId={resolvedPlanId} onImported={(planId: string) => { setActivePlanId(planId); setActiveTab("pnl-report") }} />}
          {activeTab === "rolling" && <RollingTab />}
          {activeTab === "config" && (
            <div className="space-y-6">
              <BudgetConfigTab />
              <BudgetDepartmentAccess />
              <TemplatesTab />
            </div>
          )}
        </>
      )}

      {showCreate && <CreatePlanDialog onClose={() => setShowCreate(false)} />}

      {/* AI Analysis — floating button + side panel */}
      {resolvedPlanId && SECTION_LABELS[activeTab as Section] && (
        <>
          <button
            type="button"
            onClick={() => setAiOpen(true)}
            className="fixed bottom-6 right-6 z-40 flex items-center gap-2 px-4 py-3 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-xl hover:shadow-2xl hover:scale-105 active:scale-95 transition-all"
            title={t("aiFabTooltip")}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.582a.5.5 0 0 1 0 .962L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>
            </svg>
            <span className="text-sm font-medium">{t("aiFabLabel")}</span>
          </button>
          <AIAnalyticsPanel
            open={aiOpen}
            onClose={() => setAiOpen(false)}
            section={activeTab}
            sectionLabel={SECTION_LABELS[activeTab as Section]}
            planId={resolvedPlanId}
            planName={plans.find((p: { id: string; name?: string }) => p.id === resolvedPlanId)?.name ?? null}
          />
        </>
      )}
    </div>
  )
}
