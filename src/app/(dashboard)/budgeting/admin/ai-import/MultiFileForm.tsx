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
import { useTranslations } from "next-intl"

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

/** 2026-05-27 — per-sheet «affected indicators» preview projection.
 *  Server computes via affectedIndicatorsForDataType() against
 *  indicator-seeds.requiredInputs. Shown under each file in the preview
 *  step so the user can verify the AI classifier landed on the right
 *  dataType AND see which downstream indicators will move BEFORE applying. */
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
  /** 2026-05-27 — indicators that moved from `unknown` → present
   *  thanks to this import. Surfaced as «✅ Closed N backlog items»
   *  banner below the apply result. */
  backlogClosed?: Array<{ companyCode: string; indicatorCode: string }>
  /** 2026-05-27 — per-file map of sheet-level impact projections. Read
   *  by the preview card to render confidence + affected-indicator list
   *  per classified sheet. */
  sheetImpactsByFilename?: Record<string, SheetImpact[]>
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

/** Map LLM classifier confidence (0..1) → readable band + Tailwind chip class.
 *  Mirrors `confidenceBand()` in datatype-indicator-map.ts but inlined here so
 *  the component stays self-contained and tree-shakes cleanly. */
function confidenceClass(
  c: number,
  t: (k: string) => string,
): {
  label: string
  pct: string
  cls: string
  bar: string
} {
  const pct = `${Math.round(Math.max(0, Math.min(1, c)) * 100)}%`
  if (c >= 0.85) {
    return {
      label: t("confidence.high"),
      pct,
      cls: "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-300",
      bar: "bg-emerald-500",
    }
  }
  if (c >= 0.65) {
    return {
      label: t("confidence.medium"),
      pct,
      cls: "bg-amber-50 text-amber-800 ring-1 ring-amber-300",
      bar: "bg-amber-500",
    }
  }
  return {
    label: t("confidence.low"),
    pct,
    cls: "bg-rose-50 text-rose-800 ring-1 ring-rose-300",
    bar: "bg-rose-500",
  }
}

/** Per-dataType chip color. Maps the discrete classifier outputs to a
 *  consistent palette so the user learns at-a-glance which colour is
 *  which file-type. */
function dataTypeChipClass(dt: string): string {
  switch (dt) {
    case "PLF":
      return "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200"
    case "BS":
      return "bg-cyan-50 text-cyan-700 ring-1 ring-cyan-200"
    case "CF":
      return "bg-teal-50 text-teal-700 ring-1 ring-teal-200"
    case "KPI_FARMING":
      return "bg-lime-50 text-lime-800 ring-1 ring-lime-300"
    case "KPI_PROCESSING":
      return "bg-orange-50 text-orange-800 ring-1 ring-orange-300"
    case "LAND_REGISTRY":
      return "bg-amber-50 text-amber-800 ring-1 ring-amber-300"
    case "SALES":
      return "bg-fuchsia-50 text-fuchsia-700 ring-1 ring-fuchsia-200"
    case "CAPEX":
      return "bg-violet-50 text-violet-700 ring-1 ring-violet-200"
    case "DESCRIPTIONS":
      return "bg-slate-100 text-slate-700 ring-1 ring-slate-200"
    case "OPS_FACTS":
      return "bg-sky-50 text-sky-700 ring-1 ring-sky-200"
    case "BUDGET_ACTUALS":
    case "SALES_FORECAST":
      return "bg-blue-50 text-blue-700 ring-1 ring-blue-200"
    case "INFO_SUMMARY":
      return "bg-gray-100 text-gray-600 ring-1 ring-gray-200"
    case "COMPANIES":
      return "bg-stone-100 text-stone-700 ring-1 ring-stone-200"
    default:
      return "bg-rose-50 text-rose-700 ring-1 ring-rose-200"
  }
}

