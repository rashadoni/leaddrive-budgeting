"use client"
/**
 * Phase 7.M Tier2 Bonus (2026-05-19) — client form for workbook import.
 *
 * Wraps drag-drop file selection, options (year / purge / entity filter),
 * POST to /api/admin/import-workbook, and verdict rendering. Reuses the
 * tier-coloured chip pattern from the readiness dashboard for visual
 * consistency.
 */
import { useState, useRef, type DragEvent, type ChangeEvent } from "react"

interface Entity {
  code: string
  name: string
}

interface ReconciliationDriftLine {
  key: string
  expected: number
  actual: number
  drift: number
  driftPct: number
}

interface ReconciliationReport {
  matched: number
  drift: ReconciliationDriftLine[]
  missing: string[]
  extra: string[]
  verdict: "green" | "yellow" | "red"
  toleranceAzn: number
}

interface PhaseResult {
  reconciliation: ReconciliationReport
  metrics: Record<string, number>
}

interface ImportResult {
  ok: true
  overallVerdict: "green" | "yellow" | "red"
  durationMs: number
  phases: {
    pl: PhaseResult
    bs: PhaseResult
    kpi: PhaseResult
    cf: PhaseResult
  }
  recompute: {
    targets: number
    ok: number
    unknown: number
    failed: number
  }
}

const VERDICT_STYLE = {
  green: {
    bg: "bg-emerald-500/10",
    fg: "text-emerald-300",
    border: "border-emerald-500/40",
    icon: "🟢",
  },
  yellow: {
    bg: "bg-amber-500/10",
    fg: "text-amber-300",
    border: "border-amber-500/40",
    icon: "🟡",
  },
  red: {
    bg: "bg-red-500/10",
    fg: "text-red-300",
    border: "border-red-500/40",
    icon: "🔴",
  },
} as const

