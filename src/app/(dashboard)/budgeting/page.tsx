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
import { PeriodLockBadge } from "@/features/budgeting/components/PeriodLockBadge"
import {
  useBudgetPlans,
  useCreateBudgetPlan,
  useUpdateBudgetPlan,
  useDeleteBudgetPlan,
  useBudgetLines,
  useBudgetLineCount,
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
import { VarianceTab } from "@/features/budgeting/components/VarianceTab"
import { ComparisonTab } from "@/features/budgeting/components/ComparisonTab"
import { PLTab } from "@/features/budgeting/components/PLTab"
import { PlansTab } from "@/features/budgeting/components/PlansTab"
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
import { computeOperatingProfit } from "@/lib/budgeting/operating-profit"
import { varPct } from "@/lib/budgeting/var-pct"
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
  const t = useTranslations("budgeting")
  const [importMode, setImportMode] = useState<"csv" | "excel">("csv")
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button size="sm" variant={importMode === "csv" ? "default" : "outline"} onClick={() => setImportMode("csv")}>
          <FileSpreadsheet className="h-4 w-4 mr-1" /> {t("wsImportTabCsv")}
        </Button>
        <Button size="sm" variant={importMode === "excel" ? "default" : "outline"} onClick={() => setImportMode("excel")}>
          <FileSpreadsheet className="h-4 w-4 mr-1" /> {t("wsImportTabExcel")}
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
  const t = useTranslations("budgeting")
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
          <p className="font-medium text-lg mb-2">{t("rollingForecastTitle")}</p>
          <p className="text-sm">{t("rollingNoPlanDesc")}</p>
          <p className="text-sm mt-1">{t("rollingNoPlanHint")}</p>
        </CardContent>
      </Card>
    )
  }

  if (!rollingData || !rollingData.months.length) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          <CalendarRange className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium text-lg mb-2">{t("rollingLoading")}</p>
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
  const t = useTranslations("budgeting")
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
            { key: "overview" as const, label: t("cashFlowSubviewOverview") },
            { key: "odds" as const, label: t("cashFlowSubviewOdds") },
            { key: "plan-fact" as const, label: t("cashFlowSubviewPlanFact") },
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
            {t("cashFlowGenerateFromBudget")}
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
                <p className="font-medium text-lg mb-2">{t("cashFlowEmptyTitle")}</p>
                <p className="text-sm">{t("cashFlowEmptyDesc", { year })}</p>
                <p className="text-sm mt-1">{t("cashFlowEmptyHint")}</p>
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
                title={t("wsAddActualTitle")}>
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
    // Turn 36 fix: dedupe by (category, lineType) — see sumActualUniqueCategories jsdoc
    const totActual = sumActualUniqueCategories(sectionLines)
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

  // Turn 36 (Workspace actuals 12× over-count fix): post-Turn-34 BudgetLines
  // expanded to 12 rows per (category, lineType) — one per month. Naive
  // `lines.reduce((s,l) => s + getLineActual(l), 0)` reads `actualsByCat.get(key).total`
  // (per-category aggregate) for EACH of the 12 rows → 12× over-count.
  // This helper dedupes by (category, lineType) before summing — each
  // unique tuple contributes its full actual exactly once. Plan side is
  // unaffected (each row carries its own monthly plannedAmount; sum across
  // 12 rows = annual = correct).
  const sumActualUniqueCategories = (sectionLines: BudgetLine[]): number => {
    const seen = new Set<string>()
    let sum = 0
    for (const l of sectionLines) {
      const key = `${l.category}||${l.lineType}`
      if (seen.has(key)) continue
      seen.add(key)
      sum += getLineActual(l)
    }
    return sum
  }

  // Universal grouped section renderer with per-section add form
  const renderGroupedSection = (title: string, sectionLines: BudgetLine[], totPlanned: number, sectionHintKey?: string, sectionLineType?: string) => {
    const totActual = sumActualUniqueCategories(sectionLines)
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
            <span className="text-[10px] text-muted-foreground">
              {/* Turn 36 fix: dedupe by (category, lineType) — post-Turn-34 expansion has 12 rows per category, not 1 */}
              {new Set(sectionLines.map((l) => `${l.category}||${l.lineType}`)).size}
            </span>
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
                  // Turn 36 fix: dedupe by (category, lineType) to avoid 12× over-count post-Turn-34 expansion
                  const grpActual = (() => {
                    const seen = new Set<string>()
                    let sum = 0
                    for (const l of groupLines) {
                      const key = `${l.category}||${l.lineType}`
                      if (seen.has(key)) continue
                      seen.add(key)
                      sum += getLineActual(l)
                    }
                    return sum
                  })()
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
                <td colSpan={2} className="px-2 py-1 text-[10px] text-muted-foreground align-middle">{t("wsAddSubcategoryHint")}</td>
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

  // Turn 36 fix: dedupe by (category, lineType) — see sumActualUniqueCategories jsdoc
  const totExpActual = sumActualUniqueCategories(expenseLines)
  const totRevActual = sumActualUniqueCategories(revenueLines)
  const totCOGSActual = sumActualUniqueCategories(cogsLines)

  return (
    <div className="space-y-6">
      {/* ROW 0: Budget Change History */}
      <BudgetChangeHistory planId={planId} />

      {/* ROW 1: 4 Dark KPI Scorecards (Power BI style) */}
      {(() => {
        const netPosition = computeOperatingProfit(totalRevenuePlanned, totalCOGSPlanned, totalCostPlanned)
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
              <div className="text-xs text-muted-foreground mt-1">{new Set(revenueLines.map((l: BudgetLine) => `${l.category}||${l.lineType}`)).size} {t("colCategory").toLowerCase()} · {revExecPct}% {t("kpiExecution").toLowerCase()}</div>
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
              <div className="text-xs text-muted-foreground mt-1">{new Set(expenseLines.map((l: BudgetLine) => `${l.category}||${l.lineType}`)).size} {t("colCategory").toLowerCase()} · {Math.round(expExecPct)}% {t("kpiExecution").toLowerCase()}</div>
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
              <p className="text-[10px] text-muted-foreground">{t("chartWaterfallSubtitle") || "Budget → Forecast → Actual → Variance → Projection"}</p>
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
            onClick={() => setWorkspaceView("list")} title={t("wsViewList")}>
            <List className="h-4 w-4" />
          </Button>
          <Button size="sm" variant={workspaceView === "matrix" ? "default" : "ghost"} className="h-8 text-xs rounded-none px-2"
            onClick={() => setWorkspaceView("matrix")} title={t("wsViewMatrix")}>
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
          onClick={() => setCompactNumbers(!compactNumbers)} title={t("wsCompactNumbersTitle")}>
          {compactNumbers ? "1.2M" : "1,234"}
        </Button>
      </div>

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
                    alert(json.error || t("wsGenMatrixFailed"))
                    return
                  }
                  window.location.reload()
                } catch (err) {
                  alert(t("wsNetworkError"))
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

                {/* Gross Profit row = Revenue − COGS */}
                {(revenueLines.length > 0 || cogsLines.length > 0) && (() => {
                  const gpPlanned = totRevPlanned - totCOGSPlanned
                  const gpActual = totRevActual - totCOGSActual
                  const gpNeg = gpActual < 0
                  const gpVarPct = varPct(gpActual, gpPlanned)
                  return (
                  <tr className={`border-y-2 ${gpNeg ? "border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/10" : "border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/10"}`}>
                    <td className="px-3 py-2" colSpan={2}>
                      <div className="font-bold text-sm">{t("grossProfit")}</div>
                      <div className="text-[10px] text-muted-foreground/60 font-normal">{t("hintGrossProfit")}</div>
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-sm font-bold"><AnimatedNumber value={gpPlanned} duration={500} formatter={fmt} /></td>
                    <td className={`px-2 py-2 text-right font-mono text-sm font-bold ${gpNeg ? "text-red-600 dark:text-red-400" : "text-[#065f46] dark:text-[#6ee7b7]"}`}><AnimatedNumber value={gpActual} duration={500} formatter={fmt} /></td>
                    <td className={`px-2 py-2 text-right font-mono text-sm font-bold ${gpVarPct === null ? "text-muted-foreground" : gpVarPct >= 0 ? "text-[#065f46] dark:text-[#6ee7b7]" : "text-red-600 dark:text-red-400"}`}>
                      {gpVarPct === null ? "—" : `${gpVarPct >= 0 ? "+" : ""}${gpVarPct.toFixed(1)}%`}
                    </td>
                    <td className="w-10" />
                  </tr>
                  )
                })()}

                {renderGroupedSection(t("sectionExpenses"), expenseLines, totExpPlanned, "hintSectionExpenses", "expense")}

                {/* Operating Profit row — math via computeOperatingProfit helper (Revenue − COGS − OpEx) */}
                {(expenseLines.length > 0 || revenueLines.length > 0 || cogsLines.length > 0) && (() => {
                  const opPlanned = computeOperatingProfit(totRevPlanned, totCOGSPlanned, totExpPlanned)
                  const opActual = computeOperatingProfit(totRevActual, totCOGSActual, totExpActual)
                  const opNeg = opActual < 0
                  const opVarPct = varPct(opActual, opPlanned)
                  return (
                  <tr className={`border-y-2 ${opNeg ? "border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/10" : "border-purple-300 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/10"}`}>
                    <td className="px-3 py-2" colSpan={2}>
                      <div className="font-bold text-sm">{t("operatingProfit")}</div>
                      <div className="text-[10px] text-muted-foreground/60 font-normal">{t("hintOperatingProfit")}</div>
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-sm font-bold"><AnimatedNumber value={opPlanned} duration={500} formatter={fmt} /></td>
                    <td className={`px-2 py-2 text-right font-mono text-sm font-bold ${opNeg ? "text-red-600 dark:text-red-400" : "text-[#065f46] dark:text-[#6ee7b7]"}`}><AnimatedNumber value={opActual} duration={500} formatter={fmt} /></td>
                    <td className={`px-2 py-2 text-right font-mono text-sm font-bold ${opVarPct === null ? "text-muted-foreground" : opVarPct >= 0 ? "text-[#065f46] dark:text-[#6ee7b7]" : "text-red-600 dark:text-red-400"}`}>
                      {opVarPct === null ? "—" : `${opVarPct >= 0 ? "+" : ""}${opVarPct.toFixed(1)}%`}
                    </td>
                    <td className="w-10" />
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
  const syncActuals = useSyncActuals()

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

      {/* Action buttons: sync actuals + export */}
      <div className="flex flex-wrap gap-2">
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

// ─── Plans Tab — extracted Turn LXXVI ────────────────────────────────────────
// Phase 3.1 fourth slice: PlansTab moved to
// `src/features/budgeting/components/PlansTab.tsx` (~321 LOC). Pure
// extraction — no functional changes; closure-bound state stays inside
// the function via React useState. Tab switch wiring at `activeTab ===
// "plans" && <PlansTab activePlanId={...} onSelect={...} onShowCreate={...} />`.

// ─── Variance Tab — extracted Turn LX ────────────────────────────────────────
// Phase 3.1 first slice: VarianceTab moved to
// `src/features/budgeting/components/VarianceTab.tsx`. Closes architect
// Turn-LIX flag (page.tsx 5479 → 5163 LOC after this extraction). Tab
// switch wiring at `activeTab === "variance" && <VarianceTab />` below
// (search "variance").

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
