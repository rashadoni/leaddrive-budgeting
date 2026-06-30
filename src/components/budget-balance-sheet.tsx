"use client"

import { useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area,
} from "recharts"
import { Scale, TrendingUp, Landmark, Wallet, ChevronDown, ChevronRight, ArrowUpRight, ArrowDownRight, Upload } from "lucide-react"

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function fmtNum(n: number): string {
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M"
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(1) + "K"
  return n.toFixed(0)
}

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)
}

interface BSLine {
  id: string
  // `accountCode`/`accountName` scalars were dropped in Phase 2.1 (2026-05-26);
  // the route now includes the related account. Keep the old fields optional
  // for any legacy payload, but prefer `account.*` for labels.
  accountCode?: string | null
  accountName?: string | null
  account?: { code: string | null; name: string | null } | null
  lineType: string
  month: number
  amount: number
}

interface BSResponse {
  assets: BSLine[]
  liabilities: BSLine[]
  equity: BSLine[]
  all: BSLine[]
  // Provenance (2026-06-04): when the selected plan is a budget plan (P&L-only),
  // the balance sheet is read from the matching-year Actuals plan. `fellBack`
  // drives the "showing the <year> Actuals balance sheet" note.
  meta?: {
    requestedPlanId: string
    sourcePlanId: string
    fellBack: boolean
    sourceYear: number | null
    // Consolidated-holding view (2026-06-23): when true, the figures are the
    // client's OFFICIAL consolidated balance sheet on the holding entity (not a
    // naive cross-company sum that double-counts intercompany holdings).
    consolidated?: boolean
    holding?: { id: string; name: string; code: string } | null
    viewCompanyId?: string | null
  }
}

function getSectionData(lines: BSLine[]) {
  const grouped = new Map<string, Record<number, number>>()
  // Per-(label, month) line id for inline edit. `ambiguous` when >1 line maps
  // to the same cell (summed) — those cells stay read-only (no single target).
  const cellIds = new Map<string, Record<number, { id: string; ambiguous: boolean }>>()
  lines.forEach((l) => {
    // accountName/accountCode scalars dropped Phase 2.1 — label from the
    // included account relation, with legacy-scalar + "—" fallbacks.
    const label = l.account?.name ?? l.account?.code ?? l.accountName ?? l.accountCode ?? "—"
    if (!grouped.has(label)) {
      grouped.set(label, {})
      cellIds.set(label, {})
    }
    grouped.get(label)![l.month] = (grouped.get(label)![l.month] || 0) + l.amount
    const ci = cellIds.get(label)!
    ci[l.month] = ci[l.month] ? { id: ci[l.month].id, ambiguous: true } : { id: l.id, ambiguous: false }
  })

  const sectionTotals: Record<number, number> = {}
  for (let m = 1; m <= 12; m++) {
    sectionTotals[m] = lines.filter(l => l.month === m).reduce((s, l) => s + l.amount, 0)
  }

  return { grouped, sectionTotals, cellIds }
}

