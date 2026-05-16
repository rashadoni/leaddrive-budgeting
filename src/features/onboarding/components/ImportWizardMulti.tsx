"use client"

/**
 * Phase 7.G Turn CXII (Phase 7.B v2 Day 4 — multi-sheet wizard, slice 1) —
 * `ImportWizardMulti` component shell.
 *
 * Multi-sheet variant of `ImportWizard` (single-sheet). Mirrors the upload
 * step + reuses `/api/companies` company picker pattern, then POSTs to
 * `/api/onboarding/import/analyze-multi` (CIX) and renders per-sheet
 * success/error chips so the user sees which sheets the AI mapper handled.
 *
 * **Slice 1 scope (this turn):** select → analyze-multi → per-sheet status.
 * Apply flow + per-sheet review tabs deferred to slice 2 (Turn CXIII).
 *
 * **Why a separate component (vs. extending ImportWizard):**
 *   - 800-LOC ImportWizard.tsx already carries proven single-sheet state
 *     machine; bolting a multi-sheet axis would balloon it past 1200 LOC
 *   - Multi-sheet UI semantics differ: per-sheet chips, no per-column
 *     review until selecting a sheet, apply-all vs apply-per-sheet
 *   - Future unification (when both flows are stable) is easier from two
 *     working components than from one mid-refactor
 *
 * **Wired to existing routes:**
 *   - `GET /api/companies` (companies list — same as ImportWizard)
 *   - `POST /api/onboarding/import/analyze-multi` (CIX)
 *   - `POST /api/onboarding/import/staging/[id]/apply-multi` (CX/CXI) —
 *     wired in slice 2
 */

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import type { MappingProposal } from "@/lib/onboarding/ai-mapper/types"
import { DriftDiffPreview } from "./DriftDiffPreview"

interface CompanyOption {
  id: string
  code: string
  name: string
  industry: string | null
  level: number
  children?: CompanyOption[]
}

interface PerSheetSuccess {
  sheetName: string
  proposal: Omit<MappingProposal, "usage">
  sourceColumns: Array<{ sourceIndex: number; headerText: string }>
}

interface PerSheetFailure {
  sheetName: string
  error: string
}

type PerSheetResult = PerSheetSuccess | PerSheetFailure

function isFailure(r: PerSheetResult): r is PerSheetFailure {
  return "error" in r
}

interface AnalyzeMultiResponse {
  stagingId: string
  expiresAt: string
  successCount: number
  failureCount: number
  perSheet: PerSheetResult[]
}

/** Phase 7.G Turn CXIII (slice 2) — apply-multi response shape mirrors
 *  the route's serialized payload (CX+CXI). Recompute + auditStale flags
 *  surface staleness without aborting the response. */
interface ApplyMultiResponse {
  stagingId: string
  status: "applied"
  year: number
  inserted: number
  deleted: number
  successCount: number
  failureCount: number
  perSheet: Array<
    | { sheetName: string; inserted: number; warnings: number; parentRollupsDropped: number; parentRollupsUnallocated: number }
    | { sheetName: string; error: string }
  >
  recompute: { ok: number; unknown: number; failed: number; targets: number }
  indicatorsStale: boolean
  auditStale: boolean
}

type WizardStep = "select" | "analyzed" | "applied"

const INDUSTRIES_FALLBACK = [
  "agro_crops",
  "beverage",
  "construction",
  "education",
  "entertainment",
  "food_processing",
  "hospitality",
  "industrial",
  "logistics",
  "pharma",
  "poultry",
  "real_estate",
  "retail",
  "services",
]

