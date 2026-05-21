"use client"
/**
 * Phase 7.M Tier 5 (2026-05-20) — Multi-file AI Auto Import UI.
 *
 * Two-step flow for N files (1-10):
 *   Step 1: Drop files → POST /api/import/ai-auto-multi (preview/dryRun)
 *           → render per-file file-type detection + cross-file conflict
 *             banner (if any)
 *   Step 2: User clicks "Применить группы" → POST same files with apply=1
 *           → render per-group verdict (commit / rollback)
 *
 * Safety:
 *  - "Применить" button disabled while conflicts present (unless user
 *    explicitly chose "Force override")
 *  - File count cap (10) enforced client-side + server-side
 *  - Total size cap (20 MB) enforced client-side + server-side
 */
import { useRef, useState, type ChangeEvent, type DragEvent } from "react"

interface ConflictOccurrence {
  filename: string
  value: number
}
interface CrossFileConflict {
  key: string
  occurrences: ConflictOccurrence[]
  spread: number
  spreadPct: number
}

interface SheetCounts {
  plf: number
  bs: number
  cf: number
  kpiFarming: number
  kpiProcessing: number
  capex: number
  sales: number
  landRegistry: number
  descriptions: number
  infoSummary: number
  unknown: number
}

interface FileTypeResult {
  fileType: string
  confidence: number
  reasoning: string
  sheetCounts: SheetCounts
}

interface SheetClassification {
  sheetName: string
  dataType: string
  entityCode: string | null
  confidence: number
  reasoning: string
}

interface PerFileResult {
  filename: string
  fileTypeResult: FileTypeResult
  classifications: SheetClassification[]
  error: string | null
}

interface PerGroupResult {
  fileType: string
  filenames: string[]
  verdict: "green" | "yellow" | "red" | "skipped"
  committed: boolean
  totalRowsInserted: number
  skipReason: string | null
}

interface MultiFileApiResponse {
  ok: boolean
  mode?: "preview" | "applied"
  perFile: PerFileResult[]
  conflicts: CrossFileConflict[]
  perGroup: PerGroupResult[]
  overallVerdict: "green" | "yellow" | "red"
  llmUsage: {
    inputTokens: number
    outputTokens: number
    modelName: string
  }
  durationMs: number
  recompute: { ok: number; unknown: number; failed: number; targets: number }
  warnings: string[]
  error?: string
}

const MAX_FILES = 10
const MAX_TOTAL_BYTES = 20 * 1024 * 1024

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}

function verdictColor(v: string): string {
  if (v === "green") return "text-emerald-700 bg-emerald-50 border-emerald-200"
  if (v === "yellow") return "text-amber-700 bg-amber-50 border-amber-200"
  if (v === "red") return "text-red-700 bg-red-50 border-red-200"
  return "text-slate-500 bg-slate-50 border-slate-200"
}

function verdictEmoji(v: string): string {
  if (v === "green") return "🟢"
  if (v === "yellow") return "🟡"
  if (v === "red") return "🔴"
  return "⚪"
}

