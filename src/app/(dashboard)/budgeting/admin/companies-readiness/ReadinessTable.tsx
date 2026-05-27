"use client"
/**
 * Phase 7.M Step 5 (Option E) — client table for the readiness dashboard.
 *
 * Self-contained: sort by score, filter by tier, expand row for the
 * per-area drill-down, CSV export of the gap list. Pure React state;
 * no extra hooks or libraries needed at this row count.
 */
import { useMemo, useState } from "react"
import { useTranslations } from "next-intl"

type Tier = "complete" | "good" | "partial" | "thin" | "empty"

export interface ReadinessArea {
  id: string
  label: string
  weight: number
  earned: number
  missing: string | null
}

export interface ReadinessRow {
  id: string
  code: string
  name: string
  industry: string
  score: number
  tier: Tier
  areas: ReadonlyArray<ReadinessArea>
}

const TIER_PALETTE: Record<
  Tier,
  { bg: string; fg: string; border: string; label: string; glyph: string }
> = {
  complete: {
    bg: "bg-emerald-500/15",
    fg: "text-emerald-300",
    border: "border-emerald-500/30",
    label: "Complete",
    glyph: "●",
  },
  good: {
    bg: "bg-emerald-500/10",
    fg: "text-emerald-400",
    border: "border-emerald-500/25",
    label: "Good",
    glyph: "●",
  },
  partial: {
    bg: "bg-amber-500/10",
    fg: "text-amber-400",
    border: "border-amber-500/30",
    label: "Partial",
    glyph: "◐",
  },
  thin: {
    bg: "bg-orange-500/10",
    fg: "text-orange-400",
    border: "border-orange-500/30",
    label: "Thin",
    glyph: "◐",
  },
  empty: {
    bg: "bg-red-500/10",
    fg: "text-red-400",
    border: "border-red-500/30",
    label: "Empty",
    glyph: "○",
  },
}

const SORT_OPTIONS = [
  { id: "score-asc", label: "Score ascending (worst first)" },
  { id: "score-desc", label: "Score descending (best first)" },
  { id: "code-asc", label: "Code A→Z" },
  { id: "industry", label: "By industry" },
] as const
type SortId = (typeof SORT_OPTIONS)[number]["id"]

