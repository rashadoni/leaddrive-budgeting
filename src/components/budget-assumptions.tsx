"use client"

import { useState } from "react"
import { useSession } from "next-auth/react"
import { useQuery } from "@tanstack/react-query"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Treemap, Legend,
} from "recharts"
import { Settings2, Layers, Hash, Search, ChevronDown, ChevronRight, TrendingUp, DollarSign } from "lucide-react"

/**
 * Sub-44 cont'd — collapsed 3 parallel `Record<string, string>` maps
 * (CATEGORY_LABELS / CATEGORY_COLORS / CATEGORY_ICONS) into a single
 * `Record<string, CategoryMeta>` to close sub-38 architect ⚠️.
 *
 * Why: the 3-map pattern was prone to drift — sub-35 (industry-code
 * leak) was the first miss; sub-38 (gray-fallback regression) was the
 * second; pattern would have recurred on every data-shape extension.
 * Single-entry shape forces every new category to bring all 3 fields
 * at compile time.
 *
 * Use `getCategoryMeta(cat)` for safe lookup (returns `DEFAULT_CATEGORY_META`
 * with the cat-as-label for unknown codes — keeps the fallback contract
 * the original maps had via `|| cat` / `|| "#9ca3af"` / `|| "📋"`).
 */
export interface CategoryMeta {
  label: string
  color: string
  icon: string
}

export const DEFAULT_CATEGORY_META: CategoryMeta = {
  label: "Other", // Caller supplies the cat string when label fallback matters.
  color: "#9ca3af",
  icon: "📋",
}

export const CATEGORY_META: Record<string, CategoryMeta> = {
  // Legacy product-line categories carried over from earlier tenant data
  // shapes. Keys are still in use as BudgetCategory.key in DB; renaming
  // would need a migration. Labels stay descriptive of the category kind.
  returns_transport: { label: "Returns & Transport", color: "#3b82f6", icon: "🚛" },
  mhb_transport: { label: "MHB/Lime Transport", color: "#2563eb", icon: "🏗️" },
  pallet_export: { label: "Pallets / Export", color: "#14b8a6", icon: "📦" },
  waste: { label: "Waste & Scrap", color: "#ef4444", icon: "♻️" },
  food: { label: "Food Costs", color: "#f59e0b", icon: "🍽️" },
  prepaid: { label: "Prepaid Expenses", color: "#84cc16", icon: "💳" },
  utilities: { label: "Utilities", color: "#8b5cf6", icon: "⚡" },
  mining: { label: "Mining", color: "#6b7280", icon: "⛏️" },
  repair: { label: "Repair & Maintenance", color: "#f97316", icon: "🔧" },
  mhb_recipe: { label: "Recipe (BOM)", color: "#a855f7", icon: "🧪" },
  labor_base: { label: "Labor (Base)", color: "#10b981", icon: "👷" },
  labor_summary: { label: "Labor (Summary)", color: "#059669", icon: "👥" },
  marketing: { label: "Marketing", color: "#ec4899", icon: "📢" },
  depreciation: { label: "Depreciation", color: "#06b6d4", icon: "📉" },
  other: { label: "Other", color: "#9ca3af", icon: "📋" },
  // Generic holding-wide FP&A categories. Without these the treemap +
  // donut + ranking bars all fall back to the gray default because the
  // data shape changed but the color map did not.
  operations: { label: "Operations", color: "#3b82f6", icon: "⚙️" }, // blue — primary ops backbone
  commercial: { label: "Commercial", color: "#f97316", icon: "🛒" }, // orange — sales / commerce
  finance: { label: "Finance", color: "#10b981", icon: "💰" },        // emerald — money / fin
  fx: { label: "FX / Currency", color: "#a855f7", icon: "💱" },       // purple — currency / FX
  hr: { label: "HR / People", color: "#14b8a6", icon: "👥" },         // teal — people
  pricing: { label: "Pricing", color: "#f59e0b", icon: "🏷️" },         // amber — pricing
  risk: { label: "Risk", color: "#ef4444", icon: "⚠️" },               // red — risk
  tax: { label: "Tax", color: "#6366f1", icon: "🏛️" },                 // indigo — formal / regulatory
  inflation: { label: "Inflation", color: "#ec4899", icon: "📈" },    // pink — macro / monetary
}

/**
 * Safe lookup for a category's display metadata. Returns the
 * registered entry when present; falls back to a synthesized entry
 * with the raw cat code as the label and the default gray + 📋 icon
 * (matches the legacy `CATEGORY_LABELS[cat] || cat` / `... || "#9ca3af"`
 * / `... || "📋"` semantics from the pre-consolidation maps).
 *
 * Pure / no React; testable without rendering the parent component.
 */
