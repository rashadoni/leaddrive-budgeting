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
  PiggyBank, Plus, Pencil, Loader2, TrendingUp, TrendingDown,
  AlertCircle, BarChart2, DollarSign, Link2,
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
  useUpdateBudgetPlan,
  useDeleteBudgetPlan,
  useBudgetSections,
  useCreateBudgetSection,
  useDeleteBudgetSection,
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
import { CreatePlanDialog } from "@/features/budgeting/components/CreatePlanDialog"
import { TemplatesTab } from "@/features/budgeting/components/TemplatesTab"
import { TemplateSeedButton } from "@/features/budgeting/components/TemplateSeedButton"
import {
  DEPARTMENTS,
  SECTION_TYPES,
  type BudgetLine,
} from "@/lib/budgeting/types"
import { COST_MODEL_KEY_OPTIONS } from "@/lib/budgeting/cost-model-map"
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

// ─── CreatePlanDialog — extracted to ./components/CreatePlanDialog.tsx (Turn LXXXX)

// ─── AddLineForm — DELETED Turn LXXXVI (dead code; was sole-consumer LinesTab also dead) ──

// AddActualForm + ActualsTab — DELETED Turn LXXXXIV (dead code; ActualsTab had no tab route, AddActualForm was sole-consumer).
// WorkspaceTab handles all actuals UI. Revert via `git show 1d4e666:src/features/budgeting/components/ActualsTab.tsx` if needed.

// ─── Workspace Tab (G-01 through G-09) ───────────────────────────────────────

// ─── WorkspaceTab — extracted to ./components/WorkspaceTab.tsx (Turn LXXXVIII)
// ─── Overview Tab ─────────────────────────────────────────────────────────────

// ─── OverviewTab — DELETED Turn LXXXVI (dead code; no tab route, no consumers) ──

// ─── LinesTab — DELETED Turn LXXXVI (dead code; no tab route, no consumers) ──

// ─── Forecast Tab (Monthly Matrix) ───────────────────────────────────────────

// ─── ForecastTab — extracted to ./components/ForecastTab.tsx (Turn LXXXIX)
// ─── TemplatesTab — extracted to ./components/TemplatesTab.tsx (Turn LXXXX)

// ─── Apply Templates Dialog ─────────────────────────────────────────────────

// ─── ApplyTemplatesButton — moved into WorkspaceTab.tsx as private helper (Turn LXXXVIII)

// ─── Template Seeder ──────────────────────────────────────────────────────────

// ─── TemplateSeedButton — extracted to ./components/TemplateSeedButton.tsx (Turn LXXXX)

// CXL: tabs whose underlying data table has a `companyId` column AND whose
// component already propagates the prop. Other tabs (sales-budget / cogs /
// balance-sheet / cash-flow / assumptions / variance / comparison /
// sales-forecast / expense-forecast / rolling) back schema rows that lack a
// per-company discriminator → dropdown is hidden so the user doesn't get a
// false "switching has no effect" UX. Adding companyId to remaining schemas
// is a separate roadmap item (multi-table migration).
const COMPANY_FILTERED_TABS: ReadonlySet<string> = new Set([
  "pnl-report",
  "workspace",
  "pl",
  "forecast",
])

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
              with —— prefix. Selecting a sub-group rolls up its children.
              CXL: hide on tabs that DON'T propagate companyId to their data
              query — current schema-supported tabs are pnl-report / workspace
              / pl / forecast (all use BudgetLine which has companyId). Other
              tabs back tables (sales_budget_lines / cash_flow_entries /
              balance_sheet_lines / etc.) that lack a companyId column —
              schema migration required to extend filtering. */}
          {companies.length > 0 && COMPANY_FILTERED_TABS.has(activeTab) && (
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
