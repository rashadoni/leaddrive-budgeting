"use client"

/**
 * Inline single-value entry for a gappy operational indicator.
 *
 * Rendered inside the indicator-health expanded row when the missing formula
 * variable maps to a hand-enterable operational metric (see `resolveManualMetric`
 * in `cta.ts`). Lets the user type ONE value right where the gap is shown and
 * see the indicators recompute immediately — instead of leaving the page for the
 * full data-entry form or an Excel import. (User ask 2026-06-04: "если чего-то
 * не хватает, откуда можно быстро добавить … вводить оперативно и видеть
 * результат как меняется".)
 *
 * Backend is the already-tested `POST /api/operational-facts` (manager+, Zod,
 * validateValue, 2-step requiresConfirm, recomputeAfterDataChange). On success
 * it calls `onSaved()` so the parent re-fetches the health table — the row's
 * cell-count drops (or the row disappears) live.
 */

import { useMemo, useState } from "react"
import { useTranslations, useLocale } from "next-intl"
import { Loader2, Check, AlertTriangle, Plus } from "lucide-react"
import { getOperationalRule } from "@/lib/risk/metric-validation-rules"
import { checkMetricValue } from "@/features/budgeting/components/data-entry-validation"

export interface RecomputeSummary {
  ok: number
  unknown: number
  failed: number
}

/**
 * Pure — the POST body for `/api/operational-facts`. The UI date is `YYYY-MM-DD`;
 * the API validates an ISO datetime with offset, so we expand to midnight UTC.
 */
export function buildOperationalFactBody(args: {
  companyId: string
  metric: string
  unit: string
  dateYmd: string
  value: number
  forceConfirm: boolean
  sourceNote?: string
}): {
  companyId: string
  metric: string
  date: string
  value: number
  unit: string
  sourceNote: string
  forceConfirm: boolean
} {
  return {
    companyId: args.companyId,
    metric: args.metric,
    date: new Date(args.dateYmd).toISOString(),
    value: args.value,
    unit: args.unit,
    sourceNote: args.sourceNote ?? "inline:indicator-health",
    forceConfirm: args.forceConfirm,
  }
}

/** Pure — normalize a recompute payload into {ok,total} for the success line. */
export function summarizeRecompute(
  r: RecomputeSummary | null | undefined,
): { ok: number; total: number } | null {
  if (!r) return null
  const total = r.ok + r.unknown + r.failed
  return { ok: r.ok, total }
}

type Feedback =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "confirm"; warnings: string[]; anomalyWarning: string | null }
  | { kind: "saved"; recompute: { ok: number; total: number } | null }
  | { kind: "error"; message: string }