export function getCategoryMeta(cat: string): CategoryMeta {
  const entry = CATEGORY_META[cat]
  if (entry) return entry
  return { ...DEFAULT_CATEGORY_META, label: cat }
}

function fmtNum(n: number): string {
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M"
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(1) + "K"
  return n.toFixed(n % 1 === 0 ? 0 : 2)
}

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)
}

/** Phase 8 D3(i) (2026-05-28) — AssumptionItem shape returned by
 *  GET /api/budgeting/assumptions. Mirrors the Prisma BudgetAssumption
 *  row but defined inline here so the client component doesn't pull
 *  the Prisma client into the bundle. Fields kept narrow to the
 *  columns the UI actually reads. */
interface AssumptionItem {
  id: string
  category: string
  key: string
  label: string
  value: number
  unit: string | null
  period: string | null
  notes: string | null
  sortOrder: number
}

/** Recharts Treemap content callback signature. Recharts ships
 *  inexact types so we mirror the props we read; missing fields are
 *  optional. */
interface TreemapContentProps {
  x?: number
  y?: number
  width?: number
  height?: number
  name?: string
  value?: number
  color?: string
}

// Treemap custom content
function TreemapContent(props: TreemapContentProps) {
  const { x = 0, y = 0, width = 0, height = 0, name = "", value = 0, color = "#9ca3af" } = props
  if (width < 40 || height < 30) return null
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx={4} fill={color} fillOpacity={0.85} stroke="rgba(255,255,255,0.2)" strokeWidth={2} />
      {width > 60 && height > 40 && (
        <>
          <text x={x + 8} y={y + 18} fill="#fff" fontSize={11} fontWeight={600}>{name}</text>
          <text x={x + 8} y={y + 34} fill="rgba(255,255,255,0.8)" fontSize={10}>{value} items</text>
        </>
      )}
    </g>
  )
}

