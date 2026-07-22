"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { AlertTriangle, ArchiveRestore, DatabaseZap, RotateCcw, ShieldCheck } from "lucide-react"
import type { ImportResetScopeOption } from "@/features/admin/lib/import-reset-scopes"

type ResetIntent = "reset" | "reimport" | "rollback"

interface ResetPreviewCompany {
  companyCode: string
  companyId: string
  breakdown: Record<string, number>
  rowsAffected: number
}

interface ResetPreview {
  year?: number
  companies: ResetPreviewCompany[]
  breakdown: Record<string, number>
  rowsAffected: number
  orphanBudgetLine: number
  isWholeHolding: boolean
}

interface ResetResult {
  ok: boolean
  mode?: string
  rowsAffected?: number
  breakdown?: Record<string, number>
  recomputed?: number
  companiesReset?: number
  error?: string
}

const BREAKDOWN_KEYS = [
  "budgetLine",
  "balanceSheetLine",
  "cashFlowEntry",
  "counterparty",
  "operationalFact",
  "budgetActual",
  "settingsKeys",
  "orphanBudgetLine",
] as const

export function ImportDataResetPanel({
  scopes,
  initialCompanyCode,
  initialYear,
}: {
  scopes: ReadonlyArray<ImportResetScopeOption>
  initialCompanyCode?: string
  initialYear?: number
}) {
  const t = useTranslations("adminAiImport.reset")
  const initialScopeId = useMemo(() => {
    if (initialCompanyCode) {
      const holding = scopes.find((s) => s.kind === "holding" && s.code === initialCompanyCode)
      if (holding) return holding.id
      const company = scopes.find((s) => s.kind === "company" && s.code === initialCompanyCode)
      if (company) return company.id
    }
    return ""
  }, [scopes, initialCompanyCode])
  const [scopeId, setScopeId] = useState(initialScopeId)
  const [year, setYear] = useState(String(initialYear ?? new Date().getFullYear()))
  const [reason, setReason] = useState(t("defaultReason"))
  const [confirmCode, setConfirmCode] = useState("")
  const [preview, setPreview] = useState<ResetPreview | null>(null)
  const [result, setResult] = useState<ResetResult | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [intent, setIntent] = useState<ResetIntent>("reset")

  const selectedScope = scopes.find((s) => s.id === scopeId)
  const holdingScopes = scopes.filter((s) => s.kind === "holding")
  const companyScopes = scopes.filter((s) => s.kind === "company")
  const expectedConfirm = "ALL"
  const parsedYear = parseOptionalYear(year)
  const yearValue = parsedYear.valid ? parsedYear.value : undefined
  const canPreview = selectedScope != null && parsedYear.valid && !loadingPreview
  const canReset =
    preview != null &&
    preview.rowsAffected >= 0 &&
    confirmCode === expectedConfirm &&
    !submitting

  async function loadPreview(nextIntent: ResetIntent = intent) {
    if (!canPreview || !selectedScope) return
    setIntent(nextIntent)
    setLoadingPreview(true)
    setError(null)
    setResult(null)
    setPreview(null)
    try {
      const res = await fetch("/api/admin/data-archive/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityKind: "AllImportData",
          companyCodes: selectedScope.companyCodes,
          year: yearValue,
        }),
      })
      const data = (await res.json()) as
        | { ok: true; preview: ResetPreview }
        | { ok: false; error: string }
      if (!res.ok || !data.ok) {
        throw new Error("error" in data ? data.error : `HTTP ${res.status}`)
      }
      setPreview(data.preview)
      setConfirmCode("")
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingPreview(false)
    }
  }

  async function runReset() {
    if (!canReset || !selectedScope) return
    setSubmitting(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch("/api/admin/data-archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "archive",
          entityKind: "AllImportData",
          companyCodes: selectedScope.companyCodes,
          year: yearValue,
          reason: reason.trim() || t("defaultReason"),
          confirmCode,
        }),
      })
      const data = (await res.json()) as ResetResult
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`)
      }
      setResult(data)
      setPreview(null)
      setConfirmCode("")
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section
      id="import-cleanup"
      data-testid="ai-import-guide-reset"
      className="rounded-lg border border-amber-200 bg-amber-50/50 p-4 text-sm dark:border-amber-500/30 dark:bg-amber-500/10"
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2 text-amber-900 dark:text-amber-100">
            <DatabaseZap className="h-4 w-4" aria-hidden="true" />
            <h2 className="text-base font-semibold">{t("title")}</h2>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-amber-900/80 dark:text-amber-100/80">
            {t("description")}
          </p>
        </div>
        <Link
          href="/budgeting/admin/data-archive"
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded border border-amber-300 bg-white px-3 text-xs font-medium text-amber-900 hover:bg-amber-100 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-100 dark:hover:bg-amber-900/40"
        >
          <ArchiveRestore className="h-3.5 w-3.5" aria-hidden="true" />
          {t("openFullArchive")}
        </Link>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_120px]">
        <label className="space-y-1">
          <span className="text-xs font-semibold text-foreground">{t("scopeLabel")}</span>
          <select
            value={scopeId}
            onChange={(e) => {
              setScopeId(e.target.value)
              setPreview(null)
              setResult(null)
            }}
            className="h-10 w-full rounded border border-border bg-background px-3 text-sm"
          >
            <option value="">{t("scopePlaceholder")}</option>
            {holdingScopes.length > 0 && (
              <optgroup label={t("holdingGroupLabel")}>
                {holdingScopes.map((scope) => (
                  <option key={scope.id} value={scope.id}>
                    {scopeOptionLabel(t, scope)}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label={t("companyGroupLabel")}>
              {companyScopes.map((scope) => (
                <option key={scope.id} value={scope.id}>
                  {scopeOptionLabel(t, scope)}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-xs font-semibold text-foreground">{t("yearLabel")}</span>
          <input
            type="number"
            min={2000}
            max={2100}
            value={year}
            onChange={(e) => {
              setYear(e.target.value)
              setPreview(null)
              setResult(null)
            }}
            placeholder={t("allYearsPlaceholder")}
            className="h-10 w-full rounded border border-border bg-background px-3 text-sm"
          />
        </label>
      </div>

      <label className="mt-3 block space-y-1">
        <span className="text-xs font-semibold text-foreground">{t("reasonLabel")}</span>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="h-10 w-full rounded border border-border bg-background px-3 text-sm"
          maxLength={500}
        />
      </label>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void loadPreview("reset")}
          disabled={!canPreview}
          className="inline-flex h-9 items-center gap-1.5 rounded bg-amber-700 px-3 text-xs font-semibold text-white transition hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
          {loadingPreview && intent === "reset" ? t("previewRunning") : t("previewReset")}
        </button>
        <button
          type="button"
          onClick={() => void loadPreview("reimport")}
          disabled={!canPreview}
          className="inline-flex h-9 items-center gap-1.5 rounded border border-border bg-background px-3 text-xs font-semibold text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          {loadingPreview && intent === "reimport" ? t("previewRunning") : t("resetAndReimport")}
        </button>
        <button
          type="button"
          onClick={() => void loadPreview("rollback")}
          disabled={!canPreview}
          className="inline-flex h-9 items-center gap-1.5 rounded border border-border bg-background px-3 text-xs font-semibold text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          title={t("rollbackTitle")}
        >
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
          {loadingPreview && intent === "rollback" ? t("previewRunning") : t("rollbackSafePath")}
        </button>
      </div>

      {!parsedYear.valid && (
        <p className="mt-2 text-xs text-red-700 dark:text-red-300">{t("yearError")}</p>
      )}

      {selectedScope && (
        <p className="mt-2 text-xs text-muted-foreground">
          {t("scopeLine", {
            scope: scopeOptionLabel(t, selectedScope),
            count: selectedScope.companyCount,
            year: yearValue ? String(yearValue) : t("allYears"),
          })}
        </p>
      )}

      {preview && (
        <div className="mt-4 rounded border border-amber-300 bg-white p-3 dark:border-amber-500/30 dark:bg-background/60">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="font-semibold text-foreground">
                {t("previewTitle", { rows: preview.rowsAffected })}
              </div>
              <p className="text-xs text-muted-foreground">{intentCopy(t, intent)}</p>
            </div>
            <span className="text-xs font-mono text-muted-foreground sm:max-w-md sm:text-right">
              {preview.companies.map((c) => c.companyCode).join(", ")}
            </span>
          </div>

          {preview.isWholeHolding && (
            <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-2 text-xs leading-relaxed text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
              {t("wholeHoldingPreviewNote", { count: preview.companies.length })}
            </div>
          )}

          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {BREAKDOWN_KEYS.map((key) => (
              <div key={key} className="rounded border border-border/70 bg-muted/30 px-2.5 py-2">
                <div className="text-[11px] text-muted-foreground">{t(`breakdown.${key}`)}</div>
                <div className="font-mono text-sm font-semibold">{preview.breakdown[key] ?? 0}</div>
              </div>
            ))}
          </div>

          <div className="mt-3 rounded border border-red-200 bg-red-50 p-2 text-xs leading-relaxed text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
            {t("irreversibleNote")}
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
            <label className="space-y-1">
              <span className="text-xs font-semibold text-foreground">
                {t("confirmLabel", { value: expectedConfirm })}
              </span>
              <input
                value={confirmCode}
                onChange={(e) => setConfirmCode(e.target.value)}
                placeholder={expectedConfirm}
                className="h-10 w-full rounded border border-border bg-background px-3 font-mono text-sm"
              />
            </label>
            <button
              type="button"
              onClick={() => void runReset()}
              disabled={!canReset}
              className="inline-flex h-10 items-center justify-center gap-1.5 rounded bg-red-700 px-4 text-sm font-semibold text-white transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <DatabaseZap className="h-4 w-4" aria-hidden="true" />
              {submitting ? t("resetRunning") : resetButtonCopy(t, intent)}
            </button>
          </div>
        </div>
      )}

      {result?.ok && (
        <div className="mt-4 rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100">
          <div className="font-semibold">
            {t("successTitle", { rows: result.rowsAffected ?? 0 })}
          </div>
          <div className="mt-1 text-xs">
            {t("successRecompute", { n: result.recomputed ?? 0 })}
          </div>
          {intent !== "reset" && (
            <div className="mt-2 text-xs">{t("uploadReplacementHint")}</div>
          )}
        </div>
      )}

      {error && (
        <div className="mt-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
          {t("error", { msg: error })}
        </div>
      )}
    </section>
  )
}

function parseOptionalYear(raw: string): { valid: true; value?: number } | { valid: false } {
  const trimmed = raw.trim()
  if (!trimmed) return { valid: true }
  const n = Number(trimmed)
  if (!Number.isInteger(n) || n < 2000 || n > 2100) return { valid: false }
  return { valid: true, value: n }
}

function intentCopy(t: ReturnType<typeof useTranslations>, intent: ResetIntent): string {
  if (intent === "reimport") return t("previewReimportHint")
  if (intent === "rollback") return t("previewRollbackHint")
  return t("previewResetHint")
}

function resetButtonCopy(t: ReturnType<typeof useTranslations>, intent: ResetIntent): string {
  if (intent === "reimport") return t("confirmResetAndReimport")
  if (intent === "rollback") return t("confirmRollbackSafePath")
  return t("confirmReset")
}

function scopeOptionLabel(
  t: ReturnType<typeof useTranslations>,
  scope: ImportResetScopeOption,
): string {
  if (scope.kind === "holding") {
    return t("holdingOption", {
      name: scope.name,
      root: scope.rootCode ?? scope.code,
      count: scope.companyCount,
    })
  }
  return `${scope.code} - ${scope.name}`
}