export function MultiFileForm() {
  const [files, setFiles] = useState<File[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [previewResult, setPreviewResult] =
    useState<MultiFileApiResponse | null>(null)
  const [applyResult, setApplyResult] =
    useState<MultiFileApiResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [forceOverride, setForceOverride] = useState(false)
  // Phase 7.M Tier 6 — per-conflict resolution map. Key = conflict key
  // (e.g. "AZSEKER-CPC::PLF.01::2026-01"), value = either
  //   { mode: "pick", filename: <filename to win> }  — use that file's value
  //   { mode: "skip" }                                — drop the cell entirely
  // Empty / undefined entries leave the conflict unresolved; the apply
  // button stays disabled until every conflict either has a resolution
  // OR `forceOverride` is checked (legacy escape hatch).
  type Resolution =
    | { mode: "pick"; filename: string }
    | { mode: "skip" }
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>({})
  const inputRef = useRef<HTMLInputElement>(null)
  const applyResultRef = useRef<HTMLDivElement>(null)
  const conflictBannerRef = useRef<HTMLDivElement>(null)
  const errorRef = useRef<HTMLDivElement>(null)

  const totalBytes = files.reduce((s, f) => s + f.size, 0)
  const overSizeCap = totalBytes > MAX_TOTAL_BYTES
  const overCountCap = files.length > MAX_FILES
  const hasConflicts = (previewResult?.conflicts.length ?? 0) > 0
  const allConflictsResolved =
    hasConflicts &&
    (previewResult?.conflicts ?? []).every((c) => resolutions[c.key])

  function handleFiles(newFiles: FileList | File[]): void {
    const incoming = Array.from(newFiles).filter((f) =>
      f.name.toLowerCase().endsWith(".xlsx"),
    )
    setFiles((prev) => [...prev, ...incoming].slice(0, MAX_FILES))
    setPreviewResult(null)
    setApplyResult(null)
    setError(null)
  }

  function onDrop(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault()
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files)
  }

  function onSelect(e: ChangeEvent<HTMLInputElement>): void {
    if (e.target.files) handleFiles(e.target.files)
  }

  function removeFile(idx: number): void {
    setFiles((prev) => prev.filter((_, i) => i !== idx))
    setPreviewResult(null)
    setApplyResult(null)
  }

  function resetAll(): void {
    setFiles([])
    setPreviewResult(null)
    setApplyResult(null)
    setError(null)
    setForceOverride(false)
    setResolutions({})
    if (inputRef.current) inputRef.current.value = ""
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  async function submit(apply: boolean): Promise<void> {
    if (files.length === 0) return
    setIsProcessing(true)
    setError(null)
    if (apply) {
      setApplyResult(null)
    } else {
      setPreviewResult(null)
    }
    try {
      const form = new FormData()
      for (const f of files) form.append("files", f)
      form.append("year", String(new Date().getFullYear()))
      if (apply) form.append("apply", "1")
      if (forceOverride) form.append("forceOverride", "1")
      // Per-conflict resolutions take precedence over forceOverride —
      // when both are present the orchestrator honors the resolution
      // map first, then falls back to last-write-wins for any conflict
      // not in the map.
      if (apply && Object.keys(resolutions).length > 0) {
        form.append("conflictResolutions", JSON.stringify(resolutions))
      }
      const res = await fetch("/api/import/ai-auto-multi", {
        method: "POST",
        body: form,
      })
      const data = (await res.json()) as MultiFileApiResponse
      if (!res.ok && res.status !== 409) {
        setError(data.error ?? `HTTP ${res.status}`)
        setTimeout(() => errorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 50)
        return
      }
      if (apply) {
        setApplyResult(data)
        setTimeout(() => applyResultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50)
      } else {
        setPreviewResult(data)
        // Scroll to conflict banner if conflicts exist, otherwise to the analysis section
        if ((data.conflicts?.length ?? 0) > 0) {
          setTimeout(() => conflictBannerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50)
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Drop zone */}
      <div
        data-testid="multi-drop-zone"
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center cursor-pointer hover:border-slate-400 hover:bg-slate-50 transition"
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx"
          multiple
          className="hidden"
          onChange={onSelect}
          data-testid="multi-file-input"
        />
        <p className="text-sm text-slate-600">
          Перетащите 1-{MAX_FILES} xlsx файлов сюда, или нажмите для выбора
        </p>
        <p className="text-xs text-slate-400 mt-1">
          Максимум {MAX_FILES} файлов, суммарно {MAX_TOTAL_BYTES / 1024 / 1024}{" "}
          MB
        </p>
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <div className="flex items-center justify-between bg-slate-100 px-4 py-2 border-b">
            <span className="text-sm font-medium">
              {files.length} файл{files.length === 1 ? "" : files.length < 5 ? "а" : "ов"} ·{" "}
              {formatBytes(totalBytes)}
            </span>
            {(overSizeCap || overCountCap) && (
              <span className="text-xs text-red-600 font-medium">
                ⚠ Превышен лимит
              </span>
            )}
          </div>
          <ul className="divide-y">
            {files.map((f, i) => (
              <li
                key={`${f.name}-${i}`}
                className="flex items-center justify-between px-4 py-2 text-sm"
                data-testid={`file-row-${i}`}
              >
                <span className="truncate">{f.name}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-slate-500">
                    {formatBytes(f.size)}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    className="text-slate-400 hover:text-red-600 px-2"
                    aria-label={`Remove ${f.name}`}
                    data-testid={`remove-file-${i}`}
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Step 1 button */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={
            files.length === 0 || isProcessing || overSizeCap || overCountCap
          }
          onClick={() => submit(false)}
          className="px-4 py-2 bg-slate-900 text-white rounded font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-800"
          data-testid="btn-analyze"
        >
          {isProcessing && !applyResult
            ? "Анализирую..."
            : "Шаг 1: Анализ AI"}
        </button>
        {previewResult && (
          <button
            type="button"
            disabled={
              isProcessing ||
              (hasConflicts && !forceOverride && !allConflictsResolved)
            }
            onClick={() => submit(true)}
            className="px-4 py-2 bg-emerald-600 text-white rounded font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-emerald-700"
            data-testid="btn-apply"
          >
            {isProcessing && previewResult
              ? "Применяю..."
              : "Шаг 2: Применить группы"}
          </button>
        )}
      </div>

      {/* Error banner — sits right below buttons so it's always visible */}
      {error && (
        <div
          ref={errorRef}
          className="rounded border border-red-300 bg-red-50 text-red-700 p-3 text-sm"
          data-testid="error-banner"
        >
          ❌ {error}
        </div>
      )}

      {/* Processing banner — shown while Step 2 is running */}
      {isProcessing && previewResult && (
        <div className="rounded border border-emerald-300 bg-emerald-50 text-emerald-800 p-3 text-sm flex items-center gap-2">
          <svg className="animate-spin h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
          </svg>
          <span>Применяю данные… это займёт 30-90 секунд. Не закрывайте страницу.</span>
        </div>
      )}

      {/* Conflict banner */}
      {previewResult && hasConflicts && (
        <div
          ref={conflictBannerRef}
          className="rounded border border-red-300 bg-red-50 p-4 space-y-3"
          data-testid="conflict-banner"
        >
          <h3 className="font-semibold text-red-800">
            🚫 Конфликт между файлами — {previewResult.conflicts.length}{" "}
            ячейк{previewResult.conflicts.length === 1 ? "а" : "и"} расходятся
          </h3>
          <p className="text-xs text-red-700">
            Два или больше файлов содержат разные значения для одной и той же
            ячейки. Импорт заблокирован до решения конфликта.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-1 pr-2">Ячейка</th>
                  <th className="py-1 pr-2">Значения</th>
                  <th className="py-1 pr-2 text-right">Разница</th>
                  <th className="py-1 pr-2">Решение</th>
                </tr>
              </thead>
              <tbody>
                {previewResult.conflicts.slice(0, 20).map((c) => {
                  const current = resolutions[c.key]
                  const selectValue = !current
                    ? ""
                    : current.mode === "skip"
                      ? "__skip__"
                      : current.filename
                  return (
                    <tr
                      key={c.key}
                      className="border-b last:border-b-0"
                      data-testid={`conflict-row-${c.key}`}
                    >
                      <td className="py-1 pr-2 font-mono">{c.key}</td>
                      <td className="py-1 pr-2">
                        {c.occurrences
                          .map(
                            (o) =>
                              `${o.filename}=${o.value.toLocaleString(undefined, {
                                maximumFractionDigits: 0,
                              })}`,
                          )
                          .join(", ")}
                      </td>
                      <td className="py-1 pr-2 text-right font-medium">
                        {(c.spreadPct * 100).toFixed(2)}%
                      </td>
                      <td className="py-1 pr-2">
                        <select
                          value={selectValue}
                          onChange={(e) => {
                            const v = e.target.value
                            setResolutions((prev) => {
                              const next = { ...prev }
                              if (v === "") {
                                delete next[c.key]
                              } else if (v === "__skip__") {
                                next[c.key] = { mode: "skip" }
                              } else {
                                next[c.key] = { mode: "pick", filename: v }
                              }
                              return next
                            })
                          }}
                          data-testid={`resolution-${c.key}`}
                          className="text-xs border rounded px-1 py-0.5 bg-white"
                        >
                          <option value="">— выбрать —</option>
                          {c.occurrences.map((o) => (
                            <option key={o.filename} value={o.filename}>
                              использовать {o.filename}
                            </option>
                          ))}
                          <option value="__skip__">пропустить ячейку</option>
                        </select>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {previewResult.conflicts.length > 20 && (
              <p className="text-xs text-red-600 mt-2">
                ... ещё {previewResult.conflicts.length - 20} конфликт(ов)
              </p>
            )}
          </div>
          {allConflictsResolved && (
            <p className="text-xs text-emerald-700 font-medium" data-testid="all-resolved">
              ✓ Все конфликты разрешены — можно применять.
            </p>
          )}
          <label className="flex items-center gap-2 text-xs text-slate-700 border-t pt-2">
            <input
              type="checkbox"
              checked={forceOverride}
              onChange={(e) => setForceOverride(e.target.checked)}
              data-testid="force-override"
            />
            <span>
              Запасной вариант: применить все конфликты по last-write-wins (если
              не хочу выбирать по одному)
            </span>
          </label>
        </div>
      )}

      {/* Preview result */}
      {previewResult && previewResult.perFile.length > 0 && (
        <div className="space-y-3" data-testid="preview-result">
          <h3 className="font-semibold text-sm">Анализ файлов</h3>
          {previewResult.perFile.map((f) => (
            <div
              key={f.filename}
              className="border rounded p-3 text-sm"
              data-testid={`preview-file-${f.filename}`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{f.filename}</span>
                <span
                  className={`px-2 py-0.5 rounded text-xs border ${verdictColor(
                    f.error ? "red" : "green",
                  )}`}
                >
                  {f.fileTypeResult.fileType}
                </span>
              </div>
              <p className="text-xs text-slate-600 mt-1">
                {f.fileTypeResult.reasoning}
              </p>
              {f.classifications.length > 0 && (
                <p className="text-xs text-slate-500 mt-1">
                  Листов классифицировано: {f.classifications.length}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Apply result */}
      {applyResult && (
        <div ref={applyResultRef} className="space-y-3" data-testid="apply-result">
          <h3 className="font-semibold text-sm">
            {verdictEmoji(applyResult.overallVerdict)} Результат применения ·{" "}
            {applyResult.durationMs}ms
          </h3>
          {applyResult.perGroup.map((g) => (
            <div
              key={g.fileType}
              className={`border rounded p-3 text-sm ${verdictColor(g.verdict)}`}
              data-testid={`apply-group-${g.fileType}`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">
                  {verdictEmoji(g.verdict)} {g.fileType} ({g.filenames.length}{" "}
                  файл)
                </span>
                <span className="text-xs">
                  {g.committed
                    ? `${g.totalRowsInserted} строк записано`
                    : g.skipReason ?? "пропущено"}
                </span>
              </div>
            </div>
          ))}
          {applyResult.recompute.targets > 0 && (
            <p className="text-xs text-slate-600">
              Recompute: {applyResult.recompute.ok}/{applyResult.recompute.targets}{" "}
              успешно
            </p>
          )}
        </div>
      )}

      {/* Step 3 — shown after successful apply */}
      {applyResult && applyResult.overallVerdict !== "red" && (
        <div
          className="rounded-lg border-2 border-emerald-400 bg-emerald-50 p-5 space-y-3"
          data-testid="step3-done"
        >
          <div className="flex items-center gap-2">
            <span className="text-2xl">✅</span>
            <div>
              <p className="font-semibold text-emerald-800">Шаг 3 — Импорт завершён</p>
              <p className="text-xs text-emerald-700 mt-0.5">
                {applyResult.perGroup
                  .filter((g) => g.committed)
                  .reduce((s, g) => s + g.totalRowsInserted, 0)}{" "}
                строк записано ·{" "}
                {applyResult.perGroup.filter((g) => g.committed).length} группа(ы) применены
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={resetAll}
            className="px-4 py-2 bg-emerald-600 text-white rounded font-medium hover:bg-emerald-700 text-sm"
            data-testid="btn-reset"
          >
            ↩ Начать заново (загрузить следующие файлы)
          </button>
        </div>
      )}
    </div>
  )
}
