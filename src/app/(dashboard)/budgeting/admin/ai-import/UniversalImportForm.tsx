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
import { useTranslations } from "next-intl"
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
  /** true = a holding / sub-group (has children → a consolidation roll-up),
   *  false = an operating company (a leaf you import data into). */
  isGroup: boolean
  /** depth in the holding tree (0 = top holding). */
  depth: number
}
interface PlanOpt {
  id: string
  name: string
  year: number
  kind: string
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
  // Phase C C2.8 — BU values that look like eliminations/rollups (pre-skip).
  entityEliminations?: string[]
}

// Sentinel entityMap value meaning "do not import this BU" (eliminations).
const SKIP_ENTITY = "__SKIP__"

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
  wouldDoubleActual?: boolean
  perEntity: MePerEntityPreview[]
  controlVerdict: "green" | "yellow" | "red"
  mappingIssues: {
    unmapped: string[]
    crossOrg: string[]
    duplicateCompanyIds: string[]
    parseErrors: Array<{ entityValue: string; error: string }>
    validationBlocked?: Array<{
      entityValue: string
      findings: Array<{ severity: string; category: string; message: string }>
    }>
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

const VERDICT: Record<"green" | "yellow" | "red", { fg: string; icon: string }> = {
  green: { fg: "text-emerald-700 dark:text-emerald-400", icon: "🟢" },
  yellow: { fg: "text-amber-700 dark:text-amber-400", icon: "🟡" },
  red: { fg: "text-red-700 dark:text-red-400", icon: "🔴" },
}
const VALIDATION_VERDICT: Record<
  "certified" | "warn" | "blocked" | "uncertifiable",
  { fg: string; icon: string }
> = {
  certified: { fg: "text-emerald-700 dark:text-emerald-400", icon: "✅" },
  warn: { fg: "text-amber-700 dark:text-amber-400", icon: "⚠️" },
  blocked: { fg: "text-red-700 dark:text-red-300", icon: "⛔" },
  uncertifiable: { fg: "text-sky-700 dark:text-sky-400", icon: "❓" },
}
const fmtN = (n: number) => Math.round(n).toLocaleString("ru-RU")

// Flatten the /api/companies tree (roots → children → children), tagging each
// node as a holding/group (has children → a consolidation roll-up) vs an
// operating company (a leaf), plus its depth — so the picker can make it clear
// whether you're choosing the WHOLE holding or one company inside it.
function flatten(tree: unknown): CompanyOpt[] {
  const out: CompanyOpt[] = []
  const walk = (nodes: unknown, depth: number) => {
    if (!Array.isArray(nodes)) return
    for (const n of nodes as Array<Record<string, unknown>>) {
      const hasChildren = !!(n && Array.isArray(n.children) && n.children.length > 0)
      if (n && typeof n.id === "string") {
        out.push({
          id: n.id,
          code: String(n.code ?? ""),
          name: String(n.name ?? ""),
          isGroup: hasChildren,
          depth,
        })
      }
      if (hasChildren) walk(n.children, depth + 1)
    }
  }
  walk(tree, 0)
  return out
}

// Grouped <option>s for a company picker — separates the holding / sub-groups
// (whole-group consolidation entities) from the operating companies, so the
// reviewer can tell whether they're choosing the WHOLE holding (e.g. Azərşəkər)
// or one company inside it (e.g. Azərşəkər Sugar) even when the names look alike.
function CompanyOptionList({ companies }: { companies: CompanyOpt[] }) {
  const t = useTranslations("adminUniversal")
  const groups = companies.filter((c) => c.isGroup)
  const leaves = companies.filter((c) => !c.isGroup)
  return (
    <>
      {groups.length > 0 && (
        <optgroup label={t("groupOptLabel")}>
          {groups.map((c) => (
            <option key={c.id} value={c.id}>
              {"— ".repeat(c.depth)}
              {c.name} ({c.code}) · {t("wholeGroupSuffix")}
            </option>
          ))}
        </optgroup>
      )}
      <optgroup label={t("companyOptLabel")}>
        {leaves.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} ({c.code})
          </option>
        ))}
      </optgroup>
    </>
  )
}