export function InlineFactEntry({
  metric,
  affectedCodes,
  companyIdByCode,
  onSaved,
}: {
  /** The hand-enterable operational metric this gap resolves to. */
  metric: string
  /** Affected company codes from the gap row (e.g. ["AZSEKER-EDEN"]). */
  affectedCodes: string[]
  /** code → DB id, loaded once by the parent from /api/companies. */
  companyIdByCode: Map<string, string>
  /** Called after a successful save so the parent re-fetches the health table. */
  onSaved: () => void
}) {
  const t = useTranslations("adminIndicatorHealth.inlineEntry")
  const locale = useLocale()
  const rule = getOperationalRule(metric)

  // Only entities we can resolve to a DB id can be written to (the POST needs
  // companyId, the gap row only carries codes).
  const resolvable = useMemo(
    () => affectedCodes.filter((c) => companyIdByCode.has(c)),
    [affectedCodes, companyIdByCode],
  )

  const [companyCode, setCompanyCode] = useState<string>(resolvable[0] ?? "")
  const [value, setValue] = useState<string>("")
  const [date, setDate] = useState<string>(() =>
    new Date().toISOString().slice(0, 10),
  )
  const [feedback, setFeedback] = useState<Feedback>({ kind: "idle" })

  if (!rule) return null

  const L = (en: string, ru: string, az: string): string =>
    locale === "az" ? az : locale === "ru" ? ru : en
  const metricLabel = L(rule.labelEn, rule.labelRu, rule.labelAz)
  const rangeText = `${rule.warnMin ?? rule.min}–${rule.warnMax ?? rule.max}`
  const vc = checkMetricValue(rule, value)

  const canSave =
    !!companyCode &&
    value.trim() !== "" &&
    vc.state !== "error" &&
    vc.state !== "nan" &&
    feedback.kind !== "saving"

  const borderTone =
    vc.state === "error" || vc.state === "nan"
      ? "border-rose-400 focus:ring-rose-300"
      : vc.state === "warn"
        ? "border-amber-400 focus:ring-amber-300"
        : "border-border focus:ring-primary/40"

  async function submit(forceConfirm: boolean) {
    const companyId = companyIdByCode.get(companyCode)
    if (!companyId || !rule) return
    setFeedback({ kind: "saving" })
    try {
      const res = await fetch("/api/operational-facts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          buildOperationalFactBody({
            companyId,
            metric: rule.metric,
            unit: rule.unit,
            dateYmd: date,
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
          anomalyWarning:
            typeof json.anomalyWarning === "string"
              ? (json.anomalyWarning as string)
              : null,
        })
        return
      }
      // Saved. Surface the live recompute count + refresh the parent table.
      const recompute = summarizeRecompute(
        json.recompute as RecomputeSummary | null | undefined,
      )
      setFeedback({ kind: "saved", recompute })
      setValue("")
      onSaved()
    } catch (err) {
      setFeedback({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // No resolvable entity → the inline path can't write; the row still shows the
  // import / data-sources CTAs above, so just explain why inline is unavailable.
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
      data-testid="inline-fact-entry"
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
            data-testid="inline-fact-company"
          >
            {resolvable.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        {/* Metric (read-only — fixed by the gap) */}
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground/70">
            {t("metric")}
          </span>
          <span
            className="flex h-7 items-center rounded border border-dashed border-border bg-background/60 px-1.5 text-[11px]"
            title={rule.metric}
          >
            {metricLabel}
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
            placeholder={rangeText}
            className={`h-7 w-28 rounded border bg-background px-1.5 text-[11px] tabular-nums outline-none focus:ring-2 ${borderTone}`}
            data-testid="inline-fact-value"
          />
        </label>

        {/* Date */}
        <label className="flex flex-col gap-0.5">
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground/70">
            {t("date")}
          </span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="h-7 rounded border border-border bg-background px-1.5 text-[11px]"
            data-testid="inline-fact-date"
          />
        </label>

        {/* Save */}
        {feedback.kind !== "confirm" && (
          <button
            type="button"
            disabled={!canSave}
            onClick={() => submit(false)}
            className="inline-flex h-7 items-center gap-1 rounded-md bg-primary px-2.5 text-[11px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
            data-testid="inline-fact-save"
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

      {/* Live validation hint for hard-out-of-range. */}
      {(vc.state === "error" || vc.state === "nan") && value.trim() !== "" && (
        <p className="mt-1.5 text-[10px] text-rose-500">
          {vc.state === "nan"
            ? t("notANumber")
            : t("outOfRange", { min: rule.min, max: rule.max })}
        </p>
      )}

      {/* Confirm step — soft-bound / anomaly. */}
      {feedback.kind === "confirm" && (
        <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2 dark:border-amber-500/30 dark:bg-amber-500/10">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-amber-800 dark:text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5" />
            {t("confirmTitle")}
          </div>
          {(feedback.warnings.length > 0 || feedback.anomalyWarning) && (
            <ul className="mt-1 list-disc pl-4 text-[10px] text-amber-700 dark:text-amber-200/90">
              {feedback.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
              {feedback.anomalyWarning && <li>{feedback.anomalyWarning}</li>}
            </ul>
          )}
          <div className="mt-1.5 flex gap-2">
            <button
              type="button"
              onClick={() => submit(true)}
              className="inline-flex h-6 items-center rounded bg-amber-600 px-2 text-[10px] font-medium text-white hover:bg-amber-700"
              data-testid="inline-fact-confirm"
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

      {/* Saved — show the live recompute result. */}
      {feedback.kind === "saved" && (
        <p
          className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400"
          data-testid="inline-fact-saved"
        >
          <Check className="h-3 w-3" />
          {feedback.recompute
            ? t("savedRecomputed", {
                ok: feedback.recompute.ok,
                total: feedback.recompute.total,
              })
            : t("saved")}
        </p>
      )}

      {/* Error. */}
      {feedback.kind === "error" && (
        <p className="mt-1.5 text-[10px] text-rose-500" data-testid="inline-fact-error">
          {t("error", { message: feedback.message })}
        </p>
      )}
    </div>
  )
}
