"use client"
/**
 * Universal Import — multi-sheet wizard (Phase 2 #4).
 *
 * For a workbook with SEVERAL P&L sheets belonging to ONE company. Flow:
 * pick company + file → classify → multi-select the P&L sheets → analyze all
 * (AI mapper per sheet) → REVIEW/EDIT each sheet's mapping → dry-run reconcile
 * preview (aggregate control-total verdict) → commit (atomic across sheets).
 *
 * Reuses /api/onboarding/import/analyze-multi (producer) + the existing
 * /staging/[id]/apply-multi route (now overrides + control-totals + hash-guard
 * aware) + MappingReviewTable + proposal-overrides helpers.
 */
import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react"
import type { ColumnMappingProposal, MappingProposal, SourceColumn } from "@/lib/onboarding/ai-mapper/types"
import { buildUserOverrides } from "@/features/onboarding/lib/proposal-overrides"
import { MappingReviewTable } from "@/features/onboarding/components/MappingReviewTable"

interface CompanyOpt { id: string; code: string; name: string }
interface Classification { sheetName: string; dataType: string; confidence: number }
interface SheetAnalysis { sheetName: string; proposal: MappingProposal; sourceColumns: SourceColumn[] }
interface AnalyzeMultiResponse {
  ok: true
  stagingId: string
  company: { id: string; code: string; name: string }
  sheets: SheetAnalysis[]
}
interface ControlTotal { code: string; statedTotal: number; leafSum: number; delta: number; deltaPct: number }
interface PreviewResult {
  year: number
  incomingLineCount: number
  sheetCount: { success: number; failure: number }
  controlVerdict?: "green" | "yellow" | "red"
  controlNoData?: boolean
  controlTotals?: ControlTotal[]
}
interface AppliedResult {
  status: "applied"
  year: number
  inserted: number
  deleted: number
  successCount: number
  failureCount: number
  recompute?: { ok: number; failed: number }
  indicatorsStale?: boolean
}

type Busy = null | "classify" | "analyze" | "preview" | "apply"

const VERDICT: Record<"green" | "yellow" | "red", { fg: string; icon: string; label: string }> = {
  green: { fg: "text-emerald-700 dark:text-emerald-400", icon: "🟢", label: "контрольные суммы сходятся" },
  yellow: { fg: "text-amber-700 dark:text-amber-400", icon: "🟡", label: "малое расхождение (≤1%)" },
  red: { fg: "text-red-700 dark:text-red-400", icon: "🔴", label: "крупное расхождение — вероятный мис-маппинг" },
}
const fmtN = (n: number) => Math.round(n).toLocaleString("ru-RU")

function flatten(tree: unknown): CompanyOpt[] {
  const out: CompanyOpt[] = []
  const walk = (nodes: unknown) => {
    if (!Array.isArray(nodes)) return
    for (const n of nodes as Array<Record<string, unknown>>) {
      if (n && typeof n.id === "string") out.push({ id: n.id, code: String(n.code ?? ""), name: String(n.name ?? "") })
      if (n && Array.isArray(n.children)) walk(n.children)
    }
  }
  walk(tree)
  return out
}

