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
  useBudgetSections,
  useCreateBudgetSection,
  useDeleteBudgetSection,
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
  type BudgetPlan,
} from "@/lib/budgeting/types"
import { COST_MODEL_KEY_OPTIONS } from "@/lib/budgeting/cost-model-map"
import { pickDefaultPlanId } from "@/lib/budgeting/plan-select"
import { planLineEvidence } from "@/lib/budgeting/plan-presentation"
import { BudgetConfigTab } from "@/components/budget-config-tab"
import { SalesForecastTab } from "@/components/sales-forecast-tab"
import { ExpenseForecastTab } from "@/components/expense-forecast-tab"
import { BudgetDepartmentAccess } from "@/components/budget-department-access"
import { AIAnalyticsPanel } from "@/components/ai-analytics-panel"
import { SECTION_LABELS, type Section } from "@/lib/ai/section-meta"
// The AI panel header names the section the user is looking at. SECTION_LABELS
// stays the English source of truth for the API contract; the header reuses the
// sidebar's already-translated nav labels so the two never disagree.
/**
 * Nav label per budgeting tab, so the page header can name where the reader
 * actually is.
 *
 * Every tab used to render the same "Budgeting" heading: you clicked
 * Assumptions in the sidebar and the page still said Budgeting, with the
 * active tab visible only as a highlight in the left menu. Owner's words on
 * 2026-08-06: «в меню допущение а внутри бюджетирование».
 *
 * Keys are the SAME `labelKey`s the sidebar uses (`src/components/sidebar.tsx`)
 * rather than a second set of strings — a parallel list would drift, and the
 * header naming a tab differently from the menu item you just clicked is worse
 * than not naming it at all.
 */
const TAB_NAV_KEYS: Record<string, string> = {
  "pnl-report": "navPnl",
  "sales-budget": "navSales",
  cogs: "navCogs",
  "balance-sheet": "navBalanceSheet",
  "cash-flow": "navCashFlow",
  assumptions: "navAssumptions",
  workspace: "navWorkspace",
  pl: "navPnlPlan",
  forecast: "navForecast",
  comparison: "navComparison",
  plans: "navPlans",
  "sales-forecast": "navSales",
  "expense-forecast": "navExpenses",
  rolling: "navRolling",
  config: "navConfiguration",
}

const AI_SECTION_NAV_KEYS: Record<Section, string> = {
  "pnl-report": "navPnl",
  pl: "navPnlPlan",
  "balance-sheet": "navBalanceSheet",
  cogs: "navCogs",
  "cash-flow": "navCashFlow",
  assumptions: "navAssumptions",
  workspace: "navWorkspace",
  forecast: "navForecast",
}
import { execPct } from "@/lib/budgeting/exec-pct"
import { BudgetMarginSummary } from "@/components/budget-margin-summary"
import { BudgetPnlView } from "@/components/budget-pnl-view"
import { SalesBudgetTable } from "@/components/sales-budget-table"
import { COGSCalculator } from "@/components/cogs-calculator"
import { BudgetBalanceSheet } from "@/components/budget-balance-sheet"
import { BudgetAssumptions } from "@/components/budget-assumptions"
import { toast } from "sonner"
import { SHOW_AI_IMPORT_BUTTON } from "@/config/ui-visibility"

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

