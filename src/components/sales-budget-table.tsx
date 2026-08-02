"use client"

import { useMemo, useState } from "react"
import type { MissingDataNotice } from "@/lib/budgeting/missing-data"
import { useTranslations } from "next-intl"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, ComposedChart, Line,
} from "recharts"
import { TrendingUp, Package, ShoppingCart, DollarSign, ChevronDown, ChevronRight, Upload } from "lucide-react"
import { BudgetStackTooltip } from "@/components/budget-stack-tooltip"
import { ProductPerformanceComparison } from "@/components/product-performance-comparison"
import type { ProductVarianceInputLine } from "@/lib/budgeting/product-variance"

const COLORS = ["#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"]

function fmtNum(n: number): string {
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M"
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(1) + "K"
  return n.toFixed(n % 1 === 0 ? 0 : 2)
}

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)
}

interface SalesLine {
  id: string
  month: number
  quantity: number
  unitPrice: number
  amount: number
  productLine: { id: string; code: string; name: string; unit: string }
  source?: "budget_lines"
}

interface SalesResponseEnvelope {
  lines: SalesLine[]
  source?: "budget_lines"
  fallbackReason?: string
  comparison?: {
    budgetLines: SalesLine[]
    actualLines: SalesLine[]
    missingData?: MissingDataNotice[]
    budgetSource?: "budget_lines"
    actualSource?: "budget_lines"
  }
}

