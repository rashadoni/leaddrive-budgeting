"use client"

import { useEffect, useState } from "react"
import type {
  ColumnMappingProposal,
  MappingProposal,
} from "@/lib/onboarding/ai-mapper/types"
import {
  ANOMALY_SEVERITY_BG,
  ROLE_OPTIONS,
  buildUserOverrides,
  confidenceBand,
} from "../lib/proposal-overrides"

type WizardStep = "select" | "review" | "applied"

interface CompanyOption {
  id: string
  code: string
  name: string
  industry: string | null
  level: number
  /**
   * `/api/companies` returns roots with one level of embedded children
   * (level=2 operational entities). Anything deeper requires a separate
   * fetch — declared here so flattening doesn't rely on a runtime cast.
   */
  children?: CompanyOption[]
}

interface SourceColumnHeader {
  sourceIndex: number
  headerText: string
}

interface AnalyzeResponse {
  stagingId: string
  expiresAt: string
  proposal: MappingProposal
  sourceColumns: SourceColumnHeader[]
}

interface ApplyResponse {
  stagingId: string
  status: "applied"
  year: number
  inserted: number
  deleted: number
  warnings: number
  parentRollupsDropped: number
  parentRollupsUnallocated: number
  recompute: { ok: number; unknown: number; failed: number; targets: number }
  indicatorsStale: boolean
}

interface InflightError {
  message: string
  availableSheets?: string[]
}

// Mirror of `Industry.code` seed values plus the four sectors planned for
// catalog growth (beverage / retail / logistics / construction). Sorted
// alphabetically for muscle memory in the dropdown. Driven from a
// hardcoded list rather than `/api/industries` so the wizard renders
// without a second fetch — when an `/api/industries` endpoint lands the
// list can switch to live data in one place.
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