export function ImportWorkbookForm({ entities }: { entities: Entity[] }) {
  const [file, setFile] = useState<File | null>(null)
  const [year, setYear] = useState("2026")
  const [purge, setPurge] = useState(true)
  const [entityFilter, setEntityFilter] = useState("")
  const [isDragging, setIsDragging] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) setFile(f)
  }

  const handleSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) setFile(f)
  }

  const handleSubmit = async () => {
    if (!file) return
    setIsSubmitting(true)
    setError(null)
    setResult(null)
    try {
      const form = new FormData()
      form.append("file", file)
      form.append("year", year)
      form.append("purge", purge ? "1" : "0")
      if (entityFilter) form.append("entityFilter", entityFilter)
      const res = await fetch("/api/admin/import-workbook", {
        method: "POST",
        body: form,
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      setResult((await res.json()) as ImportResult)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* ── Drop zone ─────────────────────────────────────────── */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => {
          e.preventDefault()
          setIsDragging(true)
        }}
        onDragLeave={() => setIsDragging(false)}
        className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
          isDragging
            ? "border-emerald-500/60 bg-emerald-500/5"
            : "border-border hover:border-muted-foreground/40"
        }`}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx"
          className="hidden"
          onChange={handleSelect}
        />
        {file ? (
          <div>
            <div className="text-sm font-mono">{file.name}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {(file.size / 1024).toFixed(0)} KB · drop another to replace
            </div>
          </div>
        ) : (
          <div>
            <div className="text-base font-medium mb-1">
              Перетащите xlsx файл сюда или нажмите для выбора
            </div>
            <div className="text-xs text-muted-foreground">
              Принимается только .xlsx (Excel 2007+)
            </div>
          </div>
        )}
      </div>

      {/* ── Options ───────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Year</span>
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            className="border rounded px-2 py-1 bg-background text-sm"
            min={2020}
            max={2050}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Entity filter</span>
          <select
            value={entityFilter}
            onChange={(e) => setEntityFilter(e.target.value)}
            className="border rounded px-2 py-1 bg-background text-sm"
          >
            <option value="">All 4 entities</option>
            {entities.map((e) => (
              <option key={e.code} value={e.code}>
                {e.code} — {e.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs cursor-pointer self-end pb-1">
          <input
            type="checkbox"
            checked={purge}
            onChange={(e) => setPurge(e.target.checked)}
          />
          <span>
            Purge archived rows before write
            <span
              className="block text-[10px] text-muted-foreground"
              title="hard-deletes previously soft-archived rows in scope"
            >
              (keeps archive tail bounded)
            </span>
          </span>
        </label>
      </div>

      {/* ── Submit ───────────────────────────────────────────── */}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={!file || isSubmitting}
        className="w-full px-4 py-2 rounded bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {isSubmitting ? "Importing…" : "Run 5-phase import"}
      </button>

      {/* ── Error banner ─────────────────────────────────────── */}
      {error && (
        <div className="border border-red-500/40 bg-red-500/10 text-red-300 rounded p-3 text-sm">
          ❌ {error}
        </div>
      )}

      {/* ── Result ───────────────────────────────────────────── */}
      {result && <ImportResultView result={result} />}
    </div>
  )
}

function ImportResultView({ result }: { result: ImportResult }) {
  const s = VERDICT_STYLE[result.overallVerdict]
  return (
    <div className="space-y-3">
      <div className={`border rounded p-4 ${s.bg} ${s.border}`}>
        <div className={`text-lg font-bold ${s.fg}`}>
          {s.icon} OVERALL · {result.overallVerdict.toUpperCase()}
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          Completed in {result.durationMs}ms · recompute{" "}
          {result.recompute.ok}✓ {result.recompute.unknown}? {result.recompute.failed}✗
        </div>
      </div>

      <div className="border rounded overflow-hidden">
        <table className="w-full text-sm font-mono">
          <thead className="bg-muted text-xs">
            <tr>
              <th className="text-left p-2">Phase</th>
              <th className="text-right p-2">Matched</th>
              <th className="text-right p-2">Drift</th>
              <th className="text-right p-2">Missing</th>
              <th className="text-right p-2">Extra</th>
              <th className="text-right p-2">Inserted</th>
              <th className="text-left p-2">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {(["pl", "bs", "kpi", "cf"] as const).map((key) => {
              const phase = result.phases[key]
              const ps = VERDICT_STYLE[phase.reconciliation.verdict]
              const inserted =
                (phase.metrics.rowsInserted as number | undefined) ?? 0
              return (
                <tr key={key} className="border-t">
                  <td className="p-2 uppercase">{key}</td>
                  <td className="p-2 text-right">{phase.reconciliation.matched}</td>
                  <td className="p-2 text-right">
                    {phase.reconciliation.drift.length}
                  </td>
                  <td className="p-2 text-right">
                    {phase.reconciliation.missing.length}
                  </td>
                  <td className="p-2 text-right">
                    {phase.reconciliation.extra.length}
                  </td>
                  <td className="p-2 text-right">{inserted}</td>
                  <td className="p-2">
                    <span
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-xs ${ps.bg} ${ps.border} ${ps.fg}`}
                    >
                      {ps.icon} {phase.reconciliation.verdict}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Drift detail per phase — only show when there's something */}
      {(["pl", "bs", "kpi", "cf"] as const).map((key) => {
        const r = result.phases[key].reconciliation
        if (r.drift.length === 0 && r.missing.length === 0 && r.extra.length === 0) {
          return null
        }
        return (
          <div key={`drift-${key}`} className="border rounded p-3 text-xs">
            <div className="font-bold uppercase mb-2">{key} — needs attention</div>
            {r.drift.length > 0 && (
              <div className="mb-2">
                <div className="text-muted-foreground mb-1">
                  Drift ({r.drift.length}):
                </div>
                {r.drift.slice(0, 5).map((d) => (
                  <div key={d.key} className="font-mono text-[11px] pl-2">
                    {d.key} · expected {d.expected.toFixed(2)} · actual{" "}
                    {d.actual.toFixed(2)} · {(d.driftPct * 100).toFixed(2)}%
                  </div>
                ))}
                {r.drift.length > 5 && (
                  <div className="text-[10px] text-muted-foreground pl-2">
                    ... +{r.drift.length - 5} more
                  </div>
                )}
              </div>
            )}
            {r.missing.length > 0 && (
              <div className="mb-2">
                <div className="text-muted-foreground mb-1">
                  Missing ({r.missing.length}):
                </div>
                <div className="font-mono text-[11px] pl-2 break-all">
                  {r.missing.slice(0, 3).join(", ")}
                  {r.missing.length > 3 ? ` ... +${r.missing.length - 3}` : ""}
                </div>
              </div>
            )}
            {r.extra.length > 0 && (
              <div>
                <div className="text-muted-foreground mb-1">
                  Extra ({r.extra.length}):
                </div>
                <div className="font-mono text-[11px] pl-2 break-all">
                  {r.extra.slice(0, 3).join(", ")}
                  {r.extra.length > 3 ? ` ... +${r.extra.length - 3}` : ""}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
