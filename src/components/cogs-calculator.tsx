"use client"

import { useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, ComposedChart, Line, AreaChart, Area,
} from "recharts"
import { TrendingDown, Factory, Percent, Package, ChevronDown, ChevronRight, Upload } from "lucide-react"

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const COLORS = ["#ef4444", "#f97316", "#eab308", "#84cc16", "#06b6d4", "#8b5cf6"]

function fmtNum(n: number): string {
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M"
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(1) + "K"
  return n.toFixed(n % 1 === 0 ? 0 : 2)
}

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)
}

/** Phase 8 D3(q) (2026-05-28) — shapes returned by GET /api/budgeting/cogs.
 *  Mirror Prisma's `COGSBudgetLine` (with productLine include) and
 *  `COGSCostDetail` rows narrowed to the fields this view reads. */
interface CogsLine {
  id: string
  productLineId: string
  productLine: { id: string; name: string }
  year: number
  month: number
  productionQty: number
  totalCost: number
}

interface CogsDetail {
  id: string
  productLineId: string
  costType: string // "raw_material" | "indirect" | "production" | "unit_cost"
  label: string
  accountCode: string | null
  stage: string | null
  year: number
  month: number
  amount: number
}

interface CogsResponse {
  cogsLines: CogsLine[]
  components: unknown[]
  details: CogsDetail[]
}

/** Recharts chart row for monthly stacked bars — `month` is the
 *  X-axis label, every other key is a numeric product cost. */
type MonthlyDataRow = { month: string; Total: number } & Record<string, number | string>