export function BudgetAssumptions({ planId }: { planId: string }) {
  const { data: session } = useSession()
  const orgId = session?.user?.organizationId
  const [search, setSearch] = useState("")
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)

  const { data: assumptions, isLoading } = useQuery<AssumptionItem[]>({
    queryKey: ["assumptions", planId],
    queryFn: async () => {
      const res = await fetch(`/api/budgeting/assumptions?planId=${planId}`, {
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

  if (!assumptions || assumptions.length === 0) {
    return (
      <Card>
        <CardContent className="p-12 text-center text-muted-foreground">
          <Settings2 className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No assumptions data available</p>
          <p className="text-sm mt-1">Import an Excel file to populate assumptions.</p>
        </CardContent>
      </Card>
    )
  }

  // Group by category
  const grouped = new Map<string, AssumptionItem[]>()
  assumptions.forEach((a) => {
    if (!grouped.has(a.category)) grouped.set(a.category, [])
    grouped.get(a.category)!.push(a)
  })

  const totalAssumptions = assumptions.length
  const categories = Array.from(grouped.keys())

  // All categories with item counts (for treemap — shows ALL categories)
  const allCategoryCounts = Array.from(grouped.entries()).map(([cat, items]) => {
    const aznTotal = items.filter((i) => i.unit === "AZN").reduce((s, i) => s + i.value, 0)
    const totalSum = items.reduce((s, i) => s + (typeof i.value === "number" ? i.value : 0), 0)
    const meta = getCategoryMeta(cat)
    return {
      name: meta.label, key: cat, count: items.length,
      aznValue: aznTotal, totalSum,
      color: meta.color,
    }
  }).sort((a, b) => b.count - a.count)

  // Monetary categories only (for value-based charts)
  const categoryTotals = allCategoryCounts.filter(c => c.aznValue > 0).sort((a, b) => b.aznValue - a.aznValue)
  const totalValue = categoryTotals.reduce((s, c) => s + c.aznValue, 0)
  const topCategory = allCategoryCounts[0]
  const uniqueUnits = [...new Set(assumptions.map((a) => a.unit).filter(Boolean))]

  // Treemap data — by item count so ALL categories are visible
  const treemapData = allCategoryCounts.map(c => ({
    name: c.name,
    size: c.count,
    color: c.color,
    value: c.count,
  }))

  // Filter for search
  const filteredCategories = Array.from(grouped.entries()).filter(([cat, items]) => {
    if (!search) return selectedCategory ? cat === selectedCategory : true
    const q = search.toLowerCase()
    return getCategoryMeta(cat).label.toLowerCase().includes(q) ||
      items.some((i) => i.label?.toLowerCase().includes(q))
  })

  const toggleCategory = (cat: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  // Bar chart data — by item count (all categories)
  const barData = allCategoryCounts.map(c => ({
    ...c,
    value: c.count,
    pct: totalAssumptions > 0 ? (c.count / totalAssumptions * 100) : 0,
  }))

  // Donut data — by item count (all categories)
  const donutData = allCategoryCounts.map(c => ({
    name: c.name, value: c.count, color: c.color, key: c.key,
  }))

  return (
    <div className="space-y-4">
      {/* KPI Strip — Power BI style scorecards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-amber-50 to-amber-100 border border-amber-200 dark:from-amber-950/30 dark:to-amber-900/20 dark:border-amber-800 p-4">
          <div className="absolute top-0 right-0 w-20 h-20 bg-amber-200 dark:bg-amber-800 rounded-full -mr-6 -mt-6" />
          <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 text-[10px] font-semibold uppercase tracking-widest mb-2">
            <DollarSign className="h-3.5 w-3.5" /> Total Value
          </div>
          <p className="text-2xl font-bold tracking-tight text-amber-700 dark:text-amber-300">{fmtNum(totalValue)} <span className="text-sm font-normal text-muted-foreground">AZN</span></p>
          <p className="text-[10px] text-muted-foreground mt-1">Sum of all monetary assumptions</p>
        </div>

        <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-violet-50 to-violet-100 border border-violet-200 dark:from-violet-950/30 dark:to-violet-900/20 dark:border-violet-800 p-4">
          <div className="absolute top-0 right-0 w-20 h-20 bg-violet-200 dark:bg-violet-800 rounded-full -mr-6 -mt-6" />
          <div className="flex items-center gap-2 text-violet-600 dark:text-violet-400 text-[10px] font-semibold uppercase tracking-widest mb-2">
            <Hash className="h-3.5 w-3.5" /> Parameters
          </div>
          <p className="text-2xl font-bold tracking-tight text-violet-700 dark:text-violet-300">{totalAssumptions}</p>
          <p className="text-[10px] text-muted-foreground mt-1">{categories.length} categories</p>
        </div>

        <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-emerald-50 to-emerald-100 border border-emerald-200 dark:from-emerald-950/30 dark:to-emerald-900/20 dark:border-emerald-800 p-4">
          <div className="absolute top-0 right-0 w-20 h-20 bg-emerald-200 dark:bg-emerald-800 rounded-full -mr-6 -mt-6" />
          <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-[10px] font-semibold uppercase tracking-widest mb-2">
            <TrendingUp className="h-3.5 w-3.5" /> Top Category
          </div>
          <p className="text-lg font-bold tracking-tight truncate text-emerald-700 dark:text-emerald-300">{topCategory?.name || "—"}</p>
          <p className="text-[10px] text-muted-foreground mt-1">{topCategory ? topCategory.count + " items" : ""}</p>
        </div>

        <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-violet-50 to-violet-100 border border-violet-200 dark:from-violet-950/30 dark:to-violet-900/20 dark:border-violet-800 p-4">
          <div className="absolute top-0 right-0 w-20 h-20 bg-violet-200 dark:bg-violet-800 rounded-full -mr-6 -mt-6" />
          <div className="flex items-center gap-2 text-violet-600 dark:text-violet-400 text-[10px] font-semibold uppercase tracking-widest mb-2">
            <Layers className="h-3.5 w-3.5" /> Units
          </div>
          <p className="text-2xl font-bold tracking-tight text-violet-700 dark:text-violet-300">{uniqueUnits.length}</p>
          <p className="text-[10px] text-muted-foreground mt-1 truncate">{uniqueUnits.slice(0, 4).join(", ")}{uniqueUnits.length > 4 ? "…" : ""}</p>
        </div>
      </div>

      {/* Treemap + Donut Row */}
      {categoryTotals.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          {/* Treemap — Power BI signature visualization */}
          <div className="lg:col-span-3 rounded-xl border bg-card p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-foreground">Assumptions by Category</h3>
              <Badge variant="outline" className="text-[10px]">{allCategoryCounts.length} categories</Badge>
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <Treemap
                data={treemapData}
                dataKey="size"
                aspectRatio={4 / 3}
                stroke="none"
                content={<TreemapContent />}
              />
            </ResponsiveContainer>
          </div>

          {/* Donut Chart */}
          <div className="lg:col-span-2 rounded-xl border bg-card p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3">Distribution</h3>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={donutData}
                  cx="50%"
                  cy="50%"
                  outerRadius={75}
                  innerRadius={45}
                  paddingAngle={2}
                  dataKey="value"
                  stroke="none"
                >
                  {donutData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={((v: number) => v + " items") as never} />
              </PieChart>
            </ResponsiveContainer>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2">
              {donutData.map((entry, i) => {
                const pct = totalAssumptions > 0 ? (entry.value / totalAssumptions * 100).toFixed(1) : "0"
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
      )}

      {/* Horizontal Bar — ranked waterfall style */}
      {barData.length > 0 && (
        <div className="rounded-xl border bg-card p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">Category Ranking</h3>
          <div className="space-y-2">
            {barData.map((item, i) => (
              <div
                key={i}
                className="group flex items-center gap-3 cursor-pointer rounded-lg px-2 py-1.5 hover:bg-muted/50 transition-colors"
                onClick={() => setSelectedCategory(selectedCategory === item.key ? null : item.key)}
              >
                <span className="text-xs text-muted-foreground w-5 text-right tabular-nums">{i + 1}</span>
                <span className="text-[10px] text-muted-foreground mr-1">{getCategoryMeta(item.key).icon}</span>
                <span className="text-xs font-medium w-32 truncate">{item.name}</span>
                <div className="flex-1 h-6 bg-muted/30 rounded-md overflow-hidden relative">
                  <div
                    className="h-full rounded-md transition-all duration-500"
                    style={{
                      width: `${Math.max(item.pct, 2)}%`,
                      background: `linear-gradient(90deg, ${item.color}, ${item.color}cc)`,
                    }}
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-foreground/70 tabular-nums">
                    {item.pct.toFixed(1)}%
                  </span>
                </div>
                <span className="text-xs font-bold tabular-nums w-20 text-right">{item.count} items</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Detail Matrix — Tableau style with search + expandable rows */}
      <div className="rounded-xl border bg-card">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="text-sm font-semibold text-foreground">Assumption Details</h3>
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search assumptions..."
              value={search}
              onChange={e => { setSearch(e.target.value); setSelectedCategory(null) }}
              className="pl-8 h-8 text-xs"
            />
          </div>
        </div>

        {/* Table Header */}
        <div className="grid grid-cols-[1fr_100px_80px_80px] gap-2 px-4 py-2 border-b bg-muted/30 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          <span>Parameter</span>
          <span className="text-right">Value</span>
          <span className="text-center">Unit</span>
          <span className="text-center">Period</span>
        </div>

        <div className="max-h-[500px] overflow-y-auto">
          {filteredCategories.map(([cat, items]) => {
            const isExpanded = expandedCategories.has(cat) || !!search
            const catTotal = items.filter((i) => i.unit === "AZN").reduce((s, i) => s + i.value, 0)
            const filteredItems = search
              ? items.filter((i) => i.label?.toLowerCase().includes(search.toLowerCase()))
              : items

            if (search && filteredItems.length === 0) return null

            return (
              <div key={cat}>
                {/* Category Row */}
                <div
                  className="flex items-center gap-2 px-4 py-2.5 border-b cursor-pointer hover:bg-muted/40 transition-colors"
                  onClick={() => toggleCategory(cat)}
                  style={{ borderLeft: `3px solid ${getCategoryMeta(cat).color}` }}
                >
                  {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                  <span className="text-sm mr-1">{getCategoryMeta(cat).icon}</span>
                  <span className="text-xs font-semibold text-foreground">{getCategoryMeta(cat).label}</span>
                  <Badge variant="secondary" className="text-[9px] ml-1 h-4">{items.length}</Badge>
                  <span className="ml-auto text-xs font-bold tabular-nums text-foreground">
                    {catTotal > 0 ? fmtCurrency(catTotal) + " AZN" : ""}
                  </span>
                </div>

                {/* Item Rows */}
                {isExpanded && filteredItems.map((item) => (
                  <div
                    key={item.id}
                    className="grid grid-cols-[1fr_100px_80px_80px] gap-2 px-4 py-1.5 border-b border-dashed border-muted hover:bg-muted/20 transition-colors"
                    style={{ paddingLeft: "2.5rem" }}
                  >
                    <span className="text-xs text-foreground/80 truncate">{item.label}</span>
                    <span className="text-xs font-semibold tabular-nums text-right text-foreground">
                      {typeof item.value === "number" ? item.value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : item.value}
                    </span>
                    <span className="text-center">
                      {item.unit && (
                        <Badge
                          variant="outline"
                          className="text-[9px] font-normal"
                          style={{ borderColor: `${getCategoryMeta(cat).color}40`, color: getCategoryMeta(cat).color }}
                        >
                          {item.unit}
                        </Badge>
                      )}
                    </span>
                    <span className="text-center">
                      {item.period && (
                        <Badge variant="secondary" className="text-[9px] font-normal">{item.period}</Badge>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2 border-t bg-muted/20 text-[10px] text-muted-foreground">
          <span>{filteredCategories.length} categories • {search ? filteredCategories.reduce((s, [, items]) => s + items.filter((i) => i.label?.toLowerCase().includes(search.toLowerCase())).length, 0) : totalAssumptions} items</span>
          {selectedCategory && (
            <button className="text-primary hover:underline" onClick={() => setSelectedCategory(null)}>
              Clear filter
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
