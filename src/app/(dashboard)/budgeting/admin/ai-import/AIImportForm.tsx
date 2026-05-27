"use client"
/**
 * Phase 7.M Tier 4 (2026-05-19) — AI Auto Import client form.
 *
 * Two-step flow:
 *   Step 1: Upload xlsx → POST /api/import/ai-auto (preview)
 *           → render classification table + entity sheet map
 *   Step 2: User clicks "Подтвердить и импортировать" →
 *           POST /api/admin/import-workbook (battle-tested import)
 *           → render verdict per phase
 */
import { useState, useRef, type DragEvent, type ChangeEvent } from "react"

interface Classification {
  sheetName: string
  dataType: string
  entityCode: string | null
  confidence: number
  reasoning: string
}

interface EntitySheetMap {
  code: string
  plSheet: string | null
  bsSheet: string | null
  cfSheet: string | null
  kpiFarmingSheets: string[]
  kpiProcessingSheets: string[]
  capexSheets: string[]
  salesSheets: string[]
  landSheets: string[]
  descriptionSheets: string[]
}

interface AffectedIndicator {
  code: string
  nameEn: string
  nameRu: string | null
  nameAz: string | null
  category: string
  industries: string[]
  matchedInput: string
}
interface SheetImpact {
  sheetName: string
  dataType: string
  entityCode: string | null
  confidence: number
  impact: {
    dataType: string
    writes: string
    note: string | null
    indicators: AffectedIndicator[]
  }
}

interface ClassifyResponse {
  ok: true
  mode: "preview"
  totalSheets: number
  classifications: Classification[]
  entitySheetMaps: EntitySheetMap[]
  /** 2026-05-27 — per-sheet downstream impact projection. Lets the user
   *  verify which indicators will move BEFORE clicking «Подтвердить и
   *  импортировать» on this single-file form. */
  sheetImpacts?: SheetImpact[]
  llmUsage: {
    inputTokens: number
    outputTokens: number
    modelName: string
    promptVersion: string
  }
  skippedLLM: boolean
  durationMs: number
  nextStep: string
}

interface ReconLine {
  key: string
  expected: number
  actual: number
  drift: number
  driftPct: number
}

interface PhaseReconciliation {
  matched: number
  drift: ReconLine[]
  missing: string[]
  extra: string[]
  verdict: "green" | "yellow" | "red"
  toleranceAzn: number
}

interface ImportApplyResult {
  ok: true
  overallVerdict: "green" | "yellow" | "red"
  durationMs: number
  phases: {
    pl: { reconciliation: PhaseReconciliation; metrics: Record<string, number> }
    bs: { reconciliation: PhaseReconciliation; metrics: Record<string, number> }
    kpi: { reconciliation: PhaseReconciliation; metrics: Record<string, number> }
    cf: { reconciliation: PhaseReconciliation; metrics: Record<string, number> }
  }
  recompute: { targets: number; ok: number; unknown: number; failed: number }
}

const DATA_TYPE_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  PLF: { bg: "bg-blue-500/10", fg: "text-blue-300", label: "P&L" },
  BS: { bg: "bg-purple-500/10", fg: "text-purple-300", label: "Balance Sheet" },
  CF: { bg: "bg-cyan-500/10", fg: "text-cyan-300", label: "Cash Flow" },
  KPI_FARMING: { bg: "bg-green-500/10", fg: "text-green-300", label: "KPI Farming" },
  KPI_PROCESSING: { bg: "bg-green-500/10", fg: "text-green-300", label: "KPI Processing" },
  CAPEX: { bg: "bg-amber-500/10", fg: "text-amber-300", label: "CAPEX" },
  SALES: { bg: "bg-pink-500/10", fg: "text-pink-300", label: "Sales" },
  LAND_REGISTRY: { bg: "bg-emerald-500/10", fg: "text-emerald-300", label: "Land Registry" },
  DESCRIPTIONS: { bg: "bg-indigo-500/10", fg: "text-indigo-300", label: "Descriptions" },
  INFO_SUMMARY: { bg: "bg-gray-500/10", fg: "text-gray-400", label: "Separator" },
  UNKNOWN: { bg: "bg-red-500/10", fg: "text-red-300", label: "Unknown ⚠" },
}

const VERDICT_STYLE = {
  green: { bg: "bg-emerald-500/10", fg: "text-emerald-300", icon: "🟢" },
  yellow: { bg: "bg-amber-500/10", fg: "text-amber-300", icon: "🟡" },
  red: { bg: "bg-red-500/10", fg: "text-red-300", icon: "🔴" },
} as const

