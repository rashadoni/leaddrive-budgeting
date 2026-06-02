"use client"
import { useEffect, useMemo, useState } from "react"
import { useTranslations, useLocale } from "next-intl"
import Link from "next/link"
import { ArrowRight, CheckCircle2, ChevronDown, ChevronRight, ChevronUp, Search, X } from "lucide-react"
import { buildCtas } from "./cta"

/** Locale-aware display name — English fallback, never forced Russian. */
function pickName(
  g: { indicatorNameRu: string | null; indicatorNameAz: string | null; indicatorNameEn: string },
  locale: string,
): string {
  if (locale === "az") return g.indicatorNameAz ?? g.indicatorNameEn
  if (locale === "ru") return g.indicatorNameRu ?? g.indicatorNameEn
  return g.indicatorNameEn
}

interface GappyIndicator {
  indicatorCode: string
  /** 2026-05-27 — humanized labels added so finance users see localized names
   *  instead of cryptic AGRO_SUGAR_CONTENT in the gaps table. */
  indicatorNameRu: string | null
  indicatorNameAz: string | null
  indicatorNameEn: string
  affectedEntities: string[]
  affectedCellCount: number
  missingVariable: string | null
  errorCode: string
  category: string
  remediation: string
}

interface HealthSummary {
  totalIvs: number
  green: number
  amber: number
  red: number
  unknown: number
}

interface HealthResponse {
  summary: HealthSummary
  unknownByErrorCode: Record<string, number>
  gappyIndicators: GappyIndicator[]
  generatedAt: string
}

// 2026-05-27 — bumped contrast: original light-tint chips with light-300
// foreground colors were barely readable on the white card background
// (`bg-blue-500/10` + `text-blue-300` ≈ 2.5:1, fails WCAG AA). New chips
// use ring + saturated foreground that works in both light + dark mode.
const CATEGORY_STYLE: Record<string, { cls: string; label: string }> = {
  "external-feed": {
    cls: "bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 ring-1 ring-sky-300 dark:ring-sky-700/60",
    label: "🔌 External feed needed",
  },
  "ingest-gap": {
    cls: "bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 ring-1 ring-amber-300 dark:ring-amber-700/60",
    label: "📥 Ingest gap",
  },
  "formula-edge-case": {
    cls: "bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 ring-1 ring-rose-300 dark:ring-rose-700/60",
    label: "⚙ Formula edge case",
  },
  "no-data": {
    cls: "bg-slate-100 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 ring-1 ring-slate-300 dark:ring-slate-700",
    label: "⚪ Data not entered",
  },
  "leaf-rollup": {
    cls: "bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 ring-1 ring-violet-300 dark:ring-violet-700/60",
    label: "📊 Rollup (correct for leaf)",
  },
  "code-bug": {
    cls: "bg-rose-100 dark:bg-rose-900/50 text-rose-800 dark:text-rose-200 ring-1 ring-rose-400 dark:ring-rose-600/70 font-medium",
    label: "🐛 Code bug",
  },
}

// 2026-05-27 (Phase 8 Group A polish) — interactive controls. Sort state
// is persisted to localStorage so reopening the tab keeps the chosen
// ordering; search query intentionally NOT persisted (typed text
// reappearing on next visit is annoying).
type SortColumn = "cells" | "indicator" | "category" | "missingVar"
type SortDir = "asc" | "desc"
const SORT_LS_KEY = "indicator-health-sort-v1"

function readSortFromStorage(): { col: SortColumn; dir: SortDir } {
  if (typeof window === "undefined") return { col: "cells", dir: "desc" }
  try {
    const raw = window.localStorage.getItem(SORT_LS_KEY)
    if (!raw) return { col: "cells", dir: "desc" }
    const parsed = JSON.parse(raw)
    return {
      col: (parsed.col as SortColumn) ?? "cells",
      dir: (parsed.dir as SortDir) ?? "desc",
    }
  } catch {
    return { col: "cells", dir: "desc" }
  }
}

