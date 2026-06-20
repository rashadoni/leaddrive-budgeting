"use client"
/**
 * Universal Import wizard (Phase 1 — single P&L sheet, arbitrary format).
 *
 * Flow: pick company + drop xlsx → classify sheets (AI) → analyze chosen
 * sheet (AI mapper proposes a column mapping) → REVIEW/EDIT the mapping →
 * dry-run reconcile preview (zero DB writes) → commit.
 *
 * Reuses: POST /api/import/ai-auto (classify), POST /api/onboarding/import/
 * analyze (NEW producer), POST /api/onboarding/import/staging/[id]/apply
 * (dry-run + real apply — already built), MappingReviewTable, and the
 * proposal-overrides helpers (buildUserOverrides).
 *
 * Scope (Phase 1): single P&L (BudgetLine) sheet. BS/CF/multi-sheet are
 * later phases — the UI says so explicitly.
 */
import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react"
import type {
  ColumnMappingProposal,
  MappingProposal,
  SourceColumn,
} from "@/lib/onboarding/ai-mapper/types"
import { buildUserOverrides } from "@/features/onboarding/lib/proposal-overrides"
import { MappingReviewTable } from "@/features/onboarding/components/MappingReviewTable"

interface CompanyOpt {
  id: string
  code: string
  name: string
}
interface Classification {
  sheetName: string
  dataType: string
  confidence: number
}
interface AnalyzeResponse {
  ok: true
  stagingId: string
  company: { id: string; code: string; name: string }
  proposal: MappingProposal
  sourceColumns: SourceColumn[]
}
interface ApplyResult {
  status: "preview" | "applied"
  year: number
  inserted: number
  deleted: number
  warnings: number
  parentRollupsDropped: number
  parentRollupsUnallocated: number
  recompute?: { ok: number; unknown: number; failed: number; targets: number }
  indicatorsStale?: boolean
}

type Busy = null | "classify" | "preview" | "apply"

// Flatten the /api/companies tree (roots → children → children).
function flatten(tree: unknown): CompanyOpt[] {
  const out: CompanyOpt[] = []
  const walk = (nodes: unknown) => {
    if (!Array.isArray(nodes)) return
    for (const n of nodes as Array<Record<string, unknown>>) {
      if (n && typeof n.id === "string") {
        out.push({ id: n.id, code: String(n.code ?? ""), name: String(n.name ?? "") })
      }
      if (n && Array.isArray(n.children)) walk(n.children)
    }
  }
  walk(tree)
  return out
}

