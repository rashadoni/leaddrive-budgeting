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
import { BUDGET_COLORS } from "@/lib/budget-chart-theme"
import { PeriodLockBadge } from "@/features/budgeting/components/PeriodLockBadge"
import {
  useBudgetPlans,
  useCreateBudgetPlan,
  useUpdateBudgetPlan,
  useDeleteBudgetPlan,
  useBudgetLineCount,
  useCreateBudgetLine,
  useBudgetSections,
  useCreateBudgetSection,
  useDeleteBudgetSection,
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
import { ForecastTab } from "@/features/budgeting/components/ForecastTab"
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

// ─── ForecastTab — extracted to ./components/ForecastTab.tsx (Turn LXXXIX)
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
