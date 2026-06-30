"use client"

import { useState } from "react"
import { useSession } from "next-auth/react"
import { useQuery } from "@tanstack/react-query"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  AreaChart, Area, ComposedChart, Line, Cell,
} from "recharts"
import { TrendingUp, TrendingDown, DollarSign, Percent, BarChart2, ChevronDown, ChevronRight, ArrowUpRight, ArrowDownRight, Info, Pencil } from "lucide-react"
import { isDaCode } from "@/lib/budgeting/da-codes"
import { isLumpyMonthly, sumPerRowSmoothed } from "@/lib/budgeting/margin-smoothing"
import { aggregateRowsForEbitda, computeEbitda, computeActualEbitda } from "@/lib/budgeting/ebitda"
import {
  buildEbitdaBridge,
  buildPnlPerformancePoint,
  type PnlPerformanceMetric,
} from "@/lib/budgeting/pnl-performance"
import {
  ClientReconDrawer,
  type ClientReconciliationRow,
  type PnlContributorRow,
} from "@/features/budgeting/components/ClientReconDrawer"
import { BudgetPnlDrillPanel, type DrillRow } from "./budget-pnl-drill-panel"
import { PnlPerformanceCharts } from "./pnl-performance-charts"
// Phase 8 D1 (2026-05-29) — pure formatters extracted to a sibling.
import { fmtNum, fmtCurrency, pctOfRev, varianceStr, varianceClass } from "./budget-pnl-format"

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

// Phase 3.3 v1.4 — PnlRow IS a DrillRow with parentCode required.
// Single source of truth: re-use the base shape, narrow parentCode.
type PnlRow = DrillRow & { parentCode: string | null }

