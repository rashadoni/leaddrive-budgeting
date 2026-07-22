"use client"

import { useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  getBalanceSheetSectionData,
  getLatestBalanceSheetEvidenceMonth,
  normalizeBalanceSheetMonth,
  type BalanceSheetEvidenceLine,
  type BalanceSheetSectionData,
} from "@/lib/budgeting/balance-sheet-evidence"
import {
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area,
} from "recharts"
import { Scale, TrendingUp, Landmark, Wallet, ChevronDown, ChevronRight, ArrowUpRight, ArrowDownRight, Upload } from "lucide-react"

const MONTH_KEYS = ["monthJan", "monthFeb", "monthMar", "monthApr", "monthMay", "monthJun", "monthJul", "monthAug", "monthSep", "monthOct", "monthNov", "monthDec"] as const

function fmtNum(n: number, locale: string): string {
  if (Math.abs(n) >= 1_000_000) {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(n / 1_000_000)}M`
  }
  if (Math.abs(n) >= 1_000) {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(n / 1_000)}K`
  }
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(n)
}

function fmtCurrency(n: number, locale: string): string {
  return new Intl.NumberFormat(locale, { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)
}

interface BSResponse {
  assets: BalanceSheetEvidenceLine[]
  liabilities: BalanceSheetEvidenceLine[]
  equity: BalanceSheetEvidenceLine[]
  all: BalanceSheetEvidenceLine[]
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
    currencyCode?: string | null
  }
}

