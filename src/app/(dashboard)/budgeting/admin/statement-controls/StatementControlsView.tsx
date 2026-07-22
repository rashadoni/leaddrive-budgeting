"use client"
/**
 * Phase 10 / B1 shadow slice — client view for the shadow statement controls.
 *
 * Pick a company (+ optional period) → fetch
 * GET /api/companies/[id]/statement-controls → render the six canonical
 * controls as per-control evidence cards. This surface deliberately carries
 * NO pass/fail vocabulary and NO red/green colouring: under the provisional
 * policy + null lineage every control is "provisional" (amber) or "blocked"
 * (neutral), and the permanent banner says so before the first run.
 *
 * The amber banner tokens (border-[#FFB800]/50 bg-[#FFB800]/10
 * text-[#FFB800]) are copied as NEW inline markup — deliberately NOT imported
 * from the terminal HeatMap (a visual-gate file this feature must not touch).
 */
import { useCallback, useState } from "react"
import { useTranslations, useLocale } from "next-intl"
import { AlertTriangle } from "lucide-react"

type DecisionStatus = "pass" | "fail" | "provisional" | "blocked"
type NumericStatus = "within_tolerance" | "outside_tolerance" | "not_evaluated"

interface ControlResult {
  code: string
  numericStatus: NumericStatus
  decisionStatus: DecisionStatus
  signedDelta: number | null
  absoluteDelta: number | null
  basisAmount: number | null
  tolerance: number | null
  materialityThreshold: number | null
  material: boolean | null
  reasons: string[]
}

interface SideSummary {
  label: string
  value: number | null
  sourceRowCount: number
  revisionId: string | null
}

interface ComponentSummary {
  component: string
  present: boolean
  value: number | null
  sourceRowCount: number
  noteKey?: string
}

interface FxRateDateSummary {
  min: string
  max: string
  staleRowCount: number
}

type ControlEntry =
  | {
      kind: "evaluated"
      code: string
      currency?: string
      result: ControlResult
      left: SideSummary
      right: SideSummary
      components: ComponentSummary[]
      notes: string[]
      fxRateDates?: FxRateDateSummary
    }
  | {
      kind: "no_evidence"
      code: string
      currency?: string
      reasonKey: string
      builderError?: { code: string; component: string }
      components: ComponentSummary[]
      notes: string[]
      fxRateDates?: FxRateDateSummary
    }

interface ControlsResponse {
  shadow: boolean
  decisionGrade: boolean
  noStatements?: boolean
  company?: { id: string; code: string; name: string }
  period: string | null
  openingPeriod?: string
  bsSignConvention?: {
    detected: "trial_balance" | "natural"
    signedResidual: number
    naturalResidual: number
    rawSums: { assets: number; liabilities: number; equity: number }
  }
  planCount?: number
  controls: ControlEntry[]
  notes?: string[]
}

export interface CompanyOption {
  id: string
  code: string
  name: string
}

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/

/** The i18n-covered blockedDetail keys — anything else renders as raw code. */
const BLOCKED_DETAIL_KEYS = new Set([
  "netChangeNotStored",
  "cashNotIdentifiable",
  "distributionsNotRecorded",
  "retainedEarningsNotIdentifiable",
  "monthIndexMissing",
  "noCurrentYearResultLine",
  "noForeignCurrencyRows",
  "noIndependentRate",
  "originalAmountMissing",
])

/** Non-blocking disclosure notes, rendered via `notes.<key>`. */
const DISCLOSURE_NOTE_KEYS = new Set(["staleIndependentRate"])

/**
 * Status chips: provisional = amber, blocked = neutral/gray. Deliberately no
 * red/green — nothing on this surface is decision-grade.
 */
const STATUS_STYLE: Record<"provisional" | "blocked", { badge: string; accent: string }> = {
  provisional: {
    badge:
      "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30",
    accent: "border-l-amber-500",
  },
  blocked: {
    badge: "bg-muted text-muted-foreground border-border",
    accent: "border-l-border",
  },
}