export function BudgetBalanceSheet({ planId }: { planId: string }) {
  const { data: session } = useSession()
  const router = useRouter()
  const orgId = session?.user?.organizationId
  const role = session?.user?.role
  const canEdit = role === "manager" || role === "admin"
  const queryClient = useQueryClient()
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(["assets", "liabilities", "equity"]))
  const [saveError, setSaveError] = useState<string | null>(null)

  // Inline-edit a single BS line's amount (Phase 3). PUT → refetch on success.
  const saveCell = async (id: string, amount: number) => {
    setSaveError(null)
    try {
      const res = await fetch(`/api/budgeting/balance-sheet/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-organization-id": orgId || "" },
        body: JSON.stringify({ amount }),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => null)
        throw new Error(b?.error ?? `HTTP ${res.status}`)
      }
      queryClient.invalidateQueries({ queryKey: ["balanceSheet", planId] })
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e))
    }
  }

  const { data, isLoading } = useQuery<BSResponse>({
    queryKey: ["balanceSheet", planId],
    queryFn: async (): Promise<BSResponse> => {
      const res = await fetch(`/api/budgeting/balance-sheet?planId=${planId}`, {
        headers: { "x-organization-id": orgId || "" },
      })
      return (await res.json()) as BSResponse
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
        <div className="h-72 rounded-xl bg-muted/50 animate-pulse" />
      </div>
    )
  }

  if (!data?.all || data.all.length === 0) {
    return (
      <Card>
        <CardContent className="p-12 text-center">
          <Scale className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium text-foreground">No Balance Sheet rows in this plan</p>
          <p className="mx-auto mt-1 max-w-xl text-sm text-muted-foreground">
            The selected plan has imported P&L rows, but no balance-sheet rows were written yet. Upload a workbook sheet that AI classifies as Balance Sheet to populate assets, liabilities, and equity.
          </p>
          <Button className="mt-5" onClick={() => router.push("/budgeting/admin/ai-import")}>
            <Upload className="h-4 w-4 mr-1" /> Import Excel data
          </Button>
        </CardContent>
      </Card>
    )
  }

  const assetsData = getSectionData(data.assets || [])
  const liabilitiesData = getSectionData(data.liabilities || [])
  const equityData = getSectionData(data.equity || [])

  // Latest month that actually has data. Partial-year actuals stop at the
  // reporting period (e.g. a March cut only carries Jan–Apr), so December is
  // empty until year-end — don't hardcode 12 or the headline reads 0.
  const latestMonth = (() => {
    for (let m = 12; m >= 1; m--) {
      if (
        (assetsData.sectionTotals[m] || 0) !== 0 ||
        (liabilitiesData.sectionTotals[m] || 0) !== 0 ||
        (equityData.sectionTotals[m] || 0) !== 0
      ) {
        return m
      }
    }
    return 12
  })()
  const latestMonthLabel = MONTHS[latestMonth - 1]
  const totalAssets = assetsData.sectionTotals[latestMonth] || 0
  const totalLiabilities = Math.abs(liabilitiesData.sectionTotals[latestMonth] || 0)
  // Equity is stored as a credit (trial-balance negative: Assets = Liab + Equity
  // sums to ~0). Negate to present it in normal sign — positive = healthy,
  // negative = genuine accumulated loss. (Display only; stored sign untouched.)
  const totalEquity = -(equityData.sectionTotals[latestMonth] || 0)
  const debtToEquity = totalEquity !== 0 ? (totalLiabilities / Math.abs(totalEquity)) : 0

  // Trend: Assets growth from Jan to the latest populated month
  const janAssets = assetsData.sectionTotals[1] || 0
  const assetGrowth = janAssets !== 0 ? ((totalAssets - janAssets) / Math.abs(janAssets)) * 100 : 0

  // Chart: Assets vs Liabilities+Equity monthly
  const structureData = MONTHS.map((m, i) => ({
    month: m,
    Assets: assetsData.sectionTotals[i + 1] || 0,
    Liabilities: Math.abs(liabilitiesData.sectionTotals[i + 1] || 0),
    Equity: -(equityData.sectionTotals[i + 1] || 0),
  }))

  // Asset composition donut (Dec values, top accounts)
  const assetAccounts = Array.from(assetsData.grouped.entries()).map(([name, months]) => ({
    name,
    value: Math.abs(months[latestMonth] || 0),
  })).filter(a => a.value > 0).sort((a, b) => b.value - a.value).slice(0, 6)

  const DONUT_COLORS = ["#3b82f6", "#06b6d4", "#8b5cf6", "#10b981", "#f59e0b", "#ec4899"]

  const toggleSection = (key: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const renderSection = (
    key: string,
    title: string,
    sectionData: ReturnType<typeof getSectionData>,
    colorClass: string,
    bgClass: string,
  ) => {
    const isExpanded = expandedSections.has(key)
    const sectionGrandTotal = Object.values(sectionData.sectionTotals).reduce((s, v) => s + v, 0)

    return (
      <>
        {/* Section Header */}
        <tr
          className={`border-b cursor-pointer hover:brightness-95 transition-all ${bgClass}`}
          onClick={() => toggleSection(key)}
        >
          <td className={`sticky left-0 z-10 ${bgClass} px-3 py-2.5 text-xs font-bold uppercase tracking-wide ${colorClass} flex items-center gap-1`}>
            {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            {title}
          </td>
          {MONTHS.map((_, i) => (
            <td key={i} className={`px-2 py-2.5 text-xs text-right tabular-nums font-semibold whitespace-nowrap ${colorClass}`}>
              {fmtNum(sectionData.sectionTotals[i + 1] || 0)}
            </td>
          ))}
        </tr>

        {/* Detail Rows */}
        {isExpanded && Array.from(sectionData.grouped.entries()).map(([name, months]) => (
          <tr key={name} className="border-b hover:bg-muted/30">
            <td className="sticky left-0 z-10 bg-card px-3 py-1.5 text-xs whitespace-nowrap pl-8">{name}</td>
            {MONTHS.map((_, i) => {
              const month = i + 1
              const val = months[month]
              const cell = sectionData.cellIds.get(name)?.[month]
              const editable = canEdit && cell && !cell.ambiguous
              return (
                <td key={i} className={`px-2 py-1.5 text-xs text-right tabular-nums whitespace-nowrap ${val && val < 0 ? "text-red-600 dark:text-red-400" : ""}`}>
                  {editable ? (
                    <input
                      key={`${cell!.id}-${val ?? 0}`}
                      type="number"
                      defaultValue={val ?? 0}
                      title="Изменить и снять фокус — сохранится"
                      className="w-20 bg-transparent text-right border border-transparent hover:border-border focus:border-emerald-500 focus:outline-none rounded px-1 tabular-nums"
                      onBlur={(e) => {
                        const next = parseFloat(e.target.value)
                        if (!Number.isFinite(next) || next === (val ?? 0)) return
                        void saveCell(cell!.id, next)
                      }}
                    />
                  ) : val != null ? (
                    fmtNum(val)
                  ) : (
                    "—"
                  )}
                </td>
              )
            })}
          </tr>
        ))}
      </>
    )
  }

  return (
    <div className="space-y-4">
      {/* Provenance note: a budget plan carries only the P&L, so its balance
          sheet is read from the matching-year Actuals plan. Tell the user so
          the data doesn't look like it's "from" the budget plan. */}
      {data.meta?.fellBack && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          Showing the{data.meta.sourceYear ? ` ${data.meta.sourceYear}` : ""} Actuals balance sheet — the selected budget plan has no balance sheet of its own.
        </div>
      )}
      {data.meta?.consolidated && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
          📊 Официальный консолидированный баланс группы
          {data.meta.holding?.name ? ` «${data.meta.holding.name}»` : ""} — с
          элиминацией внутригрупповых долей (источник: Reporting). Это НЕ простая
          сумма компаний. Разбивку по компаниям смотрите в drill-down.
        </div>
      )}
      {canEdit && (
        <div className="text-[11px] text-muted-foreground">
          ✎ Значения в детальной таблице ниже можно править — измените ячейку и снимите фокус (сохраняется автоматически).
        </div>
      )}
      {saveError && (
        <div className="rounded-lg border border-red-500/40 bg-red-50 dark:bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
          ❌ Не сохранено: {saveError}
        </div>
      )}
      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-blue-50 to-blue-100 border border-blue-200 dark:from-blue-950/30 dark:to-blue-900/20 dark:border-blue-800 p-4">
          <div className="absolute top-0 right-0 w-20 h-20 bg-blue-200 dark:bg-blue-800 rounded-full -mr-6 -mt-6" />
          <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 text-[10px] font-semibold uppercase tracking-widest mb-2">
            <TrendingUp className="h-3.5 w-3.5" /> Total Assets
          </div>
          <p className="text-2xl font-bold tracking-tight text-blue-700 dark:text-blue-300">{fmtNum(totalAssets)} <span className="text-sm font-normal text-muted-foreground">AZN</span></p>
          <div className="flex items-center gap-1 mt-1">
            {assetGrowth >= 0 ? <ArrowUpRight className="h-3 w-3 text-emerald-600 dark:text-emerald-400" /> : <ArrowDownRight className="h-3 w-3 text-red-600 dark:text-red-400" />}
            <span className={`text-[10px] font-medium ${assetGrowth >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>{assetGrowth.toFixed(1)}%</span>
            <span className="text-[10px] text-muted-foreground">Jan→{latestMonthLabel}</span>
          </div>
        </div>

        <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-orange-50 to-orange-100 border border-orange-200 dark:from-orange-950/30 dark:to-orange-900/20 dark:border-orange-800 p-4">
          <div className="absolute top-0 right-0 w-20 h-20 bg-orange-200 dark:bg-orange-800 rounded-full -mr-6 -mt-6" />
          <div className="flex items-center gap-2 text-orange-600 dark:text-orange-400 text-[10px] font-semibold uppercase tracking-widest mb-2">
            <Landmark className="h-3.5 w-3.5" /> Total Liabilities
          </div>
          <p className="text-2xl font-bold tracking-tight text-orange-700 dark:text-orange-300">{fmtNum(totalLiabilities)} <span className="text-sm font-normal text-muted-foreground">AZN</span></p>
          <p className="text-[10px] text-muted-foreground mt-1">{latestMonthLabel} {new Date().getFullYear()}</p>
        </div>

        <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-emerald-50 to-emerald-100 border border-emerald-200 dark:from-emerald-950/30 dark:to-emerald-900/20 dark:border-emerald-800 p-4">
          <div className="absolute top-0 right-0 w-20 h-20 bg-emerald-200 dark:bg-emerald-800 rounded-full -mr-6 -mt-6" />
          <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-[10px] font-semibold uppercase tracking-widest mb-2">
            <Wallet className="h-3.5 w-3.5" /> Total Equity
          </div>
          <p className={`text-2xl font-bold tracking-tight ${totalEquity < 0 ? "text-red-700 dark:text-red-300" : "text-emerald-700 dark:text-emerald-300"}`}>
            {totalEquity < 0 && "("}{fmtNum(Math.abs(totalEquity))}{totalEquity < 0 && ")"} <span className="text-sm font-normal text-muted-foreground">AZN</span>
          </p>
          <p className="text-[10px] text-muted-foreground mt-1">Shareholders equity</p>
        </div>

        <div className={`relative overflow-hidden rounded-xl p-4 ${
          debtToEquity <= 2
            ? "bg-gradient-to-br from-emerald-50 to-emerald-100 border border-emerald-200 dark:from-emerald-950/30 dark:to-emerald-900/20 dark:border-emerald-800"
            : "bg-gradient-to-br from-amber-50 to-amber-100 border border-amber-200 dark:from-amber-950/30 dark:to-amber-900/20 dark:border-amber-800"
        }`}>
          <div className={`absolute top-0 right-0 w-20 h-20 rounded-full -mr-6 -mt-6 ${debtToEquity <= 2 ? "bg-emerald-200 dark:bg-emerald-800" : "bg-amber-200 dark:bg-amber-800"}`} />
          <div className={`flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest mb-2 ${debtToEquity <= 2 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
            <Scale className="h-3.5 w-3.5" /> D/E Ratio
          </div>
          <p className={`text-2xl font-bold tracking-tight ${debtToEquity <= 2 ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}`}>{debtToEquity.toFixed(2)}x</p>
          <p className="text-[10px] text-muted-foreground mt-1">Debt to Equity</p>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Structure Chart */}
        <div className="lg:col-span-3 rounded-xl border bg-card p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">Balance Sheet Structure — Monthly</h3>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={structureData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmtNum(v)} />
              <Tooltip formatter={((v: number) => fmtCurrency(Math.abs(v)) + " AZN") as never} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="Assets" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.15} strokeWidth={2} />
              <Area type="monotone" dataKey="Liabilities" stroke="#ef4444" fill="#ef4444" fillOpacity={0.1} strokeWidth={2} />
              <Area type="monotone" dataKey="Equity" stroke="#10b981" fill="#10b981" fillOpacity={0.1} strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Asset Composition Donut */}
        <div className="lg:col-span-2 rounded-xl border bg-card p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">Asset Composition ({latestMonthLabel})</h3>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={assetAccounts} cx="50%" cy="50%" outerRadius={75} innerRadius={45} paddingAngle={2} dataKey="value" stroke="none">
                {assetAccounts.map((_, i) => (
                  <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={((v: number) => fmtCurrency(v) + " AZN") as never} />
            </PieChart>
          </ResponsiveContainer>
          <div className="grid grid-cols-1 gap-y-1 mt-2">
            {assetAccounts.map((entry, i) => {
              const pct = totalAssets > 0 ? ((entry.value / totalAssets) * 100).toFixed(1) : "0"
              return (
                <div key={i} className="flex items-center gap-1.5 text-[10px]">
                  <div className="h-2 w-2 rounded-sm shrink-0" style={{ backgroundColor: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                  <span className="text-muted-foreground truncate">{entry.name}</span>
                  <span className="ml-auto font-semibold tabular-nums text-foreground">{pct}%</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Balance Sheet Table */}
      <div className="rounded-xl border bg-card">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="text-sm font-semibold text-foreground">Balance Sheet — Detail</h3>
          <Badge variant="outline" className="text-[10px]">{data.all.length} line items</Badge>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="sticky left-0 z-10 bg-muted/50 px-3 py-2.5 text-left font-semibold whitespace-nowrap min-w-[260px]">Account</th>
                {MONTHS.map((m) => (
                  <th key={m} className="px-2 py-2.5 text-right font-semibold whitespace-nowrap min-w-[75px]">{m}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {renderSection("assets", "Assets", assetsData, "text-blue-700 dark:text-blue-400", "bg-blue-50 dark:bg-blue-950/30")}
              {renderSection("liabilities", "Liabilities", liabilitiesData, "text-red-700 dark:text-red-400", "bg-red-50 dark:bg-red-950/30")}
              {renderSection("equity", "Equity", equityData, "text-emerald-700 dark:text-emerald-400", "bg-emerald-50 dark:bg-emerald-950/30")}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