export function AIImportForm() {
  const [file, setFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isClassifying, setIsClassifying] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [preview, setPreview] = useState<ClassifyResponse | null>(null)
  const [importResult, setImportResult] = useState<ImportApplyResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) {
      setFile(f)
      setPreview(null)
      setImportResult(null)
    }
  }

  const handleSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) {
      setFile(f)
      setPreview(null)
      setImportResult(null)
    }
  }

  const handleClassify = async () => {
    if (!file) return
    setIsClassifying(true)
    setError(null)
    setPreview(null)
    setImportResult(null)
    try {
      const form = new FormData()
      form.append("file", file)
      form.append("year", "2026")
      const res = await fetch("/api/import/ai-auto", {
        method: "POST",
        body: form,
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      setPreview((await res.json()) as ClassifyResponse)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setIsClassifying(false)
    }
  }

  const handleConfirmImport = async () => {
    if (!file || !preview) return
    setIsImporting(true)
    setError(null)
    setImportResult(null)
    try {
      const form = new FormData()
      form.append("file", file)
      form.append("year", "2026")
      form.append("purge", "1")
      const res = await fetch("/api/admin/import-workbook", {
        method: "POST",
        body: form,
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      setImportResult((await res.json()) as ImportApplyResult)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setIsImporting(false)
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
              AI определит структуру + предложит план импорта (любой
              workbook от любого клиента)
            </div>
          </div>
        )}
      </div>

      {/* ── Step 1: Classify ───────────────────────────────────── */}
      {!preview && (
        <button
          type="button"
          onClick={handleClassify}
          disabled={!file || isClassifying}
          className="w-full px-4 py-2 rounded bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {isClassifying ? "AI анализирует структуру…" : "🧠 Шаг 1: AI-анализ листов"}
        </button>
      )}

      {/* ── Error banner ───────────────────────────────────────── */}
      {error && (
        <div className="border border-red-500/40 bg-red-500/10 text-red-300 rounded p-3 text-sm">
          ❌ {error}
        </div>
      )}

      {/* ── Classification preview ─────────────────────────────── */}
      {preview && !importResult && <ClassificationPreview preview={preview} />}

      {preview && !importResult && (
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => {
              setPreview(null)
              setFile(null)
            }}
            className="flex-1 px-4 py-2 rounded border border-border text-sm hover:bg-muted/50 transition-colors"
          >
            ✕ Отменить и загрузить другой файл
          </button>
          <button
            type="button"
            onClick={handleConfirmImport}
            disabled={isImporting}
            className="flex-1 px-4 py-2 rounded bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-40 transition-colors"
          >
            {isImporting
              ? "Импорт + сверка…"
              : "✅ Шаг 2: Подтвердить план и запустить bit-perfect импорт"}
          </button>
        </div>
      )}

      {/* ── Final result ──────────────────────────────────────── */}
      {importResult && <ImportResultView result={importResult} />}
    </div>
  )
}

function ClassificationPreview({ preview }: { preview: ClassifyResponse }) {
  return (
    <div className="space-y-4">
      <div className="border rounded p-4 bg-muted/20">
        <div className="text-lg font-bold mb-1">
          🧠 AI-анализ завершён
        </div>
        <div className="text-xs text-muted-foreground">
          {preview.totalSheets} листов · {preview.durationMs}ms ·{" "}
          {preview.skippedLLM
            ? "0 tokens (only separators detected)"
            : `${preview.llmUsage.inputTokens} in + ${preview.llmUsage.outputTokens} out tokens · ${preview.llmUsage.modelName}`}
        </div>
      </div>

      <div className="border rounded overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted text-xs">
            <tr>
              <th className="text-left p-2">Лист</th>
              <th className="text-left p-2">Тип</th>
              <th className="text-left p-2">Сущность</th>
              <th className="text-right p-2">Confidence</th>
              <th className="text-left p-2">Затронет</th>
              <th className="text-left p-2">Обоснование</th>
            </tr>
          </thead>
          <tbody>
            {preview.classifications.map((c) => {
              const style =
                DATA_TYPE_STYLE[c.dataType] ?? DATA_TYPE_STYLE.UNKNOWN
              const conf = (c.confidence * 100).toFixed(0)
              const confLow = c.confidence < 0.65
              // 2026-05-27 — find this sheet's impact from the parallel
              // sheetImpacts array (matched by sheetName).
              const sheetImpact = preview.sheetImpacts?.find(
                (s) => s.sheetName === c.sheetName,
              )
              return (
                <tr
                  key={c.sheetName}
                  className={`border-t ${confLow ? "bg-amber-50" : ""}`}
                >
                  <td className="p-2 font-mono text-xs">{c.sheetName}</td>
                  <td className="p-2">
                    <span
                      className={`inline-flex items-center px-1.5 py-0.5 rounded border text-xs ${style.bg} ${style.fg}`}
                    >
                      {style.label}
                    </span>
                  </td>
                  <td className="p-2 font-mono text-xs">
                    {c.entityCode ?? <span className="text-muted-foreground">—</span>}
                  </td>
                  <td
                    className={`p-2 text-right font-mono text-xs ${
                      confLow ? "text-rose-700 font-semibold" : ""
                    }`}
                  >
                    {conf}%
                    {confLow && (
                      <div className="text-[9px] font-normal text-rose-600">
                        ⚠ проверить
                      </div>
                    )}
                  </td>
                  <td className="p-2 text-xs">
                    {sheetImpact && sheetImpact.impact.indicators.length > 0 ? (
                      <div
                        className="flex flex-wrap gap-1"
                        title={sheetImpact.impact.writes}
                      >
                        {sheetImpact.impact.indicators.slice(0, 6).map((ind) => (
                          <span
                            key={ind.code}
                            className="inline-flex items-center px-1.5 py-0.5 rounded bg-slate-50 border border-slate-200 text-[10px] font-mono text-slate-700"
                            title={`${ind.nameRu ?? ind.nameEn} · ${ind.category}`}
                          >
                            {ind.code}
                          </span>
                        ))}
                        {sheetImpact.impact.indicators.length > 6 && (
                          <span className="text-[10px] text-muted-foreground">
                            +{sheetImpact.impact.indicators.length - 6}
                          </span>
                        )}
                      </div>
                    ) : sheetImpact?.impact.note ? (
                      <span
                        className="italic text-muted-foreground text-[11px]"
                        title={sheetImpact.impact.writes}
                      >
                        не задевает индикаторы
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="p-2 text-xs text-muted-foreground">
                    {c.reasoning}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <details className="border rounded p-3 text-xs">
        <summary className="cursor-pointer font-medium">
          Группировка по сущностям ({preview.entitySheetMaps.length})
        </summary>
        <div className="mt-2 space-y-2">
          {preview.entitySheetMaps.map((m) => (
            <div key={m.code} className="border-l-2 border-emerald-500/40 pl-3">
              <div className="font-mono font-bold">{m.code}</div>
              <div className="text-muted-foreground text-[11px] grid grid-cols-3 gap-1 mt-1">
                {m.plSheet && <div>P&L: {m.plSheet}</div>}
                {m.bsSheet && <div>BS: {m.bsSheet}</div>}
                {m.cfSheet && <div>CF: {m.cfSheet}</div>}
                {m.kpiFarmingSheets.length > 0 && (
                  <div>KPI Farm: {m.kpiFarmingSheets.join(", ")}</div>
                )}
                {m.kpiProcessingSheets.length > 0 && (
                  <div>KPI Proc: {m.kpiProcessingSheets.join(", ")}</div>
                )}
                {m.capexSheets.length > 0 && (
                  <div>CAPEX: {m.capexSheets.join(", ")}</div>
                )}
                {m.salesSheets.length > 0 && (
                  <div>Sales: {m.salesSheets.join(", ")}</div>
                )}
                {m.landSheets.length > 0 && (
                  <div>Land: {m.landSheets.join(", ")}</div>
                )}
                {m.descriptionSheets.length > 0 && (
                  <div>Desc: {m.descriptionSheets.join(", ")}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </details>
    </div>
  )
}

function ImportResultView({ result }: { result: ImportApplyResult }) {
  const s = VERDICT_STYLE[result.overallVerdict]
  return (
    <div className="space-y-3">
      <div className={`border rounded p-4 ${s.bg}`}>
        <div className={`text-lg font-bold ${s.fg}`}>
          {s.icon} ИМПОРТ ЗАВЕРШЁН · {result.overallVerdict.toUpperCase()}
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          {result.durationMs}ms · recompute {result.recompute.ok}✓{" "}
          {result.recompute.unknown}? {result.recompute.failed}✗
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
              <th className="text-left p-2">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {(["pl", "bs", "kpi", "cf"] as const).map((key) => {
              const phase = result.phases[key]
              const ps = VERDICT_STYLE[phase.reconciliation.verdict]
              return (
                <tr key={key} className="border-t">
                  <td className="p-2 uppercase">{key}</td>
                  <td className="p-2 text-right">
                    {phase.reconciliation.matched}
                  </td>
                  <td className="p-2 text-right">
                    {phase.reconciliation.drift.length}
                  </td>
                  <td className="p-2 text-right">
                    {phase.reconciliation.missing.length}
                  </td>
                  <td className="p-2 text-right">
                    {phase.reconciliation.extra.length}
                  </td>
                  <td className="p-2">
                    <span
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-xs ${ps.bg} ${ps.fg}`}
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
    </div>
  )
}