export function UniversalImportForm() {
  const [companies, setCompanies] = useState<CompanyOpt[]>([])
  const [companyId, setCompanyId] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [busy, setBusy] = useState<Busy>(null)
  const [error, setError] = useState<string | null>(null)

  const [classifications, setClassifications] = useState<Classification[]>([])
  const [sheetName, setSheetName] = useState("")
  const [analysis, setAnalysis] = useState<AnalyzeResponse | null>(null)
  const [edited, setEdited] = useState<ColumnMappingProposal[]>([])
  const [preview, setPreview] = useState<ApplyResult | null>(null)
  const [applied, setApplied] = useState<ApplyResult | null>(null)
  const [ackLowConf, setAckLowConf] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  // Monotonic token bumped on every mapping/sheet/file change. A dry-run
  // preview only applies if the token still matches when it resolves — an
  // edit made while a preview is in flight discards the now-stale result.
  const previewEpoch = useRef(0)

  useEffect(() => {
    fetch("/api/companies")
      .then((r) => (r.ok ? r.json() : []))
      .then((tree) => setCompanies(flatten(tree)))
      .catch(() => setCompanies([]))
  }, [])

  const reset = () => {
    setClassifications([])
    setSheetName("")
    setAnalysis(null)
    setEdited([])
    setPreview(null)
    setApplied(null)
    setAckLowConf(false)
    setError(null)
    previewEpoch.current++
  }
  const pickFile = (f: File | null | undefined) => {
    if (!f) return
    setFile(f)
    reset()
  }

  async function analyzeSheet(targetSheet: string) {
    if (!file || !companyId || !targetSheet) return
    setBusy("classify")
    setError(null)
    setAnalysis(null)
    setPreview(null)
    setApplied(null)
    try {
      const fd = new FormData()
      fd.append("file", file)
      fd.append("sheetName", targetSheet)
      fd.append("companyId", companyId)
      const res = await fetch("/api/onboarding/import/analyze", { method: "POST", body: fd })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body?.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
      const a = body as AnalyzeResponse
      setAnalysis(a)
      previewEpoch.current++
      // Normalise to one entry per SOURCE column. If the AI proposal omitted a
      // column, default it to "skip" so the reviewer can still re-map it (an
      // edit on a missing entry would otherwise silently vanish).
      setEdited(
        a.sourceColumns.map((sc) => {
          const c = a.proposal.columns.find((x) => x.sourceIndex === sc.index)
          return c
            ? { ...c }
            : { sourceIndex: sc.index, role: "skip" as const, confidence: 0, reasoning: "" }
        }),
      )
      setSheetName(targetSheet)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  // Step 1: classify sheets, then auto-analyze the best P&L sheet.
  async function onStart() {
    if (!file || !companyId) return
    setBusy("classify")
    setError(null)
    reset()
    try {
      const fd = new FormData()
      fd.append("file", file)
      const res = await fetch("/api/import/ai-auto", { method: "POST", body: fd })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body?.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
      const cls = (body.classifications ?? []) as Classification[]
      setClassifications(cls)
      // Prefer the highest-confidence P&L (PLF) sheet; fall back to first sheet.
      const plf = cls.filter((c) => c.dataType === "PLF").sort((a, b) => b.confidence - a.confidence)
      const best = plf[0]?.sheetName ?? cls[0]?.sheetName ?? ""
      if (!best) throw new Error("No sheets detected in workbook")
      await analyzeSheet(best)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(null)
    }
  }

  async function runApply(dryRun: boolean) {
    if (!file || !analysis) return
    const myEpoch = previewEpoch.current
    setBusy(dryRun ? "preview" : "apply")
    setError(null)
    try {
      const fd = new FormData()
      fd.append("file", file)
      if (dryRun) fd.append("dryRun", "true")
      const overrides = buildUserOverrides(analysis.proposal, edited)
      if (overrides) fd.append("userOverrides", JSON.stringify(overrides))
      const res = await fetch(`/api/onboarding/import/staging/${analysis.stagingId}/apply`, {
        method: "POST",
        body: fd,
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
      if (dryRun) {
        // Discard a preview whose mapping was edited while it was in flight —
        // otherwise a stale preview could re-enable the commit gate.
        if (previewEpoch.current !== myEpoch) return
        setPreview(body as ApplyResult)
      } else {
        setApplied(body as ApplyResult)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const lowConf =
    !!analysis &&
    (analysis.proposal.overallConfidence < 0.7 ||
      analysis.proposal.columns.some((c) => c.confidence < 0.6))
  const commitBlocked = !preview || busy !== null || (lowConf && !ackLowConf)

  return (
    <div className="space-y-6">
      <div className="text-xs text-muted-foreground leading-relaxed border rounded p-3 bg-muted/20">
        Загрузка <b>произвольного</b> файла: AI предлагает разметку колонок, вы
        проверяете/правите, видите сверку без записи, и только потом применяете.
        Фаза 1 — один лист <b>P&amp;L</b> (баланс/кэш-флоу и мультилист — позже).
      </div>

      {/* Step 1 — company + file */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="text-xs text-muted-foreground">Компания (сущность)</label>
          <select
            value={companyId}
            onChange={(e) => {
              setCompanyId(e.target.value)
              reset()
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
          className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors flex items-center justify-center ${
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
          <div className="text-sm">
            {file ? <span className="font-mono">{file.name}</span> : "Перетащите .xlsx или нажмите"}
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={onStart}
        disabled={!file || !companyId || busy !== null}
        className="w-full px-4 py-2 rounded bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-40 transition-colors"
      >
        {busy === "classify" ? "AI анализирует…" : "Анализировать файл"}
      </button>

      {error && (
        <div className="border border-red-500/40 bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 rounded p-3 text-sm">
          ❌ {error}
        </div>
      )}

      {/* Sheet picker (after classify) */}
      {classifications.length > 0 && analysis && (
        <div className="flex items-center gap-2 text-sm">
          <label className="text-xs text-muted-foreground">Лист</label>
          <select
            value={sheetName}
            onChange={(e) => analyzeSheet(e.target.value)}
            disabled={busy !== null}
            className="px-2 py-1 rounded border border-border bg-background text-xs"
          >
            {classifications.map((c) => (
              <option key={c.sheetName} value={c.sheetName}>
                {c.sheetName} · {c.dataType} ({(c.confidence * 100).toFixed(0)}%)
              </option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground">
            → {analysis.company.name} ({analysis.company.code})
          </span>
        </div>
      )}

      {/* Step 2 — review/edit mapping */}
      {analysis && !applied && (
        <MappingReviewTable
          proposal={analysis.proposal}
          sourceColumns={analysis.sourceColumns}
          edited={edited}
          disabled={busy !== null}
          onChange={(next) => {
            setEdited(next)
            previewEpoch.current++ // invalidate any in-flight preview
            setPreview(null) // mapping changed → previous preview is stale
          }}
        />
      )}

      {/* Step 3 — preview + commit */}
      {analysis && !applied && (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => runApply(true)}
            disabled={busy !== null}
            className="w-full px-4 py-2 rounded bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-40 transition-colors"
          >
            {busy === "preview" ? "Считаю…" : "Превью (без записи)"}
          </button>

          {preview && (
            <div className="border rounded p-3 bg-muted/20 text-sm">
              <div className="font-semibold mb-1">👁 Превью · год {preview.year}</div>
              <div className="text-xs text-muted-foreground">
                строк к записи: <b>{preview.inserted}</b> · заменит существующих: {preview.deleted} ·
                предупреждений: {preview.warnings} · нераспределённых родительских итогов:{" "}
                <b>{preview.parentRollupsUnallocated}</b>
              </div>
              {preview.parentRollupsUnallocated > 0 && (
                <div className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                  ⚠ итог родителя ≠ сумме строк-листьев — проверьте разметку перед записью.
                </div>
              )}
            </div>
          )}

          {lowConf && (
            <label className="flex items-start gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={ackLowConf}
                onChange={(e) => setAckLowConf(e.target.checked)}
                className="mt-0.5"
              />
              Низкая уверенность AI — я проверил разметку колонок вручную.
            </label>
          )}

          <button
            type="button"
            onClick={() => runApply(false)}
            disabled={commitBlocked}
            title={!preview ? "Сначала запустите превью" : undefined}
            className="w-full px-4 py-2 rounded bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-40 transition-colors"
          >
            {busy === "apply" ? "Записываю…" : "Применить (запись в БД)"}
          </button>
        </div>
      )}

      {/* Step 4 — applied */}
      {applied && (
        <div className="border rounded p-4 bg-emerald-50 dark:bg-emerald-500/10 text-sm space-y-1">
          <div className="text-lg font-bold">✅ Импортировано · год {applied.year}</div>
          <div className="text-xs text-muted-foreground">
            записано строк: <b>{applied.inserted}</b> · заменено: {applied.deleted} · предупреждений:{" "}
            {applied.warnings}
            {applied.recompute && ` · recompute ok:${applied.recompute.ok} failed:${applied.recompute.failed}`}
          </div>
          {applied.indicatorsStale && (
            <div className="text-xs text-amber-700 dark:text-amber-400">
              ⚠ часть индикаторов не пересчиталась — откройте терминал позже/повторите.
            </div>
          )}
          <button
            type="button"
            onClick={() => {
              setFile(null)
              reset()
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