function buildCsv(rows: ReadonlyArray<ReadinessRow>): string {
  // Header
  const header = [
    "code",
    "name",
    "industry",
    "score",
    "tier",
    "missing_areas",
  ]
  const lines = [header.join(",")]
  for (const r of rows) {
    const missing = r.areas
      .filter((a) => a.missing)
      .map((a) => `${a.label}: ${a.missing}`)
      .join("; ")
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`
    lines.push(
      [
        esc(r.code),
        esc(r.name),
        esc(r.industry),
        String(r.score),
        r.tier,
        esc(missing),
      ].join(","),
    )
  }
  return lines.join("\n")
}

export function ReadinessTable({
  rows,
}: {
  rows: ReadonlyArray<ReadinessRow>
}) {
  const t = useTranslations("adminCompaniesReadiness")
  const [sortId, setSortId] = useState<SortId>("score-asc")
  const [tierFilter, setTierFilter] = useState<Tier | "all">("all")
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const filtered = useMemo(() => {
    return tierFilter === "all"
      ? rows
      : rows.filter((r) => r.tier === tierFilter)
  }, [rows, tierFilter])

  const sorted = useMemo(() => {
    const arr = [...filtered]
    switch (sortId) {
      case "score-asc":
        arr.sort((a, b) => a.score - b.score)
        break
      case "score-desc":
        arr.sort((a, b) => b.score - a.score)
        break
      case "code-asc":
        arr.sort((a, b) => a.code.localeCompare(b.code))
        break
      case "industry":
        arr.sort(
          (a, b) =>
            a.industry.localeCompare(b.industry) || a.code.localeCompare(b.code),
        )
        break
    }
    return arr
  }, [filtered, sortId])

  // Summary stats — counts per tier across the full row set (not filtered).
  const counts = useMemo(() => {
    const out: Record<Tier, number> = {
      complete: 0,
      good: 0,
      partial: 0,
      thin: 0,
      empty: 0,
    }
    for (const r of rows) out[r.tier] += 1
    return out
  }, [rows])

  const toggleRow = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleExportCsv = () => {
    const csv = buildCsv(sorted)
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `company-readiness-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      {/* Summary chips */}
      <div className="flex flex-wrap items-center gap-2 mb-4 text-xs">
        <button
          type="button"
          onClick={() => setTierFilter("all")}
          className={`px-2.5 py-1 rounded border transition-colors ${
            tierFilter === "all"
              ? "bg-foreground/10 border-foreground/30 font-semibold"
              : "border-border hover:bg-muted"
          }`}
        >
          {t("filterAll", { n: rows.length })}
        </button>
        {(Object.keys(TIER_PALETTE) as Tier[]).map((tier) => {
          const p = TIER_PALETTE[tier]
          const n = counts[tier]
          const active = tierFilter === tier
          return (
            <button
              key={tier}
              type="button"
              onClick={() => setTierFilter(tier)}
              disabled={n === 0}
              className={`px-2.5 py-1 rounded border transition-colors ${
                active
                  ? `${p.bg} ${p.border} ${p.fg} font-semibold`
                  : `border-border ${n === 0 ? "opacity-40 cursor-not-allowed" : "hover:bg-muted"}`
              }`}
            >
              <span aria-hidden="true" className="mr-1">
                {p.glyph}
              </span>
              {p.label} ({n})
            </button>
          )
        })}
        <div className="flex-1" />
        <select
          value={sortId}
          onChange={(e) => setSortId(e.target.value as SortId)}
          className="text-xs border rounded px-2 py-1 bg-background"
          aria-label={t("sortOrderAriaLabel")}
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleExportCsv}
          className="text-xs px-2.5 py-1 rounded border border-border hover:bg-muted"
        >
          {t("exportCsv")}
        </button>
      </div>

      {/* Table */}
      <div className="border rounded overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr className="text-left text-xs">
              <th className="p-2 w-8"></th>
              <th className="p-2 w-24">{t("thCode")}</th>
              <th className="p-2">{t("thName")}</th>
              <th className="p-2 w-32">{t("thIndustry")}</th>
              <th className="p-2 w-20 text-right">{t("thScore")}</th>
              <th className="p-2 w-24">{t("thTier")}</th>
              <th className="p-2">{t("thTopMissing")}</th>
              <th className="p-2 w-28 text-right">{t("thBacklog")}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td
                  colSpan={8}
                  className="p-6 text-center text-muted-foreground italic"
                >
                  No companies match the current filter.
                </td>
              </tr>
            )}
            {sorted.map((r) => {
              const isOpen = expanded.has(r.id)
              const p = TIER_PALETTE[r.tier]
              const topMissing = r.areas
                .filter((a) => a.missing)
                .slice(0, 3)
                .map((a) => a.label.toLowerCase())
                .join(", ")
              return (
                <ReadinessRowView
                  key={r.id}
                  row={r}
                  isOpen={isOpen}
                  topMissing={topMissing}
                  palette={p}
                  onToggle={() => toggleRow(r.id)}
                />
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ReadinessRowView({
  row,
  isOpen,
  topMissing,
  palette,
  onToggle,
}: {
  row: ReadinessRow
  isOpen: boolean
  topMissing: string
  palette: (typeof TIER_PALETTE)[Tier]
  onToggle: () => void
}) {
  return (
    <>
      <tr
        className="border-t hover:bg-muted/40 cursor-pointer"
        onClick={onToggle}
      >
        <td className="p-2 text-muted-foreground text-xs">
          {isOpen ? "▾" : "▸"}
        </td>
        <td className="p-2 font-mono text-xs uppercase">{row.code}</td>
        <td className="p-2">{row.name}</td>
        <td className="p-2 text-xs text-muted-foreground">{row.industry}</td>
        <td className="p-2 text-right font-mono tabular-nums">
          {row.score}%
        </td>
        <td className="p-2">
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs ${palette.bg} ${palette.border} ${palette.fg}`}
          >
            <span aria-hidden="true">{palette.glyph}</span>
            {palette.label}
          </span>
        </td>
        <td className="p-2 text-xs text-muted-foreground truncate max-w-[280px]">
          {topMissing || "—"}
        </td>
        <td className="p-2 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
          <a
            href={`/budgeting/admin/indicator-backlog?company=${row.code}`}
            className="inline-flex items-center gap-1 rounded border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] text-primary hover:bg-primary/15 transition-colors"
          >
            View →
          </a>
        </td>
      </tr>
      {isOpen && (
        <tr>
          <td colSpan={8} className="border-t bg-muted/20 p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
              {row.areas.map((a) => {
                const pct = a.weight > 0 ? (a.earned / a.weight) * 100 : 0
                const cleared = a.missing === null
                return (
                  <div
                    key={a.id}
                    className="flex items-center justify-between gap-3"
                  >
                    <span className={cleared ? "text-foreground" : "text-muted-foreground"}>
                      {cleared ? "✓ " : "• "}
                      {a.label}
                    </span>
                    <span className="font-mono tabular-nums text-muted-foreground">
                      {a.earned}/{a.weight}
                      {a.missing && (
                        <span className="ml-2 text-amber-500">
                          ({a.missing})
                        </span>
                      )}
                      <span className="ml-1 opacity-60">[{Math.round(pct)}%]</span>
                    </span>
                  </div>
                )
              })}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