export function COGSCalculator({ planId }: { planId: string }) {
  const { data: session } = useSession()
  const router = useRouter()
  const orgId = session?.user?.organizationId
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set())

  const { data, isLoading } = useQuery<CogsResponse>({
    queryKey: ["cogs", planId],
    queryFn: async () => {
      const res = await fetch(`/api/budgeting/cogs?planId=${planId}`, {
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

  if (!data?.cogsLines || data.cogsLines.length === 0) {
    return (
      <Card>
        <CardContent className="p-12 text-center">
          <Factory className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium text-foreground">No COGS data in this plan</p>
          <p className="text-sm mt-1 text-muted-foreground">
            The selected plan exists, but it does not contain product-level cost of goods sold rows yet.
            Creating a plan only creates an empty container.
          </p>
          <Button
            className="mt-5"
            onClick={() => router.push("/budgeting/admin/ai-import")}
          >
            <Upload className="h-4 w-4 mr-1" /> Import Excel data
          </Button>
        </CardContent>
      </Card>
    )
  }

  // Group by product
  const products = new Map<string, { id: string; name: string; months: Record<number, { qty: number; cost: number }> }>()
  data.cogsLines.forEach((l) => {
    const key = l.productLine.id
    if (!products.has(key)) products.set(key, { id: key, name: l.productLine.name, months: {} })
    products.get(key)!.months[l.month] = { qty: l.productionQty, cost: l.totalCost }
  })

  // Group details by product + stage + costType + label
  // detail row: { productLineId, costType, label, accountCode, stage, month, amount }
  type DetailLine = { label: string; accountCode: string | null; costType: string; stage: string | null; months: Record<number, number>; total: number }
  type ProductDetails = { stages: Map<string, { indirect: DetailLine[]; raw: DetailLine[]; production?: DetailLine; unitCost?: DetailLine }> }
  const detailsByProduct = new Map<string, ProductDetails>()
  ;(data.details ?? []).forEach((d) => {
    if (!detailsByProduct.has(d.productLineId)) detailsByProduct.set(d.productLineId, { stages: new Map() })
    const prod = detailsByProduct.get(d.productLineId)!
    const stageKey = d.stage || "_default"
    if (!prod.stages.has(stageKey)) prod.stages.set(stageKey, { indirect: [], raw: [] })
    const stage = prod.stages.get(stageKey)!
    const lineKey = `${d.costType}::${d.label}::${d.accountCode || ""}`
    const buckets: Record<string, DetailLine[]> = { indirect: stage.indirect, raw_material: stage.raw }
    const bucket = buckets[d.costType]
    if (bucket) {
      let existing = bucket.find(x => `${x.costType}::${x.label}::${x.accountCode || ""}` === lineKey)
      if (!existing) {
        existing = { label: d.label, accountCode: d.accountCode, costType: d.costType, stage: d.stage, months: {}, total: 0 }
        bucket.push(existing)
      }
      existing.months[d.month] = (existing.months[d.month] || 0) + d.amount
      existing.total += d.amount
    } else if (d.costType === "production") {
      if (!stage.production) stage.production = { label: d.label, accountCode: null, costType: "production", stage: d.stage, months: {}, total: 0 }
      stage.production.months[d.month] = (stage.production.months[d.month] || 0) + d.amount
      stage.production.total += d.amount
    } else if (d.costType === "unit_cost") {
      if (!stage.unitCost) stage.unitCost = { label: d.label, accountCode: null, costType: "unit_cost", stage: d.stage, months: {}, total: 0 }
      stage.unitCost.months[d.month] = d.amount // unit cost is a rate, not summed
    }
  })

  const productList = Array.from(products.values())
  const totalCost = data.cogsLines.reduce((s, l) => s + l.totalCost, 0)

  // Product rankings
  const productRanking = productList.map((p, i) => {
    const totalProductCost = Object.values(p.months).reduce((s, m) => s + m.cost, 0)
    const totalProductQty = Object.values(p.months).reduce((s, m) => s + m.qty, 0)
    const monthsWithData = Object.values(p.months).filter(m => m.cost > 0).length
    return {
      ...p,
      totalCost: totalProductCost,
      totalQty: totalProductQty,
      monthsActive: monthsWithData,
      avgMonthlyCost: monthsWithData > 0 ? totalProductCost / monthsWithData : 0,
      color: COLORS[i % COLORS.length],
      index: i,
    }
  }).sort((a, b) => b.totalCost - a.totalCost)

  const topProduct = productRanking[0]
  const monthsWithCost = new Set(data.cogsLines.filter((l) => l.totalCost > 0).map((l) => l.month)).size
  const avgMonthlyCogs = monthsWithCost > 0 ? totalCost / monthsWithCost : 0

  // Donut data
  const donutData = productRanking.map(p => ({
    name: p.name,
    value: p.totalCost,
    color: p.color,
  }))

  // Monthly stacked bar + total trend
  const monthlyData: MonthlyDataRow[] = MONTHS.map((m, i) => {
    const entry: MonthlyDataRow = { month: m, Total: 0 }
    let total = 0
    productList.forEach(p => {
      const cost = p.months[i + 1]?.cost || 0
      entry[p.name] = cost
      total += cost
    })
    entry.Total = total
    return entry
  })

  // Cost trend (total COGS per month)
  const trendData = MONTHS.map((m, i) => ({
    month: m,
    COGS: productList.reduce((s, p) => s + (p.months[i + 1]?.cost || 0), 0),
  }))

  const toggleProduct = (name: string) => {
    setExpandedProducts(prev => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })
  }

  return (
    <div className="space-y-4">
      {/* KPI Strip — Power BI dark scorecards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-cyan-50 to-cyan-100 border border-cyan-200 dark:from-cyan-950/30 dark:to-cyan-900/20 dark:border-cyan-800 p-4">
          <div className="absolute top-0 right-0 w-20 h-20 bg-cyan-200 dark:bg-cyan-800 rounded-full -mr-6 -mt-6" />
          <div className="flex items-center gap-2 text-cyan-600 dark:text-cyan-400 text-[10px] font-semibold uppercase tracking-widest mb-2">
            <TrendingDown className="h-3.5 w-3.5" /> Total COGS
          </div>
          <p className="text-2xl font-bold tracking-tight text-cyan-700 dark:text-cyan-300">{fmtNum(totalCost)} <span className="text-sm font-normal text-muted-foreground">AZN</span></p>
          <p className="text-[10px] text-muted-foreground mt-1">Annual cost budget</p>
        </div>

        <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-blue-50 to-blue-100 border border-blue-200 dark:from-blue-950/30 dark:to-blue-900/20 dark:border-blue-800 p-4">
          <div className="absolute top-0 right-0 w-20 h-20 bg-blue-200 dark:bg-blue-800 rounded-full -mr-6 -mt-6" />
          <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 text-[10px] font-semibold uppercase tracking-widest mb-2">
            <Percent className="h-3.5 w-3.5" /> Avg Monthly
          </div>
          <p className="text-2xl font-bold tracking-tight text-blue-700 dark:text-blue-300">{fmtNum(avgMonthlyCogs)} <span className="text-sm font-normal text-muted-foreground">AZN</span></p>
          <p className="text-[10px] text-muted-foreground mt-1">{monthsWithCost} months with costs</p>
        </div>

        <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-orange-50 to-orange-100 border border-orange-200 dark:from-orange-950/30 dark:to-orange-900/20 dark:border-orange-800 p-4">
          <div className="absolute top-0 right-0 w-20 h-20 bg-orange-200 dark:bg-orange-800 rounded-full -mr-6 -mt-6" />
          <div className="flex items-center gap-2 text-orange-600 dark:text-orange-400 text-[10px] font-semibold uppercase tracking-widest mb-2">
            <Factory className="h-3.5 w-3.5" /> Top Cost Driver
          </div>
          <p className="text-lg font-bold tracking-tight truncate text-orange-700 dark:text-orange-300">{topProduct?.name || "—"}</p>
          <div className="flex items-center gap-1 mt-1">
            <span className="text-[10px] text-orange-600 dark:text-orange-400 font-medium">{topProduct ? ((topProduct.totalCost / totalCost) * 100).toFixed(0) + "%" : ""}</span>
            <span className="text-[10px] text-muted-foreground">of total COGS</span>
          </div>
        </div>

        <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-violet-50 to-violet-100 border border-violet-200 dark:from-violet-950/30 dark:to-violet-900/20 dark:border-violet-800 p-4">
          <div className="absolute top-0 right-0 w-20 h-20 bg-violet-200 dark:bg-violet-800 rounded-full -mr-6 -mt-6" />
          <div className="flex items-center gap-2 text-violet-600 dark:text-violet-400 text-[10px] font-semibold uppercase tracking-widest mb-2">
            <Package className="h-3.5 w-3.5" /> Product Lines
          </div>
          <p className="text-2xl font-bold tracking-tight text-violet-700 dark:text-violet-300">{productList.length}</p>
          <p className="text-[10px] text-muted-foreground mt-1">With COGS data</p>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Stacked Bar with Total trend */}
        <div className="lg:col-span-3 rounded-xl border bg-card p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">Monthly COGS by Product</h3>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={monthlyData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmtNum(v)} />
              <Tooltip formatter={((v: number, name: string) => [fmtCurrency(v) + " AZN", name]) as never} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              {productList.map((p, i) => (
                <Bar key={p.name} dataKey={p.name} stackId="a" fill={COLORS[i % COLORS.length]} />
              ))}
              <Line type="monotone" dataKey="Total" stroke="#ffffff" strokeWidth={2} strokeDasharray="5 5" dot={false} legendType="none" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Donut Chart */}
        <div className="lg:col-span-2 rounded-xl border bg-card p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">Cost Breakdown</h3>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={donutData} cx="50%" cy="50%" outerRadius={75} innerRadius={45} paddingAngle={2} dataKey="value" stroke="none">
                {donutData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip formatter={((v: number) => fmtCurrency(v) + " AZN") as never} />
            </PieChart>
          </ResponsiveContainer>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mt-2">
            {donutData.map((entry, i) => {
              const pct = totalCost > 0 ? ((entry.value / totalCost) * 100).toFixed(1) : "0"
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

      {/* COGS Trend Area Chart */}
      <div className="rounded-xl border bg-card p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3">COGS Trend</h3>
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={trendData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmtNum(v)} />
            <Tooltip formatter={((v: number) => fmtCurrency(v) + " AZN") as never} />
            <Area type="monotone" dataKey="COGS" stroke="#ef4444" fill="#ef4444" fillOpacity={0.1} strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Product Ranking */}
      <div className="rounded-xl border bg-card p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3">Cost Ranking</h3>
        <div className="space-y-2">
          {productRanking.map((p, i) => {
            const pct = totalCost > 0 ? (p.totalCost / totalCost) * 100 : 0
            return (
              <div key={p.name} className="flex items-center gap-3 px-2 py-1.5">
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
                <span className="text-xs font-bold tabular-nums w-20 text-right">{fmtNum(p.totalCost)}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Collapsible Product Details */}
      <div className="rounded-xl border bg-card">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="text-sm font-semibold text-foreground">Product Details</h3>
          <Badge variant="outline" className="text-[10px]">{productList.length} products</Badge>
        </div>

        {productRanking.map((product) => {
          const isExpanded = expandedProducts.has(product.name)
          const pct = totalCost > 0 ? ((product.totalCost / totalCost) * 100).toFixed(1) : "0"

          return (
            <div key={product.name}>
              {/* Product Header */}
              <div
                className="flex items-center gap-3 px-4 py-3 border-b cursor-pointer hover:bg-muted/40 transition-colors"
                onClick={() => toggleProduct(product.name)}
                style={{ borderLeft: `3px solid ${product.color}` }}
              >
                {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: product.color }} />
                <span className="text-xs font-semibold text-foreground">{product.name}</span>
                <span className="text-[10px] text-muted-foreground">{pct}% share</span>
                <div className="ml-auto flex items-center gap-4">
                  {product.totalQty > 0 && (
                    <div className="text-right">
                      <span className="text-[10px] text-muted-foreground block">Production</span>
                      <span className="text-xs font-semibold tabular-nums">{fmtNum(product.totalQty)}</span>
                    </div>
                  )}
                  <div className="text-right">
                    <span className="text-[10px] text-muted-foreground block">Avg/Month</span>
                    <span className="text-xs font-semibold tabular-nums">{fmtNum(product.avgMonthlyCost)}</span>
                  </div>
                  <div className="text-right min-w-[80px]">
                    <span className="text-[10px] text-muted-foreground block">Total Cost</span>
                    <span className="text-xs font-bold tabular-nums" style={{ color: product.color }}>{fmtNum(product.totalCost)} AZN</span>
                  </div>
                </div>
              </div>

              {/* Expanded Table */}
              {isExpanded && (
                <div className="overflow-x-auto border-b">
                  {(() => {
                    const prodDetails = detailsByProduct.get(product.id ?? "")
                    const stageList = prodDetails ? Array.from(prodDetails.stages.entries()) : []
                    return (
                      <>
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-muted/30">
                              <th className="px-3 py-2 text-left font-semibold w-64">Metric</th>
                              {MONTHS.map(m => (
                                <th key={m} className="px-2 py-2 text-right font-semibold">{m}</th>
                              ))}
                              <th className="px-3 py-2 text-right font-bold bg-muted/50">Total</th>
                            </tr>
                          </thead>
                    <tbody>
                      {product.totalQty > 0 && (
                        <>
                          <tr className="border-b">
                            <td className="px-3 py-1.5 font-medium">Qty</td>
                            {MONTHS.map((_, i) => (
                              <td key={i} className="px-2 py-1.5 text-right tabular-nums">
                                {product.months[i + 1]?.qty ? fmtNum(product.months[i + 1].qty) : "—"}
                              </td>
                            ))}
                            <td className="px-3 py-1.5 text-right font-bold bg-muted/50 tabular-nums">{fmtNum(product.totalQty)}</td>
                          </tr>
                          <tr className="border-b">
                            <td className="px-3 py-1.5 font-medium text-muted-foreground">Unit Cost</td>
                            {MONTHS.map((_, i) => {
                              const m = product.months[i + 1]
                              const unitCost = m && m.qty > 0 ? m.cost / m.qty : 0
                              return (
                                <td key={i} className="px-2 py-1.5 text-right text-muted-foreground tabular-nums">
                                  {unitCost > 0 ? unitCost.toFixed(2) : "—"}
                                </td>
                              )
                            })}
                            <td className="px-3 py-1.5 text-right bg-muted/50 text-muted-foreground tabular-nums">
                              {product.totalQty > 0 ? (product.totalCost / product.totalQty).toFixed(2) : "—"}
                            </td>
                          </tr>
                        </>
                      )}
                      <tr className="bg-red-50/50 dark:bg-red-950/20 font-semibold">
                        <td className="px-3 py-1.5">Cost</td>
                        {MONTHS.map((_, i) => (
                          <td key={i} className="px-2 py-1.5 text-right text-red-700 dark:text-red-400 tabular-nums">
                            {product.months[i + 1]?.cost ? fmtNum(product.months[i + 1].cost) : "—"}
                          </td>
                        ))}
                        <td className="px-3 py-1.5 text-right font-bold bg-muted/50 text-red-700 dark:text-red-400 tabular-nums">{fmtNum(product.totalCost)}</td>
                      </tr>
                    </tbody>
                  </table>
                  {stageList.length > 0 && (
                    <div className="border-t bg-muted/10">
                      <div className="px-4 py-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Cost Breakdown — Formation Detail</div>
                      {stageList.map(([stageKey, stage]) => (
                        <div key={stageKey} className="border-t">
                          {stageKey !== "_default" && (
                            <div className="px-4 py-1.5 bg-amber-50/50 dark:bg-amber-950/20 text-xs font-semibold text-amber-800 dark:text-amber-300">
                              Stage: {stageKey}
                            </div>
                          )}
                          <table className="w-full text-[11px]">
                            <tbody>
                              {stage.raw.length > 0 && (
                                <>
                                  <tr className="bg-emerald-50/40 dark:bg-emerald-950/10">
                                    <td colSpan={14} className="px-4 py-1 text-[10px] font-semibold uppercase text-emerald-700 dark:text-emerald-400">Xammal (Raw materials)</td>
                                  </tr>
                                  {stage.raw.map((line, idx) => (
                                    <tr key={`raw-${idx}`} className="border-b hover:bg-muted/20">
                                      <td
                                        className="px-4 py-1 w-64 text-muted-foreground truncate"
                                        // Phase 3.3 third bullet — hover reveals the
                                        // qualified identifier when label gets truncated.
                                        title={line.accountCode ? `${line.accountCode} — ${line.label}` : line.label}
                                      >
                                        {line.accountCode && <span className="font-mono text-[9px] mr-1.5 text-muted-foreground/70">{line.accountCode}</span>}
                                        {line.label}
                                      </td>
                                      {MONTHS.map((_, i) => (
                                        <td key={i} className="px-2 py-1 text-right tabular-nums text-muted-foreground">
                                          {line.months[i + 1] ? fmtNum(line.months[i + 1]) : "—"}
                                        </td>
                                      ))}
                                      <td className="px-3 py-1 text-right font-medium tabular-nums bg-muted/30">{fmtNum(line.total)}</td>
                                    </tr>
                                  ))}
                                </>
                              )}
                              {stage.indirect.length > 0 && (
                                <>
                                  <tr className="bg-blue-50/40 dark:bg-blue-950/10">
                                    <td colSpan={14} className="px-4 py-1 text-[10px] font-semibold uppercase text-blue-700 dark:text-blue-400">Qeyri-xammal (Indirect / overhead)</td>
                                  </tr>
                                  {stage.indirect.map((line, idx) => (
                                    <tr key={`ind-${idx}`} className="border-b hover:bg-muted/20">
                                      <td
                                        className="px-4 py-1 w-64 text-muted-foreground truncate"
                                        // Phase 3.3 third bullet — hover reveals the
                                        // qualified identifier when label gets truncated.
                                        title={line.accountCode ? `${line.accountCode} — ${line.label}` : line.label}
                                      >
                                        {line.accountCode && <span className="font-mono text-[9px] mr-1.5 text-muted-foreground/70">{line.accountCode}</span>}
                                        {line.label}
                                      </td>
                                      {MONTHS.map((_, i) => (
                                        <td key={i} className="px-2 py-1 text-right tabular-nums text-muted-foreground">
                                          {line.months[i + 1] ? fmtNum(line.months[i + 1]) : "—"}
                                        </td>
                                      ))}
                                      <td className="px-3 py-1 text-right font-medium tabular-nums bg-muted/30">{fmtNum(line.total)}</td>
                                    </tr>
                                  ))}
                                </>
                              )}
                              {stage.production && (
                                <tr className="bg-slate-50 dark:bg-slate-900/40 font-medium border-b">
                                  <td className="px-4 py-1">Production (İstehsal)</td>
                                  {MONTHS.map((_, i) => (
                                    <td key={i} className="px-2 py-1 text-right tabular-nums">
                                      {stage.production!.months[i + 1] ? fmtNum(stage.production!.months[i + 1]) : "—"}
                                    </td>
                                  ))}
                                  <td className="px-3 py-1 text-right font-bold tabular-nums bg-muted/50">{fmtNum(stage.production.total)}</td>
                                </tr>
                              )}
                              {stage.unitCost && (
                                <tr className="bg-red-50/60 dark:bg-red-950/30 font-semibold border-b text-red-800 dark:text-red-300">
                                  <td className="px-4 py-1">Vahid maya dəyəri (Unit Cost)</td>
                                  {MONTHS.map((_, i) => (
                                    <td key={i} className="px-2 py-1 text-right tabular-nums">
                                      {stage.unitCost!.months[i + 1] ? stage.unitCost!.months[i + 1].toFixed(2) : "—"}
                                    </td>
                                  ))}
                                  <td className="px-3 py-1 text-right font-bold tabular-nums bg-muted/50">—</td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      ))}
                    </div>
                  )}
                </>
                    )
                  })()}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
