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
  CheckCircle, AlertCircle, BarChart2, DollarSign, CalendarRange, Link2,
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
import {
  useBudgetPlans,
  useCreateBudgetPlan,
  useUpdateBudgetPlan,
  useDeleteBudgetPlan,
  useBudgetLines,
  useCreateBudgetLine,
  useUpdateBudgetLine,
  useDeleteBudgetLine,
  useBudgetActuals,
  useCreateBudgetActual,
  useUpdateBudgetActual,
  useDeleteBudgetActual,
  useBudgetAnalytics,
  useBudgetSections,
  useCreateBudgetSection,
  useDeleteBudgetSection,
  useBudgetForecastEntries,
  useUpsertBudgetForecast,
  useAINarrative,
  useSyncActuals,
  useBudgetTemplates,
  useCreateBudgetTemplate,
  useUpdateBudgetTemplate,
  useDeleteBudgetTemplate,
  useApplyTemplates,
  useBudgetVersions,
  useCreateBudgetVersion,
  useBudgetDiff,
  useExchangeRates,
  useImportCsv,
  useImportHistory,
  useCreateRollingPlan,
  useRollingForecast,
  useAutoForecast,
  useCloseRollingMonth,
  useReopenRollingMonth,
  useCashFlow,
  useCashFlowAlerts,
  useResolveCashFlowAlert,
  useGenerateCashFlow,
} from "@/lib/budgeting/hooks"
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
import { BudgetVersionDiff } from "@/components/budget-version-diff"
import { BudgetFxSummary } from "@/components/budget-fx-summary"
import { BudgetCsvImport } from "@/components/budget-csv-import"
import { BudgetImportHistory } from "@/components/budget-import-history"
import { BudgetRollingForecast } from "@/components/budget-rolling-forecast"
import { BudgetCashFlowChart } from "@/components/budget-cash-flow-chart"
import { BudgetCashFlowTable } from "@/components/budget-cash-flow-table"
import { BudgetCashFlowAlerts } from "@/components/budget-cash-flow-alerts"
import { BudgetODDSReport } from "@/components/budget-odds-report"
import { BudgetPlanFactDashboard } from "@/components/budget-plan-fact-dashboard"
import { BudgetWaterfallChart } from "@/components/budget-waterfall-chart"
import { BudgetExecutionGauge } from "@/components/budget-execution-gauge"
import { BudgetCategoryBars } from "@/components/budget-category-bars"
import { BudgetMarginSummary } from "@/components/budget-margin-summary"
import { BudgetChangeHistory } from "@/components/budget-change-history"
import { InfoHint } from "@/components/info-hint"
import { BudgetMatrixGrid } from "@/components/budget-matrix-grid"
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

function ImportTab({ planId, onImported }: { planId: string; onImported: (planId: string) => void }) {
  const [importMode, setImportMode] = useState<"csv" | "excel">("csv")
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button size="sm" variant={importMode === "csv" ? "default" : "outline"} onClick={() => setImportMode("csv")}>
          <FileSpreadsheet className="h-4 w-4 mr-1" /> CSV Import
        </Button>
        <Button size="sm" variant={importMode === "excel" ? "default" : "outline"} onClick={() => setImportMode("excel")}>
          <FileSpreadsheet className="h-4 w-4 mr-1" /> Excel Import
        </Button>
      </div>
      {importMode === "csv" ? (
        <IntegrationsTab planId={planId} />
      ) : (
        <BudgetExcelImport onImported={onImported} />
      )}
    </div>
  )
}

// ─── F2: Integrations Tab ─────────────────────────────────────────────────────

function IntegrationsTab({ planId }: { planId: string }) {
  const importCsv = useImportCsv()
  const { data: imports = [], isLoading: importsLoading } = useImportHistory(planId)
  const [lastResult, setLastResult] = useState<any>(null)

  const handleImport = async (data: any) => {
    const result = await importCsv.mutateAsync(data)
    setLastResult(result)
  }

  return (
    <div className="space-y-6">
      <BudgetCsvImport
        planId={planId}
        onImport={handleImport}
        isImporting={importCsv.isPending}
        lastResult={lastResult}
      />
      <BudgetImportHistory imports={imports} isLoading={importsLoading} />
    </div>
  )
}

// ─── F4: Rolling Forecast Tab ─────────────────────────────────────────────────

function RollingTab() {
  const { data: plans = [] } = useBudgetPlans()
  const rollingPlan = (plans as any[]).find((p) => p.isRolling)
  const rollingPlanId = rollingPlan?.id || null
  const { data: rollingData } = useRollingForecast(rollingPlanId)
  const autoForecast = useAutoForecast()
  const closeMonth = useCloseRollingMonth()
  const reopenMonth = useReopenRollingMonth()

  if (!rollingPlan) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          <CalendarRange className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium text-lg mb-2">Rolling Forecast</p>
          <p className="text-sm">No rolling plan has been created yet.</p>
          <p className="text-sm mt-1">Import an Excel budget file — a rolling plan will be created automatically. Or create one manually on the &quot;Plans&quot; tab.</p>
        </CardContent>
      </Card>
    )
  }

  if (!rollingData || !rollingData.months.length) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          <CalendarRange className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium text-lg mb-2">Loading data...</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <BudgetRollingForecast
        months={rollingData.months}
        totalRevenue={rollingData.revenue}
        totalExpense={rollingData.expense}
        totalMargin={rollingData.margin}
        onAutoForecast={() => autoForecast.mutate({ planId: rollingPlanId! })}
        isForecasting={autoForecast.isPending}
        onCloseMonth={(year, month) => closeMonth.mutate({ planId: rollingPlanId!, year, month })}
        isClosingMonth={closeMonth.isPending}
        onReopenMonth={(year, month) => reopenMonth.mutate({ planId: rollingPlanId!, year, month })}
        isReopeningMonth={reopenMonth.isPending}
      />
    </div>
  )
}

// ─── F6: Cash Flow Tab ────────────────────────────────────────────────────────

