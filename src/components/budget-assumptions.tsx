"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { useSession } from "next-auth/react"
import { useQuery } from "@tanstack/react-query"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Treemap, Legend,
} from "recharts"
import { Settings2, Layers, Hash, Search, ChevronDown, ChevronRight, TrendingUp, DollarSign, Plus, Pencil, AlertTriangle } from "lucide-react"
import { BudgetAssumptionEditor, type EditableAssumption } from "@/components/budget-assumption-editor"
import { ambiguousKeys } from "@/lib/budgeting/assumption-resolver"

/**
 * Category display metadata now lives in `@/lib/budgeting/assumption-categories`
 * — the editor dialog needs the same catalogue, and importing it from this
 * component made a tab → editor → tab module cycle.
 *
 * Re-exported here so existing importers (and `budget-assumptions.test.ts`)
 * keep working against the original path.
 */
import { CATEGORY_META, getCategoryMeta } from "@/lib/budgeting/assumption-categories"

export {
  CATEGORY_META,
  DEFAULT_CATEGORY_META,
  getCategoryMeta,
  type CategoryMeta,
} from "@/lib/budgeting/assumption-categories"

/**
 * i18n key per known category code. `CATEGORY_META.label` stays as the
 * English source of truth (and the fallback for codes the catalogue has not
 * caught up with yet); the UI resolves this map through next-intl so the
 * treemap tiles / donut legend / ranking bars / group headers speak the
 * viewer's language.
 */
const CATEGORY_LABEL_KEYS: Record<string, string> = Object.fromEntries(
  Object.keys(CATEGORY_META).map((code) => [code, `assumptionCategory.${code}`]),
)

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
  /** Phase 7.Q — null is the plan-level default; set is that company's override. */
  companyId: string | null
  /** Joined by the GET route purely to label an override row. */
  company?: { id: string; name: string; code: string | null } | null
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
  /** Localized "{n} items" formatter injected by the parent. */
  itemsLabel?: (count: number) => string
}

// Treemap custom content
function TreemapContent(props: TreemapContentProps) {
  const { x = 0, y = 0, width = 0, height = 0, name = "", value = 0, color = "#9ca3af", itemsLabel } = props
  if (width < 40 || height < 30) return null
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx={4} fill={color} fillOpacity={0.85} stroke="rgba(255,255,255,0.2)" strokeWidth={2} />
      {width > 60 && height > 40 && (
        <>
          <text x={x + 8} y={y + 18} fill="#fff" fontSize={11} fontWeight={600}>{name}</text>
          <text x={x + 8} y={y + 34} fill="rgba(255,255,255,0.8)" fontSize={10}>{itemsLabel ? itemsLabel(value) : value}</text>
        </>
      )}
    </g>
  )
}