export function ImportWizard() {
  const [step, setStep] = useState<WizardStep>("select")
  const [companies, setCompanies] = useState<CompanyOption[]>([])
  const [companiesLoading, setCompaniesLoading] = useState(true)
  const [companiesError, setCompaniesError] = useState<string | null>(null)

  // Step-1 form state
  const [companyId, setCompanyId] = useState<string>("")
  const [industryHint, setIndustryHint] = useState<string>("")
  const [sheetName, setSheetName] = useState<string>("")
  const [file, setFile] = useState<File | null>(null)

  // Async state for the analyze call
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeError, setAnalyzeError] = useState<InflightError | null>(null)

  // Result of analyze (Step-2 input)
  const [stagingId, setStagingId] = useState<string | null>(null)
  const [proposal, setProposal] = useState<MappingProposal | null>(null)
  const [editedColumns, setEditedColumns] = useState<ColumnMappingProposal[]>([])
  const [sourceColumns, setSourceColumns] = useState<SourceColumnHeader[]>([])
  const [expiresAt, setExpiresAt] = useState<string | null>(null)

  // Step-2 → /apply
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [applyResult, setApplyResult] = useState<ApplyResponse | null>(null)
  // True when the staging row is gone (expired / discarded / already
  // applied). The proposal in client memory is now stale — the user must
  // restart from step 1 because /apply will keep returning 410.
  const [stagingTerminal, setStagingTerminal] = useState(false)

  // Load company list once on mount. Filters to operational (level=2) — only
  // operational companies have BudgetLine targets.
  useEffect(() => {
    let cancelled = false
    fetch("/api/companies")
      .then(async (r) => {
        if (!r.ok) {
          throw new Error(`HTTP ${r.status}: ${await r.text()}`)
        }
        return r.json() as Promise<{ companies: CompanyOption[] } | CompanyOption[]>
      })
      .then((data) => {
        if (cancelled) return
        // /api/companies returns roots (level=1 sub-groups) with embedded
        // children (level=2 operational). Two-level walk only — the route
        // does `include: { children }` once, so deeper recursion would be
        // dead code. If the API ever returns deeper trees, switch to a
        // queue-based traversal here.
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
      setAnalyzeError({ message: "Pick an .xlsx file first." })
      return
    }
    if (!companyId) {
      setAnalyzeError({ message: "Pick a target company." })
      return
    }
    setAnalyzing(true)
    try {
      const form = new FormData()
      form.append("file", file)
      form.append("companyId", companyId)
      if (sheetName.trim()) form.append("sheetName", sheetName.trim())
      if (industryHint.trim()) form.append("industryHint", industryHint.trim())
      const res = await fetch("/api/onboarding/import/analyze", {
        method: "POST",
        body: form,
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setAnalyzeError({
          message: body.error || `HTTP ${res.status}`,
          availableSheets: body.availableSheets,
        })
        return
      }
      const data = (await res.json()) as AnalyzeResponse
      setStagingId(data.stagingId)
      setProposal(data.proposal)
      setEditedColumns(data.proposal.columns.map((c) => ({ ...c })))
      setSourceColumns(data.sourceColumns ?? [])
      setExpiresAt(data.expiresAt)
      setStep("review")
    } catch (err) {
      setAnalyzeError({
        message: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setAnalyzing(false)
    }
  }

  async function handleApply() {
    if (!stagingId || !proposal || !file) return
    setApplyError(null)
    setApplying(true)
    try {
      const form = new FormData()
      form.append("file", file)
      const overrides = buildUserOverrides(proposal, editedColumns)
      if (overrides) {
        form.append("userOverrides", JSON.stringify(overrides))
      }
      const res = await fetch(
        `/api/onboarding/import/staging/${encodeURIComponent(stagingId)}/apply`,
        { method: "POST", body: form },
      )
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        // 410 / 409 = staging row is in a terminal state (expired,
        // discarded, or already applied). The cached proposal is stale;
        // user has to restart from step 1 because retrying /apply will
        // keep failing the same way.
        if (res.status === 410 || res.status === 409) {
          setStagingTerminal(true)
        }
        setApplyError(body.error || `HTTP ${res.status}`)
        return
      }
      setApplyResult(body as ApplyResponse)
      setStep("applied")
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : String(err))
    } finally {
      setApplying(false)
    }
  }

  function resetWizard() {
    setStep("select")
    setStagingId(null)
    setProposal(null)
    setEditedColumns([])
    setSourceColumns([])
    setExpiresAt(null)
    setApplyResult(null)
    setApplyError(null)
    setAnalyzeError(null)
    setFile(null)
    setStagingTerminal(false)
  }

  return (
    <div className="space-y-6">
      <StepIndicator step={step} />

      {step === "select" && (
        <SelectStep
          companies={companies}
          companiesLoading={companiesLoading}
          companiesError={companiesError}
          companyId={companyId}
          setCompanyId={setCompanyId}
          industryHint={industryHint}
          setIndustryHint={setIndustryHint}
          sheetName={sheetName}
          setSheetName={setSheetName}
          file={file}
          setFile={setFile}
          analyzing={analyzing}
          analyzeError={analyzeError}
          onSubmit={handleAnalyze}
        />
      )}

      {step === "review" && proposal && (
        <ReviewStep
          proposal={proposal}
          editedColumns={editedColumns}
          setEditedColumns={setEditedColumns}
          sourceColumns={sourceColumns}
          expiresAt={expiresAt}
          applying={applying}
          applyError={applyError}
          stagingTerminal={stagingTerminal}
          onApply={handleApply}
          onBack={resetWizard}
        />
      )}

      {step === "applied" && applyResult && (
        <AppliedStep result={applyResult} onAnother={resetWizard} />
      )}
    </div>
  )
}

function StepIndicator({ step }: { step: WizardStep }) {
  const steps: Array<{ id: WizardStep; label: string }> = [
    { id: "select", label: "1. Upload" },
    { id: "review", label: "2. Review" },
    { id: "applied", label: "3. Applied" },
  ]
  const activeIdx = steps.findIndex((s) => s.id === step)
  return (
    <ol className="flex items-center gap-3 text-sm" aria-label="Progress">
      {steps.map((s, i) => {
        const isCurrent = i === activeIdx
        const isDone = i < activeIdx
        return (
          <li
            key={s.id}
            className={
              isCurrent
                ? "font-semibold text-primary"
                : isDone
                ? "font-medium text-emerald-600 dark:text-emerald-400"
                : "text-muted-foreground"
            }
          >
            {isDone && <span className="mr-1">✓</span>}
            {s.label}
            {i < steps.length - 1 && <span className="mx-2 text-border">→</span>}
          </li>
        )
      })}
    </ol>
  )
}

function SelectStep(props: {
  companies: CompanyOption[]
  companiesLoading: boolean
  companiesError: string | null
  companyId: string
  setCompanyId: (s: string) => void
  industryHint: string
  setIndustryHint: (s: string) => void
  sheetName: string
  setSheetName: (s: string) => void
  file: File | null
  setFile: (f: File | null) => void
  analyzing: boolean
  analyzeError: InflightError | null
  onSubmit: (e: React.FormEvent) => void
}) {
  const {
    companies,
    companiesLoading,
    companiesError,
    companyId,
    setCompanyId,
    industryHint,
    setIndustryHint,
    sheetName,
    setSheetName,
    file,
    setFile,
    analyzing,
    analyzeError,
    onSubmit,
  } = props

  const selectedCompany = companies.find((c) => c.id === companyId)

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-border/70 bg-card p-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label className="text-sm font-medium" htmlFor="company">
            Target company <span className="text-red-500">*</span>
          </label>
          {companiesLoading ? (
            <div className="mt-1 text-sm text-muted-foreground">Loading…</div>
          ) : companiesError ? (
            <div className="mt-1 text-sm text-red-500">
              Failed to load companies: {companiesError}
            </div>
          ) : companies.length === 0 ? (
            <div className="mt-1 text-sm text-muted-foreground">
              No operational companies in your organization yet.
            </div>
          ) : (
            <select
              id="company"
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              className="mt-1 flex h-10 w-full rounded-lg border border-border/70 bg-background px-3 py-2 text-sm"
            >
              <option value="">— pick a company —</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} · {c.name}
                  {c.industry ? ` (${c.industry})` : ""}
                </option>
              ))}
            </select>
          )}
        </div>

        <div>
          <label className="text-sm font-medium" htmlFor="industry">
            Industry hint{" "}
            <span className="text-xs text-muted-foreground">(optional)</span>
          </label>
          <select
            id="industry"
            value={industryHint}
            onChange={(e) => setIndustryHint(e.target.value)}
            className="mt-1 flex h-10 w-full rounded-lg border border-border/70 bg-background px-3 py-2 text-sm"
          >
            <option value="">
              {selectedCompany?.industry
                ? `(default: ${selectedCompany.industry})`
                : "— skip —"}
            </option>
            {INDUSTRIES_FALLBACK.map((ind) => (
              <option key={ind} value={ind}>
                {ind}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-sm font-medium" htmlFor="sheet">
            Sheet name{" "}
            <span className="text-xs text-muted-foreground">
              (optional — required only if workbook has multiple sheets)
            </span>
          </label>
          <input
            id="sheet"
            type="text"
            value={sheetName}
            onChange={(e) => setSheetName(e.target.value)}
            placeholder='e.g. "P&L" or "SOPL 2026"'
            className="mt-1 flex h-10 w-full rounded-lg border border-border/70 bg-background px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="text-sm font-medium" htmlFor="file">
            xlsx file <span className="text-red-500">*</span>
          </label>
          <input
            id="file"
            type="file"
            accept=".xlsx"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="mt-1 flex h-10 w-full rounded-lg border border-border/70 bg-background px-3 py-1.5 text-sm file:mr-3 file:rounded file:border-0 file:bg-primary/10 file:px-3 file:py-1.5 file:text-xs file:font-medium"
          />
          {file && (
            <p className="mt-1 text-xs text-muted-foreground">
              {file.name} · {(file.size / 1024).toFixed(1)} KB
            </p>
          )}
        </div>
      </div>

      {analyzeError && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-200">
          <p>{analyzeError.message}</p>
          {analyzeError.availableSheets &&
            analyzeError.availableSheets.length > 0 && (
              <p className="mt-2 text-xs">
                Available sheets:{" "}
                {analyzeError.availableSheets.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSheetName(s)}
                    className="mr-2 inline-block rounded border border-current px-2 py-0.5 hover:bg-white/10"
                  >
                    {s}
                  </button>
                ))}
              </p>
            )}
        </div>
      )}

      <div className="flex items-center justify-end gap-3">
        <button
          type="submit"
          disabled={analyzing || !file || !companyId}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {analyzing ? "Analyzing…" : "Analyze with AI"}
        </button>
      </div>
    </form>
  )
}