export function UniversalImportForm() {
  const t = useTranslations("adminUniversal")
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
  // Phase C C3.2 — target currency for a multi-currency sheet (the same period
  // in >1 currency). Empty = let the server default to the company base.
  const [targetCurrency, setTargetCurrency] = useState("")
  // Option C — plan target. Client picks: create a new plan (name + kind) or
  // update an existing one. Prevents the silent kind="actual" double-count.
  const [plans, setPlans] = useState<PlanOpt[]>([])
  const [planMode, setPlanMode] = useState<"create" | "update">("create")
  const [targetPlanId, setTargetPlanId] = useState("")
  const [newPlanName, setNewPlanName] = useState("")
  const [planKind, setPlanKind] = useState<"actual" | "budget">("actual")
  const [ackSecondActual, setAckSecondActual] = useState(false)

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
    void (async () => {
      try {
        const r = await fetch("/api/budgeting/plans")
        const j = r.ok ? await r.json() : null
        const data: PlanOpt[] = Array.isArray(j?.data)
          ? j.data.map((p: { id: string; name: string; year: number; kind?: string }) => ({
              id: p.id, name: p.name, year: p.year, kind: p.kind ?? "actual",
            }))
          : []
        setPlans(data)
      } catch {
        setPlans([])
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function createCompany() {
    if (!newCo.code.trim() || !newCo.name.trim()) {
      setError(t("codeNameRequired"))
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
    setTargetCurrency("")
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
    if (!file || !targetSheet) return
    setBusy("classify")
    setError(null)
    setAnalysis(null)
    setPreview(null)
    setApplied(null)
    try {
      const fd = new FormData()
      fd.append("file", file)
      fd.append("sheetName", targetSheet)
      if (companyId) fd.append("companyId", companyId)
      const res = await fetch("/api/onboarding/import/analyze", { method: "POST", body: fd })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body?.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
      const a = body as AnalyzeResponse
      setAnalysis(a)
      // Multi-currency: when the AI tagged >1 currency on the amount columns,
      // default the picker to the first so the preview works out of the box;
      // the reviewer can switch it. Single/untagged → empty (server uses base).
      const curs = [
        ...new Set(
          a.proposal.columns
            .filter((c) => c.role.startsWith("amount:") && c.currencyCode)
            .map((c) => (c.currencyCode as string).trim().toUpperCase()),
        ),
      ]
      setTargetCurrency(curs.length > 1 ? curs[0] : "")
      // Multi-entity: seed the entityValue→company map from the AI's
      // auto-suggested matches (the reviewer confirms/corrects below).
      // Seed entity→company from the AI's suggestions, and PRE-SKIP any BU that
      // looks like an elimination/rollup (EJE/AJE/CONSOLIDATED…) so the reviewer
      // only confirms rather than having to route a non-company block.
      setEntityMap(
        a.multiEntity
          ? {
              ...(a.entitySuggestions ?? {}),
              ...Object.fromEntries((a.entityEliminations ?? []).map((v) => [v, SKIP_ENTITY])),
            }
          : {},
      )
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
    if (!file) return
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
      if (targetCurrency) fd.append("targetCurrency", targetCurrency)
      // Option C — explicit plan target (update existing vs create new + kind).
      if (planMode === "update" && targetPlanId) {
        fd.append("targetPlanId", targetPlanId)
      } else if (planMode === "create") {
        if (newPlanName.trim()) fd.append("newPlanName", newPlanName.trim())
        fd.append("planKind", planKind)
      }
      if (!dryRun && ackSecondActual) fd.append("acknowledgeSecondActualPlan", "true")
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
      meIssues.parseErrors.length > 0 ||
      (meIssues.validationBlocked?.length ?? 0) > 0)
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

  // Changing the plan target invalidates a stale preview (Codex 2026-06-21) —
  // otherwise a user could preview plan A, switch to B, and commit into B
  // without seeing B's would-delete footprint.
  const invalidateMePreview = () => {
    setMePreview(null)
    setAckSecondActual(false)
    previewEpoch.current++
  }

  // Phase C C3.2 — distinct currencies the AI tagged on the amount columns.
  // >1 → the sheet is multi-currency and the reviewer picks which to import.
  const availableCurrencies = analysis
    ? [
        ...new Set(
          analysis.proposal.columns
            .filter((c) => c.role.startsWith("amount:") && c.currencyCode)
            .map((c) => (c.currencyCode as string).trim().toUpperCase()),
        ),
      ]
    : []
  const changeCurrency = (cur: string) => {
    setTargetCurrency(cur)
    setPreview(null)
    setMePreview(null)
    previewEpoch.current++ // invalidate any in-flight preview
  }

  return (
    <div className="space-y-6">
      <div className="text-xs text-muted-foreground leading-relaxed border rounded p-3 bg-muted/20">
        {t.rich("intro", { b: (chunks) => <b>{chunks}</b> })}
      </div>

      {/* Step 1 — company + file */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="text-xs text-muted-foreground">{t("companyLabel")}</label>
          <select
            value={companyId}
            onChange={(e) => {
              setCompanyId(e.target.value)
              reset()
            }}
            className="w-full mt-1 px-2 py-2 rounded border border-border bg-background text-sm"
          >
            <option value="">{t("selectPlaceholder")}</option>
            <CompanyOptionList companies={companies} />
          </select>
          <button
            type="button"
            onClick={() => setShowCreate((v) => !v)}
            className="mt-1 text-[11px] text-emerald-700 dark:text-emerald-400 hover:underline"
          >
            {showCreate ? t("cancelCreate") : t("newCompany")}
          </button>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {t("companyOptionalHint")}
          </div>
          {showCreate && (
            <div className="mt-2 border rounded p-2 space-y-2 bg-muted/20">
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={newCo.code}
                  onChange={(e) => setNewCo((s) => ({ ...s, code: e.target.value }))}
                  placeholder={t("phCode")}
                  className="px-2 py-1 rounded border border-border bg-background text-xs"
                />
                <input
                  value={newCo.name}
                  onChange={(e) => setNewCo((s) => ({ ...s, name: e.target.value }))}
                  placeholder={t("phName")}
                  className="px-2 py-1 rounded border border-border bg-background text-xs"
                />
                <input
                  value={newCo.industry}
                  onChange={(e) => setNewCo((s) => ({ ...s, industry: e.target.value }))}
                  placeholder={t("phIndustry")}
                  className="px-2 py-1 rounded border border-border bg-background text-xs"
                />
                <input
                  value={newCo.baseCurrencyCode}
                  onChange={(e) => setNewCo((s) => ({ ...s, baseCurrencyCode: e.target.value }))}
                  placeholder={t("phCurrency")}
                  className="px-2 py-1 rounded border border-border bg-background text-xs"
                />
              </div>
              <button
                type="button"
                onClick={createCompany}
                disabled={creating || !newCo.code.trim() || !newCo.name.trim()}
                className="w-full px-2 py-1 rounded bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 disabled:opacity-40"
              >
                {creating ? t("createBusy") : t("createBtn")}
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
            {file ? <span className="font-mono">{file.name}</span> : t("dropOrClick")}
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={onStart}
        disabled={!file || busy !== null}
        className="w-full px-4 py-2 rounded bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-40 transition-colors"
      >
        {busy === "classify" ? t("analyzeBusy") : t("analyzeBtn")}
      </button>

      {error && (
        <div className="border border-red-500/40 bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 rounded p-3 text-sm">
          ❌ {error}
        </div>
      )}

      {/* Sheet picker (after classify) */}
      {classifications.length > 0 && analysis && (
        <div className="flex items-center gap-2 text-sm">
          <label className="text-xs text-muted-foreground">{t("sheetLabel")}</label>
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

      {/* Step 2a — multi-currency: pick the currency to import */}
      {analysis && availableCurrencies.length > 1 && !applied && !meApplied && (
        <div className="flex items-center gap-2 text-sm border rounded p-3 bg-muted/10">
          <span className="text-xs">{t("multiCurrencyLabel")}</span>
          <select
            value={targetCurrency}
            disabled={busy !== null}
            onChange={(e) => changeCurrency(e.target.value)}
            className="px-2 py-1 rounded border border-border bg-background text-xs disabled:opacity-50"
            aria-label={t("currencyAria")}
          >
            {availableCurrencies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <span className="text-[11px] text-muted-foreground">
            {t("currencyHint")}
          </span>
        </div>
      )}

      {/* Step 2b — multi-company-in-one-sheet: map each BU value to a company */}
      {analysis?.multiEntity && !meApplied && (
        <div className="border rounded p-3 bg-muted/10 space-y-2">
          <div className="text-sm font-semibold">
            {t("multiEntityTitle")}
          </div>
          <div className="text-xs text-muted-foreground">
            {t("multiEntityDesc")}
          </div>
          <div className="border rounded overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted text-xs">
                <tr>
                  <th className="text-left p-2">{t("thBuValue")}</th>
                  <th className="text-left p-2">{t("thCompanyArrow")}</th>
                </tr>
              </thead>
              <tbody>
                {(analysis.entityValues ?? []).map((val) => {
                  const isElim = (analysis.entityEliminations ?? []).includes(val)
                  const isSkipped = entityMap[val] === SKIP_ENTITY
                  return (
                    <tr key={val} className={`border-t ${isSkipped ? "opacity-60" : ""}`}>
                      <td className="p-2 font-mono text-xs">
                        {val === "" ? t("empty") : val}
                        {isElim && (
                          <span className="ml-2 text-amber-700 dark:text-amber-400" title={t("elimTitle")}>
                            {t("elimWarn")}
                          </span>
                        )}
                      </td>
                      <td className="p-2">
                        <select
                          value={entityMap[val] ?? ""}
                          disabled={busy !== null}
                          onChange={(e) => setEntityMapEntry(val, e.target.value)}
                          className="w-full px-1.5 py-1 rounded border border-border bg-background text-xs disabled:opacity-50"
                          aria-label={t("companyForAria", { val: val || t("empty") })}
                        >
                          <option value="">{t("selectPlaceholder")}</option>
                          <option value={SKIP_ENTITY}>{t("skipOption")}</option>
                          <CompanyOptionList companies={companies} />
                        </select>
                      </td>
                    </tr>
                  )
                })}
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
            {busy === "preview" ? t("previewBusy") : t("previewBtn")}
          </button>

          {preview && (
            <div className="border rounded p-3 bg-muted/20 text-sm space-y-2">
              <div className="font-semibold">👁 {t("previewTitle", { year: preview.year })}</div>
              <div className="text-xs text-muted-foreground">
                {t("rowsToWriteLabel")}: <b>{preview.inserted}</b> · {t("willReplace")}: {preview.deleted} ·
                {t("warningsLabel")}: {preview.warnings}
              </div>

              {/* Control-total verdict (parent rows vs sum of their leaves) */}
              {preview.controlNoData ? (
                <div className="text-xs text-sky-700 dark:text-sky-400">
                  {t("noControlData")}
                </div>
              ) : (
                <div className={`text-xs font-medium ${VERDICT[preview.controlVerdict ?? "green"].fg}`}>
                  {t("reconcileLabel")} {VERDICT[preview.controlVerdict ?? "green"].icon}{" "}
                  {t(`verdict.${preview.controlVerdict ?? "green"}`)}
                </div>
              )}

              {/* Phase A validation engine — graded verdict + findings */}
              {preview.validationVerdict && (
                <div className="space-y-1">
                  <div className={`text-xs font-semibold ${VALIDATION_VERDICT[preview.validationVerdict].fg}`}>
                    {t("validationLabel")} {VALIDATION_VERDICT[preview.validationVerdict].icon}{" "}
                    {t(`validation.${preview.validationVerdict}`)}
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
                        <th className="text-left p-1">{t("thParent")}</th>
                        <th className="text-right p-1">{t("thStated")}</th>
                        <th className="text-right p-1">{t("thLeafSum")}</th>
                        <th className="text-right p-1">{t("thDelta")}</th>
                        <th className="text-right p-1">{t("thDeltaPct")}</th>
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
              {t("redBlocked")}
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
              {t("ackControlYellow")}
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
                ? t("ackCritical")
                : t("ackLowConf")}
            </label>
          )}

          <button
            type="button"
            onClick={() => runApply(false)}
            disabled={commitBlocked}
            title={!preview ? t("applyHint") : undefined}
            className="w-full px-4 py-2 rounded bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-40 transition-colors"
          >
            {busy === "apply" ? t("applyBusy") : t("applyBtn")}
          </button>
        </div>
      )}

      {/* Step 3b (multi-company) — preview + commit per entity */}
      {analysis?.multiEntity && !meApplied && (
        <div className="space-y-3">
          {/* Option C — where to write the data (plan target) */}
          <div className="border rounded p-3 bg-muted/10 space-y-2">
            <div className="text-sm font-semibold">{t("planTargetTitle")}</div>
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={planMode === "create"} onChange={() => { setPlanMode("create"); invalidateMePreview() }} disabled={busy !== null} />
                {t("createNewPlan")}
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={planMode === "update"} onChange={() => { setPlanMode("update"); invalidateMePreview() }} disabled={busy !== null} />
                {t("updateExisting")}
              </label>
            </div>
            {planMode === "create" ? (
              <div className="flex flex-wrap gap-2 items-center">
                <input
                  value={newPlanName}
                  onChange={(e) => { setNewPlanName(e.target.value); invalidateMePreview() }}
                  placeholder={t("planNamePh")}
                  disabled={busy !== null}
                  className="flex-1 min-w-[180px] px-2 py-1 rounded border border-border bg-background text-xs disabled:opacity-50"
                />
                <select
                  value={planKind}
                  onChange={(e) => { setPlanKind(e.target.value as "actual" | "budget"); invalidateMePreview() }}
                  disabled={busy !== null}
                  className="px-2 py-1 rounded border border-border bg-background text-xs disabled:opacity-50"
                >
                  <option value="actual">{t("planKindActual")}</option>
                  <option value="budget">{t("planKindBudget")}</option>
                </select>
              </div>
            ) : (
              <select
                value={targetPlanId}
                onChange={(e) => { setTargetPlanId(e.target.value); invalidateMePreview() }}
                disabled={busy !== null}
                className="w-full px-2 py-1 rounded border border-border bg-background text-xs disabled:opacity-50"
                aria-label={t("planUpdateAria")}
              >
                <option value="">{t("selectPlanToUpdate")}</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.year} · {p.kind}
                  </option>
                ))}
              </select>
            )}
            <p className="text-[11px] text-muted-foreground">
              {t.rich("planUpdateNote", { b: (chunks) => <b>{chunks}</b> })}
            </p>
          </div>

          <button
            type="button"
            onClick={() => runApply(true)}
            disabled={busy !== null || (planMode === "update" && !targetPlanId)}
            className="w-full px-4 py-2 rounded bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-40 transition-colors"
          >
            {busy === "preview" ? t("previewBusy") : t("previewByCompaniesBtn")}
          </button>

          {mePreview && (
            <div className="border rounded p-3 bg-muted/20 text-sm space-y-2">
              <div className="font-semibold">
                👁 {t("mePreviewTitle", { year: mePreview.year, writeable: mePreview.writeableCount, total: mePreview.entityCount })}
              </div>
              <div className={`text-xs font-medium ${VERDICT[mePreview.controlVerdict].fg}`}>
                {t("meReconcileLabel")} {VERDICT[mePreview.controlVerdict].icon}{" "}
                {t(`verdict.${mePreview.controlVerdict}`)}
              </div>
              <div className="border rounded overflow-hidden">
                <table className="w-full text-[11px]">
                  <thead className="bg-muted">
                    <tr>
                      <th className="text-left p-1">{t("meThBu")}</th>
                      <th className="text-left p-1">{t("meThCompany")}</th>
                      <th className="text-right p-1">{t("meThRows")}</th>
                      <th className="text-right p-1">{t("meThReplace")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mePreview.perEntity.map((p) => {
                      const co = companies.find((c) => c.id === p.companyId)
                      return (
                        <tr key={p.entityValue} className="border-t">
                          <td className="p-1 font-mono">{p.entityValue === "" ? t("empty") : p.entityValue}</td>
                          <td className="p-1">
                            {p.error ? (
                              <span className="text-red-700 dark:text-red-300">{t("meError", { error: p.error })}</span>
                            ) : co ? (
                              `${co.name} (${co.code})`
                            ) : (
                              <span className="text-amber-700 dark:text-amber-400">{t("meNotAssigned")}</span>
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
                    <div>{t("meUnmapped", { list: meIssues!.unmapped.map((v) => v || t("empty")).join(", ") })}</div>
                  )}
                  {meIssues!.duplicateCompanyIds.length > 0 && (
                    <div>{t("meDuplicate")}</div>
                  )}
                  {meIssues!.crossOrg.length > 0 && <div>{t("meCrossOrg")}</div>}
                  {meIssues!.parseErrors.length > 0 && (
                    <div>{t("meParseErrors", { list: meIssues!.parseErrors.map((e) => e.entityValue).join(", ") })}</div>
                  )}
                  {(meIssues!.validationBlocked?.length ?? 0) > 0 && (
                    <div>
                      {t("meValidationBlocked", { list: meIssues!.validationBlocked!
                        .map((b) => `${b.entityValue || t("empty")} — ${b.findings.map((f) => f.message).join("; ")}`)
                        .join(" | ") })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {meRedBlocked && (
            <div className="rounded border border-red-500/40 bg-red-50 dark:bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
              {t("meRedBlocked")}
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
                ? t("ackCriticalShort")
                : t("ackLowConf")}
            </label>
          )}

          {mePreview?.wouldDoubleActual && (
            <label className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400">
              <input
                type="checkbox"
                checked={ackSecondActual}
                onChange={(e) => setAckSecondActual(e.target.checked)}
                className="mt-0.5"
              />
              {t("ackSecondActual")}
            </label>
          )}

          <button
            type="button"
            onClick={() => runApply(false)}
            disabled={meCommitBlocked || (mePreview?.wouldDoubleActual && !ackSecondActual)}
            title={!mePreview ? t("applyHint") : undefined}
            className="w-full px-4 py-2 rounded bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-40 transition-colors"
          >
            {busy === "apply" ? t("applyBusy") : t("applyByCompaniesBtn")}
          </button>
        </div>
      )}

      {/* Step 4b — multi-company applied */}
      {meApplied && (
        <div className="border rounded p-4 bg-emerald-50 dark:bg-emerald-500/10 text-sm space-y-1">
          <div className="text-lg font-bold">
            ✅ {t("meAppliedTitle", { count: meApplied.entityCount, year: meApplied.year })}
          </div>
          <div className="text-xs text-muted-foreground">
            {t("meAppliedRowsLabel")}: <b>{meApplied.inserted}</b> · {t("replaced")}: {meApplied.deleted}
            {meApplied.recompute && ` · recompute ok:${meApplied.recompute.ok} failed:${meApplied.recompute.failed}`}
          </div>
          <ul className="text-[11px] text-muted-foreground mt-1 space-y-0.5">
            {meApplied.perEntity.map((p) => {
              const co = companies.find((c) => c.id === p.companyId)
              return (
                <li key={p.entityValue} className="font-mono">
                  {p.entityValue || t("empty")} → {co ? `${co.code}` : p.companyId}: {p.inserted} {t("meRowSuffix")}
                </li>
              )
            })}
          </ul>
          {meApplied.indicatorsStale && (
            <div className="text-xs text-amber-700 dark:text-amber-400">
              {t("indicatorsStale")}
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
            {t("importAnother")}
          </button>
        </div>
      )}

      {/* Step 4 — applied */}
      {applied && (
        <div className="border rounded p-4 bg-emerald-50 dark:bg-emerald-500/10 text-sm space-y-1">
          <div className="text-lg font-bold">✅ {t("appliedTitle", { year: applied.year })}</div>
          <div className="text-xs text-muted-foreground">
            {t("appliedRowsLabel")}: <b>{applied.inserted}</b> · {t("replaced")}: {applied.deleted} · {t("warningsLabel")}:{" "}
            {applied.warnings}
            {applied.recompute && ` · recompute ok:${applied.recompute.ok} failed:${applied.recompute.failed}`}
          </div>
          {applied.indicatorsStale && (
            <div className="text-xs text-amber-700 dark:text-amber-400">
              {t("indicatorsStale")}
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
            {t("importAnother")}
          </button>
        </div>
      )}
    </div>
  )
}