export default function StatementControlsView({ companies }: { companies: CompanyOption[] }) {
  const t = useTranslations("adminStatementControls")
  const locale = useLocale()
  const [selectedId, setSelectedId] = useState("")
  const [period, setPeriod] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ControlsResponse | null>(null)

  const nf = new Intl.NumberFormat(locale === "az" ? "az-AZ" : locale === "ru" ? "ru-RU" : "en-US", {
    maximumFractionDigits: 2,
  })

  const run = useCallback(
    async (companyId: string, periodValue: string) => {
      if (!companyId) return
      if (periodValue && !PERIOD_RE.test(periodValue)) {
        setError(t("errorGeneric"))
        return
      }
      setLoading(true)
      setError(null)
      setResult(null)
      try {
        const res = await fetch(
          `/api/companies/${companyId}/statement-controls${periodValue ? `?period=${periodValue}` : ""}`,
        )
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        setResult((await res.json()) as ControlsResponse)
      } catch {
        setError(t("errorGeneric"))
      } finally {
        setLoading(false)
      }
    },
    [t],
  )

  function fmt(v: number | null): string {
    return v == null ? "—" : nf.format(v)
  }

  function statusOf(entry: ControlEntry): "provisional" | "blocked" {
    // no_evidence = evidence missing = blocked; an evaluated entry can only be
    // provisional or blocked under the pinned shadow policy.
    if (entry.kind === "no_evidence") return "blocked"
    return entry.result.decisionStatus === "provisional" ? "provisional" : "blocked"
  }

  function noteText(key: string): string {
    if (DISCLOSURE_NOTE_KEYS.has(key)) return t(`notes.${key}` as never)
    return BLOCKED_DETAIL_KEYS.has(key) ? t(`blockedDetail.${key}` as never) : key
  }

  function cardTitle(entry: ControlEntry): string {
    const label = t(`controls.${entry.code}.label` as never)
    return entry.currency ? `${label} · ${entry.currency}` : label
  }

  return (
    <div>
      {/* Permanent shadow banner — rendered before the first run, always visible. */}
      <div
        className="rounded-lg border border-[#FFB800]/50 bg-[#FFB800]/10 px-4 py-3 mb-6"
        data-testid="statement-controls-shadow-banner"
        title={t("bannerTooltip")}
      >
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 text-[#FFB800]" />
          <span className="text-sm font-bold uppercase tracking-wide text-[#FFB800]">{t("banner")}</span>
        </div>
        <p className="text-xs text-muted-foreground mt-1.5 leading-snug">{t("bannerDetail")}</p>
      </div>

      {/* Company + period selectors */}
      <div className="flex flex-wrap items-end gap-3 mb-6">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t("selectCompany")}</span>
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="min-w-[280px] rounded-md border bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
            data-testid="statement-controls-company-select"
          >
            <option value="">{t("selectPlaceholder")}</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} · {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t("periodLabel")}</span>
          <input
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="rounded-md border bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
            data-testid="statement-controls-period-input"
          />
        </label>
        <button
          type="button"
          data-testid="statement-controls-run"
          onClick={() => void run(selectedId, period)}
          disabled={!selectedId || loading}
          className="rounded-md border bg-background px-4 py-2 text-sm font-medium shadow-sm hover:bg-muted disabled:opacity-50 transition-colors"
        >
          {loading ? t("running") : t("run")}
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          {error}
        </div>
      )}

      {result?.noStatements && (
        <div className="rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          {t("noStatements")}
        </div>
      )}

      {result && !result.noStatements && (
        <div data-testid="statement-controls-result">
          {/* Header: company + period + plan count */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mb-3 pb-3 border-b text-sm text-muted-foreground">
            {result.company && (
              <span>
                <span className="font-medium text-foreground">{result.company.code}</span> ·{" "}
                {result.company.name}
              </span>
            )}
            {result.period && (
              <span>
                {t("periodLabel")}: <span className="font-medium text-foreground/80">{result.period}</span>
              </span>
            )}
            {result.planCount != null && (
              <span>
                {t("planCountLabel")}:{" "}
                <span className="font-medium text-foreground/80 tabular-nums">{result.planCount}</span>
              </span>
            )}
          </div>

          {/* Sign-convention disclosure */}
          {result.bsSignConvention && (
            <p
              className="text-xs text-muted-foreground mb-5"
              data-testid="statement-controls-sign-convention"
            >
              {t("signConventionLabel")}:{" "}
              <span className="font-medium text-foreground/80">
                {t(`signConvention.${result.bsSignConvention.detected}` as never)}
              </span>
              {" — "}
              {t("residualsLine", {
                signed: nf.format(result.bsSignConvention.signedResidual),
                natural: nf.format(result.bsSignConvention.naturalResidual),
              })}
            </p>
          )}

          {/* Per-control cards */}
          <ul className="space-y-2.5">
            {result.controls.map((entry, i) => {
              const status = statusOf(entry)
              const s = STATUS_STYLE[status]
              return (
                <li
                  key={`${entry.code}-${entry.currency ?? i}`}
                  className={`rounded-lg border border-l-4 bg-card shadow-sm p-4 ${s.accent}`}
                  data-testid={`statement-control-${entry.code}`}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-foreground">{cardTitle(entry)}</span>
                    <span
                      className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${s.badge}`}
                      data-testid={`statement-control-status-${entry.code}`}
                    >
                      {t(`status.${status}` as never)}
                    </span>
                    {entry.kind === "evaluated" && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground/80 font-mono">
                        {t(`numeric.${entry.result.numericStatus}` as never)}
                      </span>
                    )}
                  </div>
                  <p className="text-xs font-mono text-muted-foreground mt-1">
                    {t(`controls.${entry.code}.equation` as never)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1.5 leading-snug">
                    {t(`controls.${entry.code}.desc` as never)}
                  </p>
                  {/* Independent-rate date range + carried-forward row count */}
                  {entry.fxRateDates && (
                    <p
                      className="text-[11px] text-muted-foreground mt-1"
                      data-testid={`statement-control-fx-rate-dates-${entry.currency ?? entry.code}`}
                    >
                      {t("fxRateDatesLine", {
                        min: entry.fxRateDates.min.slice(0, 10),
                        max: entry.fxRateDates.max.slice(0, 10),
                        stale: entry.fxRateDates.staleRowCount,
                      })}
                    </p>
                  )}

                  {entry.kind === "evaluated" && (
                    <>
                      {/* Left / right sides */}
                      <div className="flex flex-wrap gap-x-6 gap-y-1 mt-3 pt-3 border-t border-dashed text-[11px] text-muted-foreground">
                        {[entry.left, entry.right].map((side, j) => (
                          <span key={j}>
                            <span className="font-mono">{side.label}</span>:{" "}
                            <span className="font-semibold tabular-nums text-foreground/90">
                              {side.value == null ? t("evidence.missing") : nf.format(side.value)}
                            </span>{" "}
                            <span className="text-muted-foreground/70">
                              ({t("evidence.rows", { n: side.sourceRowCount })})
                            </span>
                          </span>
                        ))}
                      </div>
                      {/* Deltas + thresholds when evaluated */}
                      {(entry.result.signedDelta != null ||
                        entry.result.tolerance != null ||
                        entry.result.materialityThreshold != null) && (
                        <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2 text-[11px] text-muted-foreground">
                          {entry.result.signedDelta != null && (
                            <span>
                              {t("metrics.signedDelta")}:{" "}
                              <span className="font-semibold tabular-nums text-foreground/90">
                                {fmt(entry.result.signedDelta)}
                              </span>
                            </span>
                          )}
                          {entry.result.tolerance != null && (
                            <span>
                              {t("metrics.tolerance")}:{" "}
                              <span className="font-semibold tabular-nums">{fmt(entry.result.tolerance)}</span>
                            </span>
                          )}
                          {entry.result.basisAmount != null && (
                            <span>
                              {t("metrics.basisAmount")}:{" "}
                              <span className="font-semibold tabular-nums">{fmt(entry.result.basisAmount)}</span>
                            </span>
                          )}
                          {entry.result.materialityThreshold != null && (
                            <span>
                              {t("metrics.materialityThreshold")}:{" "}
                              <span className="font-semibold tabular-nums">
                                {fmt(entry.result.materialityThreshold)}
                              </span>
                            </span>
                          )}
                          {entry.result.material != null && (
                            <span>
                              {t("metrics.material")}:{" "}
                              <span className="font-semibold">
                                {entry.result.material ? t("metrics.yes") : t("metrics.no")}
                              </span>
                            </span>
                          )}
                        </div>
                      )}
                      {/* Reasons as human sentences */}
                      {entry.result.reasons.length > 0 && (
                        <ul className="mt-2 space-y-0.5">
                          {entry.result.reasons.map((r) => (
                            <li key={r} className="text-[11px] text-muted-foreground leading-snug">
                              · {t(`reasons.${r}` as never)}
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}

                  {entry.kind === "no_evidence" && (
                    <p className="text-xs text-muted-foreground mt-2 leading-snug" data-testid={`statement-control-reason-${entry.code}`}>
                      {entry.builderError
                        ? t("builderError", {
                            code: entry.builderError.code,
                            component: entry.builderError.component,
                          })
                        : noteText(entry.reasonKey)}
                    </p>
                  )}

                  {/* Component evidence table */}
                  {entry.components.length > 0 && (
                    <table className="mt-3 w-full text-[11px]">
                      <thead>
                        <tr className="text-left text-muted-foreground/70 border-b border-dashed">
                          <th className="py-1 pr-2 font-medium">{t("componentHeader.component")}</th>
                          <th className="py-1 pr-2 font-medium">{t("componentHeader.value")}</th>
                          <th className="py-1 pr-2 font-medium">{t("componentHeader.rows")}</th>
                          <th className="py-1 font-medium">{t("componentHeader.note")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {entry.components.map((c) => (
                          <tr key={c.component} className="border-b border-dashed last:border-0">
                            <td className="py-1 pr-2 text-foreground/90">
                              {t(`components.${c.component}` as never)}
                            </td>
                            <td className="py-1 pr-2 tabular-nums font-semibold">
                              {c.present ? nf.format(c.value ?? 0) : t("evidence.missing")}
                            </td>
                            <td className="py-1 pr-2 tabular-nums text-muted-foreground">
                              {t("evidence.rows", { n: c.sourceRowCount })}
                            </td>
                            <td className="py-1 text-muted-foreground">
                              {c.noteKey ? noteText(c.noteKey) : ""}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}

                  {/* Blocked cards name what is absent and why */}
                  {entry.notes.length > 0 && (
                    <ul className="mt-2 space-y-0.5">
                      {entry.notes.map((n) => (
                        <li key={n} className="text-[11px] text-muted-foreground leading-snug">
                          · {noteText(n)}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>

          {/* Explainer footer: why nothing can pass or fail here */}
          <div className="rounded-lg border bg-muted/40 px-4 py-3 mt-5" data-testid="statement-controls-why">
            <p className="text-sm font-semibold text-foreground">{t("whyTitle")}</p>
            <p className="text-xs text-muted-foreground mt-1 leading-snug">{t("whyBody")}</p>
            {result.notes && result.notes.length > 0 && (
              <ul className="mt-2 space-y-0.5">
                {result.notes.map((n) => (
                  <li key={n} className="text-[11px] text-muted-foreground leading-snug">
                    · {t(`limitations.${n}` as never)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