function CashFlowTab() {
  const [year] = useState(new Date().getFullYear())
  const [subView, setSubView] = useState<"overview" | "odds" | "plan-fact">("overview")
  const { data: cashFlowData } = useCashFlow(year)
  const { data: alerts = [] } = useCashFlowAlerts(year)
  const resolveAlert = useResolveCashFlowAlert()
  const generateCashFlow = useGenerateCashFlow()

  return (
    <div className="space-y-6">
      {/* Sub-view toggle */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1 bg-muted rounded-lg p-1">
          {[
            { key: "overview" as const, label: "Cash Flow" },
            { key: "odds" as const, label: "CFS" },
            { key: "plan-fact" as const, label: "Plan vs Actual" },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setSubView(key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                subView === key
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {subView === "overview" && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => generateCashFlow.mutate({ year })}
            disabled={generateCashFlow.isPending}
          >
            {generateCashFlow.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Sparkles className="h-4 w-4 mr-1" />}
            Generate from budget
          </Button>
        )}
      </div>

      {/* Sub-views */}
      {subView === "overview" && (
        <>
          {alerts.length > 0 && (
            <BudgetCashFlowAlerts
              alerts={alerts}
              onResolve={(id) => resolveAlert.mutate(id)}
            />
          )}

          {cashFlowData && cashFlowData.months.length > 0 ? (
            <>
              <BudgetCashFlowChart
                months={cashFlowData.months}
                year={cashFlowData.year}
                totalInflows={cashFlowData.totalInflows}
                totalOutflows={cashFlowData.totalOutflows}
              />
              <BudgetCashFlowTable months={cashFlowData.months} />
            </>
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <Banknote className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p className="font-medium text-lg mb-2">Cash Flow Forecast</p>
                <p className="text-sm">No cash flow data for {year}.</p>
                <p className="text-sm mt-1">Click "Generate from Budget" to create entries from your budget plan.</p>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {subView === "odds" && <BudgetODDSReport year={year} />}
      {subView === "plan-fact" && <BudgetPlanFactDashboard year={year} />}
    </div>
  )
}

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

// ─── Add Line Form ─────────────────────────────────────────────────────────────

function AddLineForm({ planId, existingCategories }: { planId: string; existingCategories: string[] }) {
  const t = useTranslations("budgeting")
  const create = useCreateBudgetLine()
  const [category, setCategory] = useState("")
  const [department, setDepartment] = useState("")
  const [customDept, setCustomDept] = useState("")
  const [lineType, setLineType] = useState<"expense" | "revenue">("expense")
  const [amount, setAmount] = useState("")
  const [forecastAmount, setForecastAmount] = useState("")
  const [costModelKey, setCostModelKey] = useState("")
  const [notes, setNotes] = useState("")
  const [show, setShow] = useState(false)

  const allCategories = useMemo(() => {
    const set = new Set([...DEFAULT_EXPENSE_CATEGORIES, ...DEFAULT_REVENUE_CATEGORIES, ...existingCategories])
    return Array.from(set)
  }, [existingCategories])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const resolvedDept = department === "__custom__" ? customDept : department
    await create.mutateAsync({
      planId,
      category,
      department: resolvedDept || undefined,
      lineType,
      plannedAmount: Number(amount),
      forecastAmount: forecastAmount ? Number(forecastAmount) : undefined,
      costModelKey: costModelKey || undefined,
      isAutoActual: !!costModelKey,
      notes: notes || undefined,
    })
    setCategory(""); setDepartment(""); setCustomDept(""); setAmount(""); setForecastAmount(""); setCostModelKey(""); setNotes("")
    setShow(false)
  }

  if (!show) return (
    <Button size="sm" onClick={() => setShow(true)} className="mb-4">
      <Plus className="h-4 w-4 mr-1" /> {t("btnAddLine")}
    </Button>
  )

  return (
    <Card className="mb-4">
      <CardContent className="pt-4">
        <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <datalist id="categories-list">
            {allCategories.map(c => <option key={c} value={c} />)}
          </datalist>
          <div>
            <label className="text-xs font-medium mb-1 block">{t("fieldCategory")}</label>
            <Input list="categories-list" value={category} onChange={e => setCategory(e.target.value)}
              placeholder={t("placeholderCategory")} required />
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block">{t("fieldDepartment")}</label>
            <select value={department} onChange={e => setDepartment(e.target.value)}
              className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background">
              <option value="">{t("optAll")}</option>
              {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
              <option value="__custom__">{t("optOther")}</option>
            </select>
            {department === "__custom__" && (
              <Input className="mt-1" value={customDept} onChange={e => setCustomDept(e.target.value)}
                placeholder={t("placeholderDepartment")} />
            )}
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block">{t("fieldType")}</label>
            <select title={t("hintFieldType")} value={lineType} onChange={e => setLineType(e.target.value as any)}
              className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background">
              <option value="expense">{t("expense")}</option>
              <option value="revenue">{t("revenue")}</option>
              <option value="cogs">COGS</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block">{t("fieldPlannedAmount")} (₼)</label>
            <Input title={t("hintFieldAmount")} type="number" value={amount} onChange={e => setAmount(e.target.value)} min={0} step={0.01} required />
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block">{t("fieldForecastAmount")} (₼)</label>
            <Input type="number" value={forecastAmount} onChange={e => setForecastAmount(e.target.value)} min={0} step={0.01} placeholder={t("placeholderForecast")} />
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs font-medium mb-1 block flex items-center gap-1">
              <Link2 className="h-3 w-3" /> {t("fieldCostModelKey")}
            </label>
            <select value={costModelKey} onChange={e => setCostModelKey(e.target.value)}
              className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background">
              <option value="">{t("optManualActual")}</option>
              {COST_MODEL_KEY_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>[{o.group}] {o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block">{t("fieldNotes")}</label>
            <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder={t("placeholderNotes")} />
          </div>
          <div className="flex items-end gap-2">
            <Button type="submit" disabled={create.isPending} size="sm">
              {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("btnAdd")}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setShow(false)}>{t("btnCancel")}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

// ─── Add Actual Form ───────────────────────────────────────────────────────────

function AddActualForm({ planId, existingCategories }: { planId: string; existingCategories: string[] }) {
  const t = useTranslations("budgeting")
  const create = useCreateBudgetActual()
  const [category, setCategory] = useState("")
  const [department, setDepartment] = useState("")
  const [customDept, setCustomDept] = useState("")
  const [lineType, setLineType] = useState<"expense" | "revenue">("expense")
  const [amount, setAmount] = useState("")
  const [expenseDate, setExpenseDate] = useState("")
  const [description, setDescription] = useState("")
  const [show, setShow] = useState(false)

  const allCategories = useMemo(() => {
    const set = new Set([...DEFAULT_EXPENSE_CATEGORIES, ...DEFAULT_REVENUE_CATEGORIES, ...existingCategories])
    return Array.from(set)
  }, [existingCategories])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const resolvedDept = department === "__custom__" ? customDept : department
    await create.mutateAsync({
      planId,
      category,
      department: resolvedDept || undefined,
      lineType,
      actualAmount: Number(amount),
      expenseDate: expenseDate || undefined,
      description: description || undefined,
    })
    setCategory(""); setDepartment(""); setCustomDept(""); setAmount(""); setExpenseDate(""); setDescription("")
    setShow(false)
  }

  if (!show) return (
    <Button size="sm" onClick={() => setShow(true)} className="mb-4">
      <Plus className="h-4 w-4 mr-1" /> {t("btnAddActual")}
    </Button>
  )

  return (
    <Card className="mb-4">
      <CardContent className="pt-4">
        <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <datalist id="actuals-categories-list">
            {allCategories.map(c => <option key={c} value={c} />)}
          </datalist>
          <div>
            <label className="text-xs font-medium mb-1 block">{t("fieldCategory")}</label>
            <Input list="actuals-categories-list" value={category} onChange={e => setCategory(e.target.value)}
              placeholder={t("placeholderCategory")} required />
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block">{t("fieldDepartment")}</label>
            <select value={department} onChange={e => setDepartment(e.target.value)}
              className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background">
              <option value="">{t("optAll")}</option>
              {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
              <option value="__custom__">{t("optOther")}</option>
            </select>
            {department === "__custom__" && (
              <Input className="mt-1" value={customDept} onChange={e => setCustomDept(e.target.value)}
                placeholder={t("placeholderDepartment")} />
            )}
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block">{t("fieldType")}</label>
            <select value={lineType} onChange={e => setLineType(e.target.value as any)}
              className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background">
              <option value="expense">{t("expense")}</option>
              <option value="revenue">{t("revenue")}</option>
              <option value="cogs">COGS</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block">{t("fieldActualAmount")} (₼)</label>
            <Input type="number" value={amount} onChange={e => setAmount(e.target.value)} min={0} step={0.01} required />
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block">{t("fieldDate")}</label>
            <Input type="date" value={expenseDate} onChange={e => setExpenseDate(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block">{t("fieldDescription")}</label>
            <Input value={description} onChange={e => setDescription(e.target.value)} placeholder={t("placeholderDescription")} />
          </div>
          <div className="flex items-end gap-2">
            <Button type="submit" disabled={create.isPending} size="sm">
              {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("btnAdd")}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setShow(false)}>{t("btnCancel")}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

// ─── Workspace Tab (G-01 through G-09) ───────────────────────────────────────

function WorkspaceTab({ planId, companyId, onNavigateTab }: { planId: string; companyId?: string | null; onNavigateTab?: (tab: string) => void }) {
  const t = useTranslations("budgeting")
  const { data: analytics, isLoading: analyticsLoading } = useBudgetAnalytics(planId, companyId)
  const { data: lines = [], isLoading: linesLoading } = useBudgetLines(planId)
  const { data: actuals = [] } = useBudgetActuals(planId)

  const updateLine = useUpdateBudgetLine()
  const createLine = useCreateBudgetLine()
  const deleteLine = useDeleteBudgetLine()
  const createActual = useCreateBudgetActual()
  const deleteActual = useDeleteBudgetActual()
  const aiNarrative = useAINarrative()
  const syncActuals = useSyncActuals()
  // Edit state
  const [editCell, setEditCell] = useState<{ id: string; field: string } | null>(null)
  const [editValue, setEditValue] = useState("")
  const [expandId, setExpandId] = useState<string | null>(null)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set())
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => new Set(["revenue", "cogs", "expense"]))
  const toggleSection = (key: string) => setCollapsedSections(prev => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next })
  const [addingSubItem, setAddingSubItem] = useState<string | null>(null)
  const [newSubItem, setNewSubItem] = useState({ category: "", amount: "", department: "" })
  const [addingSection, setAddingSection] = useState<string | null>(null) // "revenue" | "cogs" | "expense" | null
  const [addMode, setAddMode] = useState<"line" | "toGroup" | "newGroup">("line")
  const [newRow, setNewRow] = useState({ category: "", lineType: "expense", plannedAmount: "", forecastAmount: "", department: "", parentId: "" })
  const [filterText, setFilterText] = useState("")
  const [filterType, setFilterType] = useState<"all" | "expense" | "revenue">("all")
  const [showMaterialOnly, setShowMaterialOnly] = useState(false)
  const [materialityPct, setMaterialityPct] = useState(5)
  const [materialityAbs, setMaterialityAbs] = useState(500)
  const [narrative, setNarrative] = useState<string | null>(null)
  const [showNarrative, setShowNarrative] = useState(false)
  // Drill-down sheet for fact values
  const [drillDownLine, setDrillDownLine] = useState<BudgetLine | null>(null)
  // Variance note dialog
  const [varianceNoteLine, setVarianceNoteLine] = useState<BudgetLine | null>(null)
  const [varianceNoteText, setVarianceNoteText] = useState("")

  // Number format toggle — shadows outer fmt() within WorkspaceTab
  const [compactNumbers, setCompactNumbers] = useState(false)
  // List/Matrix view mode
  const [workspaceView, setWorkspaceView] = useState<"list" | "matrix">("list")
  const fmt = compactNumbers ? (n: number) => fmtK(n) + " ₼" : (n: number) => Math.round(n).toLocaleString() + " ₼"

  // New actual form for expand
  const [newActual, setNewActual] = useState({ amount: "", description: "", date: "" })

  // Build actuals by category+lineType map
  const actualsByCat = useMemo(() => {
    const m = new Map<string, { total: number; items: typeof actuals }>()
    for (const a of actuals) {
      const key = `${a.category}||${a.lineType}`
      const existing = m.get(key) ?? { total: 0, items: [] }
      existing.total += a.actualAmount
      existing.items.push(a)
      m.set(key, existing)
    }
    return m
  }, [actuals])

  // Auto-actual values from analytics
  const autoActualMap = useMemo(() => {
    const m = new Map<string, number>()
    if (analytics?.byCategory) {
      for (const c of analytics.byCategory) {
        // If the line has auto-actual, the analytics already resolved it
        m.set(c.category, c.actual)
      }
    }
    return m
  }, [analytics])

  // Filter and group lines
  const filteredLines = useMemo(() => {
    let result = [...lines]
    if (filterText) result = result.filter((l: BudgetLine) => l.category.toLowerCase().includes(filterText.toLowerCase()))
    if (filterType !== "all") result = result.filter((l: BudgetLine) => l.lineType === filterType)
    return result
  }, [lines, filterText, filterType, autoActualMap, actualsByCat])

  // Materiality check helper — used for opacity in table rows
  const isMaterial = (l: BudgetLine): boolean => {
    const factValue = l.isAutoActual ? (autoActualMap.get(l.category) ?? 0) : (actualsByCat.get(`${l.category}||${l.lineType}`)?.total ?? 0)
    const varianceAbsVal = Math.abs(l.plannedAmount - factValue)
    const variancePctVal = l.plannedAmount > 0 ? (varianceAbsVal / l.plannedAmount) * 100 : 0
    return variancePctVal >= materialityPct || varianceAbsVal >= materialityAbs
  }

  // Exclude parent-aggregate rows so totals don't double-count. Same filter as
  // the Workspace analytics endpoint. Without this, a P&L with both 601-01
  // (parent total) and 601-01-02 (child line) would count every revenue twice.
  const allLineCodes = useMemo(() => {
    const s = new Set<string>()
    for (const l of filteredLines) {
      const code = (l as any).account?.code ?? l.department ?? ""
      if (code) s.add(code)
    }
    return s
  }, [filteredLines])
  const isParentCode = useCallback((code: string): boolean => {
    for (const c of allLineCodes) {
      if (c !== code && c.startsWith(code + "-")) return true
    }
    return false
  }, [allLineCodes])
  const isLeafLine = useCallback((l: BudgetLine): boolean => {
    const code = (l as any).account?.code ?? l.department ?? ""
    return !code || !isParentCode(code)
  }, [isParentCode])

  const expenseLines = filteredLines.filter((l: BudgetLine) => l.lineType === "expense" && isLeafLine(l))
  const revenueLines = filteredLines.filter((l: BudgetLine) => l.lineType === "revenue" && isLeafLine(l))
  const cogsLines = filteredLines.filter((l: BudgetLine) => l.lineType === "cogs" && isLeafLine(l))

  // Helper: get leaf amount (children sum if group parent, else own amount)
  const leafPlanned = (l: BudgetLine) => l.children?.length ? l.children.reduce((s, c) => s + c.plannedAmount, 0) : l.plannedAmount
  const leafForecast = (l: BudgetLine) => l.children?.length ? l.children.reduce((s, c) => s + (c.forecastAmount ?? c.plannedAmount), 0) : (l.forecastAmount ?? l.plannedAmount)

  // Totals
  const totExpPlanned = expenseLines.reduce((s: number, l: BudgetLine) => s + leafPlanned(l), 0)
  const totExpForecast = expenseLines.reduce((s: number, l: BudgetLine) => s + leafForecast(l), 0)
  const totRevPlanned = revenueLines.reduce((s: number, l: BudgetLine) => s + leafPlanned(l), 0)
  const totRevForecast = revenueLines.reduce((s: number, l: BudgetLine) => s + leafForecast(l), 0)
  const totCOGSPlanned = cogsLines.reduce((s: number, l: BudgetLine) => s + leafPlanned(l), 0)
  const totCOGSForecast = cogsLines.reduce((s: number, l: BudgetLine) => s + leafForecast(l), 0)

  const { totalPlanned = 0, totalForecast = 0, totalActual = 0, totalVariance = 0, executionPct = 0, expenseExecutionPct = 0, elapsedPct = 100, autoActualTotal = 0, yearEndProjection = 0, byCategory = [], totalRevenuePlanned = 0, totalRevenueActual = 0, totalRevenueForecast = 0, totalExpensePlanned = 0, totalExpenseActual = 0, totalExpenseForecast = 0, totalCOGSPlanned = 0, totalCOGSActual = 0, totalCOGSForecast = 0, grossProfit = 0, grossProfitActual = 0, margin = 0, marginActual = 0, marginForecast = 0 } = analytics ?? {}

  // Inline edit handlers
  const startEdit = (id: string, field: string, currentVal: number) => {
    setEditCell({ id, field })
    setEditValue(String(currentVal))
  }

  const saveEdit = async () => {
    if (!editCell) return
    const val = Number(editValue)
    if (isNaN(val) || val < 0) { setEditCell(null); return }
    const { id, field } = editCell
    if (field === "plannedAmount" || field === "forecastAmount") {
      const line = lines.find((l: BudgetLine) => l.id === id)
      if (line) await updateLine.mutateAsync({ id, planId, [field]: val })
    }
    setEditCell(null)
  }

  // All parent groups filtered by adding section's lineType
  const parentGroups = lines.filter((l: BudgetLine) => l.lineType === (addingSection || "expense") && ((l.children && l.children.length > 0) || (l.notes && l.notes.startsWith("group:"))))

  // Add new row (line, sub-item in group, or new group)
  const handleAddRow = async () => {
    if (!newRow.category.trim() || !addingSection) return
    if (addMode === "newGroup") {
      await createLine.mutateAsync({
        planId,
        category: newRow.category,
        lineType: addingSection as "expense" | "revenue" | "cogs",
        plannedAmount: 0,
        notes: `group:${newRow.category.toLowerCase().replace(/\s+/g, "_")}`,
      })
    } else {
      await createLine.mutateAsync({
        planId,
        category: newRow.category,
        department: newRow.department || undefined,
        lineType: addingSection as "expense" | "revenue" | "cogs",
        plannedAmount: Number(newRow.plannedAmount) || 0,
        parentId: addMode === "toGroup" ? (newRow.parentId || undefined) : undefined,
      })
    }
    setNewRow({ category: "", lineType: "expense", plannedAmount: "", forecastAmount: "", department: "", parentId: "" })
    setAddMode("line")
    setAddingSection(null)
  }

  // Parse number: handle comma decimal separator (Excel paste) and spaces
  const parseAmount = (v: string): number => {
    const cleaned = v.replace(/\s/g, "").replace(",", ".")
    return Number(cleaned) || 0
  }

  // Add actual from expand
  const handleAddActual = async (category: string, lineType: string) => {
    if (!newActual.amount) return
    const amt = parseAmount(newActual.amount)
    if (amt <= 0) return
    await createActual.mutateAsync({
      planId,
      category,
      lineType: lineType as "expense" | "revenue" | "cogs",
      actualAmount: amt,
      description: newActual.description || undefined,
      expenseDate: newActual.date || undefined,
    })
    setNewActual({ amount: "", description: "", date: "" })
  }

  // Da Vinci narrative
  const handleAINarrative = async () => {
    setShowNarrative(true)
    try {
      const result = await aiNarrative.mutateAsync({ planId })
      setNarrative(result.narrative)
    } catch {
      setNarrative(t("errorAiGeneration"))
    }
  }

  // Sync actuals
  const handleSync = async () => {
    try {
      const result = await syncActuals.mutateAsync(planId)
      toast.success(t("msgSynced", { count: result.synced }))
    } catch { toast.error(t("errorSync")) }
  }


  if (analyticsLoading || linesLoading) return (
    <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-purple-500" /></div>
  )

  // Render one grid row
  const renderRow = (line: BudgetLine) => {
    const catActuals = actualsByCat.get(`${line.category}||${line.lineType}`)
    const factValue = line.isAutoActual ? (autoActualMap.get(line.category) ?? 0) : (catActuals?.total ?? 0)
    const variance = line.lineType === "revenue" ? factValue - line.plannedAmount : line.plannedAmount - factValue
    const variancePct = line.plannedAmount > 0 ? (variance / line.plannedAmount) * 100 : 0
    const isExpanded = expandId === line.id

    const rowMaterial = !showMaterialOnly || isMaterial(line)

    return (
      <tr key={line.id} className={`border-t border-border/50 hover:bg-muted/30 group ${!rowMaterial ? "opacity-40" : ""}`}>
        {/* Category — strip cost type prefix for expenses with " — " pattern */}
        <td className="px-3 py-2 text-sm font-medium">{line.lineType === "expense" && line.category.includes(" — ") ? line.category.split(" — ").slice(1).join(" — ") : line.category}</td>
        {/* Department */}
        <td className="px-2 py-2 text-xs text-muted-foreground">{line.department || "—"}</td>
        {/* Plan - editable */}
        <td className="px-2 py-2 text-right">
          {editCell?.id === line.id && editCell?.field === "plannedAmount" ? (
            <Input type="number" className="h-7 w-24 text-right text-xs ml-auto" value={editValue} autoFocus
              onChange={e => setEditValue(e.target.value)}
              onBlur={() => saveEdit()}
              onKeyDown={e => { if (e.key === "Enter") saveEdit() }} />
          ) : (
            <button type="button" className="font-mono text-sm cursor-pointer hover:bg-purple-50 dark:hover:bg-purple-900/20 px-1 rounded border border-transparent hover:border-purple-300 dark:hover:border-purple-700 transition-colors"
              onClick={() => startEdit(line.id, "plannedAmount", line.plannedAmount)}>
              {fmt(line.plannedAmount)}
              <Pencil className="h-2.5 w-2.5 inline ml-1 opacity-0 group-hover:opacity-40" />
            </button>
          )}
        </td>
        {/* Fact — clickable for drill-down */}
        <td className="px-2 py-2 text-right">
          <div className="flex items-center justify-end gap-1">
            {line.isAutoActual ? (
              <>
                <button type="button"
                  className="font-mono text-sm cursor-pointer px-1 rounded hover:underline text-primary"
                  onClick={() => setDrillDownLine(line)}
                  title={t("drillDownTitle")}>
                  {fmt(factValue)}
                </button>
                <Badge title={t("hintBadgeAuto")} className="text-[9px] bg-primary/10 text-primary px-1">{t("badgeAuto")}</Badge>
              </>
            ) : (
              <button type="button"
                className={`font-mono text-sm cursor-pointer px-1 rounded border border-transparent transition-colors hover:bg-emerald-50 hover:border-emerald-300 dark:hover:bg-emerald-900/20 dark:hover:border-emerald-700 ${
                  factValue > 0 ? "text-[#065f46] dark:text-[#6ee7b7]" : "text-muted-foreground"
                }`}
                onClick={() => setExpandId(isExpanded ? null : line.id)}
                title="Click to add actual">
                {fmt(factValue)}
                <Pencil className="h-2.5 w-2.5 inline ml-1 opacity-0 group-hover:opacity-40" />
              </button>
            )}
          </div>
        </td>
        {/* Variance + annotation icon */}
        <td className={`px-2 py-2 text-right font-mono text-sm font-bold ${variance >= 0 ? "text-[#065f46] dark:text-[#6ee7b7]" : "text-red-500"}`}>
          <div className="flex items-center justify-end gap-1">
            <button type="button"
              className={`p-0.5 rounded hover:bg-muted ${line.notes ? "text-primary" : "text-muted-foreground/40 hover:text-muted-foreground"}`}
              title={line.notes || t("varianceNoteTitle")}
              onClick={() => { setVarianceNoteLine(line); setVarianceNoteText(line.notes || "") }}>
              <MessageSquare className="h-3.5 w-3.5" />
            </button>
            <span>{variance >= 0 ? "+" : ""}{variancePct.toFixed(1)}%</span>
          </div>
        </td>
        {/* Actions */}
        <td className="px-2 py-2 text-center">
          <button onClick={() => { if (confirm(t("confirmDeleteLine") + " «" + line.category + "» " + t("confirmDeleteLineSuffix"))) deleteLine.mutate({ id: line.id, planId }) }}
            title={t("hintDeleteLine")}
            className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-muted-foreground hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </td>
      </tr>
    )
  }

  // Render expand detail row for actuals
  const renderExpand = (line: BudgetLine) => {
    if (expandId !== line.id || line.isAutoActual) return null
    const items = actualsByCat.get(`${line.category}||${line.lineType}`)?.items ?? []
    return (
      <tr key={`expand-${line.id}`} className="bg-muted/20">
        <td colSpan={6} className="px-4 py-2">
          <div className="text-xs space-y-1">
            <div className="font-medium text-muted-foreground mb-1">{t("actualRecordsFor")} «{line.category}»:</div>
            {items.length === 0 && <div className="text-muted-foreground italic">{t("emptyNoRecords")}</div>}
            {items.map(a => (
              <div key={a.id} className="flex items-center gap-3 py-0.5">
                <span className="font-mono">{fmt(a.actualAmount)}</span>
                <span className="text-muted-foreground">{a.expenseDate || "—"}</span>
                <span className="text-muted-foreground flex-1">{a.description || ""}</span>
                <button onClick={() => deleteActual.mutate({ id: a.id, planId })}
                  title={t("hintDeleteLine")} className="text-red-400 hover:text-red-600"><Trash2 className="h-3 w-3" /></button>
              </div>
            ))}
            <div className="flex items-center gap-2 pt-1 border-t border-border/50">
              <Input type="text" inputMode="decimal" placeholder={t("colAmount")} className="h-6 w-24 text-xs" value={newActual.amount}
                onChange={e => setNewActual(d => ({ ...d, amount: e.target.value }))} />
              <Input placeholder={t("colDescription")} className="h-6 flex-1 text-xs" value={newActual.description}
                onChange={e => setNewActual(d => ({ ...d, description: e.target.value }))} />
              <Input type="date" className="h-6 w-32 text-xs" value={newActual.date}
                onChange={e => setNewActual(d => ({ ...d, date: e.target.value }))} />
              <Button size="sm" variant="ghost" className="h-6 text-xs px-2"
                onClick={() => handleAddActual(line.category, line.lineType)}>
                <Plus className="h-3 w-3 mr-1" /> {t("btnAdd")}
              </Button>
            </div>
          </div>
        </td>
      </tr>
    )
  }

  // Group colors by notes tag
  const GROUP_COLORS: Record<string, string> = {
    "group:admin":      "bg-violet-500",
    "group:tech_infra": "bg-primary",
    "group:labor":      "bg-emerald-500",
    "group:risk":       "bg-amber-500",
  }

  // Add sub-item under a parent group
  const handleAddSubItem = async (parentLine: BudgetLine) => {
    if (!newSubItem.category.trim()) return
    await createLine.mutateAsync({
      planId,
      category: newSubItem.category,
      lineType: parentLine.lineType as "expense" | "revenue" | "cogs",
      plannedAmount: Number(newSubItem.amount) || 0,
      parentId: parentLine.id,
      department: newSubItem.department || undefined,
    })
    setNewSubItem({ category: "", amount: "", department: "" })
    setAddingSubItem(null)
  }

  // Render a group header row (collapsible)
  const renderGroupHeader = (line: BudgetLine) => {
    const groupTag = line.notes ?? ""
    const colorClass = GROUP_COLORS[groupTag] ?? "bg-muted-foreground/40"
    const children = line.children ?? []
    const groupTotal = children.reduce((s, c) => s + c.plannedAmount, 0)
    // If parent group has isAutoActual, use parent's auto-actual (e.g. adminOverhead, techInfraTotal)
    const groupActual = line.isAutoActual
      ? (autoActualMap.get(line.category) ?? 0)
      : children.reduce((s, c) => {
          return s + (c.isAutoActual ? (autoActualMap.get(c.category) ?? 0) : (actualsByCat.get(`${c.category}||${c.lineType}`)?.total ?? 0))
        }, 0)
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
      <tr key={line.id} className="border-t border-border/40 bg-muted/20 hover:bg-muted/40 cursor-pointer select-none group" onClick={toggleGroup}>
        <td className="px-3 py-2.5" colSpan={2}>
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${colorClass}`} />
            {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
            <span className="font-semibold text-sm">{line.category}</span>
            <Badge variant="outline" title={t("hintBadgeChildCount")} className="ml-1 text-[10px] px-1.5 py-0">{children.length}</Badge>
          </div>
        </td>
        <td className="px-2 py-2.5 text-right font-mono text-sm font-semibold"><AnimatedNumber value={groupTotal} duration={500} formatter={fmt} /></td>
        <td className="px-2 py-2.5 text-right font-mono text-sm font-semibold text-[#065f46] dark:text-[#6ee7b7]"><AnimatedNumber value={groupActual} duration={500} formatter={fmt} /></td>
        <td className="px-2 py-2.5 text-right text-sm font-semibold text-muted-foreground">
          {groupTotal > 0 ? `${(((groupTotal - groupActual) / groupTotal) * 100).toFixed(1)}%` : "—"}
        </td>
        <td className="px-2 py-2.5 text-center" onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-1 justify-center">
            <button
              className="p-1 rounded hover:bg-purple-50 dark:hover:bg-purple-900/20 text-muted-foreground hover:text-purple-600 opacity-60 hover:opacity-100"
              title={t("hintAddSubItem")}
              onClick={() => setAddingSubItem(addingSubItem === line.id ? null : line.id)}>
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button
              className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-muted-foreground hover:text-red-600 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"
              title={t("hintDeleteLine")}
              onClick={() => {
                const childCount = children.length
                const msg = childCount > 0
                  ? `${t("confirmDeleteLine")} «${line.category}» (${childCount} subcategories will be detached)?`
                  : `${t("confirmDeleteLine")} «${line.category}»?`
                if (confirm(msg)) deleteLine.mutate({ id: line.id, planId })
              }}>
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </td>
      </tr>
    )
  }

  // Render a child (sub-item) row — indented
  const renderChildRow = (child: BudgetLine) => {
    const factValue = child.isAutoActual ? (autoActualMap.get(child.category) ?? 0) : (actualsByCat.get(`${child.category}||${child.lineType}`)?.total ?? 0)
    const variance = child.lineType === "revenue" ? factValue - child.plannedAmount : child.plannedAmount - factValue
    const variancePct = child.plannedAmount > 0 ? (variance / child.plannedAmount) * 100 : 0
    const isExpanded = expandId === child.id

    const noteText = child.notes && !child.notes.startsWith("group:") ? child.notes : null

    return (
      <React.Fragment key={child.id}>
        <tr className="border-t border-border/30 hover:bg-muted/20 group">
          <td className="px-3 py-1.5 text-sm" colSpan={2}>
            <div className="flex items-center gap-1 pl-6">
              <span className="text-muted-foreground text-xs">—</span>
              <span className="flex-1">{child.category}</span>
              {child.department && <Badge variant="outline" className="text-[9px] px-1">{child.department}</Badge>}
            </div>
            {noteText && <div className="pl-8 text-[10px] text-muted-foreground italic mt-0.5">{noteText}</div>}
          </td>
          <td className="px-2 py-1.5 text-right">
            {editCell?.id === child.id && editCell?.field === "plannedAmount" ? (
              <Input type="number" className="h-6 w-24 text-right text-xs ml-auto" value={editValue} autoFocus
                onChange={e => setEditValue(e.target.value)}
                onBlur={() => saveEdit()} onKeyDown={e => { if (e.key === "Enter") saveEdit() }} />
            ) : (
              <button type="button" className="font-mono text-sm cursor-pointer hover:bg-purple-50 dark:hover:bg-purple-900/20 px-1 rounded border border-transparent hover:border-purple-300 dark:hover:border-purple-700 transition-colors"
                onClick={() => startEdit(child.id, "plannedAmount", child.plannedAmount)}>
                {fmt(child.plannedAmount)}
                <Pencil className="h-2.5 w-2.5 inline ml-1 opacity-0 group-hover:opacity-40" />
              </button>
            )}
          </td>
          <td className="px-2 py-1.5 text-right">
            <div className="flex items-center justify-end gap-1">
              <button type="button"
                className={`font-mono text-sm cursor-pointer px-1 rounded hover:underline ${child.isAutoActual ? "text-primary" : "text-[#065f46] dark:text-[#6ee7b7]"}`}
                onClick={() => setDrillDownLine(child)}
                title={t("drillDownTitle")}>
                {fmt(factValue)}
              </button>
              {child.isAutoActual && (
                <Badge title={t("hintBadgeAuto")} className="text-[9px] bg-primary/10 text-primary px-1">{t("badgeAuto")}</Badge>
              )}
              {!child.isAutoActual && (
                <button type="button" className="text-muted-foreground hover:text-foreground"
                  onClick={() => setExpandId(isExpanded ? null : child.id)}>
                  <ChevronDown className={`h-3 w-3 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                </button>
              )}
            </div>
          </td>
          <td className={`px-2 py-1.5 text-right font-mono text-xs font-bold ${variance >= 0 ? "text-[#065f46] dark:text-[#6ee7b7]" : "text-red-500"}`}>
            <div className="flex items-center justify-end gap-1">
              <button type="button"
                className={`p-0.5 rounded hover:bg-muted ${noteText ? "text-primary" : "text-muted-foreground/40 hover:text-muted-foreground"}`}
                title={noteText || t("varianceNoteTitle")}
                onClick={() => { setVarianceNoteLine(child); setVarianceNoteText(child.notes || "") }}>
                <MessageSquare className="h-3 w-3" />
              </button>
              <span>{variance >= 0 ? "+" : ""}{variancePct.toFixed(1)}%</span>
            </div>
          </td>
          <td className="px-2 py-1.5 text-center">
            <button onClick={() => { if (confirm(t("confirmDeleteLine") + " «" + child.category + "»?")) deleteLine.mutate({ id: child.id, planId }) }}
              title={t("hintDeleteLine")}
              className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-muted-foreground hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </td>
        </tr>
        {renderExpand(child)}
      </React.Fragment>
    )
  }

  // Render add sub-item inline form
  const renderAddSubItemForm = (parentLine: BudgetLine) => {
    if (addingSubItem !== parentLine.id) return null
    return (
      <tr key={`add-sub-${parentLine.id}`} className="bg-purple-50 dark:bg-purple-900/10 border-t border-border/30">
        <td className="px-3 py-1.5">
          <div className="pl-6 flex items-center gap-2">
            <Input placeholder={t("placeholderCategoryShort")} className="h-6 text-xs flex-1" autoFocus value={newSubItem.category}
              onChange={e => setNewSubItem(d => ({ ...d, category: e.target.value }))}
              onKeyDown={e => { if (e.key === "Enter") handleAddSubItem(parentLine) }} />
          </div>
        </td>
        <td className="px-2 py-1.5">
          <Input placeholder={t("colDepartment")} className="h-6 text-xs" value={newSubItem.department}
            onChange={e => setNewSubItem(d => ({ ...d, department: e.target.value }))}
            onKeyDown={e => { if (e.key === "Enter") handleAddSubItem(parentLine) }} />
        </td>
        <td className="px-2 py-1.5">
          <Input type="number" placeholder="0" className="h-6 text-xs text-right" value={newSubItem.amount}
            onChange={e => setNewSubItem(d => ({ ...d, amount: e.target.value }))}
            onKeyDown={e => { if (e.key === "Enter") handleAddSubItem(parentLine) }} />
        </td>
        <td colSpan={2} className="px-2 py-1.5">
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={() => handleAddSubItem(parentLine)}>
              <CheckCircle className="h-3 w-3 mr-1" /> {t("btnSave")}
            </Button>
            <Button size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={() => setAddingSubItem(null)}>{t("btnCancel")}</Button>
          </div>
        </td>
        <td />
      </tr>
    )
  }

  // Section renderer (used for revenue; expenses use renderGroupedExpenses below)
  const renderSection = (title: string, sectionLines: BudgetLine[], totPlanned: number, _totForecast: number) => {
    const totActual = sectionLines.reduce((s: number, l: BudgetLine) => {
      const fact = l.isAutoActual ? (autoActualMap.get(l.category) ?? 0) : (actualsByCat.get(`${l.category}||${l.lineType}`)?.total ?? 0)
      return s + fact
    }, 0)
    return (
      <>
        <tr className="bg-muted/40">
          <td colSpan={6} className="px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">{title}</td>
        </tr>
        {sectionLines.map(l => [renderRow(l), renderExpand(l)])}
        <tr className="border-y-2 border-border bg-muted/50">
          <td className="px-3 py-2 font-bold text-sm" colSpan={2} title={t("hintSectionTotal")}>{t("totalLabel")} {title.toLowerCase()}</td>
          <td className="px-2 py-2 text-right font-mono text-sm font-bold"><AnimatedNumber value={totPlanned} duration={500} formatter={fmt} /></td>
          <td className="px-2 py-2 text-right font-mono text-sm font-bold text-[#065f46] dark:text-[#6ee7b7]"><AnimatedNumber value={totActual} duration={500} formatter={fmt} /></td>
          <td className="px-2 py-2 text-right font-mono text-sm font-bold">
            {totPlanned > 0 ? `${(((totPlanned - totActual) / totPlanned) * 100).toFixed(1)}%` : "—"}
          </td>
          <td />
        </tr>
      </>
    )
  }

  // Helper: get actual for a line (parent auto-actual takes priority over children sum)
  const getLineActual = (l: BudgetLine): number => {
    if (l.isAutoActual) return autoActualMap.get(l.category) ?? 0
    if (l.children?.length) {
      return l.children.reduce((cs, c) => cs + (c.isAutoActual ? (autoActualMap.get(c.category) ?? 0) : (actualsByCat.get(`${c.category}||${c.lineType}`)?.total ?? 0)), 0)
    }
    return actualsByCat.get(`${l.category}||${l.lineType}`)?.total ?? 0
  }

  // Universal grouped section renderer with per-section add form
  const renderGroupedSection = (title: string, sectionLines: BudgetLine[], totPlanned: number, sectionHintKey?: string, sectionLineType?: string) => {
    const totActual = sectionLines.reduce((s: number, l: BudgetLine) => s + getLineActual(l), 0)
    const sectionKey = sectionLineType || title.toLowerCase()
    const isCollapsed = collapsedSections.has(sectionKey)

    return (
      <>
        {/* Clickable section header with totals — always visible */}
        <tr
          className="bg-muted/40 cursor-pointer hover:bg-muted/60 transition-colors select-none"
          onClick={() => toggleSection(sectionKey)}
        >
          <td colSpan={2} className="px-3 pt-2 pb-1.5">
            <div className="flex items-center gap-2">
              <svg className={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 ${isCollapsed ? "" : "rotate-90"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{title}</div>
                {sectionHintKey && <div className="text-[10px] text-muted-foreground/60 font-normal mt-0.5">{t(sectionHintKey)}</div>}
              </div>
            </div>
          </td>
          <td className="px-2 pt-2 pb-1.5 text-right font-mono text-sm font-bold"><AnimatedNumber value={totPlanned} duration={500} formatter={fmt} /></td>
          <td className="px-2 pt-2 pb-1.5 text-right font-mono text-sm font-bold text-[#065f46] dark:text-[#6ee7b7]"><AnimatedNumber value={totActual} duration={500} formatter={fmt} /></td>
          <td className="px-2 pt-2 pb-1.5 text-right font-mono text-sm font-bold">
            {totPlanned > 0 ? `${(((totPlanned - totActual) / totPlanned) * 100).toFixed(1)}%` : "—"}
          </td>
          <td className="pt-2 pb-1.5">
            <span className="text-[10px] text-muted-foreground">{sectionLines.length}</span>
          </td>
        </tr>
        {/* Detail rows — only when expanded */}
        {!isCollapsed && (() => {
          const isCostSection = sectionLineType === "expense" || sectionLineType === "cogs"

          // For expense/cogs lines with "prefix — dept" format, group by prefix with subtotals
          if (isCostSection && sectionLines.some(l => l.category.includes(" — "))) {
            const groups = new Map<string, BudgetLine[]>()
            const ungrouped: BudgetLine[] = []
            for (const l of sectionLines) {
              if (l.category.includes(" — ")) {
                const prefix = l.category.split(" — ")[0]
                if (!groups.has(prefix)) groups.set(prefix, [])
                groups.get(prefix)!.push(l)
              } else {
                ungrouped.push(l)
              }
            }

            const getLineActual = (l: BudgetLine) =>
              l.isAutoActual ? (autoActualMap.get(l.category) ?? 0) : (actualsByCat.get(`${l.category}||${l.lineType}`)?.total ?? 0)

            return (
              <>
                {Array.from(groups.entries()).map(([prefix, groupLines]) => {
                  const grpPlanned = groupLines.reduce((s, l) => s + l.plannedAmount, 0)
                  const grpActual = groupLines.reduce((s, l) => s + getLineActual(l), 0)
                  const grpVar = grpPlanned > 0 ? ((grpPlanned - grpActual) / grpPlanned * 100).toFixed(1) + "%" : "—"
                  return (
                    <React.Fragment key={`grp-${prefix}`}>
                      <tr className="bg-muted border-t-2 border-border">
                        <td colSpan={2} className="px-4 py-2">
                          <span className="text-[13px] font-bold text-foreground/70 tracking-wide">{prefix}</span>
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-xs font-semibold text-muted-foreground"><AnimatedNumber value={grpPlanned} duration={400} formatter={fmt} /></td>
                        <td className="px-2 py-2 text-right font-mono text-xs font-semibold text-muted-foreground"><AnimatedNumber value={grpActual} duration={400} formatter={fmt} /></td>
                        <td className="px-2 py-2 text-right font-mono text-xs font-semibold text-muted-foreground">{grpVar}</td>
                        <td />
                      </tr>
                      {groupLines.map(l => {
                        const isGroupParent = (l.children && l.children.length > 0) || (l.notes && l.notes.startsWith("group:"))
                        const groupTag = l.notes ?? ""
                        const isOpen = expandedGroups.has(groupTag.replace("group:", ""))
                        if (isGroupParent) {
                          return (
                            <React.Fragment key={l.id}>
                              {renderGroupHeader(l)}
                              {renderAddSubItemForm(l)}
                              {isOpen && (l.children ?? []).map(child => renderChildRow(child))}
                            </React.Fragment>
                          )
                        }
                        return <React.Fragment key={l.id}>{renderRow(l)}{renderExpand(l)}</React.Fragment>
                      })}
                    </React.Fragment>
                  )
                })}
                {ungrouped.map(l => {
                  const isGroupParent = (l.children && l.children.length > 0) || (l.notes && l.notes.startsWith("group:"))
                  const groupTag = l.notes ?? ""
                  const isOpen = expandedGroups.has(groupTag.replace("group:", ""))
                  if (isGroupParent) {
                    return (
                      <React.Fragment key={l.id}>
                        {renderGroupHeader(l)}
                        {renderAddSubItemForm(l)}
                        {isOpen && (l.children ?? []).map(child => renderChildRow(child))}
                      </React.Fragment>
                    )
                  }
                  return <React.Fragment key={l.id}>{renderRow(l)}{renderExpand(l)}</React.Fragment>
                })}
              </>
            )
          }

          // Default: flat render for revenue/cogs
          return sectionLines.map(l => {
            const isGroupParent = (l.children && l.children.length > 0) || (l.notes && l.notes.startsWith("group:"))
            const groupTag = l.notes ?? ""
            const isOpen = expandedGroups.has(groupTag.replace("group:", ""))
            if (isGroupParent) {
              return (
                <React.Fragment key={l.id}>
                  {renderGroupHeader(l)}
                  {renderAddSubItemForm(l)}
                  {isOpen && (l.children ?? []).map(child => renderChildRow(child))}
                </React.Fragment>
              )
            }
            return <React.Fragment key={l.id}>{renderRow(l)}{renderExpand(l)}</React.Fragment>
          })
        })()}
        {/* Per-section add form (only when expanded) */}
        {!isCollapsed && sectionLineType && addingSection === sectionLineType ? (
          <>
            <tr className="bg-green-50/50 dark:bg-green-900/5">
              <td colSpan={6} className="px-3 py-1.5">
                <div className="flex items-center gap-1">
                  <Button size="sm" variant={addMode === "line" ? "default" : "outline"} className="h-7 text-xs" onClick={() => setAddMode("line")}>{t("addAsLine")}</Button>
                  <Button size="sm" variant={addMode === "toGroup" ? "default" : "outline"} className="h-7 text-xs" onClick={() => setAddMode("toGroup")}>{t("addToGroup")}</Button>
                  <Button size="sm" variant={addMode === "newGroup" ? "default" : "outline"} className="h-7 text-xs" onClick={() => setAddMode("newGroup")}>{t("addAsGroup")}</Button>
                </div>
              </td>
            </tr>
            <tr className="bg-green-50 dark:bg-green-900/10">
              <td className="px-2 py-1.5">
                <div className="flex flex-col gap-1">
                  {addMode === "toGroup" && (
                    <select value={newRow.parentId} onChange={e => setNewRow(d => ({ ...d, parentId: e.target.value }))} className="h-7 rounded-md border border-input bg-background px-2 text-xs w-full">
                      <option value="">{t("selectGroup")}</option>
                      {parentGroups.map((g: BudgetLine) => <option key={g.id} value={g.id}>{g.category}</option>)}
                    </select>
                  )}
                  <Input placeholder={addMode === "newGroup" ? t("newGroupName") : t("placeholderCategoryShort")} className="h-7 text-xs" value={newRow.category} onChange={e => setNewRow(d => ({ ...d, category: e.target.value }))} autoFocus
                    onKeyDown={e => { if (e.key === "Enter") handleAddRow(); if (e.key === "Escape") setAddingSection(null) }} />
                </div>
              </td>
              {addMode !== "newGroup" ? (
                <>
                  <td className="px-2 py-1.5"><Input placeholder={t("colDepartment")} className="h-7 text-xs" value={newRow.department ?? ""} onChange={e => setNewRow(d => ({ ...d, department: e.target.value }))} /></td>
                  <td className="px-2 py-1.5"><Input type="number" placeholder="0" className="h-7 text-xs text-right" value={newRow.plannedAmount} onChange={e => setNewRow(d => ({ ...d, plannedAmount: e.target.value }))} /></td>
                </>
              ) : (
                <td colSpan={2} className="px-2 py-1 text-[10px] text-muted-foreground align-middle">Amount = 0, add subcategories via "+"</td>
              )}
              <td />
              <td className="px-2 py-1.5 text-center">
                <div className="flex gap-1 justify-center">
                  <Button size="sm" variant="default" className="h-7 text-xs" onClick={handleAddRow}><CheckCircle className="h-3 w-3 mr-1" />{t("btnSave")}</Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setAddingSection(null); setAddMode("line") }}>{t("btnCancel")}</Button>
                </div>
              </td>
              <td />
            </tr>
          </>
        ) : (!isCollapsed && sectionLineType) ? (
          <tr className="border-t border-dashed border-border/20">
            <td colSpan={6} className="px-3 py-1">
              <button onClick={() => { setAddingSection(sectionLineType); setAddMode("line"); setNewRow(d => ({ ...d, parentId: "" })) }} className="text-[11px] text-purple-600 dark:text-purple-400 hover:underline flex items-center gap-1">
                <Plus className="h-3 w-3" /> {t("btnAddRow")}
              </button>
            </td>
          </tr>
        ) : null}
      </>
    )
  }

  const planLabel = t("colPlan")
  const actualLabel = t("colActual")
  const MAX_CHART_ITEMS = 8

  const expenseAllData = byCategory
    .filter((c: any) => c.lineType === "expense" && (c.planned > 0 || c.actual > 0))
    .sort((a: any, b: any) => Math.max(b.actual, b.planned) - Math.max(a.actual, a.planned))

  const expenseBarData = (() => {
    const toRow = (c: any) => ({
      name: c.category.length > 20 ? c.category.slice(0, 20) + "…" : c.category,
      [planLabel]: Math.round(c.planned),
      [actualLabel]: Math.round(c.actual),
    })
    if (expenseAllData.length <= MAX_CHART_ITEMS + 1) return expenseAllData.map(toRow)
    const top = expenseAllData.slice(0, MAX_CHART_ITEMS).map(toRow)
    const rest = expenseAllData.slice(MAX_CHART_ITEMS)
    top.push({ name: `Other (${rest.length})`, [planLabel]: Math.round(rest.reduce((s: number, c: any) => s + c.planned, 0)), [actualLabel]: Math.round(rest.reduce((s: number, c: any) => s + c.actual, 0)) })
    return top
  })()

  const revenueAllData = byCategory
    .filter((c: any) => c.lineType === "revenue" && (c.planned > 0 || c.actual > 0))
    .sort((a: any, b: any) => Math.max(b.actual, b.planned) - Math.max(a.actual, a.planned))

  const revenueBarData = (() => {
    const toRow = (c: any) => ({
      name: c.category.length > 20 ? c.category.slice(0, 20) + "…" : c.category,
      [planLabel]: Math.round(c.planned),
      [actualLabel]: Math.round(c.actual),
    })
    if (revenueAllData.length <= MAX_CHART_ITEMS + 1) return revenueAllData.map(toRow)
    const top = revenueAllData.slice(0, MAX_CHART_ITEMS).map(toRow)
    const rest = revenueAllData.slice(MAX_CHART_ITEMS)
    top.push({ name: `Other (${rest.length})`, [planLabel]: Math.round(rest.reduce((s: number, c: any) => s + c.planned, 0)), [actualLabel]: Math.round(rest.reduce((s: number, c: any) => s + c.actual, 0)) })
    return top
  })()

  // Total costs = OpEx only (COGS allocates same costs by service, not additional)
  const totalCostPlanned = totalExpensePlanned
  const totalCostActual = totalExpenseActual
  // Expense execution: how much of total cost budget was spent
  const expExecPct = totalCostPlanned > 0 ? (totalCostActual / totalCostPlanned) * 100 : 0
  // Overspend alert
  const overspendPct = expExecPct - 100
  const overspendAmount = totalCostActual - totalCostPlanned

  // Composite budget execution: 60% revenue achievement + 40% cost discipline.
  // Only meaningful once actuals exist — previously cost discipline defaulted to
  // 100% when there were no actuals, producing a misleading "40% composite" on
  // an untouched plan.
  const hasAnyActuals = totalRevenueActual > 0 || totalCostActual > 0
  const revAchieve = totalRevenuePlanned > 0 ? Math.min((totalRevenueActual / totalRevenuePlanned) * 100, 150) : 0
  const costDisc = totalCostActual > 0 && totalCostPlanned > 0 ? Math.min((totalCostPlanned / totalCostActual) * 100, 150) : 0
  const budgetExecPct = hasAnyActuals ? Math.max(0, Math.round(revAchieve * 0.6 + costDisc * 0.4)) : 0
  const budgetExecColor = !hasAnyActuals ? "amber" as const : budgetExecPct >= 80 ? "green" as const : budgetExecPct >= 50 ? "amber" as const : "red" as const
  const budgetExecEmoji = !hasAnyActuals ? "⏳" : budgetExecPct >= 80 ? "🟢" : budgetExecPct >= 50 ? "🟡" : "🔴"
  const budgetExecLabel = hasAnyActuals ? `${budgetExecPct}% composite score` : "No actuals yet"

  const totExpActual = expenseLines.reduce((s: number, l: BudgetLine) => s + getLineActual(l), 0)
  const totRevActual = revenueLines.reduce((s: number, l: BudgetLine) => s + getLineActual(l), 0)
  const totCOGSActual = cogsLines.reduce((s: number, l: BudgetLine) => s + getLineActual(l), 0)

  return (
    <div className="space-y-6">
      {/* ROW 0: Budget Change History */}
      <BudgetChangeHistory planId={planId} />

      {/* ROW 1: 4 Dark KPI Scorecards (Power BI style) */}
      {(() => {
        const netPosition = totalRevenuePlanned - totalCostPlanned - totalCOGSPlanned
        const grossMarginPct = totalRevenuePlanned > 0 ? ((totalRevenuePlanned - totalCOGSPlanned) / totalRevenuePlanned * 100) : 0
        const revExecPct = totalRevenuePlanned > 0 ? Math.round((totalRevenueActual / totalRevenuePlanned) * 100) : 0
        const lineCount = lines.length
        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Revenue Budget */}
            <div className="rounded-xl bg-gradient-to-br from-indigo-50 to-indigo-100 border border-indigo-200 dark:from-indigo-950/30 dark:to-indigo-900/20 dark:border-indigo-800 p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">{t("sectionRevenues")}</span>
                <div className="h-9 w-9 rounded-full bg-indigo-200 dark:bg-indigo-800 flex items-center justify-center">
                  <TrendingUp className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                </div>
              </div>
              <div className="text-2xl font-bold tabular-nums text-indigo-700 dark:text-indigo-300">{fmtK(totalRevenuePlanned)} ₼</div>
              <div className="text-xs text-muted-foreground mt-1">{revenueLines.length} {t("colCategory").toLowerCase()} · {revExecPct}% {t("kpiExecution").toLowerCase()}</div>
            </div>
            {/* COGS Budget */}
            <div className="rounded-xl bg-gradient-to-br from-cyan-50 to-cyan-100 border border-cyan-200 dark:from-cyan-950/30 dark:to-cyan-900/20 dark:border-cyan-800 p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">{t("sectionCOGS")}</span>
                <div className="h-9 w-9 rounded-full bg-cyan-200 dark:bg-cyan-800 flex items-center justify-center">
                  <Banknote className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
                </div>
              </div>
              <div className="text-2xl font-bold tabular-nums text-cyan-700 dark:text-cyan-300">{fmtK(totalCOGSPlanned)} ₼</div>
              <div className="text-xs text-muted-foreground mt-1">{t("sectionMargin").split("(")[0].trim()}: {grossMarginPct.toFixed(1)}%</div>
            </div>
            {/* Operating Expenses */}
            <div className="rounded-xl bg-gradient-to-br from-orange-50 to-orange-100 border border-orange-200 dark:from-orange-950/30 dark:to-orange-900/20 dark:border-orange-800 p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">{t("sectionExpenses")}</span>
                <div className="h-9 w-9 rounded-full bg-orange-200 dark:bg-orange-800 flex items-center justify-center">
                  <DollarSign className="h-4 w-4 text-orange-600 dark:text-orange-400" />
                </div>
              </div>
              <div className="text-2xl font-bold tabular-nums text-orange-700 dark:text-orange-300">{fmtK(totalCostPlanned)} ₼</div>
              <div className="text-xs text-muted-foreground mt-1">{expenseLines.length} {t("colCategory").toLowerCase()} · {Math.round(expExecPct)}% {t("kpiExecution").toLowerCase()}</div>
            </div>
            {/* Net Budget Position */}
            <div className={`rounded-xl p-5 ${netPosition >= 0 ? "bg-gradient-to-br from-emerald-50 to-emerald-100 border border-emerald-200 dark:from-emerald-950/30 dark:to-emerald-900/20 dark:border-emerald-800" : "bg-gradient-to-br from-red-50 to-red-100 border border-red-200 dark:from-red-950/30 dark:to-red-900/20 dark:border-red-800"}`}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">{t("operatingProfit")}</span>
                <div className={`h-9 w-9 rounded-full flex items-center justify-center ${netPosition >= 0 ? "bg-emerald-200 dark:bg-emerald-800" : "bg-red-200 dark:bg-red-800"}`}>
                  {netPosition >= 0 ? <TrendingUp className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> : <TrendingDown className="h-4 w-4 text-red-600 dark:text-red-400" />}
                </div>
              </div>
              <div className={`text-2xl font-bold tabular-nums ${netPosition >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300"}`}>{netPosition < 0 ? "(" + fmtK(Math.abs(netPosition)) + ")" : fmtK(netPosition)} ₼</div>
              <div className="text-xs text-muted-foreground mt-1">{lineCount} {t("colCategory").toLowerCase()} · {t("kpiVariance")}: {totalVariance >= 0 ? "+" : ""}{fmtK(totalVariance)} ₼</div>
            </div>
          </div>
        )
      })()}

      {/* ROW 2: Waterfall + Gauge */}
      {byCategory.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-2 border-0 shadow-md">
            <CardHeader className="pb-1">
              <CardTitle className="text-sm font-semibold">{t("chartWaterfall") || "Budget Waterfall"}</CardTitle>
              <p className="text-[10px] text-muted-foreground">Budget → Forecast → Actual → Variance → Projection</p>
            </CardHeader>
            <CardContent className="pb-3">
              <BudgetWaterfallChart
                totalPlanned={totalPlanned}
                totalForecast={totalForecast}
                totalActual={totalActual}
                totalVariance={totalVariance}
                yearEndProjection={yearEndProjection}
              />
            </CardContent>
          </Card>
          <Card className="lg:col-span-1 border-0 shadow-md">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">{t("budgetExecution") || "Budget Execution"}</CardTitle>
              <p className="text-[10px] text-muted-foreground">{budgetExecEmoji} {budgetExecLabel}</p>
            </CardHeader>
            <CardContent className="flex justify-center">
              <BudgetExecutionGauge
                executionPct={budgetExecPct}
                expenseExecPct={expExecPct}
                revenueExecPct={totalRevenuePlanned > 0 ? (totalRevenueActual / totalRevenuePlanned) * 100 : 0}
                elapsedPct={elapsedPct}
              />
            </CardContent>
          </Card>
        </div>
      )}

      {/* ROW 3: Category Bars */}
      {byCategory.length > 0 && (
        <Card className="border-0 shadow-md">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">{t("chartPlanForecastActual") || "Plan vs Actual by Category"}</CardTitle>
            <p className="text-[10px] text-muted-foreground">{byCategory.filter((c: any) => c.planned > 0 || c.actual > 0).length} active categories</p>
          </CardHeader>
          <CardContent className="pt-0">
            <BudgetCategoryBars categories={byCategory} />
          </CardContent>
        </Card>
      )}

      {/* Overspend alert banner */}
      {overspendPct > 25 && (
        <div className="rounded-lg border-2 border-red-500 bg-red-100 dark:bg-red-900/50 dark:border-red-700 px-4 py-3 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-700 dark:text-red-300 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-red-800 dark:text-red-200 text-sm">{t("alertOverspendTitle")}</p>
            <p className="text-red-700 dark:text-red-300 text-xs mt-0.5">
              {t("alertOverspendDesc", { pct: Math.round(overspendPct), amount: fmt(overspendAmount) })}
            </p>
          </div>
        </div>
      )}
      {overspendPct > 10 && overspendPct <= 25 && (
        <div className="rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 px-4 py-3 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-amber-700 dark:text-amber-400 text-sm">{t("alertWarningTitle")}</p>
            <p className="text-amber-600 dark:text-amber-300 text-xs mt-0.5">
              {t("alertWarningDesc", { pct: Math.round(overspendPct), amount: fmt(overspendAmount) })}
            </p>
          </div>
        </div>
      )}

      {/* Executive Summary */}
      {(totalCostPlanned > 0 || totalRevenuePlanned > 0) && (
        <div className="rounded-xl bg-gradient-to-r from-slate-50 to-slate-100 dark:from-slate-900/50 dark:to-slate-800/50 border border-slate-200 dark:border-slate-700/50 px-5 py-3.5 text-sm text-muted-foreground flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-slate-200 dark:bg-slate-700 flex items-center justify-center shrink-0">
            <BarChart2 className="h-4 w-4 text-slate-600 dark:text-slate-300" />
          </div>
          <div>
            {totalCostActual > totalCostPlanned ? (
              <span>{t("summaryOverspend", { period: analytics?.plan?.name ?? "", pct: Math.round(overspendPct), amount: fmt(overspendAmount) })}</span>
            ) : totalCostPlanned > 0 ? (
              <span>{t("summaryUnderBudget", { period: analytics?.plan?.name ?? "", pct: Math.round(100 - expExecPct), amount: fmt(totalCostPlanned - totalCostActual) })}</span>
            ) : null}
            {totalRevenuePlanned === 0 && totalCostPlanned > 0 && (
              <span className="ml-1 text-amber-600 dark:text-amber-400">{t("summaryNoRevenue")}</span>
            )}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          title={t("hintBtnAiAnalysis")}
          onClick={handleAINarrative}
          disabled={aiNarrative.isPending}
          className="relative overflow-hidden bg-gradient-to-r from-[hsl(var(--ai-from))] to-[hsl(var(--ai-to))] hover:opacity-90 text-white border-0 shadow-md shadow-[hsl(var(--ai-from))]/25 hover:shadow-lg hover:shadow-[hsl(var(--ai-from))]/40 transition-all duration-300 hover:scale-[1.03] active:scale-[0.97]"
        >
          {aiNarrative.isPending ? (
            <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
          ) : (
            <span className="relative mr-1.5 flex h-4 w-4 items-center justify-center">
              <Sparkles className="h-4 w-4 animate-pulse" />
            </span>
          )}
          {t("btnAiAnalysis")}
        </Button>
        {autoActualTotal > 0 && (
          <Button size="sm" variant="outline" title={t("hintBtnSyncActuals")} onClick={handleSync} disabled={syncActuals.isPending}>
            {syncActuals.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Link2 className="h-4 w-4 mr-1" />}
            {t("btnUpdateActual")}
          </Button>
        )}
        <ApplyTemplatesButton planId={planId} />
        <a href={`/api/budgeting/export?planId=${planId}`} download>
          <Button size="sm" variant="outline" title={t("hintBtnExport")}><DollarSign className="h-4 w-4 mr-1" /> {t("btnExport")}</Button>
        </a>
        <div className="flex items-center border rounded-md overflow-hidden">
          <Button size="sm" variant={workspaceView === "list" ? "default" : "ghost"} className="h-8 text-xs rounded-none px-2"
            onClick={() => setWorkspaceView("list")} title="List">
            <List className="h-4 w-4" />
          </Button>
          <Button size="sm" variant={workspaceView === "matrix" ? "default" : "ghost"} className="h-8 text-xs rounded-none px-2"
            onClick={() => setWorkspaceView("matrix")} title="Matrix (Department x Cost Type)">
            <LayoutGrid className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1" />
        <Input placeholder={t("searchCategory")} title={t("hintSearchCategory")} value={filterText} onChange={e => setFilterText(e.target.value)} className="h-8 w-48 text-xs" />
        <select value={filterType} onChange={e => setFilterType(e.target.value as any)} title={t("hintFilterType")} className="h-8 rounded-md border border-input bg-background px-2 text-xs">
          <option value="all">{t("filterAll")}</option>
          <option value="expense">{t("filterExpenses")}</option>
          <option value="revenue">{t("filterRevenues")}</option>
        </select>
        <Button size="sm" variant={showMaterialOnly ? "default" : "outline"} className="h-8 text-xs"
          onClick={() => setShowMaterialOnly(!showMaterialOnly)} title={t("hintFilterMaterial")}>
          {t("filterMaterial")}
        </Button>
        {showMaterialOnly && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>≥</span>
            <Input type="number" value={materialityPct} onChange={e => setMaterialityPct(Number(e.target.value))} className="h-7 w-14 text-xs text-right" />
            <span>%</span>
            <span>{t("or")}</span>
            <Input type="number" value={materialityAbs} onChange={e => setMaterialityAbs(Number(e.target.value))} className="h-7 w-20 text-xs text-right" />
            <span>₼</span>
          </div>
        )}
        <Button size="sm" variant={compactNumbers ? "default" : "outline"} className="h-8 text-xs font-mono"
          onClick={() => setCompactNumbers(!compactNumbers)} title="Compact number format (K/M)">
          {compactNumbers ? "1.2M" : "1,234"}
        </Button>
      </div>

      {/* Da Vinci Narrative */}
      {showNarrative && (
        <Card className="border-[hsl(var(--ai-from))]/20 ai-gradient-border">
          <CardHeader className="pb-2">
            <div className="flex justify-between items-center">
              <CardTitle className="text-sm flex items-center gap-2"><AlertCircle className="h-4 w-4 text-[hsl(var(--ai-from))]" /> {t("aiAnalysisTitle")}</CardTitle>
              <Button size="sm" variant="ghost" onClick={() => { setShowNarrative(false); setNarrative(null) }}>✕</Button>
            </div>
          </CardHeader>
          <CardContent>
            {narrative ? <div className="text-sm whitespace-pre-wrap leading-relaxed">{narrative}</div>
              : <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> {t("generating")}</div>}
          </CardContent>
        </Card>
      )}

      {/* === MATRIX VIEW === */}
      {workspaceView === "matrix" && analytics?.matrix && analytics.matrix.cells.length > 0 && (
        <BudgetMatrixGrid matrix={analytics.matrix} compact={compactNumbers} />
      )}
      {workspaceView === "matrix" && (!analytics?.matrix || analytics.matrix.cells.length === 0) && (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            <LayoutGrid className="h-12 w-12 mx-auto mb-3 opacity-40" />
            <p className="text-lg font-medium mb-2">{t("matrixNotConfigured")}</p>
            <p className="text-sm mb-4">{t("matrixNotConfiguredHint")}</p>
            <Button
              onClick={async () => {
                try {
                  const res = await fetch(`/api/budgeting/matrix-seed`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ planId }),
                  })
                  const json = await res.json()
                  if (!res.ok) {
                    alert(json.error || "Failed to generate matrix")
                    return
                  }
                  window.location.reload()
                } catch (err) {
                  alert("Network error")
                }
              }}
            >
              <LayoutGrid className="h-4 w-4 mr-2" />
              {t("matrixGenerate")}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* === MAIN EDITABLE GRID === */}
      {workspaceView === "list" && (<Card className="border-0 shadow-md overflow-hidden">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-[#1a3050] border-b-2 border-white/10">
                <tr>
                  <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white/90"><span className="inline-flex items-center gap-1.5">{t("colCategory")} <InfoHint text={t("hintColCategory")} size={12} /></span></th>
                  <th className="px-2 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white/70"><span className="inline-flex items-center gap-1.5">{t("colDepartment")} <InfoHint text={t("hintColDepartment")} size={12} /></span></th>
                  <th className="px-2 py-3 text-right text-xs font-semibold uppercase tracking-wider text-sky-300"><span className="inline-flex items-center gap-1 justify-end">{t("colPlan")} ₼ <InfoHint text={t("hintColPlan")} size={12} /></span></th>
                  <th className="px-2 py-3 text-right text-xs font-semibold uppercase tracking-wider text-emerald-300"><span className="inline-flex items-center gap-1 justify-end">{t("colActual")} ₼ <InfoHint text={t("hintColActual")} size={12} /></span></th>
                  <th className="px-2 py-3 text-right text-xs font-semibold uppercase tracking-wider text-amber-300"><span className="inline-flex items-center gap-1 justify-end">{t("colVariancePct")} <InfoHint text={t("hintColVariance")} size={12} /></span></th>
                  <th className="px-2 py-3 w-10" />
                </tr>
              </thead>
              <tbody>
                {renderGroupedSection(t("sectionRevenues"), revenueLines, totRevPlanned, "hintSectionRevenue", "revenue")}
                {revenueLines.length === 0 && (
                  <tr className="bg-amber-50/50 dark:bg-amber-950/10">
                    <td colSpan={6} className="px-4 py-2 text-xs text-amber-700 dark:text-amber-400 italic">
                      {t("hintAddRevenue")}
                    </td>
                  </tr>
                )}
                {renderGroupedSection(t("sectionCOGS"), cogsLines, totCOGSPlanned, "hintSectionCOGS", "cogs")}

                {/* Gross Profit row */}
                {(revenueLines.length > 0 || cogsLines.length > 0) && (() => {
                  const gpActual = totRevActual - totCOGSActual
                  const gpNeg = gpActual < 0
                  return (
                  <tr className={`border-y-2 ${gpNeg ? "border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/10" : "border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/10"}`}>
                    <td className="px-3 py-2" colSpan={2}>
                      <div className="font-bold text-sm">{t("grossProfit")}</div>
                      <div className="text-[10px] text-muted-foreground/60 font-normal">{t("hintGrossProfit")}</div>
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-sm font-bold"><AnimatedNumber value={totRevPlanned - totCOGSPlanned} duration={500} formatter={fmt} /></td>
                    <td className={`px-2 py-2 text-right font-mono text-sm font-bold ${gpNeg ? "text-red-600 dark:text-red-400" : "text-[#065f46] dark:text-[#6ee7b7]"}`}><AnimatedNumber value={gpActual} duration={500} formatter={fmt} /></td>
                    <td colSpan={2} />
                  </tr>
                  )
                })()}

                {renderGroupedSection(t("sectionExpenses"), expenseLines, totExpPlanned, "hintSectionExpenses", "expense")}

                {/* Operating Profit row */}
                {(expenseLines.length > 0 || revenueLines.length > 0 || cogsLines.length > 0) && (() => {
                  const opActual = totRevActual - totExpActual
                  const opNeg = opActual < 0
                  return (
                  <tr className={`border-y-2 ${opNeg ? "border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/10" : "border-purple-300 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/10"}`}>
                    <td className="px-3 py-2" colSpan={2}>
                      <div className="font-bold text-sm">{t("operatingProfit")}</div>
                      <div className="text-[10px] text-muted-foreground/60 font-normal">{t("hintOperatingProfit")}</div>
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-sm font-bold"><AnimatedNumber value={totRevPlanned - totExpPlanned} duration={500} formatter={fmt} /></td>
                    <td className={`px-2 py-2 text-right font-mono text-sm font-bold ${opNeg ? "text-red-600 dark:text-red-400" : "text-[#065f46] dark:text-[#6ee7b7]"}`}><AnimatedNumber value={opActual} duration={500} formatter={fmt} /></td>
                    <td colSpan={2} />
                  </tr>
                  )
                })()}

                {/* Empty state */}
                {lines.length === 0 && !addingSection && (
                  <tr>
                    <td colSpan={6} className="text-center py-12 text-muted-foreground">
                      {t("emptyNoLines")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>)}

      {/* Drill-down Sheet for fact values */}
      <Sheet open={!!drillDownLine} onOpenChange={open => { if (!open) setDrillDownLine(null) }}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{t("drillDownTitle")}: {drillDownLine?.category}</SheetTitle>
            <SheetDescription className="sr-only">{t("drillDownTitle")}</SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-3">
            {drillDownLine?.isAutoActual ? (
              <div className="space-y-2">
                <Badge className="bg-primary/10 text-primary">{t("costModelSource")}</Badge>
                <div className="text-sm text-muted-foreground">{t("costModelKey")}: <code className="bg-muted px-1 rounded">{drillDownLine.costModelKey || "—"}</code></div>
                <div className="text-lg font-mono font-bold">{fmt(autoActualMap.get(drillDownLine.category) ?? 0)}</div>
              </div>
            ) : (
              <div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-1.5 text-xs font-medium">{t("colDate")}</th>
                      <th className="text-left py-1.5 text-xs font-medium">{t("colDescription")}</th>
                      <th className="text-right py-1.5 text-xs font-medium">{t("colAmount")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(drillDownLine ? (actualsByCat.get(`${drillDownLine.category}||${drillDownLine.lineType}`)?.items ?? []) : []).map(a => (
                      <tr key={a.id} className="border-b border-border/30">
                        <td className="py-1.5 text-xs">{a.expenseDate || "—"}</td>
                        <td className="py-1.5 text-xs">{a.description || "—"}</td>
                        <td className="py-1.5 text-right font-mono text-xs">{fmt(a.actualAmount)}</td>
                      </tr>
                    ))}
                    {drillDownLine && (actualsByCat.get(`${drillDownLine.category}||${drillDownLine.lineType}`)?.items ?? []).length === 0 && (
                      <tr><td colSpan={3} className="py-4 text-center text-muted-foreground text-xs italic">{t("noActuals")}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Variance note Dialog */}
      <Dialog open={!!varianceNoteLine} onOpenChange={open => { if (!open) setVarianceNoteLine(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("varianceNoteTitle")}: {varianceNoteLine?.category}</DialogTitle>
            <DialogDescription className="sr-only">{t("varianceNotePlaceholder")}</DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder={t("varianceNotePlaceholder")}
            value={varianceNoteText}
            onChange={e => setVarianceNoteText(e.target.value)}
            rows={4}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setVarianceNoteLine(null)}>{t("btnCancel")}</Button>
            <Button onClick={() => {
              if (varianceNoteLine) {
                updateLine.mutate({ id: varianceNoteLine.id, planId, notes: varianceNoteText })
                setVarianceNoteLine(null)
              }
            }}>{t("btnSave")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* F7: Multi-Currency FX Summary */}
      <BudgetFxSummary
        lines={(lines as any[]).flatMap((l: any) => [l, ...(l.children ?? [])])}
        baseCurrency="AZN"
      />
    </div>
  )
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────

function OverviewTab({ planId }: { planId: string }) {
  const t = useTranslations("budgeting")
  const { data: analytics, isLoading, error } = useBudgetAnalytics(planId)
  const aiNarrative = useAINarrative()
  const syncActuals = useSyncActuals()
  const [narrative, setNarrative] = useState<string | null>(null)
  const [showNarrative, setShowNarrative] = useState(false)

  if (isLoading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
    </div>
  )
  if (error || !analytics) return (
    <div className="text-center py-20 text-muted-foreground">{t("errorLoading")}</div>
  )

  const {
    totalPlanned, totalForecast, totalActual, totalVariance,
    executionPct, expenseExecutionPct = 0, revenueExecutionPct = 0,
    elapsedPct = 0, yearEndProjection, byCategory, byDepartment,
    autoActualTotal, totalExpensePlanned = 0, totalExpenseActual = 0,
    totalExpenseForecast = 0, totalRevenuePlanned = 0, totalRevenueActual = 0,
    totalRevenueForecast = 0, margin = 0, marginActual = 0,
  } = analytics

  const totalCOGSPlanned = analytics.totalCOGSPlanned ?? 0
  const totalCOGSActual = analytics.totalCOGSActual ?? 0
  // Total costs = OpEx only (COGS allocates same costs by service, not additional)
  const totalCostPlanned = totalExpensePlanned
  const totalCostActual = totalExpenseActual
  // Expense execution: <100% = under budget (green), 100-110% = warning, >110% = overspend (red)
  const expExecPct = totalCostPlanned > 0 ? (totalCostActual / totalCostPlanned) * 100 : 0
  const revExecPct = revenueExecutionPct || (totalRevenuePlanned > 0 ? (totalRevenueActual / totalRevenuePlanned) * 100 : 0)
  const marginForecast = totalRevenueForecast - totalExpenseForecast

  const handleAINarrative = async () => {
    setShowNarrative(true)
    try {
      const result = await aiNarrative.mutateAsync({ planId })
      setNarrative(result.narrative)
    } catch {
      setNarrative(t("errorAiGenerationNarrative"))
    }
  }

  const handleSyncActuals = async () => {
    try {
      const result = await syncActuals.mutateAsync(planId)
      toast.success(t("msgSyncedCostModel", { count: result.synced }))
    } catch {
      toast.error(t("errorSyncCostModel"))
    }
  }

  return (
    <div className="space-y-6">
      {/* ROW 1: 4 Summary KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <ColorStatCard
          label={t("sectionExpenses") + " (" + t("kpiActual").toLowerCase() + ")"}
          value={fmt(totalCostActual)}
          icon={<DollarSign className="h-5 w-5" />}
          color="red"
          hint={t("hintKpiExpActual")}
          subValue={`${Math.round(expExecPct)}% ${t("kpiExecution").toLowerCase()} · ${t("kpiPlan").toLowerCase()}: ${fmt(totalCostPlanned)}`}
        />
        <ColorStatCard
          label={t("sectionRevenues") + " (" + t("kpiActual").toLowerCase() + ")"}
          value={fmt(totalRevenueActual)}
          icon={<TrendingUp className="h-5 w-5" />}
          color="green"
          hint={t("hintKpiRevActual")}
          subValue={`${Math.round(revExecPct)}% ${t("kpiExecution").toLowerCase()} · ${t("kpiPlan").toLowerCase()}: ${fmt(totalRevenuePlanned)}`}
        />
        <ColorStatCard
          label={t("sectionMargin").split("(")[0].trim() + " (" + t("kpiActual").toLowerCase() + ")"}
          value={fmt(marginActual)}
          icon={marginActual >= 0 ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
          color={marginActual >= 0 ? "teal" : "red"}
          hint={t("hintKpiMarginActual")}
          subValue={`${t("kpiVariance")}: ${totalVariance >= 0 ? "+" : ""}${fmt(totalVariance)}`}
        />
        <ColorStatCard
          label={t("kpiExecution")}
          value={`${Math.round(executionPct)}%`}
          icon={executionPct >= 50 ? <CheckCircle className="h-5 w-5" /> : <AlertCircle className="h-5 w-5" />}
          color={executionPct >= 80 ? "green" : executionPct >= 50 ? "amber" : "red"}
          hint={t("kpiExecutionTooltip")}
          subValue={`${t("expectedByTime") || "By time"}: ${Math.round(elapsedPct)}%`}
        />
      </div>

      {/* Action buttons: Da Vinci narrative + sync actuals + export */}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={handleAINarrative}
          disabled={aiNarrative.isPending}
          className="relative overflow-hidden bg-gradient-to-r from-[hsl(var(--ai-from))] to-[hsl(var(--ai-to))] hover:opacity-90 text-white border-0 shadow-md shadow-[hsl(var(--ai-from))]/25 hover:shadow-lg hover:shadow-[hsl(var(--ai-from))]/40 transition-all duration-300 hover:scale-[1.03] active:scale-[0.97]"
        >
          {aiNarrative.isPending ? (
            <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
          ) : (
            <span className="relative mr-1.5 flex h-4 w-4 items-center justify-center">
              <Sparkles className="h-4 w-4 animate-pulse" />
            </span>
          )}
          {t("btnExplainVariances")}
        </Button>
        {autoActualTotal > 0 && (
          <Button size="sm" variant="outline" onClick={handleSyncActuals} disabled={syncActuals.isPending}>
            {syncActuals.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Link2 className="h-4 w-4 mr-1" />}
            {t("btnUpdateActualCostModel")}
          </Button>
        )}
        <a href={`/api/budgeting/export?planId=${planId}`} download>
          <Button size="sm" variant="outline"><DollarSign className="h-4 w-4 mr-1" /> {t("btnDownloadExcel") || "Excel"}</Button>
        </a>
      </div>

      {/* Da Vinci Narrative Card */}
      {showNarrative && (
        <Card className="border-[hsl(var(--ai-from))]/20 ai-gradient-border">
          <CardHeader className="pb-2">
            <div className="flex justify-between items-center">
              <CardTitle className="text-sm flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-[hsl(var(--ai-from))]" /> {t("aiAnalysisTitle")}
              </CardTitle>
              <Button size="sm" variant="ghost" onClick={() => { setShowNarrative(false); setNarrative(null) }}>✕</Button>
            </div>
          </CardHeader>
          <CardContent>
            {narrative ? (
              <div className="text-sm whitespace-pre-wrap leading-relaxed">{narrative}</div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> {t("generatingNarrative")}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ROW 2: Waterfall Chart (full width) */}
      {byCategory.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t("chartWaterfall")}</CardTitle>
          </CardHeader>
          <CardContent>
            <BudgetWaterfallChart
              totalPlanned={totalPlanned}
              totalForecast={totalForecast}
              totalActual={totalActual}
              totalVariance={totalVariance}
              yearEndProjection={yearEndProjection}
              onBarClick={() => {}}
            />
          </CardContent>
        </Card>
      )}

      {/* ROW 3: Gauge + Category Bars */}
      {byCategory.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-1">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{t("budgetExecution") || "Budget Execution"}</CardTitle>
            </CardHeader>
            <CardContent className="flex justify-center">
              <BudgetExecutionGauge
                executionPct={executionPct}
                expenseExecPct={expExecPct}
                revenueExecPct={revExecPct}
                elapsedPct={elapsedPct}
              />
            </CardContent>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{t("chartPlanForecastActual") || "Plan vs Actual by Category"}</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <BudgetCategoryBars categories={byCategory} />
            </CardContent>
          </Card>
        </div>
      )}

      {/* ROW 4: Margin Summary (Revenue / Expenses / Margin grouped bars) */}
      {(totalExpensePlanned > 0 || totalRevenuePlanned > 0) && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t("sectionMargin").split("(")[0].trim() || "Margin"}: {t("kpiPlan")} / {t("colForecast")} / {t("kpiActual")}</CardTitle>
          </CardHeader>
          <CardContent>
            <BudgetMarginSummary
              revenuePlan={totalRevenuePlanned}
              revenueForecast={totalRevenueForecast}
              revenueActual={totalRevenueActual}
              expensePlan={totalExpensePlanned}
              expenseForecast={totalExpenseForecast}
              expenseActual={totalExpenseActual}
              marginPlan={margin}
              marginForecast={marginForecast}
              marginActual={marginActual}
            />
          </CardContent>
        </Card>
      )}

      {/* 3-column variance table */}
      {byCategory.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">{t("tableBudgetForecastActual")}</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-[#1a3050] border-b-2 border-white/10">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white/90">{t("colCategory")}</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white/70">{t("colType")}</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-sky-300">{t("colBudget")}</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-purple-300">{t("colForecast")}</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-emerald-300">{t("colActual")}</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-amber-300">{t("colVariance")}</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-amber-300">%</th>
                  </tr>
                </thead>
                <tbody>
                  {byCategory.map((row, i) => (
                    <tr key={i} className="border-t border-border/50 hover:bg-muted/30">
                      <td className="px-4 py-2">{row.category}</td>
                      <td className="px-4 py-2">
                        <Badge variant="outline" className="text-xs">
                          {row.lineType === "revenue" ? t("revenue") : row.lineType === "cogs" ? t("cogs") : t("expense")}
                        </Badge>
                      </td>
                      <td className="px-4 py-2 text-right font-mono">{fmt(row.planned)}</td>
                      <td className="px-4 py-2 text-right font-mono text-purple-600 dark:text-purple-400">{fmt(row.forecast)}</td>
                      <td className="px-4 py-2 text-right font-mono text-[#065f46] dark:text-[#6ee7b7]">{fmt(row.actual)}</td>
                      <td className={`px-4 py-2 text-right font-medium ${row.variance >= 0 ? "text-[#065f46] dark:text-[#6ee7b7]" : "text-red-500"}`}>
                        {row.variance >= 0 ? "+" : ""}{fmt(row.variance)}
                      </td>
                      <td className={`px-4 py-2 text-right ${row.variancePct >= 0 ? "text-[#065f46] dark:text-[#6ee7b7]" : "text-red-500"}`}>
                        {row.variancePct >= 0 ? "+" : ""}{Math.round(row.variancePct)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* By Department */}
      {byDepartment.length > 1 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">{t("tableByDepartment")}</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-[#1a3050] border-b-2 border-white/10">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white/90">{t("colDepartment")}</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-sky-300">{t("colBudget")}</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-purple-300">{t("colForecast")}</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-emerald-300">{t("colActual")}</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-amber-300">{t("colVariance")}</th>
                  </tr>
                </thead>
                <tbody>
                  {byDepartment.map((row, i) => (
                    <tr key={i} className="border-t border-border/50 hover:bg-muted/30">
                      <td className="px-4 py-2 font-medium">{row.department}</td>
                      <td className="px-4 py-2 text-right font-mono">{fmt(row.planned)}</td>
                      <td className="px-4 py-2 text-right font-mono text-purple-600 dark:text-purple-400">{fmt(row.forecast)}</td>
                      <td className="px-4 py-2 text-right font-mono text-[#065f46] dark:text-[#6ee7b7]">{fmt(row.actual)}</td>
                      <td className={`px-4 py-2 text-right font-medium ${row.variance >= 0 ? "text-[#065f46] dark:text-[#6ee7b7]" : "text-red-500"}`}>
                        {row.variance >= 0 ? "+" : ""}{fmt(row.variance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {byCategory.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          {t("emptyAddLinesForAnalytics")}
        </div>
      )}
    </div>
  )
}

// ─── Lines Tab ────────────────────────────────────────────────────────────────

function LinesTab({ planId }: { planId: string }) {
  const t = useTranslations("budgeting")
  const { data: lines = [], isLoading } = useBudgetLines(planId)
  const updateLine = useUpdateBudgetLine()
  const deleteLine = useDeleteBudgetLine()
  const [editId, setEditId] = useState<string | null>(null)
  const [editData, setEditData] = useState<Partial<BudgetLine>>({})

  const existingCategories = lines.map(l => l.category)
  const total = lines.reduce((s, l) => s + l.plannedAmount, 0)
  const expenseTotal = lines.filter(l => l.lineType === "expense").reduce((s, l) => s + l.plannedAmount, 0)
  const revenueTotal = lines.filter(l => l.lineType === "revenue").reduce((s, l) => s + l.plannedAmount, 0)

  const startEdit = (line: BudgetLine) => {
    setEditId(line.id)
    setEditData({
      category: line.category,
      department: line.department || "",
      lineType: line.lineType,
      plannedAmount: line.plannedAmount,
      forecastAmount: line.forecastAmount ?? undefined,
      costModelKey: line.costModelKey || "",
      isAutoActual: line.isAutoActual,
      notes: line.notes || "",
    })
  }

  const saveEdit = async (id: string) => {
    await updateLine.mutateAsync({
      id,
      planId,
      category: editData.category,
      department: editData.department ?? undefined,
      lineType: editData.lineType,
      plannedAmount: editData.plannedAmount,
      forecastAmount: editData.forecastAmount ?? undefined,
      costModelKey: editData.costModelKey || undefined,
      isAutoActual: editData.isAutoActual,
      notes: editData.notes ?? undefined,
    })
    setEditId(null)
  }

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-purple-500" /></div>

  return (
    <div>
      <AddLineForm planId={planId} existingCategories={existingCategories} />
      <Card>
        <CardContent className="p-0">
          {lines.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">{t("emptyNoLinesHint")}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[#1a3050] border-b-2 border-white/10">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white/90">{t("colCategory")}</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white/70">{t("colDepartmentShort")}</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white/70">{t("colType")}</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-sky-300">{t("colBudget")}</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-purple-300">{t("colForecast")}</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-cyan-300">{t("colCostModel")}</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-white/70">{t("colAutoActual")}</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-white/70">{t("colActions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map(line => (
                    <tr key={line.id} className="border-t border-border/50 hover:bg-muted/30">
                      {editId === line.id ? (
                        <>
                          <td className="px-2 py-1">
                            <datalist id={`edit-cats-${line.id}`}>
                              {[...DEFAULT_EXPENSE_CATEGORIES, ...DEFAULT_REVENUE_CATEGORIES, ...existingCategories].map(c => <option key={c} value={c} />)}
                            </datalist>
                            <Input list={`edit-cats-${line.id}`} value={editData.category || ""} onChange={e => setEditData(d => ({ ...d, category: e.target.value }))} className="h-7 text-xs" />
                          </td>
                          <td className="px-2 py-1">
                            <Input value={editData.department || ""} onChange={e => setEditData(d => ({ ...d, department: e.target.value }))} className="h-7 text-xs" placeholder={t("colDepartment")} />
                          </td>
                          <td className="px-2 py-1">
                            <select value={editData.lineType} onChange={e => setEditData(d => ({ ...d, lineType: e.target.value as any }))}
                              className="border border-border rounded px-2 py-1 text-xs bg-background">
                              <option value="expense">{t("expense")}</option>
                              <option value="revenue">{t("revenue")}</option>
                            </select>
                          </td>
                          <td className="px-2 py-1">
                            <Input type="number" value={editData.plannedAmount || ""} onChange={e => setEditData(d => ({ ...d, plannedAmount: Number(e.target.value) }))} className="h-7 text-xs text-right" />
                          </td>
                          <td className="px-2 py-1">
                            <Input type="number" value={editData.forecastAmount || ""} onChange={e => setEditData(d => ({ ...d, forecastAmount: e.target.value ? Number(e.target.value) : undefined }))} className="h-7 text-xs text-right" placeholder={t("placeholderForecastShort")} />
                          </td>
                          <td className="px-2 py-1" colSpan={2}>
                            <select value={editData.costModelKey || ""} onChange={e => setEditData(d => ({ ...d, costModelKey: e.target.value, isAutoActual: !!e.target.value }))}
                              className="border border-border rounded px-2 py-1 text-xs bg-background w-full">
                              <option value="">{t("optManual")}</option>
                              {COST_MODEL_KEY_OPTIONS.map(o => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                              ))}
                            </select>
                          </td>
                          <td className="px-2 py-1 text-center">
                            <div className="flex gap-1 justify-center">
                              <Button size="sm" className="h-6 px-2 text-xs" onClick={() => saveEdit(line.id)} disabled={updateLine.isPending}>
                                {updateLine.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "✓"}
                              </Button>
                              <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => setEditId(null)}>✕</Button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-4 py-2">{line.category}</td>
                          <td className="px-4 py-2 text-muted-foreground">{line.department || "—"}</td>
                          <td className="px-4 py-2">
                            <Badge variant="outline" className="text-xs">
                              {line.lineType === "revenue" ? t("revenue") : line.lineType === "cogs" ? t("cogs") : t("expense")}
                            </Badge>
                          </td>
                          <td className="px-4 py-2 text-right font-mono">{fmt(line.plannedAmount)}</td>
                          <td className="px-4 py-2 text-right font-mono text-purple-600 dark:text-purple-400">
                            {line.forecastAmount != null ? fmt(line.forecastAmount) : <span className="text-muted-foreground text-xs">{t("placeholderForecastShort")}</span>}
                          </td>
                          <td className="px-4 py-2 text-xs text-primary">
                            {line.costModelKey ? <span title={line.costModelKey} className="flex items-center gap-1"><Link2 className="h-3 w-3" />{line.costModelKey.split(".").pop()}</span> : "—"}
                          </td>
                          <td className="px-4 py-2 text-center">
                            {line.isAutoActual
                              ? <Badge className="bg-primary/10 text-primary text-xs">{t("badgeAutoLabel")}</Badge>
                              : <span className="text-muted-foreground text-xs">{t("badgeManual")}</span>}
                          </td>
                          <td className="px-4 py-2 text-center">
                            <div className="flex gap-1 justify-center">
                              <button onClick={() => startEdit(line)} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground">
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button onClick={() => deleteLine.mutate({ id: line.id, planId })}
                                className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-muted-foreground hover:text-red-600">
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-border bg-muted/30">
                  <tr>
                    <td colSpan={3} className="px-4 py-2 font-medium text-sm">{t("totalLabel")}</td>
                    <td className="px-4 py-2 text-right font-bold font-mono">{fmt(total)}</td>
                    <td colSpan={4} className="px-4 py-2 text-xs text-muted-foreground">
                      {t("expensesLabel")} {fmt(expenseTotal)} | {t("revenuesLabel")} {fmt(revenueTotal)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ─── Actuals Tab ───────────────────────────────────────────────────────────────

function ActualsTab({ planId }: { planId: string }) {
  const t = useTranslations("budgeting")
  const { data: actuals = [], isLoading } = useBudgetActuals(planId)
  const updateActual = useUpdateBudgetActual()
  const deleteActual = useDeleteBudgetActual()
  const [filterCat, setFilterCat] = useState("")
  const [editId, setEditId] = useState<string | null>(null)
  const [editData, setEditData] = useState({ actualAmount: 0, category: "", department: "", expenseDate: "", description: "" })

  const existingCategories = actuals.map(a => a.category)
  const filtered = filterCat ? actuals.filter(a => a.category.toLowerCase().includes(filterCat.toLowerCase())) : actuals
  const total = actuals.reduce((s, a) => s + a.actualAmount, 0)

  const startEdit = (a: any) => {
    setEditId(a.id)
    setEditData({ actualAmount: a.actualAmount, category: a.category, department: a.department || "", expenseDate: a.expenseDate || "", description: a.description || "" })
  }
  const saveEdit = async (id: string) => {
    await updateActual.mutateAsync({ id, planId, actualAmount: editData.actualAmount, category: editData.category, department: editData.department || undefined, expenseDate: editData.expenseDate || undefined, description: editData.description || undefined })
    setEditId(null)
  }

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-purple-500" /></div>

  return (
    <div>
      <AddActualForm planId={planId} existingCategories={existingCategories} />
      <div className="mb-3 flex gap-2 items-center">
        <Input placeholder={t("placeholderFilterCategory")} value={filterCat} onChange={e => setFilterCat(e.target.value)} className="max-w-xs" />
        {filterCat && <Button variant="ghost" size="sm" onClick={() => setFilterCat("")}>{t("btnReset")}</Button>}
      </div>
      <Card>
        <CardContent className="p-0">
          {actuals.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">{t("emptyNoActuals")}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[#1a3050] border-b-2 border-white/10">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white/90">{t("colCategory")}</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white/70">{t("colDepartment")}</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white/70">{t("colType")}</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-emerald-300">{t("colAmount")}</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white/70">{t("colDate")}</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white/70">{t("colDescription")}</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-white/70">{t("colActions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(actual => (
                    <tr key={actual.id} className="border-t border-border/50 hover:bg-muted/30">
                      {editId === actual.id ? (
                        <>
                          <td className="px-2 py-1"><Input value={editData.category} onChange={e => setEditData(d => ({ ...d, category: e.target.value }))} className="h-7 text-xs" /></td>
                          <td className="px-2 py-1"><Input value={editData.department} onChange={e => setEditData(d => ({ ...d, department: e.target.value }))} className="h-7 text-xs" /></td>
                          <td className="px-4 py-2"><Badge variant="outline" className="text-xs">{actual.lineType === "revenue" ? t("revenue") : actual.lineType === "cogs" ? t("cogs") : t("expense")}</Badge></td>
                          <td className="px-2 py-1"><Input type="number" value={editData.actualAmount} onChange={e => setEditData(d => ({ ...d, actualAmount: Number(e.target.value) }))} className="h-7 text-xs text-right" /></td>
                          <td className="px-2 py-1"><Input value={editData.expenseDate} onChange={e => setEditData(d => ({ ...d, expenseDate: e.target.value }))} className="h-7 text-xs" placeholder="YYYY-MM-DD" /></td>
                          <td className="px-2 py-1"><Input value={editData.description} onChange={e => setEditData(d => ({ ...d, description: e.target.value }))} className="h-7 text-xs" /></td>
                          <td className="px-2 py-1 text-center">
                            <div className="flex gap-1 justify-center">
                              <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => saveEdit(actual.id)}>
                                <CheckCircle className="h-3.5 w-3.5" />
                              </Button>
                              <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => setEditId(null)}>✕</Button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-4 py-2">{actual.category}</td>
                          <td className="px-4 py-2 text-muted-foreground">{actual.department || "—"}</td>
                          <td className="px-4 py-2">
                            <Badge variant="outline" className="text-xs">
                              {actual.lineType === "revenue" ? t("revenue") : actual.lineType === "cogs" ? t("cogs") : t("expense")}
                            </Badge>
                          </td>
                          <td className="px-4 py-2 text-right font-mono">{fmt(actual.actualAmount)}</td>
                          <td className="px-4 py-2 text-muted-foreground">{actual.expenseDate || "—"}</td>
                          <td className="px-4 py-2 text-muted-foreground text-xs">{actual.description || "—"}</td>
                          <td className="px-4 py-2 text-center">
                            <div className="flex gap-1 justify-center">
                              <button onClick={() => startEdit(actual)}
                                className="p-1 rounded hover:bg-primary/5 text-muted-foreground hover:text-primary">
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button onClick={() => deleteActual.mutate({ id: actual.id, planId })}
                                className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-muted-foreground hover:text-red-600">
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-border bg-muted/30">
                  <tr>
                    <td colSpan={3} className="px-4 py-2 font-medium text-sm">{t("totalLabel")}</td>
                    <td className="px-4 py-2 text-right font-bold font-mono">{fmt(total)}</td>
                    <td colSpan={3} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ─── Plans Tab ────────────────────────────────────────────────────────────────

function PlansTab({ activePlanId, onSelect, onShowCreate }: { activePlanId: string; onSelect: (id: string) => void; onShowCreate: () => void }) {
  const t = useTranslations("budgeting")
  const { data: plans = [], isLoading } = useBudgetPlans()
  const updatePlan = useUpdateBudgetPlan()
  const deletePlan = useDeleteBudgetPlan()
  const { data: sessionData } = useSessionHook()
  const userRole = (sessionData?.user as any)?.role || "viewer"
  const activePlan = plans.find(p => p.id === activePlanId) || null

  // Inline rename
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const startRename = (plan: { id: string; name: string }) => { setRenamingId(plan.id); setRenameValue(plan.name) }
  const saveRename = async () => {
    if (!renamingId || !renameValue.trim()) { setRenamingId(null); return }
    await updatePlan.mutateAsync({ id: renamingId, name: renameValue.trim() })
    setRenamingId(null)
  }

  // Reset confirmation dialog
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [resetPending, setResetPending] = useState(false)

  // Clone plan
  const createPlan = useCreateBudgetPlan()
  const clonePlan = async (plan: any) => {
    const cloneName = `${plan.name} (Copy)`
    await createPlan.mutateAsync({ name: cloneName, year: plan.year, periodType: plan.periodType, quarter: plan.quarter, month: plan.month })
  }

  // F3: Versioning
  const { data: versions = [] } = useBudgetVersions(activePlanId || null)
  const createVersion = useCreateBudgetVersion()
  const [diffPlanIds, setDiffPlanIds] = useState<{ a: string; b: string } | null>(null)
  const { data: diffData, isLoading: diffLoading } = useBudgetDiff(
    diffPlanIds?.a || null,
    diffPlanIds?.b || null,
  )

  // F4: Rolling plan creation
  const createRolling = useCreateRollingPlan()
  const [showRollingDialog, setShowRollingDialog] = useState(false)
  const [rollingForm, setRollingForm] = useState({ name: "", startYear: new Date().getFullYear(), startMonth: new Date().getMonth() + 1 })

  const handleCreateRolling = async () => {
    if (!rollingForm.name) return
    await createRolling.mutateAsync(rollingForm)
    setShowRollingDialog(false)
    setRollingForm({ name: "", startYear: new Date().getFullYear(), startMonth: new Date().getMonth() + 1 })
  }

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-purple-500" /></div>

  return (
    <div>
      {/* Action bar */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            {plans.length} {plans.length === 1 ? "plan" : "plans"}
          </h2>
          <Button size="sm" variant="ghost" className="text-xs text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 h-7"
            disabled={plans.length === 0 || deletePlan.isPending}
            onClick={() => setShowResetConfirm(true)}>
            <Trash2 className="h-3 w-3 mr-1" /> Reset
          </Button>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="h-8" onClick={() => setShowRollingDialog(true)}>
            <CalendarRange className="h-3.5 w-3.5 mr-1" /> Rolling Plan
          </Button>
          <Button size="sm" className="h-8" onClick={onShowCreate}><Plus className="h-3.5 w-3.5 mr-1" /> {t("btnNewPlan")}</Button>
        </div>
      </div>

      {/* Rolling Plan Dialog */}
      <Dialog open={showRollingDialog} onOpenChange={setShowRollingDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Rolling Plan</DialogTitle>
            <DialogDescription>
              A 12-month rolling forecast with automatic extension. Close actuals each month, and the system adds a new month at the end.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="Plan name"
              value={rollingForm.name}
              onChange={e => setRollingForm(f => ({ ...f, name: e.target.value }))}
              onKeyDown={e => e.key === "Enter" && handleCreateRolling()}
              autoFocus
            />
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs text-muted-foreground mb-1 block">Start: year</label>
                <Input
                  type="number"
                  value={rollingForm.startYear}
                  onChange={e => setRollingForm(f => ({ ...f, startYear: Number(e.target.value) }))}
                />
              </div>
              <div className="flex-1">
                <label className="text-xs text-muted-foreground mb-1 block">Start: month</label>
                <select
                  value={rollingForm.startMonth}
                  onChange={e => setRollingForm(f => ({ ...f, startMonth: Number(e.target.value) }))}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {["January","February","March","April","May","June","July","August","September","October","November","December"].map((m, i) => (
                    <option key={i} value={i + 1}>{m}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRollingDialog(false)}>Cancel</Button>
            <Button onClick={handleCreateRolling} disabled={!rollingForm.name || createRolling.isPending}>
              {createRolling.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {plans.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <PiggyBank className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">{t("noPlansCardTitle")}</p>
          <p className="text-sm mt-1">{t("noPlansCardSubtitle")}</p>
          <Button className="mt-4" onClick={onShowCreate}><Plus className="h-4 w-4 mr-1" /> {t("createPlan")}</Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {plans.map(plan => {
            const isActive = activePlanId === plan.id
            const isImported = plan.name?.includes("(Imported)")
            const statusColor = plan.status === "approved" ? "bg-emerald-500" : plan.status === "pending_approval" ? "bg-amber-500" : plan.status === "rejected" ? "bg-red-500" : "bg-slate-500"
            return (
              <div key={plan.id}
                className={`rounded-xl overflow-hidden transition-all duration-200 shadow-md hover:shadow-lg ${isActive ? "ring-2 ring-purple-500 scale-[1.01]" : ""}`}
                style={{ borderTop: isActive ? "3px solid #8b5cf6" : "3px solid transparent" }}>
                {/* Dark header */}
                <div className="bg-gradient-to-br from-violet-50 to-violet-100 border-b border-violet-200 dark:from-violet-950/30 dark:to-violet-900/20 dark:border-violet-800 p-4">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    {renamingId === plan.id ? (
                      <Input className="h-7 text-sm bg-violet-100 border-violet-300 dark:bg-violet-900 dark:border-violet-700" value={renameValue}
                        onChange={e => setRenameValue(e.target.value)} autoFocus
                        onBlur={() => saveRename()}
                        onKeyDown={e => { if (e.key === "Enter") saveRename(); if (e.key === "Escape") setRenamingId(null) }} />
                    ) : (
                      <button onClick={() => startRename(plan)} className="text-left group" title="Click to rename">
                        <h3 className="text-sm font-bold leading-tight text-violet-700 dark:text-violet-300 group-hover:text-purple-500 dark:group-hover:text-purple-300 transition-colors">{plan.name}</h3>
                      </button>
                    )}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className={`w-2 h-2 rounded-full ${statusColor}`} />
                      <span className="text-[10px] uppercase tracking-wider text-slate-400">{plan.status?.replace("_", " ")}</span>
                    </div>
                  </div>
                  {/* Period & year */}
                  <div className="flex items-center gap-3 text-xs text-slate-400">
                    <div className="flex items-center gap-1">
                      <CalendarRange className="h-3 w-3" />
                      <span>{plan.year}</span>
                    </div>
                    <span>·</span>
                    <span>{plan.periodType === "annual" ? "Annual" : plan.periodType === "quarterly" ? `Q${plan.quarter}` : `Month ${plan.month}`}</span>
                    {isImported && (
                      <>
                        <span>·</span>
                        <Badge variant="secondary" className="text-[9px] px-1.5 py-0 bg-indigo-200 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-300 border-0">Imported</Badge>
                      </>
                    )}
                  </div>
                  {/* Approval dates */}
                  {plan.approvedAt && (
                    <div className="text-[10px] text-emerald-400 mt-1.5 flex items-center gap-1">
                      <CheckCircle className="h-3 w-3" /> Approved {new Date(plan.approvedAt).toLocaleDateString()}
                    </div>
                  )}
                  {plan.submittedAt && !plan.approvedAt && (
                    <div className="text-[10px] text-amber-400 mt-1.5">Pending since {new Date(plan.submittedAt).toLocaleDateString()}</div>
                  )}
                  {plan.status === "rejected" && plan.rejectedReason && (
                    <div className="text-[10px] text-red-400 mt-1.5 truncate" title={plan.rejectedReason}>Rejected: {plan.rejectedReason}</div>
                  )}
                </div>
                {/* Light actions footer */}
                <div className="bg-card p-3 flex items-center gap-2">
                  <Button size="sm" variant={isActive ? "default" : "outline"} onClick={() => onSelect(plan.id)} className="flex-1 text-xs h-8">
                    {isActive ? <><CheckCircle className="h-3 w-3 mr-1" /> {t("btnActive")}</> : t("btnSelect")}
                  </Button>
                  <button onClick={() => clonePlan(plan)} className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground border border-border transition-colors" title="Clone plan">
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => {
                    const msg = isImported
                      ? `Delete "${plan.name}" and ALL imported data?`
                      : `Delete "${plan.name}" and all its budget lines?`
                    if (confirm(msg)) deletePlan.mutate({ id: plan.id, deleteAll: isImported })
                  }}
                    className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-muted-foreground hover:text-red-600 border border-border transition-colors"
                    title="Delete plan">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Approval Workflow & History for active plan */}
      {activePlan && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-6">
          <BudgetApprovalWorkflow plan={activePlan} userRole={userRole} />
          <BudgetApprovalHistory planId={activePlan.id} />
        </div>
      )}

      {/* F3: Version History */}
      {activePlan && versions.length > 0 && (
        <div className="mt-6 space-y-4">
          <BudgetVersionHistory
            versions={versions}
            currentPlanId={activePlanId}
            onSelectVersion={onSelect}
            onCreateVersion={() => createVersion.mutate(activePlanId)}
            onCompare={(a, b) => setDiffPlanIds({ a, b })}
            isCreating={createVersion.isPending}
          />
          {diffData && (
            <BudgetVersionDiff
              data={diffData}
              isLoading={diffLoading}
              versionLabelA={versions.find(v => v.id === diffPlanIds?.a)?.versionLabel || "Plan A"}
              versionLabelB={versions.find(v => v.id === diffPlanIds?.b)?.versionLabel || "Plan B"}
            />
          )}
        </div>
      )}

      {/* F3: Create version button if no version chain yet */}
      {activePlan && versions.length === 0 && (
        <div className="mt-4">
          <Button
            size="sm"
            variant="outline"
            onClick={() => createVersion.mutate(activePlanId)}
            disabled={createVersion.isPending}
          >
            {createVersion.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
            Create Version (snapshot current plan)
          </Button>
        </div>
      )}

      {/* Reset Confirmation Dialog */}
      <Dialog open={showResetConfirm} onOpenChange={setShowResetConfirm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <Trash2 className="h-5 w-5" />
              Reset All Data
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              This will permanently delete <span className="font-semibold text-foreground">ALL plans</span> and <span className="font-semibold text-foreground">ALL budget data</span> for this organization.
            </p>
            <div className="rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 p-3 text-xs text-red-700 dark:text-red-300">
              ⚠️ This action cannot be undone. All budget lines, actuals, forecasts, reports, and imported data will be permanently removed.
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowResetConfirm(false)} disabled={resetPending}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={resetPending}
              onClick={async () => {
                setResetPending(true)
                try {
                  await fetch("/api/budgeting/plans?deleteAll=true", {
                    method: "DELETE",
                    headers: { "x-organization-id": String((sessionData?.user as any)?.organizationId || ""), "Content-Type": "application/json" },
                  })
                  window.location.reload()
                } catch (e) {
                  setResetPending(false)
                  setShowResetConfirm(false)
                }
              }}
            >
              {resetPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Trash2 className="h-4 w-4 mr-1" />}
              {resetPending ? "Deleting..." : "Delete Everything"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Comparison Tab ────────────────────────────────────────────────────────────

const COMPARISON_COLORS = BUDGET_COLORS.comparison

function ComparisonTab() {
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
                      <span>Relative size</span>
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
                <p className="text-xs text-muted-foreground">Budget allocation by category across plans</p>
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
                  Plan Totals Overview
                </CardTitle>
                <p className="text-xs text-muted-foreground">Budget size comparison across selected plans</p>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="space-y-4 mt-2">
                  {planSummaries.map((ps, i) => {
                    const barW = maxPlanned > 0 ? (ps.planned / maxPlanned * 100) : 0
                    const execPct = ps.planned > 0 ? Math.round((ps.actual / ps.planned) * 100) : 0
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
                          <span>Actual: {ps.actual > 0 ? `${fmtK(ps.actual)} ₼` : "—"}</span>
                          <span>{execPct > 0 ? `${execPct}% execution` : "No actuals"}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Delta between first two plans */}
                {planSummaries.length >= 2 && (
                  <div className="mt-4 pt-4 border-t border-border/50">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 font-semibold">Delta: {planSummaries[0].name} vs {planSummaries[1].name}</div>
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

// ─── P&L Tab ──────────────────────────────────────────────────────────────────

function PLTab({ planId, companyId }: { planId: string; companyId?: string | null }) {
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
    return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-purple-500" /></div>
  }

  // Revenue totals — also account for parent auto-actuals.
  // Contra-revenue rows (SAP 602 = returns, 603 = discounts) reduce net sales
  // rather than add to them. Without subtracting them here the Plan view shows
  // gross sales (18.4M) while the P&L Report shows net revenue (18.0M),
  // confusing finance reviewers.
  const isContraRevenue = (r: typeof byCategory[number]) => {
    const code = rowCode(r)
    return code.startsWith("602") || code.startsWith("603")
  }
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

  // Helpers for execution bars
  const execPct = (actual: number, planned: number) => planned > 0 ? Math.min(Math.round((actual / planned) * 100), 200) : 0
  const execColor = (pct: number, isExpense: boolean) => {
    if (isExpense) return pct > 110 ? "bg-red-500" : pct > 90 ? "bg-amber-500" : "bg-emerald-500"
    return pct >= 90 ? "bg-emerald-500" : pct >= 70 ? "bg-amber-500" : "bg-red-500"
  }

  // Mini execution bar component
  const ExecBar = ({ actual, planned, isExpense = false, className = "" }: { actual: number; planned: number; isExpense?: boolean; className?: string }) => {
    const pct = execPct(Math.abs(actual), Math.abs(planned))
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
    const pct = execPct(Math.abs(actual), Math.abs(planned))
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
    const secExecPct = execPct(Math.abs(secActual), Math.abs(secPlanned))
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
              P&L Waterfall
            </CardTitle>
            <p className="text-xs text-muted-foreground">Revenue → Direct Costs → Gross Profit → Overhead → EBITDA (plan)</p>
          </CardHeader>
          <CardContent className="pt-0">
            {(() => {
              const waterfallData = [
                { name: "Revenue", value: totalRevenuePlanned, base: 0, isStart: true, color: BUDGET_COLORS.planIndigo },
                { name: "Direct Costs", value: totalDirectPlanned, base: totalRevenuePlanned - totalDirectPlanned, positive: false, color: BUDGET_COLORS.negative },
                { name: "Gross Profit", value: grossProfitPlanned, base: 0, isTotal: true, color: grossProfitPlanned >= 0 ? BUDGET_COLORS.actualGreen : BUDGET_COLORS.negative },
                { name: "Overhead", value: totalIndirectPlanned, base: grossProfitPlanned - totalIndirectPlanned, positive: false, color: BUDGET_COLORS.warning },
                { name: "EBITDA", value: opProfitPlanned, base: 0, isTotal: true, color: opProfitPlanned >= 0 ? BUDGET_COLORS.planViolet : BUDGET_COLORS.negative },
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
                      <span className="text-muted-foreground text-xs">Amount</span>
                      <span className="font-mono font-bold text-popover-foreground">{fmtK(Math.abs(d.value))} ₼</span>
                    </div>
                    {d.name === "Gross Profit" && (
                      <div className="text-[10px] text-muted-foreground mt-1">Margin: {gpMargin}%</div>
                    )}
                    {d.name === "EBITDA" && (
                      <div className="text-[10px] text-muted-foreground mt-1">Margin: {ebitdaMargin}%</div>
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
              Expense Breakdown
            </CardTitle>
            <p className="text-xs text-muted-foreground">Cost structure by category (plan)</p>
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
                return <div className="flex items-center justify-center h-[240px] text-sm text-muted-foreground">No expense data</div>
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
                  Gross Margin: {((grossProfitPlanned / totalRevenuePlanned) * 100).toFixed(1)}% (plan) / {totalRevenueActual > 0 ? ((grossProfitActual / totalRevenueActual) * 100).toFixed(1) : "—"}% (actual)
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
                  EBITDA Margin: {((opProfitPlanned / totalRevenuePlanned) * 100).toFixed(1)}% (plan) / {totalRevenueActual > 0 ? ((opProfitActual / totalRevenueActual) * 100).toFixed(1) : "—"}% (actual)
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
                      <div className="font-bold text-base">Net Profit / (Loss)</div>
                      {totalRevenuePlanned > 0 && (
                        <div className="text-xs text-muted-foreground mt-0.5">
                          Net Margin: {((netPlanned / totalRevenuePlanned) * 100).toFixed(1)}% (plan)
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
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Deviation</p>
                      <p className={`font-bold font-mono text-sm ${row.variancePct >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>
                        {row.variancePct >= 0 ? "+" : ""}{row.variancePct.toFixed(1)}%
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Execution</p>
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
              Monthly Forecast Trend
            </CardTitle>
            <p className="text-xs text-muted-foreground">Revenue vs Expenses by month ({scenario})</p>
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
              Scenario Comparison
            </CardTitle>
            <p className="text-xs text-muted-foreground">Operating profit across scenarios</p>
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
                          <span>Rev: {fmtK(s.revenue)} ₼</span>
                          <span>Costs: {fmtK(s.costs)} ₼</span>
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
              Scenario Multipliers (%)
            </CardTitle>
            <p className="text-xs text-muted-foreground">Adjust how each scenario affects revenue, COGS, and expenses</p>
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
                    <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">Revenue %</label>
                    <Input type="number" className="h-8 text-sm text-center" value={scenarioMultipliers.optimistic.revenue}
                      onChange={e => setScenarioMultipliers(prev => ({ ...prev, optimistic: { ...prev.optimistic, revenue: Number(e.target.value) } }))} />
                  </div>
                  <div>
                    <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">COGS %</label>
                    <Input type="number" className="h-8 text-sm text-center" value={scenarioMultipliers.optimistic.cogs}
                      onChange={e => setScenarioMultipliers(prev => ({ ...prev, optimistic: { ...prev.optimistic, cogs: Number(e.target.value) } }))} />
                  </div>
                  <div>
                    <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">Expenses %</label>
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
                    <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">Revenue %</label>
                    <Input type="number" className="h-8 text-sm text-center" value={scenarioMultipliers.pessimistic.revenue}
                      onChange={e => setScenarioMultipliers(prev => ({ ...prev, pessimistic: { ...prev.pessimistic, revenue: Number(e.target.value) } }))} />
                  </div>
                  <div>
                    <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">COGS %</label>
                    <Input type="number" className="h-8 text-sm text-center" value={scenarioMultipliers.pessimistic.cogs}
                      onChange={e => setScenarioMultipliers(prev => ({ ...prev, pessimistic: { ...prev.pessimistic, cogs: Number(e.target.value) } }))} />
                  </div>
                  <div>
                    <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">Expenses %</label>
                    <Input type="number" className="h-8 text-sm text-center" value={scenarioMultipliers.pessimistic.expense}
                      onChange={e => setScenarioMultipliers(prev => ({ ...prev, pessimistic: { ...prev.pessimistic, expense: Number(e.target.value) } }))} />
                  </div>
                </div>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground mt-3">100% = no change. Revenue 110% = +10% growth. Expenses 90% = 10% savings.</p>
          </CardContent>
        </Card>
      )}

      {/* Monthly P&L Summary (sticky at top so user doesn't have to scroll) */}
      <Card className="border-0 shadow-md overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[#1a3050]">
                <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-white/80 sticky left-0 bg-[#1a3050] z-10 min-w-[120px]">P&L Summary</th>
                {monthLabels.map((label, i) => (
                  <th key={i} className="px-2 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-sky-300/70 min-w-[80px]">{label}</th>
                ))}
                <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wider text-amber-300 min-w-[90px]">{t("totalLabel")}</th>
              </tr>
            </thead>
            <tbody className="text-xs font-mono">
              <tr className="border-b border-border/30 bg-emerald-50/50 dark:bg-emerald-950/10">
                <td className="px-3 py-1.5 font-semibold text-emerald-700 dark:text-emerald-400 sticky left-0 bg-emerald-50/50 dark:bg-emerald-950/10 z-10">Revenue</td>
                {months.map(m => (
                  <td key={m} className="px-2 py-1.5 text-right">{fmtK(getColTotal(revenueLines, m))}</td>
                ))}
                <td className="px-3 py-1.5 text-right font-bold">{fmtK(totalRevenue)}</td>
              </tr>
              <tr className="border-b border-border/30">
                <td className="px-3 py-1.5 font-semibold text-muted-foreground sticky left-0 bg-background z-10">Costs</td>
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
                <td className="px-3 py-1 text-[11px] font-medium text-purple-600 dark:text-purple-400 sticky left-0 z-10 bg-purple-50/30 dark:bg-purple-950/5">EBITDA Margin %</td>
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
                {/* EBITDA Margin % row */}
                <tr className={`${totalMargin < 0 ? "bg-red-50/50 dark:bg-red-900/5" : "bg-purple-50/50 dark:bg-purple-900/5"}`}>
                  <td className={`px-3 py-1 text-[11px] font-medium sticky left-0 z-10 ${totalMargin < 0 ? "text-red-500 bg-red-50/50 dark:bg-red-900/5" : "text-purple-600 dark:text-purple-400 bg-purple-50/50 dark:bg-purple-900/5"}`}>EBITDA Margin %</td>
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
                            {deleteTemplate.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Trash2 className="h-3 w-3 mr-0.5" /> OK</>}
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

function ApplyTemplatesButton({ planId }: { planId: string }) {
  const t = useTranslations("budgeting")
  const { data: templates = [] } = useBudgetTemplates()
  const applyTemplates = useApplyTemplates()
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null)

  const activeTemplates = templates.filter((tpl: BudgetDirectionTemplate) => tpl.isActive)

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const handleApply = async () => {
    if (selected.size === 0) return
    const res = await applyTemplates.mutateAsync({ planId, templateIds: Array.from(selected) })
    setResult(res)
    setTimeout(() => { setOpen(false); setResult(null); setSelected(new Set()) }, 2000)
  }

  if (activeTemplates.length === 0) return null

  return (
    <>
      <Button size="sm" variant="outline" title={t("hintTemplateApply")} onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4 mr-1" /> {t("btnApplyTemplates")}
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle className="text-sm">{t("selectTemplates")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {result ? (
                <div className="flex items-center gap-2 text-sm text-[#065f46] dark:text-[#6ee7b7]">
                  <CheckCircle className="h-4 w-4" />
                  {t("templateApplied", { created: result.created, skipped: result.skipped })}
                </div>
              ) : (
                <>
                  <div className="max-h-60 overflow-y-auto space-y-1">
                    {activeTemplates.map((tpl: BudgetDirectionTemplate) => (
                      <label key={tpl.id} className="flex items-center gap-2 py-1 px-2 rounded hover:bg-muted/40 cursor-pointer text-xs">
                        <input type="checkbox" checked={selected.has(tpl.id)} onChange={() => toggle(tpl.id)} className="rounded" />
                        <span className="flex-1">{tpl.name}</span>
                        <Badge variant="outline" className="text-[10px]">{tpl.lineType}</Badge>
                        <span className="font-mono text-muted-foreground">{fmt(tpl.defaultAmount)}</span>
                      </label>
                    ))}
                  </div>
                  <div className="flex gap-2 pt-2">
                    <Button size="sm" onClick={handleApply} disabled={selected.size === 0 || applyTemplates.isPending} className="flex-1">
                      {applyTemplates.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("btnApplyTemplates")}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => { setOpen(false); setSelected(new Set()) }} className="flex-1">{t("btnCancel")}</Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </>
  )
}

// ─── Template Seeder ──────────────────────────────────────────────────────────

function TemplateSeedButton({ planId }: { planId: string }) {
  const t = useTranslations("budgeting")
  const createLine = useCreateBudgetLine()
  const { data: lines = [] } = useBudgetLines(planId)
  const [seeding, setSeeding] = useState(false)

  if (lines.length > 0) return null

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
          ) : null}
          {/* Turn 30: per-daughter-company drilldown selector. Org-wide default;
              level-1 sub-groups indented with — prefix; level-2 ops indented
              with —— prefix. Selecting a sub-group rolls up its children. */}
          {companies.length > 0 && (
            <select
              value={selectedCompanyId ?? ""}
              onChange={(e) => setSelectedCompanyId(e.target.value || null)}
              className="border border-border rounded-md px-3 py-1.5 text-sm bg-background min-w-[200px]"
              title="Filter by daughter company (sub-groups roll up children)"
            >
              <option value="">All companies (consolidated)</option>
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
            <p className="font-medium">No budget plans yet</p>
            <p className="text-sm mt-1">Import an Excel file or create a new plan to get started.</p>
            <div className="flex gap-2 justify-center mt-4">
              <Button onClick={() => setActiveTab("integrations")}><Upload className="h-4 w-4 mr-1" /> Import Excel</Button>
              <Button variant="outline" onClick={() => setShowCreate(true)}><Plus className="h-4 w-4 mr-1" /> Create Plan</Button>
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
            title="AI analysis of this section"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.582a.5.5 0 0 1 0 .962L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>
            </svg>
            <span className="text-sm font-medium">AI Analysis</span>
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
