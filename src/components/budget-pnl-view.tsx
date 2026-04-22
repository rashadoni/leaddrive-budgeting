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
import { TrendingUp, TrendingDown, DollarSign, Percent, BarChart2, ChevronDown, ChevronRight, ArrowUpRight, ArrowDownRight } from "lucide-react"

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function fmtNum(n: number): string {
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M"
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(1) + "K"
  return n.toFixed(0)
}

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)
}

/**
 * % of revenue for a single cost amount. Returns an empty string when the
 * denominator is zero or the amount is zero — we don't want "0.0%" clutter.
 */
function pctOfRev(amount: number, rev: number): string {
  if (!rev || !amount) return ""
  return ((Math.abs(amount) / Math.abs(rev)) * 100).toFixed(1) + "%"
}

/**
 * Plan-vs-actual variance % as a signed string. Returns "—" when plan is zero
 * (ratio is undefined). `favorable` decides the colour: for revenue "up" is
 * good (actual > plan outperforms), for costs "down" is good (actual < plan
 * means we spent less than budgeted).
 */
function varianceStr(actual: number, plan: number): string {
  if (!plan) return "—"
  const delta = ((actual - plan) / plan) * 100
  return (delta >= 0 ? "+" : "") + delta.toFixed(1) + "%"
}

function varianceClass(actual: number, plan: number, favorable: "up" | "down"): string {
  if (!plan || actual === plan) return "text-muted-foreground"
  const positive = actual > plan
  const good = favorable === "up" ? positive : !positive
  return good ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
}

interface PnlRow {
  accountCode: string
  accountName: string
  accountType: string
  parentCode: string | null
  monthly: Record<number, number>
  total: number
}