export function MultiFileForm() {
  const t = useTranslations("adminAiImport.multi")
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
          {t("dropZone.empty", { max: MAX_FILES })}
        </p>
        <p className="text-xs text-slate-400 mt-1">
          {t("dropZone.limits", {
            max: MAX_FILES,
            mb: MAX_TOTAL_BYTES / 1024 / 1024,
          })}
        </p>
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <div className="flex items-center justify-between bg-slate-100 px-4 py-2 border-b">
            <span className="text-sm font-medium">
              {t("fileList.count", { n: files.length })} · {formatBytes(totalBytes)}
            </span>
            {(overSizeCap || overCountCap) && (
              <span className="text-xs text-red-600 font-medium">
                {t("fileList.overLimit")}
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
          {isProcessing && !applyResult ? t("step1.running") : t("step1.button")}
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
            {isProcessing && previewResult ? t("step2.running") : t("step2.button")}
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
          <span>{t("applying")}</span>
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
            {t("conflict.title", { n: previewResult.conflicts.length })}
          </h3>
          <p className="text-xs text-red-700">
            {t("conflict.description")}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-1 pr-2">{t("conflict.col.cell")}</th>
                  <th className="py-1 pr-2">{t("conflict.col.values")}</th>
                  <th className="py-1 pr-2 text-right">{t("conflict.col.spread")}</th>
                  <th className="py-1 pr-2">{t("conflict.col.resolution")}</th>
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
                          <option value="">{t("conflict.pickPlaceholder")}</option>
                          {c.occurrences.map((o) => (
                            <option key={o.filename} value={o.filename}>
                              {t("conflict.useFile", { name: o.filename })}
                            </option>
                          ))}
                          <option value="__skip__">{t("conflict.skipCell")}</option>
                        </select>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {previewResult.conflicts.length > 20 && (
              <p className="text-xs text-red-600 mt-2">
                {t("conflict.moreOmitted", { n: previewResult.conflicts.length - 20 })}
              </p>
            )}
          </div>
          {allConflictsResolved && (
            <p className="text-xs text-emerald-700 font-medium" data-testid="all-resolved">
              {t("conflict.allResolved")}
            </p>
          )}
          <label className="flex items-center gap-2 text-xs text-slate-700 border-t pt-2">
            <input
              type="checkbox"
              checked={forceOverride}
              onChange={(e) => setForceOverride(e.target.checked)}
              data-testid="force-override"
            />
            <span>{t("conflict.forceOverride")}</span>
          </label>
        </div>
      )}

      {/* Preview result — 2026-05-27 expanded: per-sheet dataType chip,
          AI confidence bar, and affected-indicators chip list, so the
          admin can verify both classification correctness AND downstream
          impact before clicking Apply. */}
      {previewResult && previewResult.perFile.length > 0 && (
        <div className="space-y-3" data-testid="preview-result">
          <div className="flex items-end justify-between">
            <div>
              <h3 className="font-semibold text-sm">{t("preview.title")}</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {t("preview.subtitle")}
              </p>
            </div>
            <div className="text-[10px] text-slate-400 leading-tight text-right hidden md:block">
              <div>{t("preview.legendHigh")}</div>
              <div>{t("preview.legendMedium")}</div>
              <div>{t("preview.legendLow")}</div>
            </div>
          </div>
          {previewResult.perFile.map((f) => {
            const impacts =
              previewResult.sheetImpactsByFilename?.[f.filename] ?? []
            return (
              <div
                key={f.filename}
                className="border rounded-lg p-3 text-sm space-y-2"
                data-testid={`preview-file-${f.filename}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium truncate">{f.filename}</span>
                  <span
                    className={`px-2 py-0.5 rounded text-xs border shrink-0 ${verdictColor(
                      f.error ? "red" : "green",
                    )}`}
                  >
                    {f.fileTypeResult.fileType}
                  </span>
                </div>
                <p className="text-xs text-slate-600">
                  {f.fileTypeResult.reasoning}
                </p>
                {f.error && (
                  <p className="text-xs text-red-700">⚠ {f.error}</p>
                )}
                {impacts.length > 0 && (
                  <div className="border-t pt-2 space-y-1.5">
                    <div className="text-[11px] uppercase tracking-wide text-slate-500">
                      {t("preview.sheetsHeading", { n: impacts.length })}
                    </div>
                    <ul className="space-y-1.5">
                      {impacts.map((imp) => {
                        const conf = confidenceClass(imp.confidence, t)
                        const hasIndicators = imp.impact.indicators.length > 0
                        return (
                          <li
                            key={imp.sheetName}
                            className="rounded border border-slate-200 px-2.5 py-2 bg-slate-50/40"
                            data-testid={`sheet-impact-${f.filename}-${imp.sheetName}`}
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-[11px] text-slate-700 truncate max-w-[16rem]">
                                {imp.sheetName}
                              </span>
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${dataTypeChipClass(imp.dataType)}`}
                              >
                                {imp.dataType}
                              </span>
                              {imp.entityCode && (
                                <span className="font-mono text-[10px] text-slate-500">
                                  {imp.entityCode}
                                </span>
                              )}
                              <div
                                className={`ml-auto inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] ${conf.cls}`}
                                title={t("preview.aiConfidenceTooltip", { pct: conf.pct })}
                              >
                                <span>{conf.label}</span>
                                <span className="font-mono opacity-70">
                                  {conf.pct}
                                </span>
                              </div>
                            </div>
                            {/* confidence bar — visual reinforcement */}
                            <div className="mt-1.5 h-1 rounded-full bg-slate-200 overflow-hidden">
                              <div
                                className={`h-full ${conf.bar} transition-all`}
                                style={{
                                  width: `${Math.round(Math.max(0, Math.min(1, imp.confidence)) * 100)}%`,
                                }}
                              />
                            </div>
                            {/* writes summary */}
                            <p className="text-[10px] text-slate-500 mt-1.5">
                              <span className="text-slate-600">{t("preview.writes")}: </span>
                              {imp.impact.writes}
                            </p>
                            {/* indicator list — humanized: localized name
                                primary, code as small mono suffix so finance
                                users read at-a-glance without learning each
                                abbreviation. */}
                            {hasIndicators ? (
                              <div className="mt-1.5">
                                <p className="text-[10px] text-slate-600 mb-1">
                                  {t("preview.affectsIndicators", {
                                    n: imp.impact.indicators.length,
                                  })}
                                  :
                                </p>
                                <div className="flex flex-wrap gap-1">
                                  {imp.impact.indicators.map((ind) => (
                                    <span
                                      key={ind.code}
                                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white border border-slate-200 text-[10px] text-slate-700"
                                      title={`${ind.code} · ${ind.category} · ${ind.matchedInput}`}
                                    >
                                      <span>{ind.nameRu ?? ind.nameEn}</span>
                                      <span className="font-mono text-[9px] text-slate-400">
                                        {ind.code}
                                      </span>
                                    </span>
                                  ))}
                                </div>
                              </div>
                            ) : imp.impact.note ? (
                              <p className="text-[10px] text-slate-500 italic mt-1.5">
                                {imp.impact.note}
                              </p>
                            ) : null}
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )}
                {impacts.length === 0 && f.classifications.length > 0 && (
                  <p className="text-xs text-slate-500">
                    {t("preview.sheetsClassified", { n: f.classifications.length })}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Apply result */}
      {applyResult && (
        <div ref={applyResultRef} className="space-y-3" data-testid="apply-result">
          <h3 className="font-semibold text-sm">
            {verdictEmoji(applyResult.overallVerdict)} {t("result.title")} ·{" "}
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
                  {verdictEmoji(g.verdict)} {g.fileType} ·{" "}
                  {t("result.fileCount", { n: g.filenames.length })}
                </span>
                <span className="text-xs">
                  {g.committed
                    ? t("result.rowsWritten", { n: g.totalRowsInserted })
                    : g.skipReason ?? t("result.skipped")}
                </span>
              </div>
            </div>
          ))}
          {applyResult.recompute.targets > 0 && (
            <p className="text-xs text-slate-600">
              {t("result.recomputeLine", {
                ok: applyResult.recompute.ok,
                total: applyResult.recompute.targets,
              })}
            </p>
          )}
          {applyResult.backlogClosed && applyResult.backlogClosed.length > 0 && (
            <div className="mt-3 p-3 rounded-md bg-emerald-50 border border-emerald-200">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-base">✅</span>
                <p className="text-sm font-semibold text-emerald-800">
                  {t("result.backlogClosed", { n: applyResult.backlogClosed.length })}
                </p>
              </div>
              <ul className="text-xs text-emerald-900/80 space-y-0.5 ml-5">
                {applyResult.backlogClosed.slice(0, 8).map((b) => (
                  <li key={`${b.companyCode}-${b.indicatorCode}`}>
                    <code className="font-mono text-[11px]">{b.companyCode}</code>{" "}
                    → {b.indicatorCode}
                  </li>
                ))}
                {applyResult.backlogClosed.length > 8 && (
                  <li className="italic text-emerald-700">
                    {t("result.andMore", {
                      n: applyResult.backlogClosed.length - 8,
                    })}
                  </li>
                )}
              </ul>
              <a
                href="/budgeting/admin/indicator-backlog"
                className="inline-block mt-2 text-xs text-emerald-700 underline-offset-2 hover:underline"
              >
                {t("result.openBacklog")}
              </a>
            </div>
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
              <p className="font-semibold text-emerald-800">{t("step3.title")}</p>
              <p className="text-xs text-emerald-700 mt-0.5">
                {t("step3.summary", {
                  rows: applyResult.perGroup
                    .filter((g) => g.committed)
                    .reduce((s, g) => s + g.totalRowsInserted, 0),
                  groups: applyResult.perGroup.filter((g) => g.committed).length,
                })}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={resetAll}
            className="px-4 py-2 bg-emerald-600 text-white rounded font-medium hover:bg-emerald-700 text-sm"
            data-testid="btn-reset"
          >
            {t("step3.resetButton")}
          </button>
        </div>
      )}
    </div>
  )
}
