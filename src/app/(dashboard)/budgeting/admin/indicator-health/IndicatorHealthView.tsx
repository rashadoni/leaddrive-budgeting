"use client"
import { useEffect, useState } from "react"

interface GappyIndicator {
  indicatorCode: string
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

const CATEGORY_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  "external-feed": { bg: "bg-blue-500/10", fg: "text-blue-300", label: "🔌 External feed needed" },
  "ingest-gap": { bg: "bg-amber-500/10", fg: "text-amber-300", label: "📥 Ingest gap" },
  "formula-edge-case": { bg: "bg-red-500/10", fg: "text-red-300", label: "⚙ Formula edge case" },
  "no-data": { bg: "bg-gray-500/10", fg: "text-gray-300", label: "⚪ Data not entered" },
  "leaf-rollup": { bg: "bg-purple-500/10", fg: "text-purple-300", label: "📊 Rollup (correct for leaf)" },
  "code-bug": { bg: "bg-red-500/20", fg: "text-red-400", label: "🐛 Code bug" },
}

export function IndicatorHealthView() {
  const [data, setData] = useState<HealthResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filterCategory, setFilterCategory] = useState<string | null>(null)

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

  if (loading && !data) {
    return <div className="text-sm text-muted-foreground">Загружаю…</div>
  }
  if (error) {
    return (
      <div className="border border-red-500/40 bg-red-500/10 text-red-300 rounded p-3 text-sm">
        ❌ {error}
      </div>
    )
  }
  if (!data) return null

  const { summary, unknownByErrorCode, gappyIndicators } = data
  const filtered = filterCategory
    ? gappyIndicators.filter((g) => g.category === filterCategory)
    : gappyIndicators

  const greenPct = ((summary.green / summary.totalIvs) * 100).toFixed(1)
  const computedPct = (
    ((summary.green + summary.amber + summary.red) / summary.totalIvs) *
    100
  ).toFixed(1)

  return (
    <div className="space-y-6">
      {/* ── Summary tiles ────────────────────────────────────── */}
      <div className="grid grid-cols-5 gap-2">
        <div className="border rounded p-3 bg-emerald-500/10">
          <div className="text-xs text-emerald-300 uppercase">🟢 Green</div>
          <div className="text-2xl font-bold text-emerald-300">{summary.green}</div>
          <div className="text-[10px] text-muted-foreground">{greenPct}%</div>
        </div>
        <div className="border rounded p-3 bg-amber-500/10">
          <div className="text-xs text-amber-300 uppercase">🟡 Amber</div>
          <div className="text-2xl font-bold text-amber-300">{summary.amber}</div>
        </div>
        <div className="border rounded p-3 bg-red-500/10">
          <div className="text-xs text-red-300 uppercase">🔴 Red</div>
          <div className="text-2xl font-bold text-red-300">{summary.red}</div>
        </div>
        <div className="border rounded p-3 bg-gray-500/10">
          <div className="text-xs text-gray-400 uppercase">⚪ Unknown</div>
          <div className="text-2xl font-bold text-gray-300">{summary.unknown}</div>
        </div>
        <div className="border rounded p-3">
          <div className="text-xs text-muted-foreground uppercase">Computed</div>
          <div className="text-2xl font-bold">{computedPct}%</div>
          <div className="text-[10px] text-muted-foreground">
            {summary.totalIvs} total IVs
          </div>
        </div>
      </div>

      {/* ── Unknown by error code ─────────────────────────────── */}
      <div className="border rounded p-3">
        <div className="text-xs uppercase text-muted-foreground mb-2">
          Unknown breakdown by error code
        </div>
        <div className="flex gap-2 flex-wrap">
          {Object.entries(unknownByErrorCode)
            .sort((a, b) => b[1] - a[1])
            .map(([code, count]) => (
              <div
                key={code}
                className="border rounded px-2 py-1 text-xs font-mono"
              >
                <span className="text-muted-foreground">{code}:</span>{" "}
                <span className="font-bold">{count}</span>
              </div>
            ))}
        </div>
      </div>

      {/* ── Category filter ───────────────────────────────────── */}
      <div className="flex gap-2 flex-wrap items-center">
        <span className="text-xs text-muted-foreground">Filter:</span>
        <button
          type="button"
          onClick={() => setFilterCategory(null)}
          className={`px-2 py-1 rounded text-xs border ${
            !filterCategory ? "bg-muted" : ""
          }`}
        >
          All ({gappyIndicators.length})
        </button>
        {Object.entries(CATEGORY_STYLE).map(([cat, s]) => {
          const count = gappyIndicators.filter((g) => g.category === cat).length
          if (count === 0) return null
          return (
            <button
              key={cat}
              type="button"
              onClick={() => setFilterCategory(cat)}
              className={`px-2 py-1 rounded text-xs border ${s.bg} ${s.fg} ${
                filterCategory === cat ? "ring-1 ring-current" : ""
              }`}
            >
              {s.label} ({count})
            </button>
          )
        })}
      </div>

      {/* ── Gappy indicators table ────────────────────────────── */}
      <div className="border rounded overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted text-xs">
            <tr>
              <th className="text-left p-2">Indicator</th>
              <th className="text-left p-2">Category</th>
              <th className="text-left p-2">Missing var</th>
              <th className="text-right p-2">Cells</th>
              <th className="text-left p-2">Entities</th>
              <th className="text-left p-2">Remediation</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((g) => {
              const style = CATEGORY_STYLE[g.category] ?? CATEGORY_STYLE["no-data"]
              return (
                <tr key={`${g.indicatorCode}-${g.errorCode}-${g.missingVariable}`} className="border-t align-top">
                  <td className="p-2 font-mono text-xs">{g.indicatorCode}</td>
                  <td className="p-2">
                    <span
                      className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] ${style.bg} ${style.fg}`}
                    >
                      {style.label}
                    </span>
                  </td>
                  <td className="p-2 font-mono text-[11px] text-muted-foreground">
                    {g.missingVariable ?? <span className="italic">—</span>}
                  </td>
                  <td className="p-2 text-right font-mono text-xs">
                    {g.affectedCellCount}
                  </td>
                  <td className="p-2 text-[11px]">
                    {g.affectedEntities.slice(0, 3).join(", ")}
                    {g.affectedEntities.length > 3 && (
                      <span className="text-muted-foreground">
                        {" "}
                        +{g.affectedEntities.length - 3}
                      </span>
                    )}
                  </td>
                  <td className="p-2 text-[11px] text-muted-foreground">
                    {g.remediation}
                  </td>
                </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="p-4 text-center text-muted-foreground italic">
                  No gaps in this category 🎉
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="text-[10px] text-muted-foreground">
        Generated at {new Date(data.generatedAt).toLocaleString()}
      </div>
    </div>
  )
}