export function SalesBudgetTable({ planId }: { planId: string }) {
  const t = useTranslations("budgeting")
  const MONTHS = t("monthsShort").split(",")
  const { data: session } = useSession()
  const router = useRouter()
  const orgId = session?.user?.organizationId
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set())

  const { data, isLoading } = useQuery({
    queryKey: ["salesBudget", planId],
    queryFn: async () => {
      const res = await fetch(`/api/budgeting/sales-budget?planId=${planId}&compare=1`, {
        headers: { "x-organization-id": orgId || "" },
      })
      const body = await res.json()
      if (Array.isArray(body)) return { lines: body as SalesLine[] } satisfies SalesResponseEnvelope
      return body as SalesResponseEnvelope
    },
    enabled: !!planId && !!orgId,
  })
  const lines = data?.lines ?? []
  const fromBudgetLines = data?.source === "budget_lines"
  const comparisonBudgetLines = useMemo(
    () => toVarianceLines(data?.comparison?.budgetLines ?? []),
    [data?.comparison?.budgetLines],
  )
  const comparisonActualLines = useMemo(
    () => toVarianceLines(data?.comparison?.actualLines ?? []),
    [data?.comparison?.actualLines],
  )

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

  if (lines.length === 0) {
    return (
      <Card>
        <CardContent className="p-12 text-center">
          <ShoppingCart className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium text-foreground">{t("salesEmptyTitle")}</p>
          <p className="text-sm mt-1 text-muted-foreground">
            {t("salesEmptyDescription")}
          </p>
          <Button className="mt-5" onClick={() => router.push("/budgeting/admin/ai-import")}>
            <Upload className="h-4 w-4 mr-1" /> {t("balanceSheetImport")}
          </Button>
        </CardContent>
      </Card>
    )
  }

  // Group by product
  const products = new Map<string, { name: string; unit: string; code: string; months: Record<number, { qty: number; price: number; amount: number }> }>()
  lines.forEach((l) => {
    if (!products.has(l.productLine.id)) {
      products.set(l.productLine.id, { name: l.productLine.name, unit: l.productLine.unit, code: l.productLine.code, months: {} })
    }
    products.get(l.productLine.id)!.months[l.month] = { qty: l.quantity, price: l.unitPrice, amount: l.amount }
  })

  const productList = Array.from(products.values())
  const totalRevenue = lines.reduce((s, l) => s + l.amount, 0)
  const totalQty = lines.reduce((s, l) => s + l.quantity, 0)
  const avgPrice = totalQty > 0 ? totalRevenue / totalQty : 0
  const productCount = productList.length

  // Best-selling product
  const productRevenues = productList.map((p, i) => ({
    ...p,
    totalAmount: Object.values(p.months).reduce((s, m) => s + m.amount, 0),
    totalQty: Object.values(p.months).reduce((s, m) => s + m.qty, 0),
    color: COLORS[i % COLORS.length],
    index: i,
  })).sort((a, b) => b.totalAmount - a.totalAmount)

  const topProduct = productRevenues[0]

  // Revenue by product for pie chart
  const pieData = productRevenues.map(p => ({
    name: p.name,
    value: p.totalAmount,
    color: p.color,
  }))

  // Monthly revenue stacked bar chart + total trend line
  const monthlyData = MONTHS.map((m, i) => {
    const entry: any = { month: m }
    let total = 0
    productList.forEach(p => {
      const amount = p.months[i + 1]?.amount || 0
      entry[p.name] = amount
      total += amount
    })
    entry.Total = total
    return entry
  })

  const toggleProduct = (code: string) => {
    setExpandedProducts(prev => {
      const next = new Set(prev)
      next.has(code) ? next.delete(code) : next.add(code)
      return next
    })
  }

  return (
    <div className="space-y-4">
      {fromBudgetLines && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-300">
          {t("salesFallbackBanner")}
        </div>
      )}
      <ProductPerformanceComparison
        title={t("salesComparisonTitle")}
        description={t("salesComparisonSubtitle")}
        budgetLines={comparisonBudgetLines}
        actualLines={comparisonActualLines}
        missingData={data?.comparison?.missingData}
        amountLabel={t("plRevenue")}
        rateVarianceLabel={t("priceVarianceLabel")}
        volumeVarianceLabel={t("volumeVarianceLabel")}
        favorable="up"
      />
      {/* KPI Strip — Power BI dark scorecards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-indigo-50 to-indigo-100 border border-indigo-200 dark:from-indigo-950/30 dark:to-indigo-900/20 dark:border-indigo-800 p-4">
          <div className="absolute top-0 right-0 w-20 h-20 bg-indigo-200 dark:bg-indigo-800 rounded-full -mr-6 -mt-6" />
          <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 text-[10px] font-semibold uppercase tracking-widest mb-2">
            <DollarSign className="h-3.5 w-3.5" /> {t("salesKpiTotalRevenue")}
          </div>
          <p className="text-2xl font-bold tracking-tight text-indigo-700 dark:text-indigo-300">{fmtNum(totalRevenue)} <span className="text-sm font-normal text-muted-foreground">AZN</span></p>
          <p className="text-[10px] text-muted-foreground mt-1">{t("salesKpiTotalRevenueHint")}</p>
        </div>

        <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-amber-50 to-amber-100 border border-amber-200 dark:from-amber-950/30 dark:to-amber-900/20 dark:border-amber-800 p-4">
          <div className="absolute top-0 right-0 w-20 h-20 bg-amber-200 dark:bg-amber-800 rounded-full -mr-6 -mt-6" />
          <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 text-[10px] font-semibold uppercase tracking-widest mb-2">
            <Package className="h-3.5 w-3.5" /> {t("salesKpiTotalVolume")}
          </div>
          <p className="text-2xl font-bold tracking-tight text-amber-700 dark:text-amber-300">{fmtNum(totalQty)}</p>
          <p className="text-[10px] text-muted-foreground mt-1">{t("salesKpiTotalVolumeHint")}</p>
        </div>

        <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-blue-50 to-blue-100 border border-blue-200 dark:from-blue-950/30 dark:to-blue-900/20 dark:border-blue-800 p-4">
          <div className="absolute top-0 right-0 w-20 h-20 bg-blue-200 dark:bg-blue-800 rounded-full -mr-6 -mt-6" />
          <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 text-[10px] font-semibold uppercase tracking-widest mb-2">
            <TrendingUp className="h-3.5 w-3.5" /> {t("salesKpiAvgPrice")}
          </div>
          <p className="text-2xl font-bold tracking-tight text-blue-700 dark:text-blue-300">{avgPrice.toFixed(1)} <span className="text-sm font-normal text-muted-foreground">AZN</span></p>
          <p className="text-[10px] text-muted-foreground mt-1">{t("salesKpiAvgPriceHint")}</p>
        </div>

        <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-violet-50 to-violet-100 border border-violet-200 dark:from-violet-950/30 dark:to-violet-900/20 dark:border-violet-800 p-4">
          <div className="absolute top-0 right-0 w-20 h-20 bg-violet-200 dark:bg-violet-800 rounded-full -mr-6 -mt-6" />
          <div className="flex items-center gap-2 text-violet-600 dark:text-violet-400 text-[10px] font-semibold uppercase tracking-widest mb-2">
            <ShoppingCart className="h-3.5 w-3.5" /> {t("salesKpiTopProduct")}
          </div>
          <p className="text-lg font-bold tracking-tight truncate text-violet-700 dark:text-violet-300">{topProduct?.name || "—"}</p>
          <div className="flex items-center gap-1 mt-1">
            <span className="text-[10px] text-violet-600 dark:text-violet-400 font-medium">{topProduct ? ((topProduct.totalAmount / totalRevenue) * 100).toFixed(0) + "%" : ""}</span>
            <span className="text-[10px] text-muted-foreground">{t("pctOfRevenueLabel")}</span>
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Stacked Bar with Total trend line */}
        <div className="lg:col-span-3 rounded-xl border bg-card p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">{t("salesChartMonthlyByProduct")}</h3>
          <ResponsiveContainer width="100%" height={300} minWidth={0} minHeight={0}>
            <ComposedChart data={monthlyData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmtNum(v)} />
              <Tooltip content={<BudgetStackTooltip maxItems={5} />} cursor={{ fill: "hsl(var(--muted))", opacity: 0.24 }} />
              {productList.map((p, i) => (
                <Bar key={p.code} dataKey={p.name} stackId="a" fill={COLORS[i % COLORS.length]} />
              ))}
              <Line type="monotone" dataKey="Total" stroke="#ffffff" strokeWidth={2} strokeDasharray="5 5" dot={false} legendType="none" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Donut Chart */}
        <div className="lg:col-span-2 rounded-xl border bg-card p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">{t("salesChartMix")}</h3>
          <ResponsiveContainer width="100%" height={200} minWidth={0} minHeight={0}>
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%" outerRadius={75} innerRadius={45} paddingAngle={2} dataKey="value" stroke="none">
                {pieData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip formatter={((v: number) => fmtCurrency(v) + " AZN") as never} />
            </PieChart>
          </ResponsiveContainer>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mt-2">
            {pieData.map((entry, i) => {
              const pct = totalRevenue > 0 ? ((entry.value / totalRevenue) * 100).toFixed(1) : "0"
              return (
                <div key={i} className="flex items-center gap-1.5 text-[10px]">
                  <div className="h-2 w-2 rounded-sm shrink-0" style={{ backgroundColor: entry.color }} />
                  <span className="text-muted-foreground truncate">{entry.name}</span>
                  <span className="ml-auto font-semibold tabular-nums text-foreground">{pct}%</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Product Ranking Bar */}
      <div className="rounded-xl border bg-card p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3">{t("salesRankingTitle")}</h3>
        <div className="space-y-2">
          {productRevenues.map((p, i) => {
            const pct = totalRevenue > 0 ? (p.totalAmount / totalRevenue) * 100 : 0
            return (
              <div key={p.code} className="flex items-center gap-3 px-2 py-1.5">
                <span className="text-xs text-muted-foreground w-5 text-right tabular-nums">{i + 1}</span>
                <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                <span className="text-xs font-medium w-44 truncate">{p.name}</span>
                <div className="flex-1 h-6 bg-muted/30 rounded-md overflow-hidden relative">
                  <div
                    className="h-full rounded-md transition-all duration-500"
                    style={{
                      width: `${Math.max(pct, 2)}%`,
                      background: `linear-gradient(90deg, ${p.color}, ${p.color}cc)`,
                    }}
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-foreground/70 tabular-nums">
                    {pct.toFixed(1)}%
                  </span>
                </div>
                <span className="text-xs font-bold tabular-nums w-20 text-right">{fmtNum(p.totalAmount)}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Collapsible Product Detail Tables */}
      <div className="rounded-xl border bg-card">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="text-sm font-semibold text-foreground">{t("productDetailsTitle")}</h3>
          <Badge variant="outline" className="text-[10px]">{t("productsCountBadge", { count: productCount })}</Badge>
        </div>

        {productRevenues.map((product) => {
          const isExpanded = expandedProducts.has(product.code)
          const avgProductPrice = product.totalQty > 0 ? product.totalAmount / product.totalQty : 0
          const pct = totalRevenue > 0 ? ((product.totalAmount / totalRevenue) * 100).toFixed(1) : "0"

          return (
            <div key={product.code}>
              {/* Product Header Row */}
              <div
                className="flex items-center gap-3 px-4 py-3 border-b cursor-pointer hover:bg-muted/40 transition-colors"
                onClick={() => toggleProduct(product.code)}
                style={{ borderLeft: `3px solid ${product.color}` }}
              >
                {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: product.color }} />
                <span className="text-xs font-semibold text-foreground">{product.name}</span>
                <Badge variant="outline" className="text-[9px] h-4">{product.unit}</Badge>
                <span className="text-[10px] text-muted-foreground">{t("productShareLabel", { pct })}</span>
                <div className="ml-auto flex items-center gap-4">
                  <div className="text-right">
                    <span className="text-[10px] text-muted-foreground block">{t("colVolume")}</span>
                    <span className="text-xs font-semibold tabular-nums">{fmtNum(product.totalQty)}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-muted-foreground block">{t("colAvgPrice")}</span>
                    <span className="text-xs font-semibold tabular-nums">{avgProductPrice.toFixed(1)}</span>
                  </div>
                  <div className="text-right min-w-[80px]">
                    <span className="text-[10px] text-muted-foreground block">{t("plRevenue")}</span>
                    <span className="text-xs font-bold tabular-nums" style={{ color: product.color }}>{fmtNum(product.totalAmount)} AZN</span>
                  </div>
                </div>
              </div>

              {/* Expanded Table */}
              {isExpanded && (
                <div className="overflow-x-auto border-b">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted/30">
                        <th className="px-3 py-2 text-left font-semibold w-24">{t("colMetric")}</th>
                        {MONTHS.map(m => (
                          <th key={m} className="px-2 py-2 text-right font-semibold">{m}</th>
                        ))}
                        <th className="px-3 py-2 text-right font-bold bg-muted/50">{t("totalLabel")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b">
                        <td className="px-3 py-1.5 font-medium">{t("quantityLabel")}</td>
                        {MONTHS.map((_, i) => (
                          <td key={i} className="px-2 py-1.5 text-right tabular-nums">
                            {product.months[i + 1]?.qty ? fmtNum(product.months[i + 1].qty) : "—"}
                          </td>
                        ))}
                        <td className="px-3 py-1.5 text-right font-bold bg-muted/50 tabular-nums">{fmtNum(product.totalQty)}</td>
                      </tr>
                      <tr className="border-b">
                        <td className="px-3 py-1.5 font-medium text-muted-foreground">{t("colPrice")}</td>
                        {MONTHS.map((_, i) => (
                          <td key={i} className="px-2 py-1.5 text-right text-muted-foreground tabular-nums">
                            {product.months[i + 1]?.price ? product.months[i + 1].price.toFixed(2) : "—"}
                          </td>
                        ))}
                        <td className="px-3 py-1.5 text-right bg-muted/50 text-muted-foreground tabular-nums">{avgProductPrice.toFixed(2)}</td>
                      </tr>
                      <tr className="bg-emerald-50/50 dark:bg-emerald-950/20 font-semibold">
                        <td className="px-3 py-1.5">{t("plRevenue")}</td>
                        {MONTHS.map((_, i) => (
                          <td key={i} className="px-2 py-1.5 text-right text-emerald-700 dark:text-emerald-400 tabular-nums">
                            {product.months[i + 1]?.amount ? fmtNum(product.months[i + 1].amount) : "—"}
                          </td>
                        ))}
                        <td className="px-3 py-1.5 text-right font-bold bg-muted/50 text-emerald-700 dark:text-emerald-400 tabular-nums">
                          {fmtNum(product.totalAmount)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function toVarianceLines(lines: SalesLine[]): ProductVarianceInputLine[] {
  return lines.map((line) => ({
    productId: line.productLine.id,
    productName: line.productLine.name,
    month: line.month,
    amount: line.amount,
    quantity: line.quantity,
  }))
}
