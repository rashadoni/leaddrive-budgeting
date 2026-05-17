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
import { Button } from "@/components/ui/button"

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
      {/* Session 9 UX redesign: stepper at top so user sees flow
          (Upload → Review → Apply) before any control. */}
      <WizardStepper currentStep={step === "select" ? 1 : step === "analyzed" ? 2 : 3} />

      <header>
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </header>

      {step === "select" && (
        <form
          onSubmit={handleAnalyze}
          className="space-y-5"
          data-testid="select-form"
        >
          {/* Section 1 — where the data goes (company + optional industry) */}
          <fieldset className="space-y-4 rounded-lg border border-border/60 bg-card/60 p-4">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("sectionTarget")}
            </legend>

            <div className="space-y-1.5">
              <label htmlFor="company" className="text-sm font-medium flex items-center gap-1">
                {t("targetCompany")}
                <span className="text-red-400" aria-label="required">*</span>
              </label>
              <select
                id="company"
                value={companyId}
                onChange={(e) => {
                  setCompanyId(e.target.value)
                  if (analyzeError) setAnalyzeError(null)
                }}
                className="w-full px-3 py-2 rounded-md border border-gray-700 bg-background text-sm font-mono focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/40 transition-colors disabled:opacity-50"
                data-testid="company-select"
                disabled={companiesLoading}
              >
                <option value="">{companiesLoading ? t("loadingCompanies") : t("selectPlaceholder")}</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} · {c.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                {t("targetCompanyHelp")}
              </p>
              {companiesError && (
                <p className="text-xs text-red-400" data-testid="companies-error">
                  {companiesError}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="industry" className="text-sm font-medium">
                {t("industryHint")}{" "}
                <span className="text-xs text-muted-foreground font-normal">{t("optional")}</span>
              </label>
              <select
                id="industry"
                value={industryHint}
                onChange={(e) => setIndustryHint(e.target.value)}
                className="w-full px-3 py-2 rounded-md border border-gray-700 bg-background text-sm focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/40 transition-colors"
                data-testid="industry-select"
              >
                <option value="">{t("deriveFromCompany")}</option>
                {INDUSTRIES_FALLBACK.map((ind) => (
                  <option key={ind} value={ind}>
                    {ind.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                {t("industryHintHelp")}
              </p>
            </div>
          </fieldset>

          {/* Section 2 — what to load (file + optional sheet filter) */}
          <fieldset className="space-y-4 rounded-lg border border-border/60 bg-card/60 p-4">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("sectionWorkbook")}
            </legend>

            <div className="space-y-1.5">
              <label className="text-sm font-medium flex items-center gap-1">
                {t("xlsxWorkbook")}
                <span className="text-red-400" aria-label="required">*</span>
              </label>
              <FileDropZone
                file={file}
                onSelect={(f) => {
                  setFile(f)
                  if (analyzeError) setAnalyzeError(null)
                }}
                helpText={t("fileDropHelp")}
                dropHere={t("fileDropHere")}
                orClickToBrowse={t("fileOrClickToBrowse")}
                limitsText={t("fileLimits")}
                removeLabel={t("fileRemove")}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="sheet-filter" className="text-sm font-medium">
                {t("sheetFilter")}{" "}
                <span className="text-xs text-muted-foreground font-normal">{t("optional")}</span>
              </label>
              <input
                id="sheet-filter"
                type="text"
                value={sheetNamesFilter}
                onChange={(e) => setSheetNamesFilter(e.target.value)}
                placeholder={t("sheetFilterPlaceholder")}
                className="w-full px-3 py-2 rounded-md border border-gray-700 bg-background text-sm font-mono focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/40 transition-colors"
                data-testid="sheet-filter-input"
              />
              <p className="text-xs text-muted-foreground">
                {t("sheetFilterHelp")}
              </p>
            </div>
          </fieldset>

          {/* Submit row — primary CTA via shared Button component.
              impeccable audit (Session 9): swapped variant="brand"
              (purple-violet gradient) → variant="default" (solid primary).
              The `brand` gradient is an AI-tell per impeccable's anti-
              pattern list — reserved now for AI-feature surfaces
              (variance-explainer, board-deck narrator), NOT generic
              forms. Solid primary fits the financial-tool register. */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Button
              type="submit"
              variant="default"
              size="lg"
              disabled={analyzing || !file || !companyId}
              data-testid="analyze-submit"
            >
              {analyzing && <Spinner />}
              {analyzing ? t("analyzing") : t("analyzeSheets")}
              {!analyzing && <span aria-hidden="true">→</span>}
            </Button>

            {!analyzing && (
              <p className="text-xs text-muted-foreground" data-testid="analyze-prereq-hint">
                {!companyId && !file
                  ? t("hintNeedBoth")
                  : !companyId
                  ? t("hintNeedCompany")
                  : !file
                  ? t("hintNeedFile")
                  : t("hintReady")}
              </p>
            )}
          </div>

          {analyzeError && (
            <div
              role="alert"
              className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300"
              data-testid="analyze-error"
            >
              <strong className="font-semibold">{t("errorPrefix")}</strong> {analyzeError}
            </div>
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

          <div className="flex items-center gap-3 border-t border-gray-800 pt-4">
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={resetWizard}
              data-testid="restart"
            >
              {t("startOver")}
            </Button>
            {!stagingTerminal && analyzeResult.successCount > 0 && (
              <Button
                type="button"
                variant="default"
                size="lg"
                onClick={handleApply}
                /* L1 hard-gate (replaces advisory-only behavior from Phase
                   C.5): Apply disabled while applying OR when DriftDiff
                   preview detected existing plan data AND user hasn't
                   ticked the diff-confirm checkbox. Fresh onboarding
                   (no existing data) keeps Apply enabled without
                   requiring confirmation — same UX. */
                disabled={applying || (diffHasExistingData && !safetyConfirmed)}
                data-testid="apply-submit"
                className="bg-emerald-600 hover:bg-emerald-500 text-white"
              >
                {applying && <Spinner />}
                {applying
                  ? t("applying")
                  : analyzeResult.successCount === 1
                  ? t("applySheets", { n: analyzeResult.successCount })
                  : t("applySheetsPlural", { n: analyzeResult.successCount })}
              </Button>
            )}
          </div>

          {applyError && (
            <div
              role="alert"
              className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300"
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
                    className="underline text-xs hover:text-red-200"
                  >
                    {t("restartFromStep1")}
                  </button>
                </>
              )}
            </div>
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

          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={resetWizard}
            data-testid="another-import"
          >
            {t("anotherImport")}
          </Button>
        </section>
      )}
    </div>
  )
}

// ─── Session 9 UX helpers ──────────────────────────────────────────────────

/**
 * Wizard progress indicator. Renders 3 numbered steps with the current
 * one highlighted; previous steps marked complete with a checkmark.
 * Pure presentation — no state, just shows where the user is.
 */
function WizardStepper({ currentStep }: { currentStep: 1 | 2 | 3 }) {
  const t = useTranslations("onboarding.multi")
  const steps: Array<{ id: 1 | 2 | 3; label: string }> = [
    { id: 1, label: t("stepUpload") },
    { id: 2, label: t("stepReview") },
    { id: 3, label: t("stepApply") },
  ]
  return (
    <ol
      role="list"
      aria-label={t("stepperAriaLabel")}
      data-testid="wizard-stepper"
      className="flex items-center gap-2 text-xs"
    >
      {steps.map((s, idx) => {
        const isDone = s.id < currentStep
        const isActive = s.id === currentStep
        return (
          <li key={s.id} className="flex items-center gap-2">
            <span
              data-testid={`step-${s.id}`}
              data-active={isActive}
              data-done={isDone}
              className={`inline-flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-semibold transition-colors ${
                isDone
                  ? "border-emerald-500/50 bg-emerald-500/20 text-emerald-300"
                  : isActive
                    ? "border-cyan-500/60 bg-cyan-500/20 text-cyan-200"
                    : "border-gray-700 bg-background text-gray-500"
              }`}
            >
              {isDone ? (
                // ui-ux-pro-max no-emoji-icons rule: SVG checkmark instead
                // of Unicode ✓ glyph (font-dependent rendering otherwise).
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-3.5 w-3.5"
                  aria-hidden="true"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                s.id
              )}
            </span>
            <span
              className={`uppercase tracking-wider ${
                isActive ? "text-cyan-200 font-medium" : isDone ? "text-emerald-400/70" : "text-muted-foreground"
              }`}
            >
              {s.label}
            </span>
            {idx < steps.length - 1 && (
              <span className="mx-1 h-px w-6 bg-gray-800" aria-hidden="true" />
            )}
          </li>
        )
      })}
    </ol>
  )
}

/**
 * Drag-and-drop file zone with friendly empty state + selected-file pill.
 * Replaces the bare `<input type="file">` with a 2-state visual:
 *   - empty: dashed outline + upload icon + "drop here or click to browse"
 *   - selected: file pill (name + KB) + remove button
 *
 * Falls back to a hidden native input so accessibility + keyboard focus
 * remain standard browser behaviour.
 */
function FileDropZone({
  file,
  onSelect,
  helpText,
  dropHere,
  orClickToBrowse,
  limitsText,
  removeLabel,
}: {
  file: File | null
  onSelect: (file: File | null) => void
  helpText: string
  dropHere: string
  orClickToBrowse: string
  limitsText: string
  removeLabel: string
}) {
  const [dragOver, setDragOver] = useState(false)

  if (file) {
    return (
      <div
        data-testid="file-drop-zone"
        data-state="selected"
        className="flex items-center justify-between rounded-md border border-emerald-500/40 bg-emerald-500/10 px-4 py-3"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-emerald-500/20 text-emerald-300" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
              <path d="M14 3v4a1 1 0 0 0 1 1h4M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" />
            </svg>
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{file.name}</p>
            <p className="text-xs text-muted-foreground">
              {(file.size / 1024).toLocaleString(undefined, { maximumFractionDigits: 0 })} KB
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onSelect(null)}
          className="hover:border-red-500/50 hover:text-red-300"
          data-testid="file-remove-button"
          aria-label={`${removeLabel} ${file.name}`}
        >
          {removeLabel}
        </Button>
      </div>
    )
  }

  return (
    <label
      htmlFor="file"
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        const dropped = e.dataTransfer.files?.[0]
        if (dropped && /\.xlsx$/i.test(dropped.name)) onSelect(dropped)
      }}
      data-testid="file-drop-zone"
      data-state={dragOver ? "drag-over" : "empty"}
      className={`flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed px-4 py-8 text-center cursor-pointer transition-colors ${
        dragOver
          ? "border-cyan-500 bg-cyan-500/10"
          : "border-gray-700 bg-background hover:border-gray-600 hover:bg-gray-900/30"
      }`}
    >
      <input
        id="file"
        type="file"
        accept=".xlsx"
        onChange={(e) => onSelect(e.target.files?.[0] ?? null)}
        data-testid="file-input"
        className="sr-only"
      />
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-8 w-8 text-gray-500" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
      </svg>
      <p className="text-sm font-medium">{dropHere}</p>
      <p className="text-xs text-muted-foreground">{orClickToBrowse}</p>
      <p className="text-[11px] text-muted-foreground/70 mt-1">{limitsText}</p>
      {helpText && <p className="text-xs text-muted-foreground mt-2 max-w-md">{helpText}</p>}
    </label>
  )
}

/**
 * Tiny spinner for inline button-state. CSS-only animation; matches
 * cyan submit-button accent.
 */
function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-cyan-400/30 border-t-cyan-400"
    />
  )
}
