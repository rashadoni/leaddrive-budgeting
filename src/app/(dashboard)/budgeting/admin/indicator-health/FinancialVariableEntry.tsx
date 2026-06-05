"use client"

/**
 * Inline single-value entry for a gappy indicator whose missing input is a
 * FINANCIAL statement figure (e.g. period-end inventory) rather than an
 * operational KPI. Financial sibling of `InlineFactEntry`.
 *
 * Rendered in the indicator-health expanded row when `resolveFinancialVariable`
 * (cta.ts) matches the missing variable. Lets the user type ONE year-end value
 * and see the dependent indicators recompute immediately — instead of leaving
 * for a full Excel import.
 *
 * Backend is `POST /api/budgeting/financial-variable` (manager+, Zod,
 * validateFinancialValue, 2-step requiresConfirm, recomputeAfterDataChange,
 * audit) which writes a conforming `BalanceSheetLine`. On success it calls
 * `onSaved()` so the parent re-fetches the health table — the row's cell-count
 * drops (or the row disappears) live.
 */

import { useMemo, useState } from "react"
import { useTranslations, useLocale } from "next-intl"
import { Loader2, Check, AlertTriangle, Plus } from "lucide-react"
import {
  getFinancialVariableRule,
  validateFinancialValue,
} from "@/lib/risk/financial-variable-rules"

export interface RecomputeSummary {
  ok: number
  unknown: number
  failed: number
}

/** Pure — the POST body for `/api/budgeting/financial-variable`. */
export function buildFinancialVariableBody(args: {
  companyId: string
  variable: string
  year: number
  value: number
  forceConfirm: boolean
  sourceNote?: string
}): {
  companyId: string
  variable: string
  year: number
  value: number
  sourceNote: string
  forceConfirm: boolean
} {
  return {
    companyId: args.companyId,
    variable: args.variable,
    year: args.year,
    value: args.value,
    sourceNote: args.sourceNote ?? "inline:indicator-health",
    forceConfirm: args.forceConfirm,
  }
}

/** Pure — normalize a recompute payload into {ok,total} for the success line. */
export function summarizeRecompute(
  r: RecomputeSummary | null | undefined,
): { ok: number; total: number } | null {
  if (!r) return null
  return { ok: r.ok, total: r.ok + r.unknown + r.failed }
}

/** Pure — the year options offered, newest first, given "now". Default is the
 *  latest *completed* year (current − 1): a year-end balance figure is entered
 *  for a closed year, not the in-progress one. */
export function buildYearOptions(currentYear: number, span = 4): number[] {
  return Array.from({ length: span }, (_, i) => currentYear - i)
}

type Feedback =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "confirm"; warnings: string[] }
  | {
      kind: "saved"
      recompute: { ok: number; total: number } | null
      unlocks: string[]
    }
  | { kind: "error"; message: string }