export function MultiSheetImportForm() {
  const [companies, setCompanies] = useState<CompanyOpt[]>([])
  const [companyId, setCompanyId] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [busy, setBusy] = useState<Busy>(null)
  const [error, setError] = useState<string | null>(null)
  const [classifications, setClassifications] = useState<Classification[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [analysis, setAnalysis] = useState<AnalyzeMultiResponse | null>(null)
  const [editedBySheet, setEditedBySheet] = useState<Record<string, ColumnMappingProposal[]>>({})
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [applied, setApplied] = useState<AppliedResult | null>(null)
  const [ackReview, setAckReview] = useState(false)
  const [ackControl, setAckControl] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const previewEpoch = useRef(0)

  useEffect(() => {
    fetch("/api/companies")
      .then((r) => (r.ok ? r.json() : []))
      .then((t) => setCompanies(flatten(t)))
      .catch(() => setCompanies([]))
  }, [])

  const resetAfterFile = () => {
    setClassifications([])
    setSelected([])
    setAnalysis(null)
    setEditedBySheet({})
    setPreview(null)
    setApplied(null)
    setAckReview(false)
    setAckControl(false)
    setError(null)
    previewEpoch.current++
  }
  const pickFile = (f: File | null | undefined) => {
    if (!f) return
    setFile(f)
    resetAfterFile()
  }

  async function onClassify() {
    if (!file || !companyId) return
    setBusy("classify")
    resetAfterFile()
    try {
      const fd = new FormData()
      fd.append("file", file)
      const res = await fetch("/api/import/ai-auto", { method: "POST", body: fd })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body?.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
      const cls = (body.classifications ?? []) as Classification[]
      setClassifications(cls)
      setSelected(cls.filter((c) => c.dataType === "PLF").map((c) => c.sheetName))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function onAnalyze() {
    if (!file || !companyId || selected.length < 2) return
    setBusy("analyze")
    setError(null)
    setAnalysis(null)
    setPreview(null)
    setApplied(null)
    try {
      const fd = new FormData()
      fd.append("file", file)
      fd.append("companyId", companyId)
      fd.append("sheetNames", selected.join(","))
      const res = await fetch("/api/onboarding/import/analyze-multi", { method: "POST", body: fd })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body?.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
      const a = body as AnalyzeMultiResponse
      setAnalysis(a)
      const initial: Record<string, ColumnMappingProposal[]> = {}
      for (const s of a.sheets) {
        initial[s.sheetName] = s.sourceColumns.map((sc) => {
          const c = s.proposal.columns.find((x) => x.sourceIndex === sc.index)
          return c ? { ...c } : { sourceIndex: sc.index, role: "skip" as const, confidence: 0, reasoning: "" }
        })
      }
      setEditedBySheet(initial)
      previewEpoch.current++
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  function buildOverridesForm(): string | null {
    if (!analysis) return null
    const overrides: Record<string, Partial<MappingProposal>> = {}
    for (const s of analysis.sheets) {
      const o = buildUserOverrides(s.proposal, editedBySheet[s.sheetName] ?? s.proposal.columns)
      if (o) overrides[s.sheetName] = o
    }
    return Object.keys(overrides).length ? JSON.stringify(overrides) : null
  }

  async function runApply(dryRun: boolean) {
    if (!file || !analysis) return
    const myEpoch = previewEpoch.current
    setBusy(dryRun ? "preview" : "apply")
    setError(null)
    if (dryRun) setAckControl(false)
    try {
      const fd = new FormData()
      fd.append("file", file)
      const ov = buildOverridesForm()
      if (ov) fd.append("userOverrides", ov)
      if (!dryRun) {
        // Server re-checks the review gates (Codex P1 #1) — forward the
        // human's acknowledgement so a reviewed commit isn't 409'd.
        fd.append("acknowledgeAnomalies", String(ackReview))
        fd.append("acknowledgeLowConfidence", String(ackReview))
      }
      const url = `/api/onboarding/import/staging/${analysis.stagingId}/apply-multi${dryRun ? "?dryRun=true" : ""}`
      const res = await fetch(url, { method: "POST", body: fd })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
      if (dryRun) {
        if (previewEpoch.current !== myEpoch) return
        setPreview(body as PreviewResult)
      } else {
        setApplied(body as AppliedResult)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const plfSheets = classifications.filter((c) => c.dataType === "PLF")
  const needsReviewAck =
    !!analysis &&
    analysis.sheets.some(
      (s) =>
        s.proposal.overallConfidence < 0.7 ||
        s.proposal.columns.some((c) => c.confidence < 0.6) ||
        s.proposal.anomalies.some((a) => a.severity === "critical"),
    )
  const controlGated = !!preview && preview.controlVerdict !== undefined && preview.controlVerdict !== "green"
  // RED control-total = hard block (can't be ack-overridden; server rejects too).
  const redBlocked = !!preview && preview.controlVerdict === "red"
  // All-or-none (Codex P1 #2): any failed sheet blocks the whole commit —
  // otherwise the company's full P&L would be replaced by a partial subset.
  const failureBlocked = !!preview && preview.sheetCount.failure > 0
  const commitBlocked =
    !preview ||
    busy !== null ||
    redBlocked ||
    failureBlocked ||
    (needsReviewAck && !ackReview) ||
    (controlGated && !ackControl)

  return (
    <div className="space-y-6">
      <div className="text-xs text-muted-foreground leading-relaxed border rounded p-3 bg-muted/20">
        Несколько <b>P&amp;L-листов одной компании</b> в одном файле: AI размечает каждый лист, вы
        проверяете/правите, видите общую сверку, и применяете атомарно. Для одного листа — вкладка «Любой файл (AI)».
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="text-xs text-muted-foreground">Компания (сущность)</label>
          <select
            value={companyId}
            onChange={(e) => {
              setCompanyId(e.target.value)
              resetAfterFile()
            }}
            className="w-full mt-1 px-2 py-2 rounded border border-border bg-background text-sm"
          >
            <option value="">— выберите —</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.code})
              </option>
            ))}
          </select>
        </div>
        <div
          onDrop={(e: DragEvent<HTMLDivElement>) => {
            e.preventDefault()
            setIsDragging(false)
            pickFile(e.dataTransfer.files[0])
          }}
          onDragOver={(e) => {
            e.preventDefault()
            setIsDragging(true)
          }}
          onDragLeave={() => setIsDragging(false)}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer flex items-center justify-center transition-colors ${
            isDragging ? "border-emerald-500/60 bg-emerald-500/5" : "border-border hover:border-muted-foreground/40"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(e: ChangeEvent<HTMLInputElement>) => pickFile(e.target.files?.[0])}
          />
          <div className="text-sm">{file ? <span className="font-mono">{file.name}</span> : "Перетащите .xlsx или нажмите"}</div>
        </div>
      </div>

      <button
        type="button"
        onClick={onClassify}
        disabled={!file || !companyId || busy !== null}
        className="w-full px-4 py-2 rounded bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-40 transition-colors"
      >
        {busy === "classify" ? "AI распознаёт листы…" : "Распознать листы"}
      </button>

      {error && (
        <div className="border border-red-500/40 bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 rounded p-3 text-sm">
          ❌ {error}
        </div>
      )}

      {/* Sheet multi-select */}
      {plfSheets.length > 0 && !analysis && (
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">Выберите P&L-листы (≥2):</div>
          <div className="grid grid-cols-2 gap-1">
            {plfSheets.map((c) => (
              <label key={c.sheetName} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selected.includes(c.sheetName)}
                  onChange={(e) =>
                    setSelected((s) =>
                      e.target.checked ? [...s, c.sheetName] : s.filter((x) => x !== c.sheetName),
                    )
                  }
                />
                <span className="font-mono text-xs">{c.sheetName}</span>
                <span className="text-[10px] text-muted-foreground">{(c.confidence * 100).toFixed(0)}%</span>
              </label>
            ))}
          </div>
          <button
            type="button"
            onClick={onAnalyze}
            disabled={selected.length < 2 || busy !== null}
            className="w-full px-4 py-2 rounded bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-40 transition-colors"
          >
            {busy === "analyze" ? "AI размечает…" : `Анализировать выбранные (${selected.length})`}
          </button>
          {classifications.length > 0 && plfSheets.length < 2 && (
            <div className="text-xs text-amber-700 dark:text-amber-400">
              Найдено &lt;2 P&L-листов. Для одного листа используйте вкладку «Любой файл (AI)».
            </div>
          )}
        </div>
      )}

      {/* Per-sheet review */}
      {analysis && !applied && (
        <div className="space-y-5">
          {analysis.sheets.map((s) => (
            <div key={s.sheetName} className="space-y-2">
              <div className="font-semibold text-sm">📄 {s.sheetName}</div>
              <MappingReviewTable
                proposal={s.proposal}
                sourceColumns={s.sourceColumns}
                edited={editedBySheet[s.sheetName] ?? s.proposal.columns}
                disabled={busy !== null}
                onChange={(next) => {
                  setEditedBySheet((m) => ({ ...m, [s.sheetName]: next }))
                  previewEpoch.current++
                  setPreview(null)
                  setAckControl(false)
                }}
              />
            </div>
          ))}

          <button
            type="button"
            onClick={() => runApply(true)}
            disabled={busy !== null}
            className="w-full px-4 py-2 rounded bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-40 transition-colors"
          >
            {busy === "preview" ? "Считаю…" : "Превью (без записи)"}
          </button>

          {preview && (
            <div className="border rounded p-3 bg-muted/20 text-sm space-y-2">
              <div className="font-semibold">👁 Превью · год {preview.year}</div>
              <div className="text-xs text-muted-foreground">
                строк к записи: <b>{preview.incomingLineCount}</b> · листов ок:{" "}
                {preview.sheetCount.success} · ошибок: {preview.sheetCount.failure}
              </div>
              {preview.controlNoData ? (
                <div className="text-xs text-sky-700 dark:text-sky-400">
                  ℹ Нет родительских итогов для авто-сверки — проверьте разметку вручную.
                </div>
              ) : (
                <div className={`text-xs font-medium ${VERDICT[preview.controlVerdict ?? "green"].fg}`}>
                  Сверка: {VERDICT[preview.controlVerdict ?? "green"].icon}{" "}
                  {VERDICT[preview.controlVerdict ?? "green"].label}
                </div>
              )}
              {failureBlocked && (
                <div className="rounded border border-red-500/40 bg-red-50 dark:bg-red-500/10 px-2 py-1.5 text-[11px] text-red-700 dark:text-red-300">
                  ⛔ {preview.sheetCount.failure} лист(ов) не разобрались — коммит
                  заблокирован (режим «всё-или-ничего»). Иначе данные компании
                  заменятся неполным набором. Исправьте проблемные листы и
                  обновите превью.
                </div>
              )}
              {redBlocked && (
                <div className="rounded border border-red-500/40 bg-red-50 dark:bg-red-500/10 px-2 py-1.5 text-[11px] text-red-700 dark:text-red-300">
                  🔴 Контроль-сумма RED — коммит заблокирован жёстко (нельзя
                  подтвердить). Вероятный мис-маппинг колонки. Сервер тоже
                  отклонит такой коммит.
                </div>
              )}
              {preview.controlTotals && preview.controlTotals.length > 0 && (
                <div className="border rounded overflow-hidden">
                  <table className="w-full text-[11px]">
                    <thead className="bg-muted">
                      <tr>
                        <th className="text-left p-1">Родитель</th>
                        <th className="text-right p-1">Заявлено</th>
                        <th className="text-right p-1">Σ листьев</th>
                        <th className="text-right p-1">Δ%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.controlTotals.map((c) => (
                        <tr key={c.code} className="border-t">
                          <td className="p-1 font-mono">{c.code}</td>
                          <td className="p-1 text-right font-mono">{fmtN(c.statedTotal)}</td>
                          <td className="p-1 text-right font-mono">{fmtN(c.leafSum)}</td>
                          <td className="p-1 text-right font-mono">{(c.deltaPct * 100).toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {needsReviewAck && (
            <label className="flex items-start gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={ackReview} onChange={(e) => setAckReview(e.target.checked)} className="mt-0.5" />
              Низкая уверенность AI / критическая аномалия на одном из листов — я проверил разметку вручную.
            </label>
          )}
          {controlGated && (
            <label className="flex items-start gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={ackControl} onChange={(e) => setAckControl(e.target.checked)} className="mt-0.5" />
              Расхождение контрольных сумм проверено (🔴 = вероятный мис-маппинг).
            </label>
          )}

          <button
            type="button"
            onClick={() => runApply(false)}
            disabled={commitBlocked}
            title={!preview ? "Сначала запустите превью" : undefined}
            className="w-full px-4 py-2 rounded bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-40 transition-colors"
          >
            {busy === "apply" ? "Записываю…" : "Применить все листы (запись в БД)"}
          </button>
        </div>
      )}

      {applied && (
        <div className="border rounded p-4 bg-emerald-50 dark:bg-emerald-500/10 text-sm space-y-1">
          <div className="text-lg font-bold">✅ Импортировано · год {applied.year}</div>
          <div className="text-xs text-muted-foreground">
            записано строк: <b>{applied.inserted}</b> · заменено: {applied.deleted} · листов ок:{" "}
            {applied.successCount} · ошибок: {applied.failureCount}
            {applied.recompute && ` · recompute ok:${applied.recompute.ok} failed:${applied.recompute.failed}`}
          </div>
          {applied.indicatorsStale && (
            <div className="text-xs text-amber-700 dark:text-amber-400">
              ⚠ часть индикаторов не пересчиталась — повторите/проверьте позже.
            </div>
          )}
          <button
            type="button"
            onClick={() => {
              setFile(null)
              resetAfterFile()
            }}
            className="mt-2 px-3 py-1.5 rounded border border-border text-xs hover:bg-muted/50"
          >
            Импортировать ещё файл
          </button>
        </div>
      )}
    </div>
  )
}