export function BudgetPnlView({ planId, companyId }: { planId: string; companyId?: string | null }) {
  const { data: session } = useSession()
  const orgId = session?.user?.organizationId
  const userRole = session?.user?.role
  const canEditRecon = userRole === "admin" || userRole === "manager"
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set())
  const [reconOpen, setReconOpen] = useState(false)
  // Phase 3.3 — clicked-row drill-down side panel state. Holds the
  // PnlRow currently expanded into month-by-month detail. null = closed.
  const [drillRow, setDrillRow] = useState<PnlRow | null>(null)

  // Phase 3.3 — chart-category drill: clicking a Waterfall bar scrolls
  // to + briefly highlights the corresponding section in the table
  // below. Auto-expands collapsed sections so the rows are visible
  // after the scroll lands. `flashSection` holds the section key
  // currently pulsing (auto-clears after 1.5s via the timer in
  // drillToSection).
  const [flashSection, setFlashSection] = useState<string | null>(null)
  function drillToSection(chartCategory: string): void {
    // Map waterfallData[].name → section key + DOM id.
    const map: Record<string, string> = {
      Revenue: "revenue",
      COGS: "cogs",
      "Gross Profit": "gross-profit",
      OpEx: "opex",
      EBITDA: "ebitda",
      "D&A/Tax": "below-ebitda",
      "Net Profit": "net-profit",
    }
    const key = map[chartCategory]
    if (!key) return
    // Auto-expand the expandable sections (revenue/cogs/opex/below-ebitda)
    // so the detail rows are visible after the scroll. GP / EBITDA / Net
    // Profit are summary rows — already visible, no expand needed.
    if (key === "revenue" || key === "cogs" || key === "opex" || key === "below-ebitda") {
      setExpandedSections((prev) => {
        const next = new Set(prev)
        next.add(key)
        return next
      })
    }
    // Scroll + flash on the next paint so the expand-induced layout
    // shift has happened.
    requestAnimationFrame(() => {
      const el = document.getElementById(`pnl-section-${key}`)
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" })
      }
      setFlashSection(key)
      setTimeout(() => setFlashSection((cur) => (cur === key ? null : cur)), 1500)
    })
  }
  // Turn 38 sub-turn 4: Margin Trends chart toggle. "management" smooths
  // year-end accounting lumps (FX losses, interest, tax, D&A true-ups
  // booked 100% in one month per AZ SAP practice) by spreading them
  // across 12 months for a meaningful monthly margin trend. YTD totals
  // unchanged. Default = "management" because the demo audience is
  // finance professionals; "bookkeeping" available for verbatim view.
  const [marginViewMode, setMarginViewMode] = useState<"management" | "bookkeeping">("management")

  // Turn 30: per-daughter-company drilldown. queryKey includes companyId
  // so switching companies re-fetches; URL query string carries it through.
  const queryString = companyId ? `?planId=${planId}&companyId=${companyId}` : `?planId=${planId}`
  const { data, isLoading } = useQuery({
    queryKey: ["pnl", planId, companyId ?? null],
    queryFn: async () => {
      const res = await fetch(`/api/budgeting/pnl${queryString}`, {
        headers: { "x-organization-id": orgId || "" },
      })
      return res.json()
    },
    enabled: !!planId && !!orgId,
  })

  // Phase 7.H Feature 5 — client-reported EBITDA reference. MUST be
  // declared above the early-return branches below so React sees a
  // consistent hook order across renders (first render: data still
  // loading → early return at line ~120; second render: data resolved
  // → full body executes). Pre-fix this useQuery sat below the early
  // returns and broke the rules-of-hooks contract once the loading
  // state flipped. Period defaults to current year while data is
  // pending; the enabled flag prevents the request from firing without
  // companyId / orgId, so no wasted fetches during load.
  const reconPeriod =
    (data?.year ? String(data.year) : null) ?? new Date().getFullYear().toString()
  const reconLookupEnabled = !!companyId && !!orgId
  const { data: reconLookup } = useQuery({
    queryKey: ["pnl-recon-lookup", companyId, reconPeriod],
    enabled: reconLookupEnabled,
    queryFn: async () => {
      const url = new URL(`/api/companies/${companyId}/reconciliation`, window.location.origin)
      url.searchParams.set("period", reconPeriod)
      url.searchParams.set("indicatorKey", "EBITDA")
      const res = await fetch(url.toString())
      if (!res.ok) return { rows: [] as ClientReconciliationRow[] }
      return res.json() as Promise<{ rows: ClientReconciliationRow[] }>
    },
  })

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-4 gap-3">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-24 rounded-xl bg-muted/50 animate-pulse" />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="h-72 rounded-xl bg-muted/50 animate-pulse" />
          <div className="h-72 rounded-xl bg-muted/50 animate-pulse" />
        </div>
      </div>
    )
  }

  if (!data?.rows || data.rows.length === 0) {
    return (
      <Card>
        <CardContent className="p-12 text-center text-muted-foreground">
          <BarChart2 className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No P&L data available</p>
          <p className="text-sm mt-1">Import an Excel file to populate the P&L statement.</p>
        </CardContent>
      </Card>
    )
  }

  const { rows, monthlyRevenue, monthlyCogs } = data
  const actualByKey: Record<string, number> = data.actualByKey ?? {}
  // Phase 3.3 v1.2 (post-Turn LIX v1.2 wire-up) — per-month actuals
  // keyed by accountCode::accountName. /pnl route parses BudgetActual
  // .expenseDate at request time. Drill panel reads this map by row key.
  const actualMonthlyByKey: Record<string, Record<number, number>> =
    data.actualMonthlyByKey ?? {}
  const sectionActuals = data.sectionActuals ?? { revenue: 0, cogs: 0, opex: 0, belowEbitda: 0 }
  const monthlyActualRevenue: Record<number, number> = data.monthlyActualRevenue ?? {}
  const monthlyActualCogs: Record<number, number> = data.monthlyActualCogs ?? {}
  const monthlyActualOpex: Record<number, number> = data.monthlyActualOpex ?? {}
  const monthlyActualBelowEbitda: Record<number, number> = data.monthlyActualBelowEbitda ?? {}
  const monthlyActualDa: Record<number, number> = data.monthlyActualDa ?? {}
  const hasActuals: boolean = Boolean(data.hasActuals)

  // Calculate totals — revenue/cogs already pre-aggregated by the API route.
  // EBITDA + adjacent metrics come from `src/lib/budgeting/ebitda.ts` (single
  // source of truth shared with the client-reconciliation API).
  const totalRevenue = Object.values(monthlyRevenue || {}).reduce((s: number, v: any) => s + (v || 0), 0)
  const totalCogs = Math.abs(Object.values(monthlyCogs || {}).reduce((s: number, v: any) => s + (v || 0), 0))

  // `depreciationRows` stays here (not in the shared module) because it uses
  // a broader `startsWith("731")` predicate for a UI legend, whereas the
  // EBITDA math uses the strict D&A code set (`isDaCode` → 703-11/721-11).
  const allExpenseRows = rows.filter((r: PnlRow) => r.accountType === "expense" && r.total !== 0)
  const depreciationRows = allExpenseRows.filter((r: PnlRow) => r.accountCode.startsWith("731"))

  const planAggregated = aggregateRowsForEbitda({
    rows: rows as PnlRow[],
    totalRevenue,
    totalCogs,
  })
  const { opexRows, belowEbitdaRows, daRowsInOpex, daRowsInCogs } = planAggregated
  const totalOpex = planAggregated.totals.totalOpex
  const totalBelowEbitda = planAggregated.totals.totalBelowEbitda
  const totalDaInCogs = planAggregated.totals.daInCogs
  const totalDaInOpex = planAggregated.totals.daInOpex
  const planBreakdown = computeEbitda(planAggregated.totals)
  const { grossProfit, grossMargin, totalDa, ebit, ebitda, ebitdaMargin, netProfit, netMargin } = planBreakdown

  // Actual-side EBITDA — same formula (EBIT + D&A) so the Actual column
  // carries meaning for computed rows. D&A in actuals comes from a single
  // bucket since sectionActuals doesn't preserve the COGS/OpEx split.
  const actualBreakdown = computeActualEbitda({ sectionActuals, actualByKey })
  const actualGrossProfit = actualBreakdown.grossProfit
  const actualEbit = actualBreakdown.ebit
  const actualEbitda = actualBreakdown.ebitda
  const actualNetProfit = actualBreakdown.netProfit

  // Top-5 P&L contributors to EBITDA, sorted by |total| desc. Revenue +
  // COGS + OpEx rows participate (below-EBITDA lines don't affect EBITDA).
  // D&A rows aren't pinned, only badged in the drawer — pinning a small
  // D&A item over a 10x larger revenue row would mislead the viewer.
  const contributors: PnlContributorRow[] = (() => {
    const acc: PnlContributorRow[] = []
    for (const r of rows as PnlRow[]) {
      if (r.total === 0) continue
      if (r.accountType === "revenue") {
        acc.push({ accountCode: r.accountCode, accountName: r.accountName, section: "revenue", total: r.total })
      } else if (r.accountType === "cogs") {
        acc.push({ accountCode: r.accountCode, accountName: r.accountName, section: "cogs", total: r.total })
      }
    }
    for (const r of opexRows) {
      acc.push({ accountCode: r.accountCode, accountName: r.accountName, section: "opex", total: r.total })
    }
    acc.sort((a, b) => Math.abs(b.total) - Math.abs(a.total))
    return acc.slice(0, 5)
  })()

  // `clientReconRow` derived from the hook declared at the top of the
  // component (see rules-of-hooks block above the early-return guards).
  const clientReconRow: ClientReconciliationRow | null = reconLookup?.rows?.[0] ?? null
  const reconVariance: number | null =
    clientReconRow && ebitda !== 0
      ? ((clientReconRow.value - ebitda) / Math.abs(ebitda)) * 100
      : null

  // Chart data
  const chartData = MONTHS.map((m, i) => {
    const rev = monthlyRevenue?.[i + 1] || 0
    const cogs = Math.abs(monthlyCogs?.[i + 1] || 0)
    const gp = rev - cogs
    return { month: m, Revenue: rev, COGS: cogs, "Gross Profit": gp }
  })

  // Margin trend data (gross + EBITDA + net) — Turn 38 sub-turn 4:
  // - Correct EBITDA: add D&A back (D&A in OpEx 721-11 + D&A in COGS 703-11).
  // - Management view (default): smooth lumpy non-operating + D&A PER ROW
  //   (NOT on the aggregated sum — at consolidated view multiple rows
  //   wash each other out so the agg ratio drops below threshold even
  //   when one constituent row IS a Dec lump). YTD totals preserved.
  const rowMonthlyAbs = (r: PnlRow): number[] =>
    Array.from({ length: 12 }, (_, i) => Math.abs(r.monthly[i + 1] || 0))
  const sumRows = (rs: PnlRow[]): number[] =>
    sumPerRowSmoothed(rs.map(rowMonthlyAbs), marginViewMode === "management")
  const opexNonDaRows = opexRows.filter((r: PnlRow) => !isDaCode(r.accountCode))
  // For lumpiness detection (does the toggle make sense to show?), check
  // raw rows individually — even one lumpy row in the section justifies
  // exposing the toggle.
  const anyLumpyRow = (rs: PnlRow[]): boolean =>
    rs.some((r) => isLumpyMonthly(rowMonthlyAbs(r)))

  const monthlyOpexNonDa = sumRows(opexNonDaRows)
  const monthlyDaInOpex = sumRows(daRowsInOpex)
  const monthlyDaInCogs = sumRows(daRowsInCogs)
  const monthlyBelowEbitda = sumRows(belowEbitdaRows)
  // Raw versions (no smoothing) for the cogsRaw bridge below.
  const monthlyDaInCogsRaw = Array.from({ length: 12 }, (_, i) =>
    daRowsInCogs.reduce((s, r) => s + Math.abs(r.monthly[i + 1] || 0), 0),
  )
  const monthlyDaInOpexRaw = Array.from({ length: 12 }, (_, i) =>
    daRowsInOpex.reduce((s, r) => s + Math.abs(r.monthly[i + 1] || 0), 0),
  )
  const monthlyOpexBudgetRaw = Array.from({ length: 12 }, (_, i) =>
    Math.abs(opexRows.reduce((s, r) => s + (r.monthly[i + 1] || 0), 0)),
  )
  const monthlyBelowEbitdaBudgetRaw = Array.from({ length: 12 }, (_, i) =>
    Math.abs(belowEbitdaRows.reduce((s, r) => s + (r.monthly[i + 1] || 0), 0)),
  )

  const marginData = MONTHS.map((m, i) => {
    const rev = monthlyRevenue?.[i + 1] || 0
    const cogsRaw = Math.abs(monthlyCogs?.[i + 1] || 0)
    const cogsExclDa = cogsRaw - monthlyDaInCogsRaw[i] + monthlyDaInCogs[i]
    const opexExclDa = monthlyOpexNonDa[i]
    const monthBelowEbitda = monthlyBelowEbitda[i]
    const gm = rev > 0 ? ((rev - cogsExclDa - monthlyDaInCogs[i]) / rev) * 100 : 0
    // True EBITDA: revenue − COGS_exclDA − OpEx_exclDA = current EBIT + D&A
    const em = rev > 0 ? ((rev - cogsExclDa - opexExclDa) / rev) * 100 : 0
    const nm = rev > 0 ? ((rev - cogsExclDa - monthlyDaInCogs[i] - opexExclDa - monthlyDaInOpex[i] - monthBelowEbitda) / rev) * 100 : 0
    return {
      month: m,
      "Gross Margin": Math.round(gm * 10) / 10,
      "EBITDA Margin": Math.round(em * 10) / 10,
      "Net Margin": Math.round(nm * 10) / 10,
    }
  })

  // Detect whether the underlying data has lumps — surfaces the toggle's
  // value to the user (no point showing toggle if everything's already smooth).
  const hasLumpyNonOp = anyLumpyRow(belowEbitdaRows) ||
    anyLumpyRow(daRowsInOpex) || anyLumpyRow(daRowsInCogs)

  // Waterfall data
  const waterfallData = [
    { name: "Revenue", value: totalRevenue, fill: "#10b981" },
    { name: "COGS", value: -totalCogs, fill: "#ef4444" },
    { name: "Gross Profit", value: grossProfit, fill: "#3b82f6" },
    { name: "OpEx", value: -totalOpex, fill: "#f59e0b" },
    { name: "EBITDA", value: ebitda, fill: ebitda >= 0 ? "#8b5cf6" : "#ef4444" },
    ...(totalBelowEbitda > 0 ? [{ name: "D&A/Tax", value: -totalBelowEbitda, fill: "#94a3b8" }] : []),
    { name: "Net Profit", value: netProfit, fill: netProfit >= 0 ? "#10b981" : "#ef4444" },
  ]

  const monthlyPerformance: Record<PnlPerformanceMetric, ReturnType<typeof buildPnlPerformancePoint>[]> = {
    revenue: MONTHS.map((month, i) => buildPnlPerformancePoint({
      month,
      budget: monthlyRevenue?.[i + 1] || 0,
      actual: monthlyActualRevenue?.[i + 1] || 0,
    })),
    cogs: MONTHS.map((month, i) => buildPnlPerformancePoint({
      month,
      budget: Math.abs(monthlyCogs?.[i + 1] || 0),
      actual: monthlyActualCogs?.[i + 1] || 0,
    })),
    opex: MONTHS.map((month, i) => buildPnlPerformancePoint({
      month,
      budget: monthlyOpexBudgetRaw[i] || 0,
      actual: monthlyActualOpex?.[i + 1] || 0,
    })),
    ebitda: MONTHS.map((month, i) => {
      const revenueBudget = monthlyRevenue?.[i + 1] || 0
      const cogsBudget = Math.abs(monthlyCogs?.[i + 1] || 0)
      const opexBudget = monthlyOpexBudgetRaw[i] || 0
      const daBudget = (monthlyDaInCogsRaw[i] || 0) + (monthlyDaInOpexRaw[i] || 0)
      const revenueActual = monthlyActualRevenue?.[i + 1] || 0
      const cogsActual = monthlyActualCogs?.[i + 1] || 0
      const opexActual = monthlyActualOpex?.[i + 1] || 0
      const daActual = monthlyActualDa?.[i + 1] || 0
      return buildPnlPerformancePoint({
        month,
        budget: revenueBudget - cogsBudget - opexBudget + daBudget,
        actual: revenueActual - cogsActual - opexActual + daActual,
      })
    }),
    netProfit: MONTHS.map((month, i) => {
      const revenueBudget = monthlyRevenue?.[i + 1] || 0
      const cogsBudget = Math.abs(monthlyCogs?.[i + 1] || 0)
      const opexBudget = monthlyOpexBudgetRaw[i] || 0
      const belowBudget = monthlyBelowEbitdaBudgetRaw[i] || 0
      const revenueActual = monthlyActualRevenue?.[i + 1] || 0
      const cogsActual = monthlyActualCogs?.[i + 1] || 0
      const opexActual = monthlyActualOpex?.[i + 1] || 0
      const belowActual = monthlyActualBelowEbitda?.[i + 1] || 0
      return buildPnlPerformancePoint({
        month,
        budget: revenueBudget - cogsBudget - opexBudget - belowBudget,
        actual: revenueActual - cogsActual - opexActual - belowActual,
      })
    }),
  }

  const ebitdaBridge = buildEbitdaBridge({
    budget: {
      revenue: totalRevenue,
      cogs: totalCogs,
      opex: totalOpex,
      da: totalDa,
      ebitda,
    },
    actual: {
      revenue: sectionActuals.revenue,
      cogs: sectionActuals.cogs,
      opex: sectionActuals.opex,
      da: actualBreakdown.totalDa,
      ebitda: actualEbitda,
    },
  })

  // Group rows by type
  const revenueRows = rows.filter((r: PnlRow) => r.accountType === "revenue" && r.total !== 0)
  const cogsRows = rows.filter((r: PnlRow) => r.accountType === "cogs" && r.total !== 0)

  const toggleSection = (key: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const renderSectionRows = (
    sectionRows: PnlRow[],
    colorClass: string,
    opts: { showPct?: boolean; favorable?: "up" | "down" } = {},
  ) => {
    const showPct = opts.showPct ?? true
    const favorable = opts.favorable ?? "down"
    return sectionRows.map((row: PnlRow, idx: number) => {
      const isParent = !row.parentCode
      const rowKey = `${row.accountCode}::${row.accountName}`
      const actual = actualByKey[rowKey] || 0
      return (
        <tr
          key={`${rowKey}::${idx}`}
          // Phase 3.3 — click any row to open the month-by-month
          // drill-down side panel. Cursor + hover-bg-stronger affordance
          // so users discover the clickability without a tutorial.
          onClick={() => setDrillRow(row)}
          className={`border-b cursor-pointer hover:bg-primary/5 ${isParent ? "font-medium" : "text-muted-foreground"}`}
          data-drill-row-code={row.accountCode}
        >
          <td
            className="sticky left-0 bg-card px-3 py-1.5 text-xs"
            // Phase 3.3 third bullet — hover anywhere on the first
            // column reveals the qualified identifier (code — name).
            // Useful when CoA names are long and truncated, or when
            // the user wants to copy the code into a search box.
            title={`${row.accountCode} — ${row.accountName}`}
          >
            <span
              className="text-[10px] text-muted-foreground/60 mr-2 font-mono"
              title={`Account code: ${row.accountCode}`}
            >
              {row.accountCode}
            </span>
            {row.accountName}
          </td>
          {Array.from({ length: 12 }, (_, i) => {
            const val = row.monthly[i + 1] || 0
            const monthRev = monthlyRevenue?.[i + 1] || 0
            return (
              <td key={i} className={`px-2 py-1.5 text-right text-xs tabular-nums leading-tight ${colorClass}`}>
                <div>{val ? fmtNum(val) : "—"}</div>
                {showPct && val !== 0 && monthRev > 0 && (
                  <div className="text-[10px] text-muted-foreground/60 font-normal">{pctOfRev(val, monthRev)}</div>
                )}
              </td>
            )
          })}
          <td className={`px-3 py-1.5 text-right text-xs font-medium bg-muted/50 tabular-nums leading-tight ${colorClass}`}>
            <div>{fmtNum(row.total)}</div>
            {showPct && row.total !== 0 && totalRevenue > 0 && (
              <div className="text-[10px] text-muted-foreground/60 font-normal">{pctOfRev(row.total, totalRevenue)}</div>
            )}
          </td>
          <td className={`px-3 py-1.5 text-right text-xs tabular-nums bg-muted/30 leading-tight ${actual ? colorClass : "text-muted-foreground/50"}`}>
            <div>{actual ? fmtNum(actual) : "—"}</div>
            {showPct && actual !== 0 && sectionActuals.revenue > 0 && (
              <div className="text-[10px] text-muted-foreground/60 font-normal">{pctOfRev(actual, sectionActuals.revenue)}</div>
            )}
          </td>
          <td className={`px-3 py-1.5 text-right text-xs tabular-nums bg-muted/30 ${varianceClass(actual, row.total, favorable)}`}>
            {varianceStr(actual, row.total)}
          </td>
        </tr>
      )
    })
  }

  return (
    <div className="space-y-4">
      {/* KPI Strip — Power BI dark scorecards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {/* Revenue — Phase 3.3 v1.2 ext: clickable KPI card drills to
            the corresponding P&L section, mirroring Waterfall bar UX. */}
        <div
          onClick={() => drillToSection("Revenue")}
          className="relative overflow-hidden rounded-xl bg-gradient-to-br from-indigo-50 to-indigo-100 border border-indigo-200 dark:from-indigo-950/30 dark:to-indigo-900/20 dark:border-indigo-800 p-4 cursor-pointer hover:ring-2 hover:ring-indigo-300 transition"
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); drillToSection("Revenue") } }}
          aria-label="Open Revenue section"
        >
          <div className="absolute top-0 right-0 w-20 h-20 bg-indigo-200 dark:bg-indigo-800 rounded-full -mr-6 -mt-6" />
          <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 text-[10px] font-semibold uppercase tracking-widest mb-2">
            <TrendingUp className="h-3.5 w-3.5" /> Net Revenue
          </div>
          <p className="text-2xl font-bold tracking-tight text-indigo-700 dark:text-indigo-300">{fmtNum(totalRevenue)} <span className="text-sm font-normal text-muted-foreground">AZN</span></p>
          <p className="text-[10px] text-muted-foreground mt-1">Annual budget</p>
        </div>

        {/* COGS */}
        <div
          onClick={() => drillToSection("COGS")}
          className="relative overflow-hidden rounded-xl bg-gradient-to-br from-cyan-50 to-cyan-100 border border-cyan-200 dark:from-cyan-950/30 dark:to-cyan-900/20 dark:border-cyan-800 p-4 cursor-pointer hover:ring-2 hover:ring-cyan-300 transition"
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); drillToSection("COGS") } }}
          aria-label="Open COGS section"
        >
          <div className="absolute top-0 right-0 w-20 h-20 bg-cyan-200 dark:bg-cyan-800 rounded-full -mr-6 -mt-6" />
          <div className="flex items-center gap-2 text-cyan-600 dark:text-cyan-400 text-[10px] font-semibold uppercase tracking-widest mb-2">
            <TrendingDown className="h-3.5 w-3.5" /> Cost of Goods Sold
          </div>
          <p className="text-2xl font-bold tracking-tight text-cyan-700 dark:text-cyan-300">{fmtNum(totalCogs)} <span className="text-sm font-normal text-muted-foreground">AZN</span></p>
          <div className="flex items-center gap-1 mt-1">
            <span className="text-[10px] text-cyan-600 dark:text-cyan-400 font-medium">{((totalCogs / totalRevenue) * 100).toFixed(1)}%</span>
            <span className="text-[10px] text-muted-foreground">of revenue</span>
          </div>
        </div>

        {/* Gross Profit */}
        <div
          onClick={() => drillToSection("Gross Profit")}
          className="relative overflow-hidden rounded-xl bg-gradient-to-br from-emerald-50 to-emerald-100 border border-emerald-200 dark:from-emerald-950/30 dark:to-emerald-900/20 dark:border-emerald-800 p-4 cursor-pointer hover:ring-2 hover:ring-emerald-300 transition"
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); drillToSection("Gross Profit") } }}
          aria-label="Open Gross Profit row"
        >
          <div className="absolute top-0 right-0 w-20 h-20 bg-emerald-200 dark:bg-emerald-800 rounded-full -mr-6 -mt-6" />
          <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-[10px] font-semibold uppercase tracking-widest mb-2">
            <DollarSign className="h-3.5 w-3.5" /> Gross Profit
          </div>
          <p className="text-2xl font-bold tracking-tight text-emerald-700 dark:text-emerald-300">{fmtNum(grossProfit)} <span className="text-sm font-normal text-muted-foreground">AZN</span></p>
          <div className="flex items-center gap-1 mt-1">
            <ArrowUpRight className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">{grossMargin.toFixed(1)}%</span>
            <span className="text-[10px] text-muted-foreground">margin</span>
          </div>
        </div>

        {/* EBITDA */}
        <div
          onClick={() => drillToSection("EBITDA")}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); drillToSection("EBITDA") } }}
          aria-label="Open EBITDA row"
          className={`relative overflow-hidden rounded-xl p-4 cursor-pointer hover:ring-2 transition ${
          ebitda >= 0
            ? "bg-gradient-to-br from-purple-50 to-purple-100 border border-purple-200 dark:from-purple-950/30 dark:to-purple-900/20 dark:border-purple-800 hover:ring-purple-300"
            : "bg-gradient-to-br from-red-50 to-red-100 border border-red-200 dark:from-red-950/30 dark:to-red-900/20 dark:border-red-800 hover:ring-red-300"
        }`}>
          <div className={`absolute top-0 right-0 w-20 h-20 rounded-full -mr-6 -mt-6 ${ebitda >= 0 ? "bg-purple-200 dark:bg-purple-800" : "bg-red-200 dark:bg-red-800"}`} />
          <div className={`flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest mb-2 ${ebitda >= 0 ? "text-purple-600 dark:text-purple-400" : "text-red-600 dark:text-red-400"}`}>
            <BarChart2 className="h-3.5 w-3.5" /> EBITDA
            {companyId && (
              <button
                type="button"
                aria-label="Reconcile client EBITDA"
                onClick={(e) => {
                  // Phase 3.3 v1.2 — stop propagation so the parent
                  // KPI card's drill onClick doesn't fire when the
                  // user wants the reconciliation pencil.
                  e.stopPropagation()
                  setReconOpen(true)
                }}
                className="ml-auto relative z-10 rounded p-1 text-muted-foreground hover:bg-white/40 hover:text-foreground dark:hover:bg-white/10"
              >
                <Pencil className="h-3 w-3" />
              </button>
            )}
          </div>
          <p className={`text-2xl font-bold tracking-tight ${ebitda >= 0 ? "text-purple-700 dark:text-purple-300" : "text-red-700 dark:text-red-300"}`}>
            {ebitda < 0 && "("}{fmtNum(Math.abs(ebitda))}{ebitda < 0 && ")"} <span className="text-sm font-normal text-muted-foreground">AZN</span>
          </p>
          <div className="flex items-center gap-1 mt-1">
            {ebitda >= 0 ? <ArrowUpRight className="h-3 w-3 text-purple-600 dark:text-purple-400" /> : <ArrowDownRight className="h-3 w-3 text-red-600 dark:text-red-400" />}
            <span className={`text-[10px] font-medium ${ebitda >= 0 ? "text-purple-600 dark:text-purple-400" : "text-red-600 dark:text-red-400"}`}>{ebitdaMargin.toFixed(1)}%</span>
            <span className="text-[10px] text-muted-foreground">margin</span>
          </div>
          {clientReconRow && (
            <div className="mt-1.5 flex items-center gap-1.5 text-[10px]">
              <span className="text-muted-foreground">Client:</span>
              <span className="font-medium tabular-nums">
                {fmtNum(clientReconRow.value)} {clientReconRow.currency}
              </span>
              {reconVariance != null && (
                <span
                  className={`tabular-nums font-medium ${
                    reconVariance >= 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-red-600 dark:text-red-400"
                  }`}
                >
                  {reconVariance >= 0 ? "+" : ""}
                  {reconVariance.toFixed(1)}%
                </span>
              )}
            </div>
          )}
        </div>

        {/* Net Profit */}
        <div
          onClick={() => drillToSection("Net Profit")}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); drillToSection("Net Profit") } }}
          aria-label="Open Net Profit row"
          className={`relative overflow-hidden rounded-xl p-4 cursor-pointer hover:ring-2 transition ${
          netProfit >= 0
            ? "bg-gradient-to-br from-emerald-50 to-emerald-100 border border-emerald-200 dark:from-emerald-950/30 dark:to-emerald-900/20 dark:border-emerald-800 hover:ring-emerald-300"
            : "bg-gradient-to-br from-red-50 to-red-100 border border-red-200 dark:from-red-950/30 dark:to-red-900/20 dark:border-red-800 hover:ring-red-300"
        }`}>
          <div className={`absolute top-0 right-0 w-20 h-20 rounded-full -mr-6 -mt-6 ${netProfit >= 0 ? "bg-emerald-200 dark:bg-emerald-800" : "bg-red-200 dark:bg-red-800"}`} />
          <div className={`flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest mb-2 ${netProfit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
            <Percent className="h-3.5 w-3.5" /> Net Profit
          </div>
          <p className={`text-2xl font-bold tracking-tight ${netProfit >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300"}`}>
            {netProfit < 0 && "("}{fmtNum(Math.abs(netProfit))}{netProfit < 0 && ")"} <span className="text-sm font-normal text-muted-foreground">AZN</span>
          </p>
          <div className="flex items-center gap-1 mt-1">
            {netProfit >= 0 ? <ArrowUpRight className="h-3 w-3 text-emerald-600 dark:text-emerald-400" /> : <ArrowDownRight className="h-3 w-3 text-red-600 dark:text-red-400" />}
            <span className={`text-[10px] font-medium ${netProfit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>{netMargin.toFixed(1)}%</span>
            <span className="text-[10px] text-muted-foreground">margin</span>
          </div>
        </div>
      </div>

      <PnlPerformanceCharts
        monthly={monthlyPerformance}
        bridge={ebitdaBridge}
        hasActuals={hasActuals}
      />

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Revenue vs COGS */}
        <div className="lg:col-span-2 rounded-xl border bg-card p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">Revenue vs COGS — Monthly</h3>
          <ResponsiveContainer width="100%" height={280} minWidth={0}>
            <ComposedChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmtNum(v)} />
              <Tooltip formatter={((v: number) => fmtCurrency(v) + " AZN") as never} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="Revenue" fill="#10b981" radius={[4, 4, 0, 0]} />
              <Bar dataKey="COGS" fill="#ef4444" radius={[4, 4, 0, 0]} />
              <Line type="monotone" dataKey="Gross Profit" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Margin Trends — Turn 38 sub-turn 4: management/bookkeeping toggle */}
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center justify-between mb-3 gap-2">
            <h3 className="text-sm font-semibold text-foreground">Margin Trends</h3>
            {hasLumpyNonOp && (
              <div
                role="radiogroup"
                aria-label="Margin view mode"
                className="flex items-center gap-0 bg-muted/60 rounded-md p-0.5 text-[10px] font-semibold"
                title="Toggle between bookkeeping (raw monthly) and management (smoothed) views"
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={marginViewMode === "management"}
                  onClick={() => setMarginViewMode("management")}
                  className={`px-2 py-1 rounded ${marginViewMode === "management" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  Management
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={marginViewMode === "bookkeeping"}
                  onClick={() => setMarginViewMode("bookkeeping")}
                  className={`px-2 py-1 rounded ${marginViewMode === "bookkeeping" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  Bookkeeping
                </button>
              </div>
            )}
          </div>
          <ResponsiveContainer width="100%" height={280} minWidth={0}>
            <AreaChart data={marginData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => v + "%"} />
              <Tooltip formatter={((v: number) => v.toFixed(1) + "%") as never} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="Gross Margin" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.1} strokeWidth={2} />
              <Area type="monotone" dataKey="EBITDA Margin" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.08} strokeWidth={2} />
              <Area type="monotone" dataKey="Net Margin" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.1} strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
          {hasLumpyNonOp && (
            <div className="mt-2 flex items-start gap-1.5 text-[10px] text-muted-foreground">
              <Info className="h-3 w-3 mt-0.5 shrink-0" />
              <span>
                {marginViewMode === "management"
                  ? "Management view: year-end accrual lumps (FX losses, interest, extraordinary, tax) booked as single-month entries are spread evenly across 12 months. YTD totals unchanged."
                  : "Bookkeeping view: raw monthly bookings as recorded — single-month spikes reflect AZ SAP year-end true-ups."}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Waterfall Chart */}
      <div className="rounded-xl border bg-card p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3">P&L Waterfall</h3>
        <ResponsiveContainer width="100%" height={220} minWidth={0}>
          <BarChart data={waterfallData} margin={{ top: 10, right: 30, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" className="opacity-30" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmtNum(v)} />
            <Tooltip formatter={((v: number) => fmtCurrency(Math.abs(v)) + " AZN") as never} />
            {/* Phase 3.3 — Cell onClick fires drillToSection with the
                category name; auto-expands the table section + scrolls
                to it + briefly pulses the section header. cursor:pointer
                tells users the bars are clickable. */}
            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
              {waterfallData.map((entry, i) => (
                <Cell
                  key={i}
                  fill={entry.fill}
                  style={{ cursor: "pointer" }}
                  onClick={() => drillToSection(entry.name)}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* P&L Table */}
      <div className="rounded-xl border bg-card">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">P&L Statement — Detail</h3>
            {!hasActuals && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground border">
                No actuals imported - variance columns show no value
              </span>
            )}
          </div>
          <Badge variant="outline">{data.year}</Badge>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="sticky left-0 bg-muted/50 px-3 py-2.5 text-left font-semibold min-w-[220px]">Account</th>
                {MONTHS.map((m) => (
                  <th key={m} className="px-2 py-2.5 text-right font-semibold min-w-[80px]">{m}</th>
                ))}
                <th className="px-3 py-2.5 text-right font-bold min-w-[90px] bg-muted">Plan (Total)</th>
                <th className="px-3 py-2.5 text-right font-semibold min-w-[90px] bg-muted">Actual</th>
                <th className="px-3 py-2.5 text-right font-semibold min-w-[80px] bg-muted">Δ%</th>
              </tr>
            </thead>
            <tbody>
              {/* Revenue */}
              <tr
                id="pnl-section-revenue"
                className={`bg-emerald-50 dark:bg-emerald-950/30 font-semibold border-b cursor-pointer hover:bg-emerald-100 dark:hover:bg-emerald-950/40 transition-shadow ${flashSection === "revenue" ? "shadow-[inset_0_0_0_3px_rgb(16,185,129)]" : ""}`}
                onClick={() => toggleSection("revenue")}
              >
                <td className="sticky left-0 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 flex items-center gap-1">
                  {expandedSections.has("revenue") ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  Net Revenue
                </td>
                {Array.from({ length: 12 }, (_, i) => (
                  <td key={i} className="px-2 py-2 text-right text-emerald-700 dark:text-emerald-400 tabular-nums">
                    {fmtNum(monthlyRevenue?.[i + 1] || 0)}
                  </td>
                ))}
                <td className="px-3 py-2 text-right font-bold bg-muted text-emerald-700 dark:text-emerald-400 tabular-nums">
                  {fmtNum(totalRevenue)}
                </td>
                <td className={`px-3 py-2 text-right font-bold bg-muted/70 tabular-nums ${sectionActuals.revenue ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground/50"}`}>
                  {sectionActuals.revenue ? fmtNum(sectionActuals.revenue) : "—"}
                </td>
                <td className={`px-3 py-2 text-right font-semibold bg-muted/70 tabular-nums ${varianceClass(sectionActuals.revenue, totalRevenue, "up")}`}>
                  {varianceStr(sectionActuals.revenue, totalRevenue)}
                </td>
              </tr>
              {expandedSections.has("revenue") && renderSectionRows(revenueRows, "text-emerald-600", { favorable: "up" })}

              {/* COGS */}
              <tr
                id="pnl-section-cogs"
                className={`bg-red-50 dark:bg-red-950/30 font-semibold border-b cursor-pointer hover:bg-red-100 dark:hover:bg-red-950/40 transition-shadow ${flashSection === "cogs" ? "shadow-[inset_0_0_0_3px_rgb(239,68,68)]" : ""}`}
                onClick={() => toggleSection("cogs")}
              >
                <td className="sticky left-0 bg-red-50 dark:bg-red-950/30 px-3 py-2 flex items-center gap-1">
                  {expandedSections.has("cogs") ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  COGS
                </td>
                {Array.from({ length: 12 }, (_, i) => {
                  const val = Math.abs(monthlyCogs?.[i + 1] || 0)
                  const rev = monthlyRevenue?.[i + 1] || 0
                  return (
                    <td key={i} className="px-2 py-2 text-right text-red-700 dark:text-red-400 tabular-nums leading-tight">
                      <div>({fmtNum(val)})</div>
                      {val > 0 && rev > 0 && (
                        <div className="text-[10px] text-red-600/70 dark:text-red-400/60 font-normal">{pctOfRev(val, rev)}</div>
                      )}
                    </td>
                  )
                })}
                <td className="px-3 py-2 text-right font-bold bg-muted text-red-700 dark:text-red-400 tabular-nums leading-tight">
                  <div>({fmtNum(totalCogs)})</div>
                  {totalCogs > 0 && totalRevenue > 0 && (
                    <div className="text-[10px] text-red-600/70 dark:text-red-400/60 font-normal">{pctOfRev(totalCogs, totalRevenue)}</div>
                  )}
                </td>
                <td className={`px-3 py-2 text-right font-bold bg-muted/70 tabular-nums leading-tight ${sectionActuals.cogs ? "text-red-700 dark:text-red-400" : "text-muted-foreground/50"}`}>
                  <div>{sectionActuals.cogs ? `(${fmtNum(sectionActuals.cogs)})` : "—"}</div>
                  {sectionActuals.cogs > 0 && sectionActuals.revenue > 0 && (
                    <div className="text-[10px] text-red-600/70 dark:text-red-400/60 font-normal">{pctOfRev(sectionActuals.cogs, sectionActuals.revenue)}</div>
                  )}
                </td>
                <td className={`px-3 py-2 text-right font-semibold bg-muted/70 tabular-nums ${varianceClass(sectionActuals.cogs, totalCogs, "down")}`}>
                  {varianceStr(sectionActuals.cogs, totalCogs)}
                </td>
              </tr>
              {expandedSections.has("cogs") && renderSectionRows(cogsRows, "text-red-600")}

              {/* Gross Profit */}
              <tr
                id="pnl-section-gross-profit"
                className={`bg-blue-50 dark:bg-blue-950/30 font-bold border-b-2 border-blue-200 dark:border-blue-800 transition-shadow ${flashSection === "gross-profit" ? "shadow-[inset_0_0_0_3px_rgb(59,130,246)]" : ""}`}
              >
                <td className="sticky left-0 bg-blue-50 dark:bg-blue-950/30 px-3 py-2.5 pl-6">Gross Profit</td>
                {Array.from({ length: 12 }, (_, i) => {
                  const rev = monthlyRevenue?.[i + 1] || 0
                  const gp = rev + (monthlyCogs?.[i + 1] || 0)
                  return (
                    <td key={i} className="px-2 py-2.5 text-right text-blue-700 dark:text-blue-400 tabular-nums leading-tight">
                      <div>{fmtNum(gp)}</div>
                      {rev > 0 && (
                        <div className="text-[10px] text-blue-600/70 dark:text-blue-400/60 font-normal">
                          {((gp / rev) * 100).toFixed(1)}%
                        </div>
                      )}
                    </td>
                  )
                })}
                <td className="px-3 py-2.5 text-right font-bold bg-muted text-blue-700 dark:text-blue-400 tabular-nums leading-tight">
                  <div>{fmtNum(grossProfit)}</div>
                  {totalRevenue > 0 && (
                    <div className="text-[10px] text-blue-600/70 dark:text-blue-400/60 font-normal">
                      {grossMargin.toFixed(1)}%
                    </div>
                  )}
                </td>
                <td className={`px-3 py-2.5 text-right font-bold bg-muted/70 tabular-nums leading-tight ${actualGrossProfit || sectionActuals.revenue ? "text-blue-700 dark:text-blue-400" : "text-muted-foreground/50"}`}>
                  <div>{actualGrossProfit || sectionActuals.revenue ? fmtNum(actualGrossProfit) : "—"}</div>
                  {sectionActuals.revenue > 0 && (
                    <div className="text-[10px] text-blue-600/70 dark:text-blue-400/60 font-normal">
                      {((actualGrossProfit / sectionActuals.revenue) * 100).toFixed(1)}%
                    </div>
                  )}
                </td>
                <td className={`px-3 py-2.5 text-right font-semibold bg-muted/70 tabular-nums ${varianceClass(actualGrossProfit, grossProfit, "up")}`}>
                  {varianceStr(actualGrossProfit, grossProfit)}
                </td>
              </tr>

              {/* Operating Expenses */}
              <tr
                id="pnl-section-opex"
                className={`bg-amber-50 dark:bg-amber-950/30 font-semibold border-b cursor-pointer hover:bg-amber-100 dark:hover:bg-amber-950/40 transition-shadow ${flashSection === "opex" ? "shadow-[inset_0_0_0_3px_rgb(245,158,11)]" : ""}`}
                onClick={() => toggleSection("opex")}
              >
                <td className="sticky left-0 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 flex items-center gap-1">
                  {expandedSections.has("opex") ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  Operating Expenses
                </td>
                {Array.from({ length: 12 }, (_, i) => {
                  const monthOpex = Math.abs(opexRows.reduce((s: number, r: PnlRow) => s + (r.monthly[i + 1] || 0), 0))
                  const rev = monthlyRevenue?.[i + 1] || 0
                  return (
                    <td key={i} className="px-2 py-2 text-right text-amber-700 dark:text-amber-400 tabular-nums leading-tight">
                      <div>({fmtNum(monthOpex)})</div>
                      {monthOpex > 0 && rev > 0 && (
                        <div className="text-[10px] text-amber-600/70 dark:text-amber-400/60 font-normal">{pctOfRev(monthOpex, rev)}</div>
                      )}
                    </td>
                  )
                })}
                <td className="px-3 py-2 text-right font-bold bg-muted text-amber-700 dark:text-amber-400 tabular-nums leading-tight">
                  <div>({fmtNum(totalOpex)})</div>
                  {totalOpex > 0 && totalRevenue > 0 && (
                    <div className="text-[10px] text-amber-600/70 dark:text-amber-400/60 font-normal">{pctOfRev(totalOpex, totalRevenue)}</div>
                  )}
                </td>
                <td className={`px-3 py-2 text-right font-bold bg-muted/70 tabular-nums leading-tight ${sectionActuals.opex ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground/50"}`}>
                  <div>{sectionActuals.opex ? `(${fmtNum(sectionActuals.opex)})` : "—"}</div>
                  {sectionActuals.opex > 0 && sectionActuals.revenue > 0 && (
                    <div className="text-[10px] text-amber-600/70 dark:text-amber-400/60 font-normal">{pctOfRev(sectionActuals.opex, sectionActuals.revenue)}</div>
                  )}
                </td>
                <td className={`px-3 py-2 text-right font-semibold bg-muted/70 tabular-nums ${varianceClass(sectionActuals.opex, totalOpex, "down")}`}>
                  {varianceStr(sectionActuals.opex, totalOpex)}
                </td>
              </tr>
              {expandedSections.has("opex") && renderSectionRows(opexRows, "text-amber-600")}

              {/* EBITDA */}
              <tr
                id="pnl-section-ebitda"
                className={`font-bold border-t-2 transition-shadow ${ebitda >= 0 ? "bg-purple-50 dark:bg-purple-950/30 border-purple-200 dark:border-purple-800" : "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800"} ${flashSection === "ebitda" ? "shadow-[inset_0_0_0_3px_rgb(139,92,246)]" : ""}`}
              >
                <td className={`sticky left-0 px-3 py-2.5 pl-6 text-sm ${ebitda >= 0 ? "bg-purple-50 dark:bg-purple-950/30 text-purple-700 dark:text-purple-400" : "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400"}`}>
                  EBITDA
                </td>
                {Array.from({ length: 12 }, (_, i) => {
                  const rev = monthlyRevenue?.[i + 1] || 0
                  const cogs = monthlyCogs?.[i + 1] || 0 // already negative
                  // OpEx rows are stored as positive amounts, so we subtract them.
                  // (cogs is already negative, hence the + for that part.)
                  const monthOpex = Math.abs(opexRows.reduce((s: number, r: PnlRow) => s + (r.monthly[i + 1] || 0), 0))
                  const monthEbitda = rev + cogs - monthOpex
                  const pct = rev > 0 ? ((monthEbitda / rev) * 100).toFixed(1) + "%" : ""
                  return (
                    <td key={i} className={`px-2 py-2.5 text-right tabular-nums leading-tight ${monthEbitda >= 0 ? "text-purple-700 dark:text-purple-400" : "text-red-700 dark:text-red-400"}`}>
                      <div>{monthEbitda < 0 ? `(${fmtNum(Math.abs(monthEbitda))})` : fmtNum(monthEbitda)}</div>
                      {pct && (
                        <div className={`text-[10px] font-normal ${monthEbitda >= 0 ? "text-purple-600/70 dark:text-purple-400/60" : "text-red-600/70 dark:text-red-400/60"}`}>{pct}</div>
                      )}
                    </td>
                  )
                })}
                <td className={`px-3 py-2.5 text-right font-bold text-sm bg-muted tabular-nums leading-tight ${ebitda >= 0 ? "text-purple-700 dark:text-purple-400" : "text-red-700 dark:text-red-400"}`}>
                  <div>{ebitda < 0 ? `(${fmtNum(Math.abs(ebitda))})` : fmtNum(ebitda)}</div>
                  {totalRevenue > 0 && (
                    <div className={`text-[10px] font-normal ${ebitda >= 0 ? "text-purple-600/70 dark:text-purple-400/60" : "text-red-600/70 dark:text-red-400/60"}`}>{ebitdaMargin.toFixed(1)}%</div>
                  )}
                </td>
                <td className={`px-3 py-2.5 text-right font-bold text-sm bg-muted/70 tabular-nums leading-tight ${actualEbitda || sectionActuals.revenue ? (actualEbitda >= 0 ? "text-purple-700 dark:text-purple-400" : "text-red-700 dark:text-red-400") : "text-muted-foreground/50"}`}>
                  <div>
                    {actualEbitda || sectionActuals.revenue
                      ? (actualEbitda < 0 ? `(${fmtNum(Math.abs(actualEbitda))})` : fmtNum(actualEbitda))
                      : "—"}
                  </div>
                  {sectionActuals.revenue > 0 && (
                    <div className={`text-[10px] font-normal ${actualEbitda >= 0 ? "text-purple-600/70 dark:text-purple-400/60" : "text-red-600/70 dark:text-red-400/60"}`}>
                      {((actualEbitda / sectionActuals.revenue) * 100).toFixed(1)}%
                    </div>
                  )}
                </td>
                <td className={`px-3 py-2.5 text-right font-semibold bg-muted/70 tabular-nums ${varianceClass(actualEbitda, ebitda, "up")}`}>
                  {varianceStr(actualEbitda, ebitda)}
                </td>
              </tr>
              {/* D&A, Finance, Tax — below EBITDA items */}
              {belowEbitdaRows.length > 0 && (
                <tr
                  id="pnl-section-below-ebitda"
                  className={`bg-slate-50 dark:bg-slate-950/30 font-semibold border-b cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-950/40 transition-shadow ${flashSection === "below-ebitda" ? "shadow-[inset_0_0_0_3px_rgb(100,116,139)]" : ""}`}
                  onClick={() => toggleSection("below-ebitda")}
                >
                  <td className="sticky left-0 bg-slate-50 dark:bg-slate-950/30 px-3 py-2 flex items-center gap-1">
                    {expandedSections.has("below-ebitda") ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    D&A, Finance & Tax
                  </td>
                  {Array.from({ length: 12 }, (_, i) => {
                    const val = Math.abs(belowEbitdaRows.reduce((s: number, r: PnlRow) => s + (r.monthly[i + 1] || 0), 0))
                    const rev = monthlyRevenue?.[i + 1] || 0
                    return (
                      <td key={i} className="px-2 py-2 text-right text-slate-600 dark:text-slate-400 tabular-nums leading-tight">
                        <div>({fmtNum(val)})</div>
                        {val > 0 && rev > 0 && (
                          <div className="text-[10px] text-slate-500/80 dark:text-slate-400/60 font-normal">{pctOfRev(val, rev)}</div>
                        )}
                      </td>
                    )
                  })}
                  <td className="px-3 py-2 text-right font-bold bg-muted text-slate-600 dark:text-slate-400 tabular-nums leading-tight">
                    <div>({fmtNum(totalBelowEbitda)})</div>
                    {totalBelowEbitda > 0 && totalRevenue > 0 && (
                      <div className="text-[10px] text-slate-500/80 dark:text-slate-400/60 font-normal">{pctOfRev(totalBelowEbitda, totalRevenue)}</div>
                    )}
                  </td>
                  <td className={`px-3 py-2 text-right font-bold bg-muted/70 tabular-nums leading-tight ${sectionActuals.belowEbitda ? "text-slate-600 dark:text-slate-400" : "text-muted-foreground/50"}`}>
                    <div>{sectionActuals.belowEbitda ? `(${fmtNum(sectionActuals.belowEbitda)})` : "—"}</div>
                    {sectionActuals.belowEbitda > 0 && sectionActuals.revenue > 0 && (
                      <div className="text-[10px] text-slate-500/80 dark:text-slate-400/60 font-normal">{pctOfRev(sectionActuals.belowEbitda, sectionActuals.revenue)}</div>
                    )}
                  </td>
                  <td className={`px-3 py-2 text-right font-semibold bg-muted/70 tabular-nums ${varianceClass(sectionActuals.belowEbitda, totalBelowEbitda, "down")}`}>
                    {varianceStr(sectionActuals.belowEbitda, totalBelowEbitda)}
                  </td>
                </tr>
              )}
              {expandedSections.has("below-ebitda") && renderSectionRows(belowEbitdaRows, "text-slate-600")}

              {/* Net Profit */}
              <tr
                id="pnl-section-net-profit"
                className={`font-bold border-t-2 transition-shadow ${netProfit >= 0 ? "bg-emerald-100 dark:bg-emerald-950/40" : "bg-red-100 dark:bg-red-950/40"} ${flashSection === "net-profit" ? "shadow-[inset_0_0_0_3px_rgb(16,185,129)]" : ""}`}
              >
                <td className={`sticky left-0 px-3 py-3 pl-6 text-sm ${netProfit >= 0 ? "bg-emerald-100 dark:bg-emerald-950/40" : "bg-red-100 dark:bg-red-950/40"}`}>
                  Net Profit / (Loss)
                </td>
                {Array.from({ length: 12 }, (_, i) => {
                  const rev = monthlyRevenue?.[i + 1] || 0
                  const cogs = monthlyCogs?.[i + 1] || 0 // already negative
                  const monthOpex = Math.abs(opexRows.reduce((s: number, r: PnlRow) => s + (r.monthly[i + 1] || 0), 0))
                  const monthBelow = Math.abs(belowEbitdaRows.reduce((s: number, r: PnlRow) => s + (r.monthly[i + 1] || 0), 0))
                  const np = rev + cogs - monthOpex - monthBelow
                  const pct = rev > 0 ? ((np / rev) * 100).toFixed(1) + "%" : ""
                  return (
                    <td key={i} className={`px-2 py-3 text-right tabular-nums leading-tight ${np >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}>
                      <div>{np < 0 ? `(${fmtNum(Math.abs(np))})` : fmtNum(np)}</div>
                      {pct && (
                        <div className={`text-[10px] font-normal ${np >= 0 ? "text-emerald-600/70 dark:text-emerald-400/60" : "text-red-600/70 dark:text-red-400/60"}`}>{pct}</div>
                      )}
                    </td>
                  )
                })}
                <td className={`px-3 py-3 text-right font-bold text-sm bg-muted tabular-nums leading-tight ${netProfit >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}>
                  <div>{netProfit < 0 ? `(${fmtNum(Math.abs(netProfit))})` : fmtNum(netProfit)}</div>
                  {totalRevenue > 0 && (
                    <div className={`text-[10px] font-normal ${netProfit >= 0 ? "text-emerald-600/70 dark:text-emerald-400/60" : "text-red-600/70 dark:text-red-400/60"}`}>{netMargin.toFixed(1)}%</div>
                  )}
                </td>
                <td className={`px-3 py-3 text-right font-bold text-sm bg-muted/70 tabular-nums leading-tight ${actualNetProfit || sectionActuals.revenue ? (actualNetProfit >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400") : "text-muted-foreground/50"}`}>
                  <div>
                    {actualNetProfit || sectionActuals.revenue
                      ? (actualNetProfit < 0 ? `(${fmtNum(Math.abs(actualNetProfit))})` : fmtNum(actualNetProfit))
                      : "—"}
                  </div>
                  {sectionActuals.revenue > 0 && (
                    <div className={`text-[10px] font-normal ${actualNetProfit >= 0 ? "text-emerald-600/70 dark:text-emerald-400/60" : "text-red-600/70 dark:text-red-400/60"}`}>
                      {((actualNetProfit / sectionActuals.revenue) * 100).toFixed(1)}%
                    </div>
                  )}
                </td>
                <td className={`px-3 py-3 text-right font-semibold bg-muted/70 tabular-nums ${varianceClass(actualNetProfit, netProfit, "up")}`}>
                  {varianceStr(actualNetProfit, netProfit)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Phase 7.H Feature 5 — client-reported EBITDA reconciliation drawer.
          Mounted only when a specific company is selected (consolidated-org
          view doesn't have a meaningful single-EBITDA reconcile target). */}
      {companyId && (
        <ClientReconDrawer
          open={reconOpen}
          onOpenChange={setReconOpen}
          companyId={companyId}
          defaultPeriod={reconPeriod}
          systemEbitda={ebitda}
          contributors={contributors}
          canEdit={canEditRecon}
        />
      )}

      {/* Phase 3.3 — P&L row drill-down. Opens via row onClick. Shows
          12-month plan vs actual vs Δ for the clicked account.
          Phase 3.3 v1.2 — actualMonthly now wired from the /pnl route's
          actualMonthlyByKey map (keyed by accountCode::accountName).
          When no actuals exist for the clicked account, the panel
          shows zeros across all 12 months (variance = -planned per
          month, total Δ = -plannedTotal), making "we planned X but
          haven't spent anything yet" visually obvious. */}
      {drillRow && (
        <BudgetPnlDrillPanel
          row={drillRow}
          actualMonthly={
            actualMonthlyByKey[`${drillRow.accountCode}::${drillRow.accountName}`] ?? {}
          }
          monthlyRevenue={monthlyRevenue ?? {}}
          onClose={() => setDrillRow(null)}
        />
      )}
    </div>
  )
}