export function FinancialVariableEntry({
  variable,
  affectedCodes,
  companyIdByCode,
  onSaved,
  nowYear,
}: {
  /** The hand-enterable financial variable this gap resolves to (e.g. "inventory"). */
  variable: string
  /** Affected company codes from the gap row. */
  affectedCodes: string[]
  /** code → DB id, loaded once by the parent from /api/companies. */
  companyIdByCode: Map<string, string>
  /** Called after a successful save so the parent re-fetches the health table. */
  onSaved: () => void
  /** Injected current year (defaults to the real calendar year) — for testing. */
  nowYear?: number
}) {
  const t = useTranslations("adminIndicatorHealth.financialEntry")
  const locale = useLocale()
  const rule = getFinancialVariableRule(variable)

  const resolvable = useMemo(
    () => affectedCodes.filter((c) => companyIdByCode.has(c)),
    [affectedCodes, companyIdByCode],
  )
  const yearOptions = useMemo(
    () => buildYearOptions(nowYear ?? new Date().getFullYear()),
    [nowYear],
  )

  const [companyCode, setCompanyCode] = useState<string>(resolvable[0] ?? "")
  const [value, setValue] = useState<string>("")
  // Default: latest completed year (newest option − 1 = options[1]).
  const [year, setYear] = useState<number>(yearOptions[1] ?? yearOptions[0])
  const [feedback, setFeedback] = useState<Feedback>({ kind: "idle" })

  if (!rule) return null

  const L = (en: string, ru: string, az: string): string =>
    locale === "az" ? az : locale === "ru" ? ru : en
  const variableLabel = L(rule.labelEn, rule.labelRu, rule.labelAz)

  const numeric = value.trim() === "" ? NaN : Number(value)
  const check = value.trim() === "" ? null : validateFinancialValue(rule, numeric)
  const isError = check != null && !check.ok
  const isNan = value.trim() !== "" && Number.isNaN(numeric)

  const canSave =
    !!companyCode && value.trim() !== "" && !isError && feedback.kind !== "saving"

  const borderTone = isError
    ? "border-rose-400 focus:ring-rose-300"
    : check != null && check.warnings.length > 0
      ? "border-amber-400 focus:ring-amber-300"
      : "border-border focus:ring-primary/40"

  async function submit(forceConfirm: boolean) {
    const companyId = companyIdByCode.get(companyCode)
    if (!companyId || !rule) return
    setFeedback({ kind: "saving" })
    try {
      const res = await fetch("/api/budgeting/financial-variable", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          buildFinancialVariableBody({
            companyId,
            variable: rule.variable,
            year,
            value: Number(value),
            forceConfirm,
          }),
        ),
      })
      const json = (await res.json()) as Record<string, unknown>
      if (!res.ok) {
        const errs =
          Array.isArray(json.errors) && json.errors.length > 0
            ? (json.errors as string[]).join("; ")
            : ((json.error as string) ?? `HTTP ${res.status}`)
        setFeedback({ kind: "error", message: errs })
        return
      }
      if (json.requiresConfirm === true) {
        setFeedback({
          kind: "confirm",
          warnings: Array.isArray(json.warnings) ? (json.warnings as string[]) : [],
        })
        return
      }
      setFeedback({
        kind: "saved",
        recompute: summarizeRecompute(
          json.recompute as RecomputeSummary | null | undefined,
        ),
        unlocks: Array.isArray(json.unlocks) ? (json.unlocks as string[]) : [],
      })
      setValue("")
      onSaved()
    } catch (err) {
      setFeedback({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  if (resolvable.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-background/60 p-2.5 text-[11px] text-muted-foreground">
        {t("noResolvableEntity")}
      </div>
    )
  }

  return (
    <div
      className="rounded-md border border-primary/20 bg-primary/[0.04] p-3"
      data-testid="financial-variable-entry"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="mb-2">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
          <Plus className="h-3.5 w-3.5 text-primary" />
          {t("title")}
        </div>
        <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
          {t("subtitle")}
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        {/* Company */}
        <label className="flex flex-col gap-0.5">
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground/70">
            {t("company")}
          </span>
          <select
            value={companyCode}
            onChange={(e) => setCompanyCode(e.target.value)}
            className="h-7 rounded border border-border bg-background px-1.5 text-[11px] font-mono"
            data-testid="financial-variable-company"
          >
            {resolvable.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        {/* Variable (read-only — fixed by the gap) */}
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground/70">
            {t("figure")}
          </span>
          <span
            className="flex h-7 items-center rounded border border-dashed border-border bg-background/60 px-1.5 text-[11px]"
            title={rule.requiredInputKey}
          >
            {variableLabel}
          </span>
        </div>

        {/* Value */}
        <label className="flex flex-col gap-0.5">
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground/70">
            {t("value")} · {rule.unit}
          </span>
          <input
            type="number"
            inputMode="decimal"
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              if (feedback.kind !== "idle") setFeedback({ kind: "idle" })
            }}
            placeholder={`${rule.min}–`}
            className={`h-7 w-32 rounded border bg-background px-1.5 text-[11px] tabular-nums outline-none focus:ring-2 ${borderTone}`}
            data-testid="financial-variable-value"
          />
        </label>

        {/* Year */}
        <label className="flex flex-col gap-0.5">
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground/70">
            {t("year")}
          </span>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="h-7 rounded border border-border bg-background px-1.5 text-[11px] tabular-nums"
            data-testid="financial-variable-year"
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>

        {/* Save */}
        {feedback.kind !== "confirm" && (
          <button
            type="button"
            disabled={!canSave}
            onClick={() => submit(false)}
            className="inline-flex h-7 items-center gap-1 rounded-md bg-primary px-2.5 text-[11px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
            data-testid="financial-variable-save"
          >
            {feedback.kind === "saving" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Check className="h-3 w-3" />
            )}
            {feedback.kind === "saving" ? t("saving") : t("save")}
          </button>
        )}
      </div>

      <p className="mt-1.5 text-[10px] text-muted-foreground/80">{t("yearHint")}</p>

      {/* Hard-out-of-range / NaN. */}
      {(isError || isNan) && value.trim() !== "" && (
        <p className="mt-1 text-[10px] text-rose-500">
          {isNan
            ? t("notANumber")
            : t("outOfRange", { min: rule.min, max: rule.max })}
        </p>
      )}

      {/* Confirm step — soft-bound / non-positive. */}
      {feedback.kind === "confirm" && (
        <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2 dark:border-amber-500/30 dark:bg-amber-500/10">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-amber-800 dark:text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5" />
            {t("confirmTitle")}
          </div>
          {feedback.warnings.length > 0 && (
            <ul className="mt-1 list-disc pl-4 text-[10px] text-amber-700 dark:text-amber-200/90">
              {feedback.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
          <div className="mt-1.5 flex gap-2">
            <button
              type="button"
              onClick={() => submit(true)}
              className="inline-flex h-6 items-center rounded bg-amber-600 px-2 text-[10px] font-medium text-white hover:bg-amber-700"
              data-testid="financial-variable-confirm"
            >
              {t("confirmSave")}
            </button>
            <button
              type="button"
              onClick={() => setFeedback({ kind: "idle" })}
              className="inline-flex h-6 items-center rounded border border-border px-2 text-[10px] text-muted-foreground hover:text-foreground"
            >
              {t("cancel")}
            </button>
          </div>
        </div>
      )}

      {/* Saved — show the live recompute result + what it unlocked. */}
      {feedback.kind === "saved" && (
        <div
          className="mt-1.5 space-y-0.5"
          data-testid="financial-variable-saved"
        >
          <p className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
            <Check className="h-3 w-3" />
            {feedback.recompute
              ? t("savedRecomputed", {
                  ok: feedback.recompute.ok,
                  total: feedback.recompute.total,
                })
              : t("saved")}
          </p>
          {feedback.unlocks.length > 0 && (
            <p className="text-[10px] text-muted-foreground">
              {t("savedUnlocks", { indicators: feedback.unlocks.join(", ") })}
            </p>
          )}
        </div>
      )}

      {/* Error. */}
      {feedback.kind === "error" && (
        <p
          className="mt-1.5 text-[10px] text-rose-500"
          data-testid="financial-variable-error"
        >
          {t("error", { message: feedback.message })}
        </p>
      )}
    </div>
  )
}
