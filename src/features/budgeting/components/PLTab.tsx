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
  TrendingDown, TrendingUp, X,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DataBoundary } from "@/components/ui/data-boundary"
// Phase 3.1 v1.2 ext — same 12-month sparkline used in VarianceTab.
// Mounted as a colSpan={6} expansion row under the active drilldown
// row so the user sees the monthly distribution without leaving PLTab.
import { MonthlySparkline } from "./monthly-sparkline"
// Phase 3.1 v1.3 — `buildGrouped` extracted to shared helper for
// direct unit testing. See group-by-parent.ts for the 9-case test.
import { groupByParent } from "@/lib/budgeting/group-by-parent"
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
import { BarChart2, Settings2, Info } from "lucide-react"


import { makePlSection } from "./pl-tab-section"
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
  // Phase 3.3 extension — clicking the Donut slice highlights that
  // expense category in the table below AND scrolls it into view.
  // `pulseDrilldown` flashes the active row for 1.5s so the user sees
  // where they landed when the table is long.
  const [pulseDrilldown, setPulseDrilldown] = useState(false)
  function drillToCategory(categoryName: string): void {
    setDrilldown(categoryName)
    setPulseDrilldown(true)
    setTimeout(() => setPulseDrilldown(false), 1500)
    requestAnimationFrame(() => {
      const el = document.querySelector(
        `[data-pl-category="${CSS.escape(categoryName)}"]`,
      ) as HTMLElement | null
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" })
      }
    })
  }
  // Phase 3.3 extension — clicking a Waterfall bar scrolls to the
  // matching section anchor. Sections rendered via renderSection() get
  // an id of `pl-section-<key>`; map waterfallData[].key → that key.
  const [flashSection, setFlashSection] = useState<string | null>(null)
  function drillToSection(barKey: string): void {
    // Map Waterfall entry.key → renderSection sectionId (passed to
    // `id="pl-section-<id>"`). GP and EBITDA are inline summary blocks
    // (not renderSection), so they get their own anchor ids.
    const map: Record<string, string> = {
      Revenue: "auto-revenue",
      "Direct Costs": "auto-direct",
      "Gross Profit": "pl-gp-block",
      Overhead: "auto-indirect",
      EBITDA: "pl-ebitda-block",
    }
    const sectionId = map[barKey]
    if (!sectionId) return
    requestAnimationFrame(() => {
      // GP / EBITDA blocks use bare ids; renderSection blocks are
      // prefixed `pl-section-`.
      const el =
        document.getElementById(sectionId) ??
        document.getElementById(`pl-section-${sectionId}`)
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" })
      setFlashSection(sectionId)
      setTimeout(
        () => setFlashSection((cur) => (cur === sectionId ? null : cur)),
        1500,
      )
    })
  }
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

  // Per-category actuals availability (2026-06-04). False when the realized
  // figures exist only in aggregate — a budget plan whose actuals live in the
  // matching-year Actuals plan under a different account taxonomy (Y4). The
  // detailed P&L statement then renders "—" for per-category actual / variance
  // / execution instead of a misleading 0 / −planned; the real totals stay in
  // the KPI cards above. Prefer the route flag; fall back to a byCategory scan
  // for responses cached before the flag shipped.
  const perCatActuals = analytics?.perCategoryActualsAvailable ?? byCategory.some(c => c.actual !== 0)
  // "—" node for actual/variance cells in the GP / EBITDA / Net blocks +
  // drill-down when per-category actuals aren't available.
  const naDash = <span className="text-muted-foreground/50 font-mono">—</span>

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
  const rowCode = (r: typeof byCategory[number]) => r.accountCode ?? r.category ?? ""
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

  // Phase 3.1 v1.3 — `groupByParent` extracted to shared helper.
  const revGrouped = groupByParent(revRows)
  const directGrouped = groupByParent(directExpRows)
  const indirectGrouped = groupByParent(indirectExpRows)
  const belowEbitdaGrouped = groupByParent(belowEbitdaRows)

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
  // Actual GP/EBITDA derive from the analytics AGGREGATE (auto + manual + Y4
  // join, and the FULL expense actual incl. OpEx categories not yet mapped
  // per-İcmal-code), not the per-category row sums — otherwise an unmapped
  // OpEx section reads 0 and EBITDA reads GP-minus-0 (falsely positive). This
  // keeps the GP/EBITDA blocks + section headers consistent with the KPI cards.
  const grossProfitActual = (analytics?.totalRevenueActual || totalRevenueActual) - (analytics?.totalCOGSActual || totalDirectActual)
  // EBITDA = Gross Profit - Indirect Costs
  const opProfitPlanned = grossProfitPlanned - totalIndirectPlanned
  const opProfitActual = grossProfitActual - (analytics?.totalExpenseActual || totalIndirectActual)

  // KPI-card actuals (2026-06-04). The per-category `byCategory[].actual` is 0
  // when the plan's realized figures aren't keyed to the BUDGET categories:
  //   • a budget plan's actuals live in the matching-year Actuals plan (Y4
  //     fallback) under a DIFFERENT account taxonomy → can't map per-category;
  //   • an actuals plan reports its realized totals in aggregate.
  // In both cases the route still computes the correct AGGREGATE realized
  // totals (totalRevenueActual / totalCOGSActual / totalExpenseActual). Use
  // those for the headline cards so they show the real numbers (e.g. 9.5M
  // revenue / 4 months booked) instead of 0. The detailed P&L table below
  // stays per-category (honest: per-budget-category actuals aren't available).
  const cardRevenueActual = analytics?.totalRevenueActual || totalRevenueActual
  const cardDirectActual = analytics?.totalCOGSActual || totalDirectActual
  const cardIndirectActual = analytics?.totalExpenseActual || totalIndirectActual
  const cardExpenseActual = cardDirectActual + cardIndirectActual
  const cardGrossProfitActual = cardRevenueActual - cardDirectActual
  const cardOpProfitActual = cardGrossProfitActual - cardIndirectActual

  // execPct is imported from @/lib/budgeting/exec-pct (sign-aware, unit-tested).
  // NOTE: thresholds assume planned > 0. Behavior is undefined for the
  // (planned < 0, isExpense=true) edge case (e.g. budget for net refund −100,
  // actual −50 = under-recovery — execPct=150 reads "overrun" red here, but
  // semantically it's "less recovery than expected"). Not hit on AZMADE today;
  // revisit Phase 7.G if a customer chart of accounts produces negative-cost
  // rows.

  // Phase 8 D1 (2026-05-29) — renderSection (+ ExecBar/execColor) and KPICard
  // moved to ./pl-tab-section. Closure state is now threaded through ctx.
  const { renderSection, KPICard } = makePlSection({
    t, byCategory, collapsed, toggleCollapse, drilldown, setDrilldown,
    pulseDrilldown, plShowMaterialOnly, isPlMaterial, flashSection, drillToSection,
    getGroupActual, perCategoryActualsAvailable: perCatActuals,
  })

  return (
    <div className="space-y-4">
      {/* KPI Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPICard
          title={t("plRevenue")}
          planned={totalRevenuePlanned}
          actual={cardRevenueActual}
          iconEl={<DollarSign className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />}
          accentClass="bg-indigo-200 dark:bg-indigo-800"
          conditionalBg="bg-gradient-to-br from-indigo-50 to-indigo-100 border border-indigo-200 dark:from-indigo-950/30 dark:to-indigo-900/20 dark:border-indigo-800"
          valueColorClass="text-indigo-700 dark:text-indigo-300"
        />
        <KPICard
          title={t("grossProfit")}
          planned={grossProfitPlanned}
          actual={cardGrossProfitActual}
          iconEl={cardGrossProfitActual < 0 ? <TrendingDown className="h-4 w-4 text-red-600 dark:text-red-400" /> : <TrendingUp className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />}
          accentClass={cardGrossProfitActual < 0 ? "bg-red-200 dark:bg-red-800" : "bg-emerald-200 dark:bg-emerald-800"}
          conditionalBg={cardGrossProfitActual < 0
            ? "bg-gradient-to-br from-red-50 to-red-100 border border-red-200 dark:from-red-950/30 dark:to-red-900/20 dark:border-red-800"
            : "bg-gradient-to-br from-emerald-50 to-emerald-100 border border-emerald-200 dark:from-emerald-950/30 dark:to-emerald-900/20 dark:border-emerald-800"}
          valueColorClass={cardGrossProfitActual < 0 ? "text-red-700 dark:text-red-300" : "text-emerald-700 dark:text-emerald-300"}
          marginPct={totalRevenuePlanned > 0 ? `Gross Margin: ${((grossProfitPlanned / totalRevenuePlanned) * 100).toFixed(1)}% (plan)` : undefined}
        />
        <KPICard
          title={t("plExpenses")}
          planned={totalExpensePlanned}
          actual={cardExpenseActual}
          iconEl={<Banknote className="h-4 w-4 text-orange-600 dark:text-orange-400" />}
          accentClass="bg-orange-200 dark:bg-orange-800"
          conditionalBg="bg-gradient-to-br from-orange-50 to-orange-100 border border-orange-200 dark:from-orange-950/30 dark:to-orange-900/20 dark:border-orange-800"
          valueColorClass="text-orange-700 dark:text-orange-300"
          isExpense
        />
        <KPICard
          title="EBITDA"
          planned={opProfitPlanned}
          actual={cardOpProfitActual}
          iconEl={cardOpProfitActual < 0 ? <TrendingDown className="h-4 w-4 text-red-600 dark:text-red-400" /> : <Target className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />}
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

              // Phase 8 D3(s) (2026-05-28) — structural shape for the
              // Recharts Tooltip callback payload entries. We read
              // `payload[0].payload` (the row our chart was built with),
              // so `payload` typed as a generic record array suffices.
              type WaterfallTooltipProps = {
                active?: boolean
                payload?: Array<{ payload: typeof waterfallData[number] }>
              }
              const WaterfallTooltip = ({ active, payload }: WaterfallTooltipProps) => {
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

              // Recharts LabelList content callback props: positional
              // props arrive as `string | number | undefined` (SVG-friendly).
              type WfLabelProps = {
                x?: string | number
                y?: string | number
                width?: string | number
                index?: number
              }
              const wfPx = (v: string | number | undefined) => {
                if (typeof v === "number") return v
                if (typeof v === "string") {
                  const n = Number(v)
                  return Number.isFinite(n) ? n : 0
                }
                return 0
              }
              const WaterfallLabel = (props: WfLabelProps) => {
                const x = wfPx(props.x)
                const y = wfPx(props.y)
                const width = wfPx(props.width)
                const item = props.index != null ? waterfallData[props.index] : undefined
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
                    {/* Phase 3.3 ext — onClick drills to the matching section
                        anchor below. cursor:pointer is the affordance. */}
                    <Bar dataKey="value" stackId="wf" radius={[4, 4, 0, 0]} animationDuration={ANIMATION.duration} animationEasing={ANIMATION.easing}>
                      {waterfallData.map((entry, i) => (
                        <Cell
                          key={i}
                          fill={`url(#pl-wf-${i})`}
                          style={{ cursor: "pointer" }}
                          onClick={() => drillToSection(entry.key)}
                        />
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

              // Pie chart tooltip entry: Recharts hands us `value` from the
              // data row plus `name` and the row itself (with fill colour
              // from the Cell). Narrow only what we read.
              type DonutTooltipProps = {
                active?: boolean
                payload?: Array<{ value: number; name: string; payload: { fill: string } }>
              }
              const DonutTooltip = ({ active, payload }: DonutTooltipProps) => {
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

              // Recharts Pie label render props — all values are
              // numeric pixel/percent coordinates supplied by the chart.
              type DonutLabelProps = {
                cx?: number
                cy?: number
                midAngle?: number
                innerRadius?: number
                outerRadius?: number
                percent?: number
              }
              const DonutLabel = ({ cx = 0, cy = 0, midAngle = 0, innerRadius = 0, outerRadius = 0, percent = 0 }: DonutLabelProps) => {
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
                        {/* Phase 3.3 ext — clicking a Donut slice highlights
                            that category row in the table below + scrolls + flashes
                            for 1.5s. cursor:pointer is the affordance. */}
                        {expenseItems.map((item, i) => (
                          <Cell
                            key={i}
                            fill={DONUT_COLORS[i % DONUT_COLORS.length]}
                            style={{ cursor: "pointer" }}
                            onClick={() => drillToCategory(item.name)}
                          />
                        ))}
                      </Pie>
                      <Tooltip content={<DonutTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  {/* Legend below donut */}
                  <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 mt-1">
                    {expenseItems.slice(0, 6).map((item, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-1.5 text-[10px] text-muted-foreground"
                        // Phase 3.3 hover pattern — donut legend names
                        // truncate aggressively at 80px max-width.
                        title={item.name}
                      >
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
            {allExpanded ? t("plCollapseAll") : t("plExpandAll")}
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

      {/* Honesty note — per-category actuals unavailable (budget plan whose
          realized figures live in a different-taxonomy Actuals plan). The
          detailed rows below show "—" for actual/variance; the real totals
          are in the KPI cards above. */}
      {!perCatActuals && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300/60 bg-amber-50/70 dark:border-amber-700/50 dark:bg-amber-950/20 px-3.5 py-2.5 text-xs text-amber-800 dark:text-amber-200">
          <Info className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{t("pnlPerCategoryActualNote")}</span>
        </div>
      )}

      {/* P&L Income Statement — no COGS (allocated costs shown in Profitability module) */}
      {renderSection(t("plRevenue"), revRows, "auto-revenue", <DollarSign className="h-4 w-4" />, "bg-primary/[0.04]", true, totalRevenuePlanned, totalRevenueActual, false, revGrouped, cardRevenueActual)}
      {renderSection(t("plSectionDirectCosts"), directExpRows, "auto-direct", <Settings2 className="h-4 w-4" />, "bg-orange-50/60 dark:bg-orange-950/20", false, 0, 0, true, directGrouped, cardDirectActual)}

      {/* Gross Profit = Revenue - Direct Costs */}
      {/* Phase 3.3 ext — id targets Waterfall "Gross Profit" bar click. */}
      <div
        id="pl-gp-block"
        className={`border-2 rounded-xl overflow-hidden mb-3 ${grossProfitActual < 0 ? "border-red-400/50 dark:border-red-500/50 bg-gradient-to-r from-red-50 to-rose-50 dark:from-red-950/40 dark:to-rose-950/30" : "border-emerald-500/50 dark:border-emerald-600/50 bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/40 dark:to-teal-950/30"} ${flashSection === "pl-gp-block" ? "ring-2 ring-indigo-500" : ""}`}
      >
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
            {perCatActuals ? (
              <span className={grossProfitActual >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-red-600 dark:text-red-400"}>
                <AnimatedNumber value={grossProfitActual} duration={600} />
              </span>
            ) : naDash}
            {perCatActuals ? (
              <span className={`text-sm ${grossProfitActual - grossProfitPlanned >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                <AnimatedNumber value={grossProfitActual - grossProfitPlanned} duration={400} formatter={(n) => `${n >= 0 ? "+" : ""}${Math.round(n).toLocaleString()} ₼`} />
              </span>
            ) : naDash}
          </div>
        </div>
      </div>

      {renderSection(t("plSectionOverheadExpenses"), indirectExpRows, "auto-indirect", <Banknote className="h-4 w-4" />, "bg-amber-50/60 dark:bg-amber-950/20", false, 0, 0, true, indirectGrouped, cardIndirectActual)}

      {/* EBITDA */}
      {/* Phase 3.3 ext — id targets Waterfall "EBITDA" bar click. */}
      <div
        id="pl-ebitda-block"
        className={`border-2 rounded-xl overflow-hidden mb-3 ${opProfitActual < 0 ? "border-red-400/50 dark:border-red-500/50 bg-gradient-to-r from-red-50 to-rose-50 dark:from-red-950/40 dark:to-rose-950/30" : "border-purple-400/50 dark:border-purple-500/50 bg-gradient-to-r from-muted/50 to-purple-50 dark:from-purple-950/30 dark:to-purple-950/30"} ${flashSection === "pl-ebitda-block" ? "ring-2 ring-indigo-500" : ""}`}
      >
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
            {perCatActuals ? (
              <span className={opProfitActual >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-red-600 dark:text-red-400"}>
                <AnimatedNumber value={opProfitActual} duration={600} />
              </span>
            ) : naDash}
            {perCatActuals ? (
              <span className={`text-sm ${opProfitActual - opProfitPlanned >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                <AnimatedNumber value={opProfitActual - opProfitPlanned} duration={400} formatter={(n) => `${n >= 0 ? "+" : ""}${Math.round(n).toLocaleString()} ₼`} />
              </span>
            ) : naDash}
          </div>
        </div>
      </div>

      {/* D&A / Finance / Tax — below-EBITDA items */}
      {belowEbitdaRows.length > 0 && (
        <>
          {renderSection(t("pnlBelowEbitdaSection"), belowEbitdaRows, "auto-below-ebitda", <Banknote className="h-4 w-4" />, "bg-slate-50/60 dark:bg-slate-950/20", false, 0, 0, true, belowEbitdaGrouped)}

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
                    {perCatActuals ? (
                      <span className={netActual >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-red-600 dark:text-red-400"}>
                        <AnimatedNumber value={netActual} duration={600} />
                      </span>
                    ) : naDash}
                    {perCatActuals ? (
                      <span className={`text-sm ${netActual - netPlanned >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                        <AnimatedNumber value={netActual - netPlanned} duration={400} formatter={(n) => `${n >= 0 ? "+" : ""}${Math.round(n).toLocaleString()} ₼`} />
                      </span>
                    ) : naDash}
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
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => deleteSection.mutate({ id: sec.id, planId })}
              className="h-7 w-7 text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
              aria-label={`Delete ${sec.name}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
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
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setDrilldown(null)}
                className="h-7 text-xs"
                aria-label={t("btnClose")}
              >
                <X className="h-3 w-3" /> {t("btnClose")}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {(() => {
              const row = byCategory.find(r => r.category === drilldown)
              if (!row) return <p className="text-sm text-muted-foreground">{t("emptyNoData")}</p>
              const isExp = row.lineType === "expense" || row.lineType === "cogs"
              const maxVal = Math.max(row.planned, row.forecast, perCatActuals ? row.actual : 0, 1)
              const items = [
                { label: t("colBudget"), value: row.planned, color: "#3b82f6" },
                { label: t("colForecast"), value: row.forecast, color: "#a855f7" },
                // Drop the Actual bar when per-category actuals aren't available
                // (would otherwise render a misleading 0-width "achieved nothing").
                ...(perCatActuals ? [{ label: t("colActual"), value: row.actual, color: "#10b981" }] : []),
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
                      <p className={`font-bold font-mono text-sm ${perCatActuals ? (row.variance >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500") : "text-muted-foreground/50"}`}>
                        {perCatActuals ? <AnimatedNumber value={row.variance} duration={400} formatter={(n) => `${n >= 0 ? "+" : ""}${Math.round(n).toLocaleString()} ₼`} /> : "—"}
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{t("pnlDeviation")}</p>
                      <p className={`font-bold font-mono text-sm ${perCatActuals ? (row.variancePct >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500") : "text-muted-foreground/50"}`}>
                        {perCatActuals ? `${row.variancePct >= 0 ? "+" : ""}${row.variancePct.toFixed(1)}%` : "—"}
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{t("pnlExecution")}</p>
                      <p className={`font-bold font-mono text-sm ${perCatActuals ? "" : "text-muted-foreground/50"}`}>
                        {perCatActuals ? `${row.planned > 0 ? Math.round((row.actual / row.planned) * 100) : 0}%` : "—"}
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