function periodLabel(plan: BudgetPlan, t: (key: string) => string): string {
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
// component already propagates the prop. Forecast overrides have no companyId,
// so Forecast is deliberately excluded even though its baseline BudgetLines do
// carry companyId: showing the selector would falsely imply per-company saved
// overrides. Other tabs (sales-budget / cogs / balance-sheet / cash-flow / assumptions / variance / comparison /
// sales-forecast / expense-forecast / rolling) back schema rows that lack a
// per-company discriminator → dropdown is hidden so the user doesn't get a
// false "switching has no effect" UX. Adding companyId to remaining schemas
// is a separate roadmap item (multi-table migration).
const COMPANY_FILTERED_TABS: ReadonlySet<string> = new Set([
  "pnl-report",
  "workspace",
  "pl",
])

const DATA_IMPORT_TABS: ReadonlySet<string> = new Set([
  "pnl-report",
  "sales-budget",
  "cogs",
  "balance-sheet",
  "cash-flow",
  "assumptions",
])

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BudgetingPage() {
  const t = useTranslations("budgeting")
  const tAdmin = useTranslations("adminLanding")
  const tNav = useTranslations("nav")
  const router = useRouter()
  const searchParams = useSearchParams()
  const { data: plans = [], isLoading: plansLoading } = useBudgetPlans()
  const [activePlanId, setActivePlanId] = useState<string>("")
  const [showCreate, setShowCreate] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  React.useEffect(() => setMounted(true), [])
  // 2026-07-31 (11.55) — the budgeting module opens on the P&L.
  // "workspace" was a landing page about the data rather than the data; the
  // profit & loss statement is the first thing every user (and every client
  // in a demo) actually wants. An explicit `?tab=` still wins, so every
  // existing deep link keeps working.
  const activeTab = searchParams.get("tab") || "pnl-report"
  const setActiveTab = (tab: string) => router.push(`/budgeting?tab=${tab}`)

  // Auto-select the most useful plan: a POPULATED budget plan (newest year)
  // so the Workspace's execution % is meaningful on load (plan=budget vs the
  // actuals plan). Falls back to any populated plan, then the first plan —
  // never lands on an empty placeholder year-plan (the "0%/empty" complaint).
  const resolvedPlanId = activePlanId || pickDefaultPlanId(plans)
  const activePlan = plans.find((p: BudgetPlan) => p.id === resolvedPlanId) ?? null
  const importYear = activePlan?.year ?? new Date().getFullYear()

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
          // Recursive flatten so the holding tree's level-2 op-cos
          // (AAC-MAIN, ATL-DBZ, SPARK-MAIN, etc.) make the dropdown
          // alongside the level-1 sub-groups. AZMADE is 3 levels deep
          // (root → sub-group → op-co); previous flat-walk stopped at
          // level-1 and silently dropped every op-co, so picking SPARK
          // in the budgeting filter saw "zero" because SPARK-MAIN —
          // the row that actually holds BudgetLines — was missing.
          type Node = { id: string; code: string; name: string; level: number; parentCompanyId: string | null; children?: Node[] }
          const flat: Array<{ id: string; code: string; name: string; level: number; parentCompanyId: string | null }> = []
          const walk = (n: Node) => {
            flat.push({ id: n.id, code: n.code, name: n.name, level: n.level, parentCompanyId: n.parentCompanyId })
            if (Array.isArray(n.children)) for (const c of n.children) walk(c)
          }
          for (const root of list as Node[]) walk(root)
          setCompanies(flat)
        }
      })
      .catch(() => {})
  }, [])

  // Phase 7.G — plan-scoped company list. The dropdown previously showed
  // every operational company in the org regardless of which plan was
  // active, so picking "Azərşəkər 2026 Budget" still surfaced AZMADE's
  // children (AAC / ATL / SPARK) as options. Fix: fetch the distinct
  // companyIds present in the plan's BudgetLines + their parent chain,
  // then narrow the dropdown to that set.
  //
  // Three-state filter — distinguishes "still fetching" from "fetch
  // resolved + plan has zero lines" so the dropdown doesn't briefly
  // leak entities from other plans during the load gap.
  //
  // Bug reproducer (Phase 7.I sub-fix): user reported that on AZMADE
  // plan the dropdown showed AZSEKER children. Root cause: while the
  // /companies fetch was in-flight, `planCompanyIds === null` and the
  // memo below fell through to the FULL `companies` array (which
  // includes both AZMADE + AZSEKER sub-trees). Fix: gate the fallback
  // on `loaded === true` so during the load window the dropdown is
  // empty rather than over-broad.
  type PlanCompanyState =
    | { status: 'loading' }
    | { status: 'loaded'; ids: Set<string> | null };
  const [planCompanyState, setPlanCompanyState] = useState<PlanCompanyState>({ status: 'loading' });
  React.useEffect(() => {
    if (!resolvedPlanId) {
      setPlanCompanyState({ status: 'loaded', ids: null });
      return;
    }
    let cancelled = false;
    setPlanCompanyState({ status: 'loading' });
    fetch(`/api/budgeting/plans/${encodeURIComponent(resolvedPlanId)}/companies`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { companyIds?: string[] } | null) => {
        if (cancelled) return;
        const ids = Array.isArray(body?.companyIds) ? body!.companyIds : [];
        // Empty list → null `ids` (treat as "no scope, show all available")
        // post-load. Loading state already over.
        setPlanCompanyState({
          status: 'loaded',
          ids: ids.length > 0 ? new Set(ids) : null,
        });
      })
      .catch(() => {
        if (!cancelled) setPlanCompanyState({ status: 'loaded', ids: null });
      });
    return () => {
      cancelled = true;
    };
  }, [resolvedPlanId]);

  // Companies visible in the dropdown:
  //   - loading → empty (prevents cross-plan leak during fetch window).
  //   - loaded + ids non-null → filter to plan scope.
  //   - loaded + ids null (plan has no lines OR fetch failed) → full list.
  //
  // Single-child collapse (user feedback 2026-05-16): when a level=1 sub-
  // group has exactly ONE level=2 child (AAC→AAC-Main, SPARK→SPARK-Main,
  // ZTP→ZTP-Main, LLS→LLS-Main), the parent rollup equals the child by
  // definition — they look like duplicates in the dropdown ("AAC" and
  // "AAC Main" both produce the same P&L). Hide the child, keep the parent
  // (selecting the parent already auto-rolls-up to the single child via
  // resolveCompanyFilter's BFS). For multi-child groups like ATL (with
  // DBZ/MRKZ/PMZ/TAZ), the hierarchy is genuine and both layers stay.
  const visibleCompanies = React.useMemo(() => {
    if (planCompanyState.status === 'loading') return [];
    const base = planCompanyState.ids === null
      ? companies
      : companies.filter((c) => planCompanyState.ids!.has(c.id));
    // Count children per parent in `base` so the rule respects the
    // current plan scope (a sub-group with 3 children globally but only
    // 1 in this plan still gets the collapse).
    const childCountByParentId = new Map<string, number>();
    for (const c of base) {
      if (c.level === 2 && c.parentCompanyId) {
        childCountByParentId.set(
          c.parentCompanyId,
          (childCountByParentId.get(c.parentCompanyId) ?? 0) + 1,
        );
      }
    }
    return base.filter((c) => {
      if (c.level !== 2 || !c.parentCompanyId) return true;
      // Hide this leaf if its parent is in `base` AND has exactly 1 child.
      const parentInScope = base.some((p) => p.id === c.parentCompanyId);
      if (!parentInScope) return true;
      return (childCountByParentId.get(c.parentCompanyId) ?? 0) !== 1;
    });
  }, [companies, planCompanyState]);
  // Legacy alias kept for downstream code paths reading the Set directly.
  const planCompanyIds = planCompanyState.status === 'loaded' ? planCompanyState.ids : null;

  // If the user had a company selected and the active plan no longer
  // contains it, drop the stale selection so they don't see "filter
  // applied but visibly absent from the dropdown".
  React.useEffect(() => {
    if (!selectedCompanyId) return
    if (!planCompanyIds) return
    if (!planCompanyIds.has(selectedCompanyId)) {
      setSelectedCompanyId(null)
    }
    // setSelectedCompanyId is referentially stable (router.push wrapper)
    // but we list it for the linter contract; eslint-disable not needed
    // because the wrapper closes over the same params reference.
  }, [planCompanyIds, selectedCompanyId])

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-500 text-white">
            <PiggyBank className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold">
              {t("title")}
              {TAB_NAV_KEYS[activeTab] && (
                <>
                  <span className="mx-2 font-normal text-muted-foreground">·</span>
                  <span data-testid="budgeting-active-tab">{tNav(TAB_NAV_KEYS[activeTab])}</span>
                </>
              )}
            </h1>
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
                  const selected = plans.find((p: BudgetPlan) => p.id === e.target.value)
                  if (selected?.isRolling) setActiveTab("rolling")
                }}
                className="border border-border rounded-md px-3 py-1.5 text-sm bg-background min-w-[180px]">
                {plans.map(p => {
                  // Mark empty placeholder plans so the picker reads clearly
                  // (∅ = no budget lines yet). Populated plans sort first.
                  const lineEvidence = planLineEvidence(p)
                  return (
                    <option key={p.id} value={p.id}>
                      {p.name} — {periodLabel(p, t)}{lineEvidence.state === "empty" ? ` · ${t("plansPickerEmpty")}` : lineEvidence.state === "unknown" ? ` · ${t("plansPickerUnknown")}` : ""}
                    </option>
                  )
                })}
              </select>
              {/* Phase 7.G Turn LXXIV — Phase 4.2 indicator UI badge.
                  Shows lock-icon + period + tooltip when the active plan's
                  period is locked at the org level. Renders nothing if
                  not locked (no layout shift). */}
              <PeriodLockBadge plan={plans.find((p: BudgetPlan) => p.id === resolvedPlanId) ?? null} />
            </>
          ) : null}
          {/* Turn 30: per-daughter-company drilldown selector. Org-wide default;
              level-1 sub-groups indented with — prefix; level-2 ops indented
              with —— prefix. Selecting a sub-group rolls up its children.
              CXL: hide on tabs that DON'T propagate companyId to their data
              query — current schema-supported tabs are pnl-report / workspace
              / pl. Forecast is excluded because saved overrides lack companyId.
              Other
              tabs back tables (sales_budget_lines / cash_flow_entries /
              balance_sheet_lines / etc.) that lack a companyId column —
              schema migration required to extend filtering. */}
          {visibleCompanies.length > 0 && COMPANY_FILTERED_TABS.has(activeTab) && (
            <select
              value={selectedCompanyId ?? ""}
              onChange={(e) => setSelectedCompanyId(e.target.value || null)}
              className="border border-border rounded-md px-3 py-1.5 text-sm bg-background min-w-[200px]"
              title={t("companyFilterTitle")}
            >
              <option value="">{t("companyFilterAllConsolidated")}</option>
              {visibleCompanies.map((c) => {
                // CLI follow-up — strip parent code prefix for child rows
                // (`AZSEKER-EDEN` → `EDEN` when nested under AZSEKER). The
                // hierarchy is already conveyed by the indent dashes; the
                // redundant prefix wastes label width and clutters the
                // dropdown for the CFO.
                const parent = c.parentCompanyId
                  ? companies.find((p) => p.id === c.parentCompanyId)
                  : null;
                const display =
                  parent && c.code.startsWith(parent.code + "-")
                    ? c.code.slice(parent.code.length + 1)
                    : c.code;
                return (
                  <option key={c.id} value={c.id}>
                    {c.level === 1 ? "— " : "—— "}{display} {c.name && c.name !== c.code ? `· ${c.name}` : ""}
                  </option>
                );
              })}
            </select>
          )}
          {DATA_IMPORT_TABS.has(activeTab) ? (
            // The flag nests INSIDE this branch on purpose. Folding it into the
            // ternary condition would fall through to the "create plan" button
            // on import tabs — a swap, not a hiding, and a different screen
            // from the one that was asked for.
            SHOW_AI_IMPORT_BUTTON ? (
            <Button
              size="sm"
              onClick={() => router.push(`/budgeting/admin/ai-import?year=${importYear}`)}
              title={t("headerImportTooltip")}
            >
              <Upload className="h-4 w-4 mr-1" /> {tAdmin("tools.aiImport.title")}
            </Button>
            ) : null
          ) : (
            <Button
              size="sm"
              onClick={() => setShowCreate(true)}
              title={t("headerCreatePlanTooltip")}
            >
              <Plus className="h-4 w-4 mr-1" /> {t("createPlan")}
            </Button>
          )}
        </div>
      </div>

      {/* No plans state — only render after mount to avoid hydration mismatch with searchParams */}
      {mounted && !plansLoading && plans.length === 0 && (
        activeTab === "plans" ? (
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
          {activeTab === "forecast" && <ForecastTab planId={resolvedPlanId} />}
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
            sectionLabel={tNav(AI_SECTION_NAV_KEYS[activeTab as Section])}
            planId={resolvedPlanId}
            planName={plans.find((p: { id: string; name?: string }) => p.id === resolvedPlanId)?.name ?? null}
            // Phase 7.G — pass the same company filter the visible UI
            // already honors. Without this, SPARK in the dropdown +
            // open AI panel would still get AZMADE's roll-up P&L.
            companyId={selectedCompanyId}
            companyName={(() => {
              if (!selectedCompanyId) return null
              const c = companies.find((x) => x.id === selectedCompanyId)
              if (!c) return null
              return `${c.code} · ${c.name}`
            })()}
          />
        </>
      )}
    </div>
  )
}