function ReviewStep(props: {
  proposal: MappingProposal
  editedColumns: ColumnMappingProposal[]
  setEditedColumns: (c: ColumnMappingProposal[]) => void
  sourceColumns: SourceColumnHeader[]
  expiresAt: string | null
  applying: boolean
  applyError: string | null
  stagingTerminal: boolean
  onApply: () => void
  onBack: () => void
}) {
  const {
    proposal,
    editedColumns,
    setEditedColumns,
    sourceColumns,
    expiresAt,
    applying,
    applyError,
    stagingTerminal,
    onApply,
    onBack,
  } = props
  const headerByIdx = new Map(
    sourceColumns.map((s) => [s.sourceIndex, s.headerText]),
  )

  function setRoleAt(idx: number, role: ColumnMappingProposal["role"]) {
    const next = editedColumns.map((c) =>
      c.sourceIndex === idx ? { ...c, role } : c,
    )
    setEditedColumns(next)
  }

  const overall = Math.round(proposal.overallConfidence * 100)
  const overallTone =
    proposal.overallConfidence >= 0.8
      ? "text-emerald-600 dark:text-emerald-400"
      : proposal.overallConfidence >= 0.6
      ? "text-amber-600 dark:text-amber-400"
      : "text-red-600 dark:text-red-400"

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border/70 bg-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">AI proposal</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {proposal.sourceFile} · sheet{" "}
              <span className="font-mono">{proposal.sourceSheet}</span>
              {expiresAt && (
                <span className="ml-2 text-xs">
                  · expires {new Date(expiresAt).toLocaleString()}
                </span>
              )}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Overall confidence
            </p>
            <p className={`text-2xl font-semibold ${overallTone}`}>{overall}%</p>
          </div>
        </div>
        <p className="mt-4 rounded-lg bg-muted/50 px-4 py-3 text-sm">
          {proposal.summary}
        </p>
      </section>

      <section className="rounded-xl border border-border/70 bg-card">
        <header className="border-b border-border/70 px-6 py-3">
          <h3 className="text-sm font-semibold">
            Columns ({proposal.columns.length})
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Override any column the AI got wrong. Manual changes ship as
            <span className="mx-1 font-mono">userOverrides</span> in the apply
            request.
          </p>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">#</th>
                <th className="px-4 py-2 text-left">Header</th>
                <th className="px-4 py-2 text-left">Role</th>
                <th className="px-4 py-2 text-left">Conf.</th>
                <th className="px-4 py-2 text-left">Reasoning</th>
              </tr>
            </thead>
            <tbody>
              {editedColumns.map((c) => {
                const orig = proposal.columns.find(
                  (o) => o.sourceIndex === c.sourceIndex,
                )
                const changed = orig && orig.role !== c.role
                const band = confidenceBand(orig?.confidence ?? c.confidence)
                const bandTone =
                  band === "high"
                    ? "text-emerald-600 dark:text-emerald-400"
                    : band === "med"
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-red-600 dark:text-red-400"
                return (
                  <tr
                    key={c.sourceIndex}
                    className="border-t border-border/50 last:border-b"
                  >
                    <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                      {c.sourceIndex}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">
                      <span className="text-foreground/80">
                        {headerByIdx.get(c.sourceIndex)?.trim() ||
                          `(col ${c.sourceIndex})`}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <select
                        value={c.role}
                        onChange={(e) =>
                          setRoleAt(
                            c.sourceIndex,
                            e.target.value as ColumnMappingProposal["role"],
                          )
                        }
                        className={`flex h-9 w-44 rounded-md border bg-background px-2 py-1 text-xs ${
                          changed
                            ? "border-amber-500/60 ring-1 ring-amber-500/30"
                            : "border-border/70"
                        }`}
                      >
                        {ROLE_OPTIONS.map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className={`px-4 py-2 text-xs font-mono ${bandTone}`}>
                      {Math.round((orig?.confidence ?? c.confidence) * 100)}%
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {orig?.reasoning}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {proposal.anomalies.length > 0 && (
        <section className="rounded-xl border border-border/70 bg-card p-6">
          <h3 className="mb-3 text-sm font-semibold">
            Anomalies ({proposal.anomalies.length})
          </h3>
          <ul className="space-y-2">
            {proposal.anomalies.map((a, i) => (
              <li
                key={i}
                className={`rounded-lg border px-4 py-2 text-sm ${
                  ANOMALY_SEVERITY_BG[a.severity] || ""
                }`}
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-xs font-bold uppercase">
                    {a.severity}
                  </span>
                  <span className="text-xs font-mono">{a.category}</span>
                  {a.row !== null && (
                    <span className="text-xs">row {a.row}</span>
                  )}
                </div>
                <p className="mt-1">{a.description}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {applyError && (
        <div className="space-y-2 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-200">
          <p>{applyError}</p>
          {stagingTerminal && (
            <p className="text-xs">
              The mapping proposal is no longer valid (expired, applied, or
              discarded). Restart from step 1 to create a fresh proposal.
            </p>
          )}
        </div>
      )}

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          disabled={applying}
          className="rounded-lg border border-border/70 px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
        >
          ← Back
        </button>
        {stagingTerminal ? (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Restart from step 1
          </button>
        ) : (
          <button
            type="button"
            onClick={onApply}
            disabled={applying}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {applying ? "Applying…" : "Apply to BudgetLine"}
          </button>
        )}
      </div>
    </div>
  )
}

function AppliedStep({
  result,
  onAnother,
}: {
  result: ApplyResponse
  onAnother: () => void
}) {
  return (
    <div className="space-y-4 rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-emerald-700 dark:text-emerald-300">
            ✓ Applied to BudgetLine
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Year {result.year} · staging {result.stagingId}
          </p>
        </div>
        <button
          type="button"
          onClick={onAnother}
          className="rounded-lg border border-border/70 px-4 py-2 text-sm hover:bg-muted"
        >
          Import another
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Inserted" value={result.inserted} />
        <Stat label="Deleted" value={result.deleted} />
        <Stat label="Warnings" value={result.warnings} />
        <Stat
          label="Rollups deduped"
          value={result.parentRollupsDropped}
          hint={`${result.parentRollupsUnallocated} reconciled`}
        />
      </div>
      <div className="rounded-lg bg-card px-4 py-3 text-sm">
        <p className="font-medium">Indicator recompute</p>
        <p className="mt-1 text-muted-foreground">
          {result.recompute.ok} ok · {result.recompute.unknown} unknown ·{" "}
          {result.recompute.failed} failed (over {result.recompute.targets}{" "}
          targets)
        </p>
        {result.indicatorsStale && (
          <p className="mt-2 rounded bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-200">
            ⚠ Some indicators failed to recompute. The matrix may be stale —
            retry from the Risk Terminal page.
          </p>
        )}
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string
  value: number
  hint?: string
}) {
  return (
    <div className="rounded-lg bg-card px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