export function ImportWizardMulti() {
  const t = useTranslations("onboarding.multi")
  const [step, setStep] = useState<WizardStep>("select")
  const [companies, setCompanies] = useState<CompanyOption[]>([])
  const [companiesLoading, setCompaniesLoading] = useState(true)
  const [companiesError, setCompaniesError] = useState<string | null>(null)

  // Step-1 form state
  const [companyId, setCompanyId] = useState<string>("")
  const [industryHint, setIndustryHint] = useState<string>("")
  const [sheetNamesFilter, setSheetNamesFilter] = useState<string>("")
  const [file, setFile] = useState<File | null>(null)

  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)

  // Step-2 result
  const [analyzeResult, setAnalyzeResult] = useState<AnalyzeMultiResponse | null>(null)

  // Step-3 (apply) state — Phase 7.G Turn CXIII (slice 2)
  const [applying, setApplying] = useState(false)
  // Phase C.5 — pre-import safety check confirmation. When the target
  // company already has BudgetLines, the wizard requires the user to
  // tick a confirm checkbox before Apply becomes enabled. Catches the
  // "wrong file / wrong company" failure mode noted in the user
  // feedback after Phase A+B+C.
  const [safetyConfirmed, setSafetyConfirmed] = useState(false)
  // L1 hard-gate — flips to true when the dryRun preview detects
  // existing plan data for the target company. Apply button is hard-
  // disabled until safetyConfirmed is ticked in that case (was advisory
  // only pre-L1).
  const [diffHasExistingData, setDiffHasExistingData] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [applyResult, setApplyResult] = useState<ApplyMultiResponse | null>(null)
  // Set when apply hits 410/409 (staging row in terminal state — expired,
  // discarded, already-applied). Cached analyze result is stale; user must
  // restart from select. Mirrors single-sheet wizard's stagingTerminal flag.
  const [stagingTerminal, setStagingTerminal] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch("/api/companies")
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`)
        return r.json() as Promise<{ companies: CompanyOption[] } | CompanyOption[]>
      })
      .then((data) => {
        if (cancelled) return
        const roots = Array.isArray(data)
          ? data
          : Array.isArray((data as { companies?: CompanyOption[] }).companies)
          ? (data as { companies: CompanyOption[] }).companies
          : []
        const operational: CompanyOption[] = []
        for (const root of roots as CompanyOption[]) {
          if (root.level === 2) operational.push(root)
          for (const child of root.children ?? []) {
            if (child.level === 2) operational.push(child)
          }
        }
        operational.sort((a, b) => a.code.localeCompare(b.code))
        setCompanies(operational)
        setCompaniesLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setCompaniesError(err instanceof Error ? err.message : String(err))
        setCompaniesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleAnalyze(e: React.FormEvent) {
    e.preventDefault()
    setAnalyzeError(null)
    if (!file) {
      setAnalyzeError(t("errPickFile"))
      return
    }
    if (!companyId) {
      setAnalyzeError(t("errPickCompany"))
      return
    }
    setAnalyzing(true)
    try {
      const form = new FormData()
      form.append("file", file)
      form.append("companyId", companyId)
      if (sheetNamesFilter.trim()) form.append("sheetNames", sheetNamesFilter.trim())
      if (industryHint.trim()) form.append("industryHint", industryHint.trim())
      const res = await fetch("/api/onboarding/import/analyze-multi", {
        method: "POST",
        body: form,
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setAnalyzeError(body.error || `HTTP ${res.status}`)
        return
      }
      const data = (await res.json()) as AnalyzeMultiResponse
      setAnalyzeResult(data)
      setStep("analyzed")
    } catch (err) {
      setAnalyzeError(err instanceof Error ? err.message : String(err))
    } finally {
      setAnalyzing(false)
    }
  }

  async function handleApply() {
    if (!analyzeResult || !file) return
    setApplyError(null)
    setApplying(true)
    try {
      const form = new FormData()
      form.append("file", file)
      const res = await fetch(
        `/api/onboarding/import/staging/${encodeURIComponent(analyzeResult.stagingId)}/apply-multi`,
        { method: "POST", body: form },
      )
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        // 410 / 409 = staging row in terminal state (expired / discarded /
        // already applied). Cached analyzeResult is stale — user must restart
        // from step 1. Same semantic as single-sheet wizard's stagingTerminal.
        if (res.status === 410 || res.status === 409) {
          setStagingTerminal(true)
        }
        setApplyError(body.error || `HTTP ${res.status}`)
        return
      }
      setApplyResult(body as ApplyMultiResponse)
      setStep("applied")
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : String(err))
    } finally {
      setApplying(false)
    }
  }

  function resetWizard() {
    setStep("select")
    setAnalyzeResult(null)
    setAnalyzeError(null)
    setFile(null)
    setApplyResult(null)
    setApplyError(null)
    setStagingTerminal(false)
  }

  return (
    <div className="space-y-6" data-testid="import-wizard-multi">
      <header>
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </header>

      {step === "select" && (
        <form onSubmit={handleAnalyze} className="space-y-4" data-testid="select-form">
          <div className="space-y-1">
            <label htmlFor="company" className="text-sm font-medium block">
              {t("targetCompany")}
            </label>
            <select
              id="company"
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              className="w-full px-2 py-1 rounded border border-gray-700 bg-background text-sm font-mono"
              data-testid="company-select"
              disabled={companiesLoading}
            >
              <option value="">{t("selectPlaceholder")}</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} · {c.name}
                </option>
              ))}
            </select>
            {companiesLoading && (
              <p className="text-xs text-muted-foreground" data-testid="companies-loading">
                {t("loadingCompanies")}
              </p>
            )}
            {companiesError && (
              <p className="text-xs text-[#FF4757]" data-testid="companies-error">
                {companiesError}
              </p>
            )}
          </div>

          <div className="space-y-1">
            <label htmlFor="industry" className="text-sm font-medium block">
              {t("industryHint")} <span className="text-muted-foreground">{t("optional")}</span>
            </label>
            <select
              id="industry"
              value={industryHint}
              onChange={(e) => setIndustryHint(e.target.value)}
              className="w-full px-2 py-1 rounded border border-gray-700 bg-background text-sm"
              data-testid="industry-select"
            >
              <option value="">{t("deriveFromCompany")}</option>
              {INDUSTRIES_FALLBACK.map((ind) => (
                <option key={ind} value={ind}>
                  {ind}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label htmlFor="sheet-filter" className="text-sm font-medium block">
              {t("sheetFilter")}{" "}
              <span className="text-muted-foreground">{t("sheetFilterHint")}</span>
            </label>
            <input
              id="sheet-filter"
              type="text"
              value={sheetNamesFilter}
              onChange={(e) => setSheetNamesFilter(e.target.value)}
              placeholder={t("sheetFilterPlaceholder")}
              className="w-full px-2 py-1 rounded border border-gray-700 bg-background text-sm font-mono"
              data-testid="sheet-filter-input"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="file" className="text-sm font-medium block">
              {t("xlsxWorkbook")}
            </label>
            <input
              id="file"
              type="file"
              accept=".xlsx"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              data-testid="file-input"
              className="block text-sm"
            />
          </div>

          <button
            type="submit"
            disabled={analyzing}
            data-testid="analyze-submit"
            className="rounded border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 px-4 py-1.5 text-sm hover:bg-cyan-500/20 disabled:opacity-50"
          >
            {analyzing ? t("analyzing") : t("analyzeSheets")}
          </button>

          {analyzeError && (
            <p
              role="alert"
              className="text-sm text-[#FF4757]"
              data-testid="analyze-error"
            >
              {analyzeError}
            </p>
          )}
        </form>
      )}

      {step === "analyzed" && analyzeResult && (
        <section className="space-y-4" data-testid="analyzed-results">
          <div className="rounded border border-gray-800 bg-card p-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">{t("summary")}</p>
            <p className="mt-1 text-sm">
              <span className="font-mono font-semibold text-emerald-400">
                {analyzeResult.successCount}
              </span>{" "}
              {t("succeeded")} ·{" "}
              <span className="font-mono font-semibold text-[#FF4757]">
                {analyzeResult.failureCount}
              </span>{" "}
              {t("failed")} · {t("staging")}:{" "}
              <code className="text-xs">{analyzeResult.stagingId}</code>
            </p>
          </div>

          <div className="space-y-2" data-testid="per-sheet-list">
            {analyzeResult.perSheet.map((r) => (
              <div
                key={r.sheetName}
                className={`rounded border p-3 text-sm ${
                  isFailure(r)
                    ? "border-red-500/40 bg-red-500/5"
                    : "border-emerald-500/40 bg-emerald-500/5"
                }`}
                data-testid={`sheet-row-${r.sheetName}`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-block px-2 py-0.5 rounded text-[10px] font-mono uppercase ${
                      isFailure(r)
                        ? "bg-[#FF4757]/15 text-[#FF4757]"
                        : "bg-emerald-500/15 text-emerald-400"
                    }`}
                  >
                    {isFailure(r) ? t("statusError") : t("statusOk")}
                  </span>
                  <span className="font-mono font-medium">{r.sheetName}</span>
                </div>
                {isFailure(r) ? (
                  <p className="mt-1 text-xs text-[#FF4757]">{r.error}</p>
                ) : (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("perSheetSummary", {
                      cols: r.proposal.columns.length,
                      headers: r.sourceColumns.length,
                      pct: Math.round(r.proposal.overallConfidence * 100),
                    })}
                  </p>
                )}
              </div>
            ))}
          </div>

          {/* Phase D follow-up — drift diff preview via server dryRun.
              Replaces the simpler Phase C.5 PreImportSafetyCheck —
              shows current vs incoming totals side-by-side with
              percent delta, so wrong-file imports surface before the
              destructive delete-then-insert lands. */}
          {!stagingTerminal && analyzeResult.successCount > 0 && companyId && file && (
            <DriftDiffPreview
              stagingId={analyzeResult.stagingId}
              file={file}
              companyCode={
                companies.find((c) => c.id === companyId)?.code ?? "(unknown)"
              }
              companyName={
                companies.find((c) => c.id === companyId)?.name ?? ""
              }
              confirmed={safetyConfirmed}
              onConfirmChange={setSafetyConfirmed}
              onHasExistingDataChange={setDiffHasExistingData}
            />
          )}

          <div className="flex items-center gap-3 border-t border-gray-800 pt-3">
            <button
              type="button"
              onClick={resetWizard}
              data-testid="restart"
              className="rounded border border-gray-700 px-3 py-1.5 text-sm hover:bg-gray-800"
            >
              {t("startOver")}
            </button>
            {!stagingTerminal && analyzeResult.successCount > 0 && (
              <button
                type="button"
                onClick={handleApply}
                /* L1 hard-gate (replaces advisory-only behavior from Phase
                   C.5): Apply disabled while applying OR when DriftDiff
                   preview detected existing plan data AND user hasn't
                   ticked the diff-confirm checkbox. Fresh onboarding
                   (no existing data) keeps Apply enabled without
                   requiring confirmation — same UX. */
                disabled={applying || (diffHasExistingData && !safetyConfirmed)}
                data-testid="apply-submit"
                className="rounded border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 px-4 py-1.5 text-sm hover:bg-emerald-500/20 disabled:opacity-50"
              >
                {applying
                  ? t("applying")
                  : analyzeResult.successCount === 1
                  ? t("applySheets", { n: analyzeResult.successCount })
                  : t("applySheetsPlural", { n: analyzeResult.successCount })}
              </button>
            )}
          </div>

          {applyError && (
            <p
              role="alert"
              className="text-sm text-[#FF4757]"
              data-testid="apply-error"
            >
              {applyError}
              {stagingTerminal && (
                <>
                  {" — "}
                  <button
                    type="button"
                    onClick={resetWizard}
                    data-testid="restart-after-terminal"
                    className="underline text-xs"
                  >
                    {t("restartFromStep1")}
                  </button>
                </>
              )}
            </p>
          )}
        </section>
      )}

      {step === "applied" && applyResult && (
        <section className="space-y-4" data-testid="applied-results">
          <div className="rounded border border-emerald-500/40 bg-emerald-500/5 p-4">
            <p className="text-xs uppercase tracking-wider text-emerald-400">
              {t("importedSuccessfully")}
            </p>
            <p className="mt-1 text-sm">
              <span className="font-mono font-semibold">{applyResult.inserted}</span>{" "}
              {t("linesInserted")} ·{" "}
              <span className="font-mono font-semibold">{applyResult.deleted}</span> {t("priorDeleted")} · {t("year")}{" "}
              <span className="font-mono font-semibold">{applyResult.year}</span> ·{" "}
              <span className="font-mono font-semibold">{applyResult.successCount}</span>/
              {applyResult.successCount + applyResult.failureCount} {t("sheetsApplied")}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("recomputeStats", {
                ok: applyResult.recompute.ok,
                unknown: applyResult.recompute.unknown,
                failed: applyResult.recompute.failed,
                targets: applyResult.recompute.targets,
              })}
            </p>
          </div>

          {applyResult.indicatorsStale && (
            <p
              role="alert"
              className="rounded border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-300"
              data-testid="indicators-stale-warning"
            >
              {t("indicatorsStaleWarn")}
            </p>
          )}

          {applyResult.auditStale && (
            <p
              role="alert"
              className="rounded border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-300"
              data-testid="audit-stale-warning"
            >
              {t("auditStaleWarn")}
            </p>
          )}

          <div className="space-y-2" data-testid="applied-per-sheet-list">
            {applyResult.perSheet.map((r) => {
              const isErr = "error" in r
              return (
                <div
                  key={r.sheetName}
                  className={`rounded border p-3 text-sm ${
                    isErr
                      ? "border-red-500/40 bg-red-500/5"
                      : "border-emerald-500/40 bg-emerald-500/5"
                  }`}
                  data-testid={`applied-sheet-row-${r.sheetName}`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-[10px] font-mono uppercase ${
                        isErr
                          ? "bg-[#FF4757]/15 text-[#FF4757]"
                          : "bg-emerald-500/15 text-emerald-400"
                      }`}
                    >
                      {isErr ? t("statusError") : t("statusOk")}
                    </span>
                    <span className="font-mono font-medium">{r.sheetName}</span>
                  </div>
                  {isErr ? (
                    <p className="mt-1 text-xs text-[#FF4757]">{r.error}</p>
                  ) : (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("perAppliedSheet", {
                        n: r.inserted,
                        warns: r.warnings,
                        dropped: r.parentRollupsDropped,
                        unallocated: r.parentRollupsUnallocated,
                      })}
                    </p>
                  )}
                </div>
              )
            })}
          </div>

          <button
            type="button"
            onClick={resetWizard}
            data-testid="another-import"
            className="rounded border border-gray-700 px-3 py-1.5 text-sm hover:bg-gray-800"
          >
            {t("anotherImport")}
          </button>
        </section>
      )}
    </div>
  )
}
