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
  // Phase C C2.4 — present only for a multi-company-in-one-sheet (entity column).
  multiEntity?: boolean
  entityValues?: string[]
  entitySuggestions?: Record<string, string>
}

// Phase C C2.4b — /apply-multi-entity response shapes (distinct from the
// single-company ApplyResult).
interface MePerEntityPreview {
  entityValue: string
  companyId: string | null
  lineCount: number
  error?: string
  wouldDelete: number
}
interface MePreviewResult {
  status: "preview"
  dryRun: true
  year: number
  entityCount: number
  writeableCount: number
  perEntity: MePerEntityPreview[]
  controlVerdict: "green" | "yellow" | "red"
  mappingIssues: {
    unmapped: string[]
    crossOrg: string[]
    duplicateCompanyIds: string[]
    parseErrors: Array<{ entityValue: string; error: string }>
  }
}
interface MeAppliedResult {
  status: "applied"
  year: number
  inserted: number
  deleted: number
  entityCount: number
  perEntity: Array<{ entityValue: string; companyId: string; inserted: number; deleted: number }>
  recompute?: { ok: number; unknown: number; failed: number; targets: number }
  indicatorsStale?: boolean
}
interface ControlTotal {
  code: string
  statedTotal: number
  leafSum: number
  delta: number
  deltaPct: number
}
interface ApplyResult {
  status: "preview" | "applied"
  year: number
  inserted: number
  deleted: number
  warnings: number
  parentRollupsDropped: number
  parentRollupsUnallocated: number
  // Phase 2 — control-total verdict (dry-run only).
  controlVerdict?: "green" | "yellow" | "red"
  controlNoData?: boolean
  controlTotals?: ControlTotal[]
  // Phase A validation engine — graded verdict + findings (dry-run only).
  validationVerdict?: "certified" | "warn" | "blocked" | "uncertifiable"
  validationFindings?: Array<{ severity: "blocker" | "warning" | "info"; category: string; message: string }>
  rowTotalMismatches?: number
  recompute?: { ok: number; unknown: number; failed: number; targets: number }
  indicatorsStale?: boolean
}

type Busy = null | "classify" | "preview" | "apply"

const VERDICT: Record<"green" | "yellow" | "red", { fg: string; icon: string; label: string }> = {
  green: { fg: "text-emerald-700 dark:text-emerald-400", icon: "🟢", label: "контрольные суммы сходятся" },
  yellow: { fg: "text-amber-700 dark:text-amber-400", icon: "🟡", label: "малое расхождение (≤1%)" },
  red: { fg: "text-red-700 dark:text-red-400", icon: "🔴", label: "крупное расхождение — вероятный мис-маппинг" },
}
const VALIDATION_VERDICT: Record<
  "certified" | "warn" | "blocked" | "uncertifiable",
  { fg: string; icon: string; label: string }
