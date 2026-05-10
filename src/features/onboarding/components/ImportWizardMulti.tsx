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
import type { MappingProposal } from "@/lib/onboarding/ai-mapper/types"

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

type WizardStep = "select" | "analyzed"

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
      setAnalyzeError("Pick an .xlsx file first.")
      return
    }
    if (!companyId) {
      setAnalyzeError("Pick a target company.")
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

  function resetWizard() {
    setStep("select")
    setAnalyzeResult(null)
    setAnalyzeError(null)
    setFile(null)
  }

  return (
    <div className="space-y-6" data-testid="import-wizard-multi">
      <header>
        <h2 className="text-lg font-semibold">Multi-Sheet Import (AI Mapper)</h2>
        <p className="text-sm text-muted-foreground">
          Upload a workbook with multiple sheets — each is analyzed separately. Failures
          isolated per sheet.
        </p>
      </header>

      {step === "select" && (
        <form onSubmit={handleAnalyze} className="space-y-4" data-testid="select-form">
          <div className="space-y-1">
            <label htmlFor="company" className="text-sm font-medium block">
              Target company
            </label>
            <select
              id="company"
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              className="w-full px-2 py-1 rounded border border-gray-700 bg-background text-sm font-mono"
              data-testid="company-select"
              disabled={companiesLoading}
            >
              <option value="">— select —</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} · {c.name}
                </option>
              ))}
            </select>
            {companiesLoading && (
              <p className="text-xs text-muted-foreground" data-testid="companies-loading">
                Loading companies…
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
              Industry hint <span className="text-muted-foreground">(optional)</span>
            </label>
            <select
              id="industry"
              value={industryHint}
              onChange={(e) => setIndustryHint(e.target.value)}
              className="w-full px-2 py-1 rounded border border-gray-700 bg-background text-sm"
              data-testid="industry-select"
            >
              <option value="">— derive from company —</option>
              {INDUSTRIES_FALLBACK.map((ind) => (
                <option key={ind} value={ind}>
                  {ind}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label htmlFor="sheet-filter" className="text-sm font-medium block">
              Sheet filter{" "}
              <span className="text-muted-foreground">
                (optional — comma-separated names; default: all sheets)
              </span>
            </label>
            <input
              id="sheet-filter"
              type="text"
              value={sheetNamesFilter}
              onChange={(e) => setSheetNamesFilter(e.target.value)}
              placeholder="e.g. P&L, BS, CF"
              className="w-full px-2 py-1 rounded border border-gray-700 bg-background text-sm font-mono"
              data-testid="sheet-filter-input"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="file" className="text-sm font-medium block">
              .xlsx workbook
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
            {analyzing ? "Analyzing…" : "Analyze sheets"}
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
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Summary</p>
            <p className="mt-1 text-sm">
              <span className="font-mono font-semibold text-emerald-400">
                {analyzeResult.successCount}
              </span>{" "}
              succeeded ·{" "}
              <span className="font-mono font-semibold text-[#FF4757]">
                {analyzeResult.failureCount}
              </span>{" "}
              failed · staging:{" "}
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
                    {isFailure(r) ? "ERROR" : "OK"}
                  </span>
                  <span className="font-mono font-medium">{r.sheetName}</span>
                </div>
                {isFailure(r) ? (
                  <p className="mt-1 text-xs text-[#FF4757]">{r.error}</p>
                ) : (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {r.proposal.columns.length} columns · {r.sourceColumns.length} source
                    headers · confidence{" "}
                    {(r.proposal.overallConfidence * 100).toFixed(0)}%
                  </p>
                )}
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3 border-t border-gray-800 pt-3">
            <button
              type="button"
              onClick={resetWizard}
              data-testid="restart"
              className="rounded border border-gray-700 px-3 py-1.5 text-sm hover:bg-gray-800"
            >
              Start over
            </button>
            <p className="text-xs text-muted-foreground">
              Apply flow ships in slice 2 — for now, the staging row is persisted; rerun
              <code className="mx-1">/api/onboarding/import/staging/{analyzeResult.stagingId}/apply-multi</code>
              manually to commit.
            </p>
          </div>
        </section>
      )}
    </div>
  )
}