export function BudgetPnlView({ planId }: { planId: string }) {
  const { data: session } = useSession()
  const orgId = (session?.user as any)?.organizationId
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set())

  const { data, isLoading } = useQuery({
    queryKey: ["pnl", planId],
    queryFn: async () => {
      const res = await fetch(`/api/budgeting/pnl?planId=${planId}`, {
        headers: { "x-organization-id": orgId || "" },
      })
      return res.json()
    },
    enabled: !!planId && !!orgId,
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
  const sectionActuals = data.sectionActuals ?? { revenue: 0, cogs: 0, opex: 0, belowEbitda: 0 }
  const hasActuals: boolean = Boolean(data.hasActuals)

  // Calculate totals
  const totalRevenue = Object.values(monthlyRevenue || {}).reduce((s: number, v: any) => s + (v || 0), 0)
  const totalCogs = Math.abs(Object.values(monthlyCogs || {}).reduce((s: number, v: any) => s + (v || 0), 0))
  const grossProfit = totalRevenue - totalCogs
  const grossMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0

  // Operating expenses from rows — split by type for EBITDA calculation
  const allExpenseRows = rows.filter((r: PnlRow) => r.accountType === "expense" && r.total !== 0)
  // OpEx for EBITDA: only sales (711) + admin (721) expenses — NOT depreciation, finance, tax
  const opexRows = allExpenseRows.filter((r: PnlRow) => {
    const code = r.accountCode
    return code.startsWith("711") || code.startsWith("721") ||
      (!code.startsWith("731") && !code.startsWith("741") && !code.startsWith("751") &&
       !code.startsWith("761") && !code.startsWith("771") && !code.startsWith("801"))
  })
  // Below-EBITDA items: depreciation, finance costs, extraordinary, tax
  const depreciationRows = allExpenseRows.filter((r: PnlRow) => r.accountCode.startsWith("731"))
  const belowEbitdaRows = allExpenseRows.filter((r: PnlRow) => {
    const code = r.accountCode
    return code.startsWith("731") || code.startsWith("741") || code.startsWith("751") ||
      code.startsWith("761") || code.startsWith("771") || code.startsWith("801")
  })

  const totalOpex = Math.abs(opexRows.reduce((s: number, r: PnlRow) => s + r.total, 0))
  const totalBelowEbitda = Math.abs(belowEbitdaRows.reduce((s: number, r: PnlRow) => s + r.total, 0))
  const ebitda = grossProfit - totalOpex
  const ebitdaMargin = totalRevenue > 0 ? (ebitda / totalRevenue) * 100 : 0
  const netProfit = grossProfit - totalOpex - totalBelowEbitda
  const netMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0

  // Derived actual equivalents — match the plan-side formulas so the
  // Actual column keeps meaning for computed rows (Gross Profit, EBITDA, Net).
  const actualGrossProfit = sectionActuals.revenue - sectionActuals.cogs
  const actualEbitda = actualGrossProfit - sectionActuals.opex
  const actualNetProfit = actualEbitda - sectionActuals.belowEbitda

  // Chart data
  const chartData = MONTHS.map((m, i) => {
    const rev = monthlyRevenue?.[i + 1] || 0
    const cogs = Math.abs(monthlyCogs?.[i + 1] || 0)
    const gp = rev - cogs
    return { month: m, Revenue: rev, COGS: cogs, "Gross Profit": gp }
  })

  // Margin trend data (gross + EBITDA + net)
  const marginData = MONTHS.map((m, i) => {
    const rev = monthlyRevenue?.[i + 1] || 0
    const cogs = Math.abs(monthlyCogs?.[i + 1] || 0)
    const monthOpex = Math.abs(opexRows.reduce((s: number, r: PnlRow) => s + (r.monthly[i + 1] || 0), 0))
    const monthBelowEbitda = Math.abs(belowEbitdaRows.reduce((s: number, r: PnlRow) => s + (r.monthly[i + 1] || 0), 0))
    const gm = rev > 0 ? ((rev - cogs) / rev) * 100 : 0
    const em = rev > 0 ? ((rev - cogs - monthOpex) / rev) * 100 : 0
    const nm = rev > 0 ? ((rev - cogs - monthOpex - monthBelowEbitda) / rev) * 100 : 0
    return { month: m, "Gross Margin": Math.round(gm * 10) / 10, "EBITDA Margin": Math.round(em * 10) / 10, "Net Margin": Math.round(nm * 10) / 10 }
  })

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
    return sectionRows.map((row: PnlRow) => {
      const isParent = !row.parentCode
      const rowKey = `${row.accountCode}::${row.accountName}`
      const actual = actualByKey[rowKey] || 0
      return (
        <tr key={rowKey} className={`border-b hover:bg-muted/30 ${isParent ? "font-medium" : "text-muted-foreground"}`}>
          <td className="sticky left-0 bg-card px-3 py-1.5 text-xs">
            <span className="text-[10px] text-muted-foreground/60 mr-2 font-mono">{row.accountCode}</span>
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
        {/* Revenue */}
        <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-indigo-50 to-indigo-100 border border-indigo-200 dark:from-indigo-950/30 dark:to-indigo-900/20 dark:border-indigo-800 p-4">
          <div className="absolute top-0 right-0 w-20 h-20 bg-indigo-200 dark:bg-indigo-800 rounded-full -mr-6 -mt-6" />
          <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 text-[10px] font-semibold uppercase tracking-widest mb-2">
            <TrendingUp className="h-3.5 w-3.5" /> Net Revenue
          </div>
          <p className="text-2xl font-bold tracking-tight text-indigo-700 dark:text-indigo-300">{fmtNum(totalRevenue)} <span className="text-sm font-normal text-muted-foreground">AZN</span></p>
          <p className="text-[10px] text-muted-foreground mt-1">Annual budget</p>
        </div>

        {/* COGS */}
        <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-cyan-50 to-cyan-100 border border-cyan-200 dark:from-cyan-950/30 dark:to-cyan-900/20 dark:border-cyan-800 p-4">
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
        <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-emerald-50 to-emerald-100 border border-emerald-200 dark:from-emerald-950/30 dark:to-emerald-900/20 dark:border-emerald-800 p-4">
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
        <div className={`relative overflow-hidden rounded-xl p-4 ${
          ebitda >= 0
            ? "bg-gradient-to-br from-purple-50 to-purple-100 border border-purple-200 dark:from-purple-950/30 dark:to-purple-900/20 dark:border-purple-800"
            : "bg-gradient-to-br from-red-50 to-red-100 border border-red-200 dark:from-red-950/30 dark:to-red-900/20 dark:border-red-800"
        }`}>
          <div className={`absolute top-0 right-0 w-20 h-20 rounded-full -mr-6 -mt-6 ${ebitda >= 0 ? "bg-purple-200 dark:bg-purple-800" : "bg-red-200 dark:bg-red-800"}`} />
          <div className={`flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest mb-2 ${ebitda >= 0 ? "text-purple-600 dark:text-purple-400" : "text-red-600 dark:text-red-400"}`}>
            <BarChart2 className="h-3.5 w-3.5" /> EBITDA
          </div>
          <p className={`text-2xl font-bold tracking-tight ${ebitda >= 0 ? "text-purple-700 dark:text-purple-300" : "text-red-700 dark:text-red-300"}`}>
            {ebitda < 0 && "("}{fmtNum(Math.abs(ebitda))}{ebitda < 0 && ")"} <span className="text-sm font-normal text-muted-foreground">AZN</span>
          </p>
          <div className="flex items-center gap-1 mt-1">
            {ebitda >= 0 ? <ArrowUpRight className="h-3 w-3 text-purple-600 dark:text-purple-400" /> : <ArrowDownRight className="h-3 w-3 text-red-600 dark:text-red-400" />}
            <span className={`text-[10px] font-medium ${ebitda >= 0 ? "text-purple-600 dark:text-purple-400" : "text-red-600 dark:text-red-400"}`}>{ebitdaMargin.toFixed(1)}%</span>
            <span className="text-[10px] text-muted-foreground">margin</span>
          </div>
        </div>

        {/* Net Profit */}
        <div className={`relative overflow-hidden rounded-xl p-4 ${
          netProfit >= 0
            ? "bg-gradient-to-br from-emerald-50 to-emerald-100 border border-emerald-200 dark:from-emerald-950/30 dark:to-emerald-900/20 dark:border-emerald-800"
            : "bg-gradient-to-br from-red-50 to-red-100 border border-red-200 dark:from-red-950/30 dark:to-red-900/20 dark:border-red-800"
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

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Revenue vs COGS */}
        <div className="lg:col-span-2 rounded-xl border bg-card p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">Revenue vs COGS — Monthly</h3>
          <ResponsiveContainer width="100%" height={280}>
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

        {/* Margin Trends — now with both Gross and Net */}
        <div className="rounded-xl border bg-card p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">Margin Trends</h3>
          <ResponsiveContainer width="100%" height={280}>
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
        </div>
      </div>

      {/* Waterfall Chart */}
      <div className="rounded-xl border bg-card p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3">P&L Waterfall</h3>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={waterfallData} margin={{ top: 10, right: 30, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" className="opacity-30" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmtNum(v)} />
            <Tooltip formatter={((v: number) => fmtCurrency(Math.abs(v)) + " AZN") as never} />
            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
              {waterfallData.map((entry, i) => (
                <Cell key={i} fill={entry.fill} />
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
                No actuals imported — Δ% columns show "—"
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
                className="bg-emerald-50 dark:bg-emerald-950/30 font-semibold border-b cursor-pointer hover:bg-emerald-100 dark:hover:bg-emerald-950/40"
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
                className="bg-red-50 dark:bg-red-950/30 font-semibold border-b cursor-pointer hover:bg-red-100 dark:hover:bg-red-950/40"
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
              <tr className="bg-blue-50 dark:bg-blue-950/30 font-bold border-b-2 border-blue-200 dark:border-blue-800">
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
                className="bg-amber-50 dark:bg-amber-950/30 font-semibold border-b cursor-pointer hover:bg-amber-100 dark:hover:bg-amber-950/40"
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
              <tr className={`font-bold border-t-2 ${ebitda >= 0 ? "bg-purple-50 dark:bg-purple-950/30 border-purple-200 dark:border-purple-800" : "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800"}`}>
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
                  className="bg-slate-50 dark:bg-slate-950/30 font-semibold border-b cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-950/40"
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
              <tr className={`font-bold border-t-2 ${netProfit >= 0 ? "bg-emerald-100 dark:bg-emerald-950/40" : "bg-red-100 dark:bg-red-950/40"}`}>
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
    </div>
  )
}