> = {
  certified: { fg: "text-emerald-700 dark:text-emerald-400", icon: "✅", label: "сертифицировано — контроли сошлись" },
  warn: { fg: "text-amber-700 dark:text-amber-400", icon: "⚠️", label: "с предупреждениями — проверьте находки" },
  blocked: { fg: "text-red-700 dark:text-red-300", icon: "⛔", label: "заблокировано — данные не пройдут коммит" },
  uncertifiable: { fg: "text-sky-700 dark:text-sky-400", icon: "❓", label: "нечем авто-подтвердить — нужен ручной review" },
}
const fmtN = (n: number) => Math.round(n).toLocaleString("ru-RU")

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
  // Create-new-company sub-flow (for entities not yet in the org tree).
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newCo, setNewCo] = useState({ code: "", name: "", industry: "", baseCurrencyCode: "AZN" })
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
  const [ackControl, setAckControl] = useState(false)
  // Phase C C2.4b — multi-entity routing: entityValue → companyId map + the
  // /apply-multi-entity preview/applied results (kept separate from the
  // single-company preview/applied so the two paths don't entangle).
  const [entityMap, setEntityMap] = useState<Record<string, string>>({})
  const [mePreview, setMePreview] = useState<MePreviewResult | null>(null)
  const [meApplied, setMeApplied] = useState<MeAppliedResult | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  // Monotonic token bumped on every mapping/sheet/file change. A dry-run
  // preview only applies if the token still matches when it resolves — an
  // edit made while a preview is in flight discards the now-stale result.
  const previewEpoch = useRef(0)

  const loadCompanies = async (): Promise<CompanyOpt[]> => {
    try {
      const r = await fetch("/api/companies")
      const tree = r.ok ? await r.json() : []
      const flat = flatten(tree)
      setCompanies(flat)
      return flat
    } catch {
      setCompanies([])
      return []
    }
  }

  useEffect(() => {
    void loadCompanies()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function createCompany() {
    if (!newCo.code.trim() || !newCo.name.trim()) {
      setError("Код и название компании обязательны")
      return
    }
    setCreating(true)
    setError(null)
    try {
      const res = await fetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: newCo.code.trim(),
          name: newCo.name.trim(),
          industry: newCo.industry.trim() || undefined,
          baseCurrencyCode: newCo.baseCurrencyCode.trim() || undefined,
        }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
      await loadCompanies()
      setCompanyId(body.id) // select the freshly created company
      setShowCreate(false)
      setNewCo({ code: "", name: "", industry: "", baseCurrencyCode: "AZN" })
      reset()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setCreating(false)
    }
  }

  const reset = () => {
    setClassifications([])
    setSheetName("")
    setAnalysis(null)
    setEdited([])
    setPreview(null)
    setApplied(null)
    setEntityMap({})
    setMePreview(null)
    setMeApplied(null)
    setAckLowConf(false)
    setAckControl(false)
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
      // Multi-entity: seed the entityValue→company map from the AI's
      // auto-suggested matches (the reviewer confirms/corrects below).
      setEntityMap(a.multiEntity ? { ...(a.entitySuggestions ?? {}) } : {})
      setMePreview(null)
      setMeApplied(null)
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
    if (dryRun) setAckControl(false) // fresh preview → fresh verdict to acknowledge
    try {
      const fd = new FormData()
      fd.append("file", file)
      if (dryRun) fd.append("dryRun", "true")
      const overrides = buildUserOverrides(analysis.proposal, edited)
      if (overrides) fd.append("userOverrides", JSON.stringify(overrides))
      if (!dryRun) {
        // Server re-checks the review gates (Codex P1 #1) — forward the
        // human's acknowledgement so a legit reviewed commit isn't 409'd.
        // The commit button is disabled until these acks are given.
        fd.append("acknowledgeAnomalies", String(ackLowConf))
        fd.append("acknowledgeLowConfidence", String(ackLowConf))
      }

      // Phase C C2.4b — multi-company-in-one-sheet routes to a DIFFERENT
      // endpoint (per-entity clean-slate + insert) and carries the reviewer's
      // entityValue→company map.
      if (analysis.multiEntity) {
        fd.append("entityMap", JSON.stringify(entityMap))
        const res = await fetch(
          `/api/onboarding/import/staging/${analysis.stagingId}/apply-multi-entity`,
          { method: "POST", body: fd },
        )
        const body = await res.json().catch(() => null)
        if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
        if (dryRun) {
          if (previewEpoch.current !== myEpoch) return
          setMePreview(body as MePreviewResult)
        } else {
          setMeApplied(body as MeAppliedResult)
        }
        return
      }

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

  const hasCriticalAnomaly =
    !!analysis && analysis.proposal.anomalies.some((a) => a.severity === "critical")
  // Block one-click commit when the AI is unsure OR flagged a critical anomaly.
  const needsReviewAck =
    !!analysis &&
    (analysis.proposal.overallConfidence < 0.7 ||
      analysis.proposal.columns.some((c) => c.confidence < 0.6) ||
      hasCriticalAnomaly)
  const controlGated =
    !!preview && preview.controlVerdict !== undefined && preview.controlVerdict !== "green"
  // RED control-total is a HARD block (product decision 2026-06-20) — it
  // cannot be overridden by ackControl; the server also rejects it (409).
  const redBlocked = !!preview && preview.controlVerdict === "red"
  // Phase A validation engine — a "blocked" verdict (RED control OR zero-revenue
  // coverage failure) is a hard block; the server also 409s it.
  const validationBlocked = !!preview && preview.validationVerdict === "blocked"
  const commitBlocked =
    !preview ||
    busy !== null ||
    redBlocked ||
    validationBlocked ||
    (needsReviewAck && !ackLowConf) ||
    (controlGated && !ackControl)

  // ── Multi-entity gating (mirrors the single path; the server enforces) ──
  const meIssues = mePreview?.mappingIssues
  const meHasMappingProblem =
    !!meIssues &&
    (meIssues.unmapped.length > 0 ||
      meIssues.crossOrg.length > 0 ||
      meIssues.duplicateCompanyIds.length > 0 ||
      meIssues.parseErrors.length > 0)
  const meRedBlocked = mePreview?.controlVerdict === "red"
  const meCommitBlocked =
    !mePreview ||
    busy !== null ||
    meRedBlocked ||
    meHasMappingProblem ||
    (needsReviewAck && !ackLowConf)
  // Invalidate a multi-entity preview when the reviewer changes a BU→company
  // assignment (the destructive footprint changed).
  const setEntityMapEntry = (value: string, companyId: string) => {
    setEntityMap((m) => ({ ...m, [value]: companyId }))
    setMePreview(null)
    previewEpoch.current++
  }

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
          <button
            type="button"
            onClick={() => setShowCreate((v) => !v)}
            className="mt-1 text-[11px] text-emerald-700 dark:text-emerald-400 hover:underline"
          >
            {showCreate ? "× отмена" : "+ Новая компания"}
          </button>
          {showCreate && (
            <div className="mt-2 border rounded p-2 space-y-2 bg-muted/20">
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={newCo.code}
                  onChange={(e) => setNewCo((s) => ({ ...s, code: e.target.value }))}
                  placeholder="Код (напр. CO-NEW)"
                  className="px-2 py-1 rounded border border-border bg-background text-xs"
                />
                <input
                  value={newCo.name}
                  onChange={(e) => setNewCo((s) => ({ ...s, name: e.target.value }))}
                  placeholder="Название"
                  className="px-2 py-1 rounded border border-border bg-background text-xs"
                />
                <input
                  value={newCo.industry}
                  onChange={(e) => setNewCo((s) => ({ ...s, industry: e.target.value }))}
                  placeholder="Отрасль (опц.)"
                  className="px-2 py-1 rounded border border-border bg-background text-xs"
                />
                <input
                  value={newCo.baseCurrencyCode}
                  onChange={(e) => setNewCo((s) => ({ ...s, baseCurrencyCode: e.target.value }))}
                  placeholder="Валюта (AZN)"
                  className="px-2 py-1 rounded border border-border bg-background text-xs"
                />
              </div>
              <button
                type="button"
                onClick={createCompany}
                disabled={creating || !newCo.code.trim() || !newCo.name.trim()}
                className="w-full px-2 py-1 rounded bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 disabled:opacity-40"
              >
                {creating ? "Создаю…" : "Создать и выбрать"}
              </button>
            </div>
          )}
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
      {analysis && !applied && !meApplied && (
        <MappingReviewTable
          proposal={analysis.proposal}
          sourceColumns={analysis.sourceColumns}
          edited={edited}
          disabled={busy !== null}
          onChange={(next) => {
            setEdited(next)
            previewEpoch.current++ // invalidate any in-flight preview
            setPreview(null) // mapping changed → previous preview is stale
            setMePreview(null)
            setAckControl(false)
          }}
        />
      )}

      {/* Step 2b — multi-company-in-one-sheet: map each BU value to a company */}
      {analysis?.multiEntity && !meApplied && (
        <div className="border rounded p-3 bg-muted/10 space-y-2">
          <div className="text-sm font-semibold">
            🏢 Лист содержит несколько компаний (колонка-сущность)
          </div>
          <div className="text-xs text-muted-foreground">
            Каждое значение BU направляется в отдельную компанию. Проверьте
            авто-сопоставление; одно значение — одна компания.
          </div>
          <div className="border rounded overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted text-xs">
                <tr>
                  <th className="text-left p-2">Значение в файле (BU)</th>
                  <th className="text-left p-2">→ Компания</th>
                </tr>
              </thead>
              <tbody>
                {(analysis.entityValues ?? []).map((val) => (
                  <tr key={val} className="border-t">
                    <td className="p-2 font-mono text-xs">{val === "" ? "(пусто)" : val}</td>
                    <td className="p-2">
                      <select
                        value={entityMap[val] ?? ""}
                        disabled={busy !== null}
                        onChange={(e) => setEntityMapEntry(val, e.target.value)}
                        className="w-full px-1.5 py-1 rounded border border-border bg-background text-xs disabled:opacity-50"
                        aria-label={`Компания для ${val || "(пусто)"}`}
                      >
                        <option value="">— выберите —</option>
                        {companies.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} ({c.code})
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Step 3 (single company) — preview + commit */}
      {analysis && !analysis.multiEntity && !applied && (
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
            <div className="border rounded p-3 bg-muted/20 text-sm space-y-2">
              <div className="font-semibold">👁 Превью · год {preview.year}</div>
              <div className="text-xs text-muted-foreground">
                строк к записи: <b>{preview.inserted}</b> · заменит существующих: {preview.deleted} ·
                предупреждений: {preview.warnings}
              </div>

              {/* Control-total verdict (parent rows vs sum of their leaves) */}
              {preview.controlNoData ? (
                <div className="text-xs text-sky-700 dark:text-sky-400">
                  ℹ В файле нет родительских итогов для авто-сверки — проверьте разметку вручную.
                </div>
              ) : (
                <div className={`text-xs font-medium ${VERDICT[preview.controlVerdict ?? "green"].fg}`}>
                  Сверка: {VERDICT[preview.controlVerdict ?? "green"].icon}{" "}
                  {VERDICT[preview.controlVerdict ?? "green"].label}
                </div>
              )}

              {/* Phase A validation engine — graded verdict + findings */}
              {preview.validationVerdict && (
                <div className="space-y-1">
                  <div className={`text-xs font-semibold ${VALIDATION_VERDICT[preview.validationVerdict].fg}`}>
                    Валидация: {VALIDATION_VERDICT[preview.validationVerdict].icon}{" "}
                    {VALIDATION_VERDICT[preview.validationVerdict].label}
                  </div>
                  {preview.validationFindings && preview.validationFindings.length > 0 && (
                    <ul className="space-y-0.5">
                      {preview.validationFindings.map((f, i) => (
                        <li
                          key={i}
                          className={`text-[11px] ${
                            f.severity === "blocker"
                              ? "text-red-700 dark:text-red-300"
                              : f.severity === "warning"
                                ? "text-amber-700 dark:text-amber-400"
                                : "text-muted-foreground"
                          }`}
                        >
                          {f.severity === "blocker" ? "⛔" : f.severity === "warning" ? "⚠️" : "ℹ"} {f.message}
                        </li>
                      ))}
                    </ul>
                  )}
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
                        <th className="text-right p-1">Δ</th>
                        <th className="text-right p-1">Δ%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.controlTotals.map((c) => (
                        <tr key={c.code} className="border-t">
                          <td className="p-1 font-mono">{c.code}</td>
                          <td className="p-1 text-right font-mono">{fmtN(c.statedTotal)}</td>
                          <td className="p-1 text-right font-mono">{fmtN(c.leafSum)}</td>
                          <td className="p-1 text-right font-mono">{fmtN(c.delta)}</td>
                          <td className="p-1 text-right font-mono">{(c.deltaPct * 100).toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {redBlocked && (
            <div className="rounded border border-red-500/40 bg-red-50 dark:bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
              🔴 Контроль-сумма RED — коммит заблокирован жёстко (нельзя
              подтвердить). Итог родительских строк не сходится с суммой
              листьев: вероятный мис-маппинг колонки. Исправьте разметку и
              нажмите «Предпросмотр» заново. Сервер тоже отклонит такой коммит.
            </div>
          )}

          {controlGated && !redBlocked && (
            <label className="flex items-start gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={ackControl}
                onChange={(e) => setAckControl(e.target.checked)}
                className="mt-0.5"
              />
              🟡 Малое расхождение контрольных сумм (≤1%) проверено — итог
              родителя ≈ сумме листьев в пределах округления.
            </label>
          )}

          {needsReviewAck && (
            <label className="flex items-start gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={ackLowConf}
                onChange={(e) => setAckLowConf(e.target.checked)}
                className="mt-0.5"
              />
              {hasCriticalAnomaly
                ? "AI пометил критическую аномалию (см. таблицу выше) — я проверил разметку вручную."
                : "Низкая уверенность AI — я проверил разметку колонок вручную."}
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

      {/* Step 3b (multi-company) — preview + commit per entity */}
      {analysis?.multiEntity && !meApplied && (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => runApply(true)}
            disabled={busy !== null}
            className="w-full px-4 py-2 rounded bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-40 transition-colors"
          >
            {busy === "preview" ? "Считаю…" : "Превью по компаниям (без записи)"}
          </button>

          {mePreview && (
            <div className="border rounded p-3 bg-muted/20 text-sm space-y-2">
              <div className="font-semibold">
                👁 Превью · год {mePreview.year} · компаний с данными: {mePreview.writeableCount}/
                {mePreview.entityCount}
              </div>
              <div className={`text-xs font-medium ${VERDICT[mePreview.controlVerdict].fg}`}>
                Сверка (худшая по компаниям): {VERDICT[mePreview.controlVerdict].icon}{" "}
                {VERDICT[mePreview.controlVerdict].label}
              </div>
              <div className="border rounded overflow-hidden">
                <table className="w-full text-[11px]">
                  <thead className="bg-muted">
                    <tr>
                      <th className="text-left p-1">BU</th>
                      <th className="text-left p-1">Компания</th>
                      <th className="text-right p-1">строк</th>
                      <th className="text-right p-1">заменит</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mePreview.perEntity.map((p) => {
                      const co = companies.find((c) => c.id === p.companyId)
                      return (
                        <tr key={p.entityValue} className="border-t">
                          <td className="p-1 font-mono">{p.entityValue === "" ? "(пусто)" : p.entityValue}</td>
                          <td className="p-1">
                            {p.error ? (
                              <span className="text-red-700 dark:text-red-300">ошибка: {p.error}</span>
                            ) : co ? (
                              `${co.name} (${co.code})`
                            ) : (
                              <span className="text-amber-700 dark:text-amber-400">не назначена</span>
                            )}
                          </td>
                          <td className="p-1 text-right font-mono">{p.lineCount}</td>
                          <td className="p-1 text-right font-mono">{p.wouldDelete}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mapping issues — each is a hard server-side block */}
              {meHasMappingProblem && (
                <div className="rounded border border-red-500/40 bg-red-50 dark:bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300 space-y-1">
                  {meIssues!.unmapped.length > 0 && (
                    <div>Не назначены компании: {meIssues!.unmapped.map((v) => v || "(пусто)").join(", ")}</div>
                  )}
                  {meIssues!.duplicateCompanyIds.length > 0 && (
                    <div>⚠ Несколько BU ведут в одну компанию — это перетёрло бы данные. Назначьте разные компании.</div>
                  )}
                  {meIssues!.crossOrg.length > 0 && <div>Назначены компании вне организации.</div>}
                  {meIssues!.parseErrors.length > 0 && (
                    <div>Не разобрались: {meIssues!.parseErrors.map((e) => e.entityValue).join(", ")}</div>
                  )}
                </div>
              )}
            </div>
          )}

          {meRedBlocked && (
            <div className="rounded border border-red-500/40 bg-red-50 dark:bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
              🔴 Контроль-сумма RED по одной из компаний — коммит заблокирован.
              Исправьте разметку и запустите превью заново.
            </div>
          )}

          {needsReviewAck && (
            <label className="flex items-start gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={ackLowConf}
                onChange={(e) => setAckLowConf(e.target.checked)}
                className="mt-0.5"
              />
              {hasCriticalAnomaly
                ? "AI пометил критическую аномалию — я проверил разметку вручную."
                : "Низкая уверенность AI — я проверил разметку колонок вручную."}
            </label>
          )}

          <button
            type="button"
            onClick={() => runApply(false)}
            disabled={meCommitBlocked}
            title={!mePreview ? "Сначала запустите превью" : undefined}
            className="w-full px-4 py-2 rounded bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-40 transition-colors"
          >
            {busy === "apply" ? "Записываю…" : "Применить по компаниям (запись в БД)"}
          </button>
        </div>
      )}

      {/* Step 4b — multi-company applied */}
      {meApplied && (
        <div className="border rounded p-4 bg-emerald-50 dark:bg-emerald-500/10 text-sm space-y-1">
          <div className="text-lg font-bold">
            ✅ Импортировано в {meApplied.entityCount} компани(й) · год {meApplied.year}
          </div>
          <div className="text-xs text-muted-foreground">
            всего строк: <b>{meApplied.inserted}</b> · заменено: {meApplied.deleted}
            {meApplied.recompute && ` · recompute ok:${meApplied.recompute.ok} failed:${meApplied.recompute.failed}`}
          </div>
          <ul className="text-[11px] text-muted-foreground mt-1 space-y-0.5">
            {meApplied.perEntity.map((p) => {
              const co = companies.find((c) => c.id === p.companyId)
              return (
                <li key={p.entityValue} className="font-mono">
                  {p.entityValue || "(пусто)"} → {co ? `${co.code}` : p.companyId}: {p.inserted} строк
                </li>
              )
            })}
          </ul>
          {meApplied.indicatorsStale && (
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