export function BudgetBalanceSheet({ planId }: { planId: string }) {
  const { data: session } = useSession()
  const router = useRouter()
  const orgId = session?.user?.organizationId
  const role = session?.user?.role
  const canEdit = role === "manager" || role === "admin"
  const queryClient = useQueryClient()
  const locale = useLocale()
  const t = useTranslations("budgeting")
  const monthLabel = (month: number) => t(MONTH_KEYS[month - 1])
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

  const { data, isLoading, error } = useQuery<BSResponse>({
    queryKey: ["balanceSheet", planId],
    queryFn: async (): Promise<BSResponse> => {
      const res = await fetch(`/api/budgeting/balance-sheet?planId=${planId}`, {
        headers: { "x-organization-id": orgId || "" },
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      return (await res.json()) as BSResponse
    },
    enabled: !!planId && !!orgId,
  })

  if (isLoading) {
    return (
      <div className="space-y-4" data-testid="balance-sheet-loading">
        <div className="grid grid-cols-4 gap-3">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-24 rounded-xl bg-muted/50 animate-pulse" />
          ))}
        </div>
        <div className="h-72 rounded-xl bg-muted/50 animate-pulse" />
      </div>
    )
  }

  if (error) {
    return (
      <Card data-testid="balance-sheet-error">
        <CardContent className="p-12 text-center">
          <Scale className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium text-foreground">{t("balanceSheetErrorTitle")}</p>
          <p className="mx-auto mt-1 max-w-xl text-sm text-muted-foreground">
            {t("balanceSheetErrorDescription")}
          </p>
        </CardContent>
      </Card>
    )
  }

  if (!data?.all || data.all.length === 0) {
    return (
      <Card data-testid="balance-sheet-empty">
        <CardContent className="p-12 text-center">
          <Scale className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium text-foreground">{t("balanceSheetEmptyTitle")}</p>
          <p className="mx-auto mt-1 max-w-xl text-sm text-muted-foreground">
            {t("balanceSheetEmptyDescription")}
          </p>
          <Button data-testid="balance-sheet-import" className="mt-5" onClick={() => router.push("/budgeting/admin/ai-import")}>
            <Upload className="h-4 w-4 mr-1" /> {t("balanceSheetImport")}
          </Button>
        </CardContent>
      </Card>
    )
  }

  const assetsData = getBalanceSheetSectionData(data.assets || [])
  const liabilitiesData = getBalanceSheetSectionData(data.liabilities || [])
  const equityData = getBalanceSheetSectionData(data.equity || [])

  // Latest month that actually has data. Partial-year actuals stop at the
  // reporting period (e.g. a March cut only carries Jan–Apr), so December is
  // empty until year-end — don't hardcode 12 or the headline reads 0.
  const latestMonth = getLatestBalanceSheetEvidenceMonth(assetsData, liabilitiesData, equityData) ?? 12
  const latestMonthLabel = monthLabel(latestMonth)
  const asOfYear = data.meta?.sourceYear ?? "—"
  const currencyCode = data.meta?.currencyCode ?? null
  const currencySuffix = currencyCode ? ` ${currencyCode}` : ""
  const latestTotals = normalizeBalanceSheetMonth(
    assetsData,
    liabilitiesData,
    equityData,
    latestMonth,
  )
  const totalAssets = latestTotals.assets
  const totalLiabilities = latestTotals.liabilities
  const totalEquity = latestTotals.equity
  const debtToEquity =
    totalLiabilities !== null && totalEquity !== null && totalEquity > 0
      ? totalLiabilities / totalEquity
      : null

  // Trend: Assets growth from Jan to the latest populated month
  const janAssets = assetsData.sectionTotals[1]
  const assetGrowth =
    totalAssets !== null && assetsData.sectionCounts[1] > 0 && janAssets !== 0
      ? ((totalAssets - janAssets) / Math.abs(janAssets)) * 100
      : null

  // Chart: Assets vs Liabilities+Equity monthly
  const structureData = MONTH_KEYS.slice(0, latestMonth).map((_, index) => {
    const month = index + 1
    return { month: monthLabel(month), ...normalizeBalanceSheetMonth(assetsData, liabilitiesData, equityData, month) }
  })

  // Asset composition donut (Dec values, top accounts)
  const assetAccounts = Array.from(assetsData.grouped.entries()).map(([name, months]) => ({
    name,
    value: Math.abs(months[latestMonth] || 0),
  })).filter(a => a.value > 0).sort((a, b) => b.value - a.value).slice(0, 6)
  const accountCount =
    assetsData.grouped.size + liabilitiesData.grouped.size + equityData.grouped.size

  const DONUT_COLORS = ["#3b82f6", "#06b6d4", "#8b5cf6", "#10b981", "#f59e0b", "#ec4899"]

  const toggleSection = (key: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const renderSection = (
    key: "assets" | "liabilities" | "equity",
    title: string,
    sectionData: BalanceSheetSectionData,
    colorClass: string,
    bgClass: string,
  ) => {
    const isExpanded = expandedSections.has(key)
    return (
      <>
        {/* Section Header */}
        <tr className={`border-b hover:brightness-95 transition-all ${bgClass}`}>
          <td className={`sticky left-0 z-10 ${bgClass} px-3 py-2.5 text-xs font-bold uppercase tracking-wide ${colorClass}`}>
            <button
              type="button"
              data-testid={
                key === "assets"
                  ? "balance-sheet-section-assets"
                  : key === "liabilities"
                    ? "balance-sheet-section-liabilities"
                    : "balance-sheet-section-equity"
              }
              aria-expanded={isExpanded}
              onClick={() => toggleSection(key)}
              className="flex w-full cursor-pointer items-center gap-1 text-left"
            >
              {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              {title}
            </button>
          </td>
          {MONTH_KEYS.map((_, i) => (
            <td key={i} className={`px-2 py-2.5 text-xs text-right tabular-nums font-semibold whitespace-nowrap ${colorClass}`}>
              {sectionData.sectionCounts[i + 1] > 0
                ? fmtNum(sectionData.sectionTotals[i + 1], locale)
                : "—"}
            </td>
          ))}
        </tr>

        {/* Detail Rows */}
        {isExpanded && Array.from(sectionData.grouped.entries()).map(([name, months]) => (
          <tr key={name} className="border-b hover:bg-muted/30">
            <td className="sticky left-0 z-10 bg-card px-3 py-1.5 text-xs whitespace-nowrap pl-8">{name}</td>
            {MONTH_KEYS.map((_, i) => {
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
                      title={t("balanceSheetEditTitle")}
                      className="w-20 bg-transparent text-right border border-transparent hover:border-border focus:border-emerald-500 focus:outline-none rounded px-1 tabular-nums"
                      onBlur={(e) => {
                        const next = parseFloat(e.target.value)
                        if (!Number.isFinite(next) || next === (val ?? 0)) return
                        void saveCell(cell!.id, next)
                      }}
                    />
                  ) : val != null ? (
                    fmtNum(val, locale)
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
    <div className="space-y-4" data-testid="balance-sheet-guide-root">
      {/* Provenance note: a budget plan carries only the P&L, so its balance
          sheet is read from the matching-year Actuals plan. Tell the user so
          the data doesn't look like it's "from" the budget plan. */}
      {data.meta?.fellBack && (
        <div data-testid="balance-sheet-provenance" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          {t("balanceSheetActualsFallback", { year: asOfYear })}
        </div>
      )}
      {data.meta?.consolidated && (
        <div data-testid="balance-sheet-consolidated" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
          {t("balanceSheetConsolidated", {
            holding: data.meta.holding?.name ? ` — ${data.meta.holding.name}` : "",
          })}
        </div>
      )}
      {canEdit && (
        <div data-testid="balance-sheet-edit-warning" className="text-[11px] text-muted-foreground">
          {t("balanceSheetEditHint")}
        </div>
      )}
      {saveError && (
        <div data-testid="balance-sheet-save-error" className="rounded-lg border border-red-500/40 bg-red-50 dark:bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
          {t("balanceSheetSaveError", { error: saveError })}
        </div>
      )}
      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="balance-sheet-kpis">
        <div data-testid="balance-sheet-kpi-assets" className="relative overflow-hidden rounded-xl bg-gradient-to-br from-blue-50 to-blue-100 border border-blue-200 dark:from-blue-950/30 dark:to-blue-900/20 dark:border-blue-800 p-4">
          <div className="absolute top-0 right-0 w-20 h-20 bg-blue-200 dark:bg-blue-800 rounded-full -mr-6 -mt-6" />
          <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 text-[10px] font-semibold uppercase tracking-widest mb-2">
            <TrendingUp className="h-3.5 w-3.5" /> {t("balanceSheetTotalAssets")}
          </div>
          <p className="text-2xl font-bold tracking-tight text-blue-700 dark:text-blue-300">{totalAssets === null ? "—" : fmtNum(totalAssets, locale)} {totalAssets !== null && currencyCode && <span className="text-sm font-normal text-muted-foreground">{currencyCode}</span>}</p>
          <div className="flex items-center gap-1 mt-1">
            {assetGrowth !== null && (assetGrowth >= 0 ? <ArrowUpRight className="h-3 w-3 text-emerald-600 dark:text-emerald-400" /> : <ArrowDownRight className="h-3 w-3 text-red-600 dark:text-red-400" />)}
            <span className={`text-[10px] font-medium ${assetGrowth === null ? "text-muted-foreground" : assetGrowth >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>{assetGrowth === null ? "—" : `${assetGrowth.toFixed(1)}%`}</span>
            <span className="text-[10px] text-muted-foreground">{t("balanceSheetPeriodRange", { from: monthLabel(1), to: latestMonthLabel })}</span>
          </div>
        </div>

        <div data-testid="balance-sheet-kpi-liabilities" className="relative overflow-hidden rounded-xl bg-gradient-to-br from-orange-50 to-orange-100 border border-orange-200 dark:from-orange-950/30 dark:to-orange-900/20 dark:border-orange-800 p-4">
          <div className="absolute top-0 right-0 w-20 h-20 bg-orange-200 dark:bg-orange-800 rounded-full -mr-6 -mt-6" />
          <div className="flex items-center gap-2 text-orange-600 dark:text-orange-400 text-[10px] font-semibold uppercase tracking-widest mb-2">
            <Landmark className="h-3.5 w-3.5" /> {t("balanceSheetTotalLiabilities")}
          </div>
          <p className="text-2xl font-bold tracking-tight text-orange-700 dark:text-orange-300">{totalLiabilities === null ? "—" : fmtNum(totalLiabilities, locale)} {totalLiabilities !== null && currencyCode && <span className="text-sm font-normal text-muted-foreground">{currencyCode}</span>}</p>
          <p className="text-[10px] text-muted-foreground mt-1">{t("balanceSheetAsOf", { month: latestMonthLabel, year: asOfYear })}</p>
        </div>

        <div data-testid="balance-sheet-kpi-equity" className="relative overflow-hidden rounded-xl bg-gradient-to-br from-emerald-50 to-emerald-100 border border-emerald-200 dark:from-emerald-950/30 dark:to-emerald-900/20 dark:border-emerald-800 p-4">
          <div className="absolute top-0 right-0 w-20 h-20 bg-emerald-200 dark:bg-emerald-800 rounded-full -mr-6 -mt-6" />
          <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-[10px] font-semibold uppercase tracking-widest mb-2">
            <Wallet className="h-3.5 w-3.5" /> {t("balanceSheetTotalEquity")}
          </div>
          <p className={`text-2xl font-bold tracking-tight ${totalEquity !== null && totalEquity < 0 ? "text-red-700 dark:text-red-300" : "text-emerald-700 dark:text-emerald-300"}`}>
            {totalEquity === null ? "—" : <>{totalEquity < 0 && "("}{fmtNum(Math.abs(totalEquity), locale)}{totalEquity < 0 && ")"} {currencyCode && <span className="text-sm font-normal text-muted-foreground">{currencyCode}</span>}</>}
          </p>
          <p className="text-[10px] text-muted-foreground mt-1">{t("balanceSheetShareholdersEquity")}</p>
        </div>

        <div data-testid="balance-sheet-kpi-debt-equity" className={`relative overflow-hidden rounded-xl p-4 ${
          debtToEquity === null
            ? "bg-muted/40 border border-border"
            : debtToEquity <= 2
            ? "bg-gradient-to-br from-emerald-50 to-emerald-100 border border-emerald-200 dark:from-emerald-950/30 dark:to-emerald-900/20 dark:border-emerald-800"
            : "bg-gradient-to-br from-amber-50 to-amber-100 border border-amber-200 dark:from-amber-950/30 dark:to-amber-900/20 dark:border-amber-800"
        }`}>
          <div className={`absolute top-0 right-0 w-20 h-20 rounded-full -mr-6 -mt-6 ${debtToEquity === null ? "bg-muted" : debtToEquity <= 2 ? "bg-emerald-200 dark:bg-emerald-800" : "bg-amber-200 dark:bg-amber-800"}`} />
          <div className={`flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest mb-2 ${debtToEquity === null ? "text-muted-foreground" : debtToEquity <= 2 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
            <Scale className="h-3.5 w-3.5" /> {t("balanceSheetDebtEquityRatio")}
          </div>
          <p className={`text-2xl font-bold tracking-tight ${debtToEquity === null ? "text-muted-foreground" : debtToEquity <= 2 ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}`}>{debtToEquity === null ? "—" : `${debtToEquity.toFixed(2)}x`}</p>
          <p className="text-[10px] text-muted-foreground mt-1">{t("balanceSheetDebtToEquity")}</p>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Structure Chart */}
        <div data-testid="balance-sheet-structure-chart" className="lg:col-span-3 rounded-xl border bg-card p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">{t("balanceSheetStructureMonthly")}</h3>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={structureData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmtNum(v, locale)} />
              <Tooltip formatter={((v: number) => `${fmtCurrency(Math.abs(v), locale)}${currencySuffix}`) as never} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="assets" name={t("balanceSheetAssets")} connectNulls={false} stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.15} strokeWidth={2} />
              <Area type="monotone" dataKey="liabilities" name={t("balanceSheetLiabilities")} connectNulls={false} stroke="#ef4444" fill="#ef4444" fillOpacity={0.1} strokeWidth={2} />
              <Area type="monotone" dataKey="equity" name={t("balanceSheetEquity")} connectNulls={false} stroke="#10b981" fill="#10b981" fillOpacity={0.1} strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Asset Composition Donut */}
        <div data-testid="balance-sheet-asset-composition" className="lg:col-span-2 rounded-xl border bg-card p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">{t("balanceSheetAssetComposition", { month: latestMonthLabel })}</h3>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={assetAccounts} cx="50%" cy="50%" outerRadius={75} innerRadius={45} paddingAngle={2} dataKey="value" stroke="none">
                {assetAccounts.map((_, i) => (
                  <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={((v: number) => `${fmtCurrency(v, locale)}${currencySuffix}`) as never} />
            </PieChart>
          </ResponsiveContainer>
          <div className="grid grid-cols-1 gap-y-1 mt-2">
            {assetAccounts.map((entry, i) => {
              const pct = totalAssets !== null && totalAssets > 0 ? ((entry.value / totalAssets) * 100).toFixed(1) : "—"
              return (
                <div key={i} className="flex items-center gap-1.5 text-[10px]">
                  <div className="h-2 w-2 rounded-sm shrink-0" style={{ backgroundColor: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                  <span className="text-muted-foreground truncate">{entry.name}</span>
                  <span className="ml-auto font-semibold tabular-nums text-foreground">{pct}{pct !== "—" && "%"}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Balance Sheet Table */}
      <div className="rounded-xl border bg-card" data-testid="balance-sheet-detail">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="text-sm font-semibold text-foreground">{t("balanceSheetDetailTitle")}</h3>
          <Badge variant="outline" className="text-[10px]">{t("balanceSheetLineItems", { count: accountCount })}</Badge>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="sticky left-0 z-10 bg-muted/50 px-3 py-2.5 text-left font-semibold whitespace-nowrap min-w-[260px]">{t("balanceSheetAccount")}</th>
                {MONTH_KEYS.map((key, index) => (
                  <th key={key} className="px-2 py-2.5 text-right font-semibold whitespace-nowrap min-w-[75px]">{monthLabel(index + 1)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {renderSection("assets", t("balanceSheetAssets"), assetsData, "text-blue-700 dark:text-blue-400", "bg-blue-50 dark:bg-blue-950/30")}
              {renderSection("liabilities", t("balanceSheetLiabilities"), liabilitiesData, "text-red-700 dark:text-red-400", "bg-red-50 dark:bg-red-950/30")}
              {renderSection("equity", t("balanceSheetEquity"), equityData, "text-emerald-700 dark:text-emerald-400", "bg-emerald-50 dark:bg-emerald-950/30")}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