function rowKey(g: GappyIndicator): string {
  return `${g.indicatorCode}::${g.errorCode}::${g.missingVariable ?? "_"}`
}

export function IndicatorHealthView() {
  const t = useTranslations("adminIndicatorHealth")
  const locale = useLocale()
  const [data, setData] = useState<HealthResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filterCategory, setFilterCategory] = useState<string | null>(null)
  // 2026-05-27 — 4 new interactive controls (see plan robust-drifting-pancake.md)
  const [searchQuery, setSearchQuery] = useState("")
  const [entityFilter, setEntityFilter] = useState<string | null>(null)
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set())
  const [sortColumn, setSortColumn] = useState<SortColumn>("cells")
  const [sortDir, setSortDir] = useState<SortDir>("desc")

  // Hydrate sort preference from localStorage on first client mount.
  useEffect(() => {
    const stored = readSortFromStorage()
    setSortColumn(stored.col)
    setSortDir(stored.dir)
  }, [])

  // Persist sort changes (debouncing not needed — single-click events).
  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      window.localStorage.setItem(
        SORT_LS_KEY,
        JSON.stringify({ col: sortColumn, dir: sortDir }),
      )
    } catch {
      // localStorage can throw in private mode — non-fatal.
    }
  }, [sortColumn, sortDir])

  useEffect(() => {
    setLoading(true)
    fetch("/api/admin/indicator-health")
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((j: HealthResponse) => setData(j))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [])

  // Derived: filter → entity-filter → search → sort. useMemo keeps it
  // O(N log N) instead of recomputing per render. `filtered` is the
  // intermediate pre-sort list (used by the count badges); `visible`
  // is the final sorted list rendered in the table body.
  const filtered = useMemo(() => {
    if (!data) return []
    let rows = data.gappyIndicators
    if (filterCategory) rows = rows.filter((g) => g.category === filterCategory)
    if (entityFilter)
      rows = rows.filter((g) => g.affectedEntities.includes(entityFilter))
    const q = searchQuery.trim().toLocaleLowerCase()
    if (q) {
      rows = rows.filter((g) => {
        // Match across all name variants so a search term works in any locale.
        const ru = (g.indicatorNameRu ?? "").toLocaleLowerCase()
        const az = (g.indicatorNameAz ?? "").toLocaleLowerCase()
        const en = g.indicatorNameEn.toLocaleLowerCase()
        const code = g.indicatorCode.toLocaleLowerCase()
        const miss = (g.missingVariable ?? "").toLocaleLowerCase()
        return (
          ru.includes(q) || az.includes(q) || en.includes(q) || code.includes(q) || miss.includes(q)
        )
      })
    }
    return rows
  }, [data, filterCategory, entityFilter, searchQuery])

  const visible = useMemo(() => {
    const sorted = [...filtered]
    const dir = sortDir === "asc" ? 1 : -1
    sorted.sort((a, b) => {
      switch (sortColumn) {
        case "cells":
          return (a.affectedCellCount - b.affectedCellCount) * dir
        case "indicator": {
          const an = pickName(a, locale).toLocaleLowerCase()
          const bn = pickName(b, locale).toLocaleLowerCase()
          return an.localeCompare(bn) * dir
        }
        case "category":
          return a.category.localeCompare(b.category) * dir
        case "missingVar":
          return (a.missingVariable ?? "").localeCompare(b.missingVariable ?? "") * dir
        default:
          return 0
      }
    })
    return sorted
  }, [filtered, sortColumn, sortDir, locale])

  // Cells column impact-bar normalization — compute once per data fetch.
  const maxCells = useMemo(() => {
    if (!data || data.gappyIndicators.length === 0) return 1
    return Math.max(...data.gappyIndicators.map((g) => g.affectedCellCount), 1)
  }, [data])

  function toggleSort(col: SortColumn) {
    if (sortColumn === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortColumn(col)
      // Sensible defaults: cells/category descending, names ascending.
      setSortDir(col === "cells" ? "desc" : "asc")
    }
  }

  function toggleExpanded(key: string) {
    setExpandedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (loading && !data) {
    return <div className="text-sm text-muted-foreground">{t("loading")}</div>
  }
  if (error) {
    return (
      <div className="border border-red-200 bg-red-50 text-red-700 rounded p-3 text-sm dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">
        ❌ {error}
      </div>
    )
  }
  if (!data) return null

  const { summary, unknownByErrorCode, gappyIndicators } = data

  const greenPct = ((summary.green / summary.totalIvs) * 100).toFixed(1)
  const computedPct = (
    ((summary.green + summary.amber + summary.red) / summary.totalIvs) *
    100
  ).toFixed(1)

  const hasActiveFilter = searchQuery || filterCategory || entityFilter

  return (
    <div className="space-y-6">
      {/* ── Summary tiles ────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          { label: t("summaryGreen"), value: summary.green, sub: `${greenPct}%`, dot: "bg-emerald-500", num: "text-emerald-600 dark:text-emerald-400", accent: "border-l-emerald-500" },
          { label: t("summaryAmber"), value: summary.amber, sub: null, dot: "bg-amber-500", num: "text-amber-600 dark:text-amber-400", accent: "border-l-amber-500" },
          { label: t("summaryRed"), value: summary.red, sub: null, dot: "bg-rose-500", num: "text-rose-600 dark:text-rose-400", accent: "border-l-rose-500" },
          { label: t("summaryUnknown"), value: summary.unknown, sub: null, dot: "bg-slate-400", num: "text-slate-600 dark:text-slate-300", accent: "border-l-slate-400" },
        ].map((tile) => (
          <div key={tile.label} className={`rounded-lg border border-l-[3px] ${tile.accent} bg-card shadow-sm p-4 transition-shadow hover:shadow-md`}>
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
              <span className={`h-2 w-2 rounded-full ${tile.dot}`} aria-hidden />
              {tile.label}
            </div>
            <div className={`text-2xl font-bold tabular-nums mt-1.5 ${tile.num}`}>{tile.value}</div>
            {tile.sub && <div className="text-[10px] text-muted-foreground mt-0.5">{tile.sub}</div>}
          </div>
        ))}
        <div className="rounded-lg border border-l-[3px] border-l-primary bg-card shadow-sm p-4 transition-shadow hover:shadow-md">
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
            {t("summaryComputed")}
          </div>
          <div className="text-2xl font-bold tabular-nums mt-1.5">{computedPct}%</div>
          <div className="mt-2 h-1.5 w-full rounded-full bg-muted overflow-hidden" aria-hidden>
            <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${computedPct}%` }} />
          </div>
          <div className="text-[10px] text-muted-foreground mt-1">
            {t("summaryTotalIvs", { n: summary.totalIvs })}
          </div>
        </div>
      </div>

      {/* ── Unknown by error code ─────────────────────────────── */}
      <div className="rounded-lg border bg-card shadow-sm p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2.5">
          {t("unknownBreakdown")}
        </div>
        <div className="flex gap-2 flex-wrap">
          {Object.entries(unknownByErrorCode)
            .sort((a, b) => b[1] - a[1])
            .map(([code, count]) => (
              <div
                key={code}
                className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1 text-xs"
                title={code}
              >
                <span className="text-foreground/80">
                  {t.has(`errorCode.${code}` as never) ? t(`errorCode.${code}` as never) : code}
                </span>
                <span className="font-semibold tabular-nums rounded bg-muted px-1.5 py-0.5">{count}</span>
              </div>
            ))}
        </div>
      </div>

      {/* ── Search + active-filter banner ─────────────────────── */}
      <div className="space-y-2">
        <div className="relative max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60 pointer-events-none" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="w-full pl-8 pr-8 py-1.5 text-xs border border-border rounded bg-background placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
            aria-label={t("searchAriaLabel")}
            data-testid="health-search"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={t("clearSearchAriaLabel")}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {hasActiveFilter && (
          <div className="flex items-center gap-2 flex-wrap text-[11px]">
            <span className="text-muted-foreground">{t("activeFilters")}</span>
            {filterCategory && (
              <button
                type="button"
                onClick={() => setFilterCategory(null)}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded ring-1 ring-primary/30 bg-primary/5 text-primary hover:bg-primary/10"
              >
                {t.has(`category.${filterCategory}` as never)
                  ? t(`category.${filterCategory}` as never)
                  : filterCategory}{" "}
                <X className="h-3 w-3" />
              </button>
            )}
            {entityFilter && (
              <button
                type="button"
                onClick={() => setEntityFilter(null)}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded ring-1 ring-primary/30 bg-primary/5 text-primary hover:bg-primary/10"
                data-testid="entity-filter-chip"
              >
                Entity: <span className="font-mono">{entityFilter}</span>{" "}
                <X className="h-3 w-3" />
              </button>
            )}
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded ring-1 ring-primary/30 bg-primary/5 text-primary hover:bg-primary/10"
              >
                «{searchQuery}» <X className="h-3 w-3" />
              </button>
            )}
            <span className="text-muted-foreground ml-1">
              {t("rowsCount", { visible: visible.length, total: gappyIndicators.length })}
            </span>
          </div>
        )}
      </div>

      {/* ── Category filter ───────────────────────────────────── */}
      <div className="flex gap-2 flex-wrap items-center">
        <span className="text-xs text-muted-foreground">{t("filterLabel")}</span>
        <button
          type="button"
          onClick={() => setFilterCategory(null)}
          className={`px-2 py-1 rounded text-xs border transition-colors hover:bg-muted/60 ${
            !filterCategory ? "bg-muted" : ""
          }`}
        >
          {t("filterAll", { n: gappyIndicators.length })}
        </button>
        {Object.entries(CATEGORY_STYLE).map(([cat, s]) => {
          const count = gappyIndicators.filter((g) => g.category === cat).length
          if (count === 0) return null
          return (
            <button
              key={cat}
              type="button"
              onClick={() => setFilterCategory(cat)}
              className={`px-2.5 py-1 rounded-md text-xs ${s.cls} transition-all hover:brightness-95 dark:hover:brightness-110 ${
                filterCategory === cat ? "ring-2 ring-primary/60" : ""
              }`}
            >
              {t.has(`category.${cat}` as never) ? t(`category.${cat}` as never) : s.label} ({count})
            </button>
          )
        })}
      </div>

      {/* ── Gappy indicators table ────────────────────────────── */}
      <div className="rounded-lg border bg-card shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted text-xs">
            <tr>
              <th className="w-6 p-2" />
              <SortableTh
                label={t("thIndicator")}
                col="indicator"
                sortColumn={sortColumn}
                sortDir={sortDir}
                onSort={toggleSort}
              />
              <SortableTh
                label={t("thCategory")}
                col="category"
                sortColumn={sortColumn}
                sortDir={sortDir}
                onSort={toggleSort}
              />
              <SortableTh
                label={t("thMissingVar")}
                col="missingVar"
                sortColumn={sortColumn}
                sortDir={sortDir}
                onSort={toggleSort}
              />
              <SortableTh
                label={t("thCells")}
                col="cells"
                sortColumn={sortColumn}
                sortDir={sortDir}
                onSort={toggleSort}
                align="right"
              />
              <th className="text-left p-2">{t("thEntities")}</th>
              <th className="text-left p-2">{t("thRemediation")}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((g) => {
              const style = CATEGORY_STYLE[g.category] ?? CATEGORY_STYLE["no-data"]
              const key = rowKey(g)
              const expanded = expandedKeys.has(key)
              return (
                <Row
                  key={key}
                  g={g}
                  style={style}
                  expanded={expanded}
                  maxCells={maxCells}
                  entityFilter={entityFilter}
                  onToggleExpand={() => toggleExpanded(key)}
                  onClickEntity={(code) => setEntityFilter(code)}
                />
              )
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                  {hasActiveFilter ? (
                    <div className="flex flex-col items-center gap-2">
                      <Search className="h-6 w-6 text-muted-foreground/40" aria-hidden />
                      <p className="text-sm">{t("emptyFiltered")}</p>
                      <button
                        type="button"
                        onClick={() => {
                          setSearchQuery("")
                          setFilterCategory(null)
                          setEntityFilter(null)
                        }}
                        className="text-xs font-medium text-primary hover:underline"
                      >
                        {t("clearAllFilters")}
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2">
                      <CheckCircle2 className="h-6 w-6 text-emerald-500" aria-hidden />
                      <p className="text-sm">{t("emptyNoGaps")}</p>
                    </div>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="text-[10px] text-muted-foreground">
        {t("generatedAt", { date: new Date(data.generatedAt).toLocaleString() })}
      </div>
    </div>
  )
}

function SortableTh({
  label,
  col,
  sortColumn,
  sortDir,
  onSort,
  align = "left",
}: {
  label: string
  col: SortColumn
  sortColumn: SortColumn
  sortDir: SortDir
  onSort: (col: SortColumn) => void
  align?: "left" | "right"
}) {
  const active = sortColumn === col
  return (
    <th className={`p-2 text-${align} cursor-pointer select-none`}>
      <button
        type="button"
        onClick={() => onSort(col)}
        className={`inline-flex items-center gap-1 ${
          align === "right" ? "ml-auto" : ""
        } ${active ? "text-foreground" : "text-muted-foreground hover:text-foreground"} transition-colors`}
        data-testid={`sort-${col}`}
      >
        {label}
        {active ? (
          sortDir === "asc" ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )
        ) : (
          <span className="w-3 h-3 opacity-30">⇅</span>
        )}
      </button>
    </th>
  )
}

function Row({
  g,
  style,
  expanded,
  maxCells,
  entityFilter,
  onToggleExpand,
  onClickEntity,
}: {
  g: GappyIndicator
  style: { cls: string; label: string }
  expanded: boolean
  maxCells: number
  entityFilter: string | null
  onToggleExpand: () => void
  onClickEntity: (code: string) => void
}) {
  // Cells column impact bar — width proportional to maxCells; color
  const t = useTranslations("adminIndicatorHealth")
  const locale = useLocale()
  // bracket by absolute count (severity is "how many gaps" not "% of
  // the dataset").
  const barWidth = `${Math.max(4, Math.round((g.affectedCellCount / maxCells) * 100))}%`
  const barColor =
    g.affectedCellCount >= 50
      ? "bg-rose-500"
      : g.affectedCellCount >= 10
        ? "bg-amber-500"
        : "bg-emerald-500"

  // Remediation CTAs — manual entry only when the missing var is actually
  // hand-enterable; deep-links data-entry with company + metric prefilled.
  const ctas = buildCtas(g)

  return (
    <>
      <tr
        className="border-t align-top hover:bg-muted/40 transition-colors cursor-pointer"
        onClick={onToggleExpand}
      >
        <td className="p-2 text-muted-foreground">
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </td>
        <td className="p-2 text-xs">
          {/* 2026-05-27 — human name primary, code as small mono
              subtitle. Tooltip shows English fallback for
              bilingual context. */}
          <div
            className="font-medium text-[12px]"
            title={g.indicatorNameEn}
          >
            {pickName(g, locale)}
          </div>
          <div className="font-mono text-[10px] text-muted-foreground/80 mt-0.5">
            {g.indicatorCode}
          </div>
        </td>
        <td className="p-2">
          <span
            className={`inline-flex items-center whitespace-nowrap px-2 py-0.5 rounded-md text-[10px] ${style.cls}`}
          >
            {t.has(`category.${g.category}` as never) ? t(`category.${g.category}` as never) : style.label}
          </span>
        </td>
        <td className="p-2 font-mono text-[11px] text-muted-foreground">
          {g.missingVariable ?? <span className="italic">—</span>}
        </td>
        <td className="p-2 text-right font-mono text-xs">
          <div className="flex items-center gap-2 justify-end">
            <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full ${barColor} transition-all`}
                style={{ width: barWidth }}
                aria-hidden="true"
              />
            </div>
            <span className="tabular-nums min-w-[2.5ch] text-right">
              {g.affectedCellCount}
            </span>
          </div>
        </td>
        <td
          className="p-2 text-[11px]"
          title={g.affectedEntities.join(", ")}
        >
          <div className="flex flex-wrap gap-1">
            {g.affectedEntities.slice(0, 3).map((code) => (
              <button
                key={code}
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onClickEntity(code)
                }}
                className={`px-1.5 py-0.5 rounded text-[10px] font-mono ring-1 transition-colors ${
                  entityFilter === code
                    ? "bg-primary/15 text-primary ring-primary/40"
                    : "bg-muted/50 text-muted-foreground ring-border hover:bg-muted hover:text-foreground"
                }`}
                data-testid={`entity-chip-${code}`}
              >
                {code}
              </button>
            ))}
            {g.affectedEntities.length > 3 && (
              <span
                className="text-muted-foreground self-center text-[10px]"
                title={g.affectedEntities.slice(3).join(", ")}
              >
                +{g.affectedEntities.length - 3}
              </span>
            )}
          </div>
        </td>
        <td className="p-2 text-[11px] text-foreground/80 max-w-sm align-top">
          <p className="whitespace-normal break-words leading-relaxed">
            {t.has(`action.${g.category}` as never) ? t(`action.${g.category}` as never) : g.remediation}
          </p>
          {ctas.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5" data-testid={`cta-${rowKey(g)}`}>
              {ctas.map((cta) => (
                <Link
                  key={cta.href + cta.labelKey}
                  href={cta.href}
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 font-medium text-primary ring-1 ring-primary/15 hover:bg-primary/20 hover:ring-primary/30 transition-colors"
                >
                  {t(cta.labelKey as never)}
                  <ArrowRight className="h-3 w-3" />
                </Link>
              ))}
            </div>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="border-t bg-muted/20">
          <td />
          <td colSpan={6} className="p-3 text-xs space-y-2" data-testid={`expanded-${rowKey(g)}`}>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-1">
                {t("expandedRemediation")}
              </div>
              <p className="text-foreground/90 leading-relaxed">
                {t.has(`action.${g.category}` as never) ? t(`action.${g.category}` as never) : g.remediation}
              </p>
              <div className="mt-2 text-[10px] uppercase tracking-wider text-muted-foreground/70">
                {t("expandedTechnicalDetail")}
              </div>
              <p className="text-muted-foreground leading-relaxed whitespace-pre-line">
                {g.remediation}
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-1">
                  {t("expandedErrorCode")}
                </div>
                <code className="text-[11px] font-mono">{g.errorCode}</code>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-1">
                  {t("expandedMissingVariable")}
                </div>
                <code className="text-[11px] font-mono">
                  {g.missingVariable ?? "—"}
                </code>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-1">
                  {t("expandedAffectedEntities", { n: g.affectedEntities.length })}
                </div>
                <div className="flex flex-wrap gap-1">
                  {g.affectedEntities.map((code) => (
                    <button
                      key={code}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onClickEntity(code)
                      }}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-mono ring-1 transition-colors ${
                        entityFilter === code
                          ? "bg-primary/15 text-primary ring-primary/40"
                          : "bg-background text-muted-foreground ring-border hover:text-foreground"
                      }`}
                    >
                      {code}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