export function BudgetAssumptions({ planId }: { planId: string }) {
  const t = useTranslations("budgeting")
  const categoryLabel = (cat: string): string => {
    const key = CATEGORY_LABEL_KEYS[cat]
    return key ? t(key) : getCategoryMeta(cat).label
  }
  const { data: session } = useSession()
  const orgId = session?.user?.organizationId
  const [search, setSearch] = useState("")
  // Collapsed-by-default hid everything: a plan typically holds a handful of
  // drivers, so opening the tab showed two category headers and no values at
  // all — the reader had to click before seeing a single number. Categories
  // now start OPEN and collapse on demand, which is the right default for a
  // short list; the toggle is unchanged.
  //
  // `null` means "untouched" and renders every category open. It only becomes
  // a real Set once the reader toggles something, so the default never has to
  // be recomputed when the fetched rows change.
  const [expandedCategories, setExpandedCategories] = useState<Set<string> | null>(null)
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  // Phase 7.Q — `null` while closed; `{ row: null }` opens in create mode.
  const [editing, setEditing] = useState<{ row: AssumptionItem | null } | null>(null)

  const { data: assumptions, isLoading, refetch } = useQuery<AssumptionItem[]>({
    queryKey: ["assumptions", planId],
    queryFn: async () => {
      const res = await fetch(`/api/budgeting/assumptions?planId=${planId}`, {
        headers: { "x-organization-id": orgId || "" },
      })
      return res.json()
    },
    enabled: !!planId && !!orgId,
  })

  const editorDialog = (
    <BudgetAssumptionEditor
      planId={planId}
      open={editing !== null}
      existing={(editing?.row as EditableAssumption | null | undefined) ?? null}
      onOpenChange={(next) => { if (!next) setEditing(null) }}
      onSaved={() => { void refetch() }}
    />
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

  if (!assumptions || assumptions.length === 0) {
    // Phase 7.Q — this used to offer "Import Excel data" and route to AI Auto
    // Import, which has no assumptions data type and therefore could never fill
    // this tab: the button ran, the import succeeded, the tab stayed empty.
    // Entering a driver by hand is the path that actually exists.
    return (
      <>
        <Card data-testid="assumptions-empty">
          <CardContent className="p-12 text-center">
            <Settings2 className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium text-foreground">{t("assumptionsEmptyTitle")}</p>
            <p className="mx-auto mt-1 max-w-xl text-sm text-muted-foreground">
              {t("assumptionsEmptyDescription")}
            </p>
            <Button className="mt-5" data-testid="assumptions-add-first" onClick={() => setEditing({ row: null })}>
              <Plus className="h-4 w-4 mr-1" /> {t("assumptionAddFirst")}
            </Button>
          </CardContent>
        </Card>
        {editorDialog}
      </>
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
  /** Every category present, i.e. what the untouched default renders as open. */
  const allCategoryKeys = categories

  // All categories with item counts (for treemap — shows ALL categories)
  const allCategoryCounts = Array.from(grouped.entries()).map(([cat, items]) => {
    const aznTotal = items.filter((i) => i.unit === "AZN").reduce((s, i) => s + i.value, 0)
    const totalSum = items.reduce((s, i) => s + (typeof i.value === "number" ? i.value : 0), 0)
    const meta = getCategoryMeta(cat)
    return {
      name: categoryLabel(cat), key: cat, count: items.length,
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
    return categoryLabel(cat).toLowerCase().includes(q) ||
      items.some((i) => i.label?.toLowerCase().includes(q))
  })

  const toggleCategory = (cat: string) => {
    setExpandedCategories(prev => {
      // `null` = the untouched default, which renders every category open, so
      // the first click must start from "all open" and remove one — not from
      // an empty set, which would collapse everything except the one clicked.
      const next = new Set(prev ?? allCategoryKeys)
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

  // Keys with more than one row at the plan-level tier. Checked against the
  // default tier (companyId=null) because that is the collision the resolver
  // must silently break; a company override shadowing a default is intended
  // layering, not a duplicate.
  const duplicateKeys = ambiguousKeys(assumptions, null)

  return (
    <div className="space-y-4" data-testid="assumptions-root">
      {editorDialog}
      {/* KPI Strip — Power BI style scorecards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-amber-50 to-amber-100 border border-amber-200 dark:from-amber-950/30 dark:to-amber-900/20 dark:border-amber-800 p-4">
          <div className="absolute top-0 right-0 w-20 h-20 bg-amber-200 dark:bg-amber-800 rounded-full -mr-6 -mt-6" />
          <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 text-[10px] font-semibold uppercase tracking-widest mb-2">
            <DollarSign className="h-3.5 w-3.5" /> {t("assumptionsKpiTotalValue")}
          </div>
          <p className="text-2xl font-bold tracking-tight text-amber-700 dark:text-amber-300">{fmtNum(totalValue)} <span className="text-sm font-normal text-muted-foreground">AZN</span></p>
          <p className="text-[10px] text-muted-foreground mt-1">{t("assumptionsKpiTotalValueHint")}</p>
        </div>

        <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-violet-50 to-violet-100 border border-violet-200 dark:from-violet-950/30 dark:to-violet-900/20 dark:border-violet-800 p-4">
          <div className="absolute top-0 right-0 w-20 h-20 bg-violet-200 dark:bg-violet-800 rounded-full -mr-6 -mt-6" />
          <div className="flex items-center gap-2 text-violet-600 dark:text-violet-400 text-[10px] font-semibold uppercase tracking-widest mb-2">
            <Hash className="h-3.5 w-3.5" /> {t("assumptionsKpiParameters")}
          </div>
          <p className="text-2xl font-bold tracking-tight text-violet-700 dark:text-violet-300">{totalAssumptions}</p>
          <p className="text-[10px] text-muted-foreground mt-1">{t("assumptionsCategoriesCount", { count: categories.length })}</p>
        </div>

        <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-emerald-50 to-emerald-100 border border-emerald-200 dark:from-emerald-950/30 dark:to-emerald-900/20 dark:border-emerald-800 p-4">
          <div className="absolute top-0 right-0 w-20 h-20 bg-emerald-200 dark:bg-emerald-800 rounded-full -mr-6 -mt-6" />
          <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-[10px] font-semibold uppercase tracking-widest mb-2">
            <TrendingUp className="h-3.5 w-3.5" /> {t("assumptionsKpiTopCategory")}
          </div>
          <p className="text-lg font-bold tracking-tight truncate text-emerald-700 dark:text-emerald-300">{topCategory?.name || "—"}</p>
          <p className="text-[10px] text-muted-foreground mt-1">{topCategory ? t("assumptionsItemsCount", { count: topCategory.count }) : ""}</p>
        </div>

        <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-violet-50 to-violet-100 border border-violet-200 dark:from-violet-950/30 dark:to-violet-900/20 dark:border-violet-800 p-4">
          <div className="absolute top-0 right-0 w-20 h-20 bg-violet-200 dark:bg-violet-800 rounded-full -mr-6 -mt-6" />
          <div className="flex items-center gap-2 text-violet-600 dark:text-violet-400 text-[10px] font-semibold uppercase tracking-widest mb-2">
            <Layers className="h-3.5 w-3.5" /> {t("assumptionsKpiUnits")}
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
              <h3 className="text-sm font-semibold text-foreground">{t("assumptionsByCategoryTitle")}</h3>
              <Badge variant="outline" className="text-[10px]">{t("assumptionsCategoriesCount", { count: allCategoryCounts.length })}</Badge>
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <Treemap
                data={treemapData}
                dataKey="size"
                aspectRatio={4 / 3}
                stroke="none"
                content={<TreemapContent itemsLabel={(count) => t("assumptionsItemsCount", { count })} />}
              />
            </ResponsiveContainer>
          </div>

          {/* Donut Chart */}
          <div className="lg:col-span-2 rounded-xl border bg-card p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3">{t("assumptionsDistributionTitle")}</h3>
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
                <Tooltip formatter={((v: number) => t("assumptionsItemsCount", { count: v })) as never} />
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
          <h3 className="text-sm font-semibold text-foreground mb-3">{t("assumptionsCategoryRankingTitle")}</h3>
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
                <span className="text-xs font-bold tabular-nums w-20 text-right">{t("assumptionsItemsCount", { count: item.count })}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Detail Matrix — Tableau style with search + expandable rows */}
      <div className="rounded-xl border bg-card">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="text-sm font-semibold text-foreground" data-testid="assumptions-details-title">{t("assumptionsDetailsTitle")}</h3>
          <div className="flex items-center gap-2">
            <div className="relative w-64">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder={t("assumptionsSearchPlaceholder")}
                value={search}
                onChange={e => { setSearch(e.target.value); setSelectedCategory(null) }}
                className="pl-8 h-8 text-xs"
              />
            </div>
            <Button size="sm" className="h-8" data-testid="assumptions-add" onClick={() => setEditing({ row: null })}>
              <Plus className="h-3.5 w-3.5 mr-1" /> {t("btnAdd")}
            </Button>
          </div>
        </div>

        {/* Duplicate-key warning. There is no UNIQUE constraint on
            (planId, key, companyId) — see the 7.Q migration — so the resolver
            has to break ties deterministically, and a reader deserves to know
            a tie was broken rather than to trust the surviving number. */}
        {duplicateKeys.length > 0 && (
          <div data-testid="assumptions-duplicate-warning" className="flex items-start gap-2 px-4 py-2 border-b bg-amber-50 dark:bg-amber-950/30 text-[11px] text-amber-800 dark:text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>{t("assumptionsDuplicateKeys", { keys: duplicateKeys.join(", ") })}</span>
          </div>
        )}

        {/* Table Header */}
        <div className="grid grid-cols-[1fr_110px_100px_80px_80px_32px] gap-2 px-4 py-2 border-b bg-muted/30 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          <span>{t("assumptionsColParameter")}</span>
          <span>{t("assumptionsColScope")}</span>
          <span className="text-right">{t("assumptionsColValue")}</span>
          <span className="text-center">{t("assumptionsColUnit")}</span>
          <span className="text-center">{t("assumptionsColPeriod")}</span>
          <span />
        </div>

        <div className="max-h-[500px] overflow-y-auto">
          {filteredCategories.map(([cat, items]) => {
            const isExpanded = (expandedCategories?.has(cat) ?? true) || !!search
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
                  <span className="text-xs font-semibold text-foreground">{categoryLabel(cat)}</span>
                  <Badge variant="secondary" className="text-[9px] ml-1 h-4">{items.length}</Badge>
                  <span className="ml-auto text-xs font-bold tabular-nums text-foreground">
                    {catTotal > 0 ? fmtCurrency(catTotal) + " AZN" : ""}
                  </span>
                </div>

                {/* Item Rows */}
                {isExpanded && filteredItems.map((item) => (
                  <div
                    key={item.id}
                    data-testid="assumptions-row"
                    data-assumption-key={item.key}
                    data-assumption-scope={item.companyId ? "company" : "plan"}
                    className="group grid grid-cols-[1fr_110px_100px_80px_80px_32px] items-center gap-2 px-4 py-1.5 border-b border-dashed border-muted hover:bg-muted/20 transition-colors"
                    style={{ paddingLeft: "2.5rem" }}
                  >
                    <span className="text-xs text-foreground/80 truncate" title={item.notes ?? undefined}>
                      {item.label}
                      {/* The note is the "why", and it is the answer to the only
                          question a board actually asks about a driver. */}
                      {item.notes && <span className="ml-1 text-muted-foreground">*</span>}
                    </span>
                    {/* Scope: a company override must be visually distinct from
                        the plan-level default it shadows, or the two-tier model
                        is invisible and reads as one flat list. */}
                    <span className="truncate">
                      {item.companyId ? (
                        <Badge variant="outline" className="text-[9px] font-normal border-primary/40 text-primary" title={item.company?.name ?? undefined}>
                          {item.company?.code || item.company?.name || t("assumptionScopeCompany")}
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-[9px] font-normal text-muted-foreground">
                          {t("assumptionScopePlan")}
                        </Badge>
                      )}
                    </span>
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
                    <button
                      type="button"
                      onClick={() => setEditing({ row: item })}
                      title={t("assumptionEditTitle")}
                      aria-label={`${t("assumptionEditTitle")}: ${item.label}`}
                      className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2 border-t bg-muted/20 text-[10px] text-muted-foreground">
          <span>{t("assumptionsCategoriesCount", { count: filteredCategories.length })} • {t("assumptionsItemsCount", { count: search ? filteredCategories.reduce((s, [, items]) => s + items.filter((i) => i.label?.toLowerCase().includes(search.toLowerCase())).length, 0) : totalAssumptions })}</span>
          {selectedCategory && (
            <button className="text-primary hover:underline" onClick={() => setSelectedCategory(null)}>
              {t("assumptionsClearFilter")}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
