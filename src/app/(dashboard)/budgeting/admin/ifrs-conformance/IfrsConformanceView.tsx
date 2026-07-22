"use client"
/**
 * Phase 7.N — client view for the post-import IFRS conformance check.
 *
 * Pick a company → fetch GET /api/companies/[id]/ifrs-check → render the
 * IAS 1 structural checks as a pass/warn/fail/skip checklist with a 0-100
 * conformance score. All numbers come from the API (real imported figures);
 * this component only formats + localises them.
 *
 * Styling: this is a LIGHT admin surface (with dark-mode support), so status
 * colours use solid "soft badge" tones — saturated text on a pale tint in
 * light, light text on a dark tint in dark — never the dark-terminal opacity
 * tints (which read as washed-out pastels on white).
 */
import { useCallback, useState } from "react"
import { useTranslations, useLocale } from "next-intl"
import { CheckCircle2, AlertTriangle, XCircle, MinusCircle } from "lucide-react"

type IfrsStatus = "pass" | "warn" | "fail" | "skip"

interface IfrsCheck {
  code: string
  status: IfrsStatus
  messageEn: string
  values?: Record<string, number | string>
}
interface IfrsReport {
  checks: IfrsCheck[]
  summary: { pass: number; warn: number; fail: number; skip: number; score: number | null }
}
interface IfrsResponse {
  company: { id: string; code: string; name: string }
  period: string | null
  scope: {
    status: "confirmed" | "ambiguous" | "missing"
    basis: "same_plan_ytd"
    planId: string | null
    sourcePlanCount: number
    balanceSheetRows: number
    profitAndLossRows: number
  }
  report: IfrsReport
}

export interface CompanyOption {
  id: string
  code: string
  name: string
}

interface StatusStyle {
  Icon: React.ComponentType<{ className?: string }>
  icon: string // icon colour
  badge: string // status pill (bg + text + border)
  accent: string // card left-accent border colour
  reason: string // detailed-finding text colour
}

const STATUS_STYLE: Record<IfrsStatus, StatusStyle> = {
  pass: {
    Icon: CheckCircle2,
    icon: "text-emerald-600 dark:text-emerald-400",
    badge:
      "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30",
    accent: "border-l-emerald-500",
    reason: "",
  },
  warn: {
    Icon: AlertTriangle,
    icon: "text-amber-600 dark:text-amber-400",
    badge:
      "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30",
    accent: "border-l-amber-500",
    reason: "text-amber-700 dark:text-amber-300",
  },
  fail: {
    Icon: XCircle,
    icon: "text-red-600 dark:text-red-400",
    badge:
      "bg-red-50 text-red-700 border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/30",
    accent: "border-l-red-500",
    reason: "text-red-700 dark:text-red-300",
  },
  skip: {
    Icon: MinusCircle,
    icon: "text-muted-foreground/50",
    badge: "bg-muted text-muted-foreground border-border",
    accent: "border-l-border",
    reason: "",
  },
}

function scoreColor(score: number | null): string {
  if (score == null) return "text-muted-foreground"
  if (score >= 90) return "text-emerald-600 dark:text-emerald-400"
  if (score >= 70) return "text-amber-600 dark:text-amber-400"
  return "text-red-600 dark:text-red-400"
}

/** Which `values` fields to surface per check, in display order. */
const DETAIL_FIELDS: Record<string, string[]> = {
  bs_balances: ["assets", "liabilities", "equity", "residual"],
  bs_sections: ["missing"],
  bs_current_noncurrent: ["unclassified"],
  bs_equity_composition: ["equityComponents"],
  pnl_revenue: ["revenue", "revenueAccounts"],
  pnl_cogs_opex_separation: ["cogsAccounts", "opexAccounts"],
  pnl_depreciation: ["depreciationAccounts"],
  pnl_equity_linkage: ["pnlNet", "equityCurrentYear", "linkageGap"],
}

export function IfrsConformanceView({ companies }: { companies: CompanyOption[] }) {
  const t = useTranslations("adminIfrs")
  const locale = useLocale()
  const [selectedId, setSelectedId] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<IfrsResponse | null>(null)

  const nf = new Intl.NumberFormat(locale === "az" ? "az-AZ" : locale === "ru" ? "ru-RU" : "en-US", {
    maximumFractionDigits: 0,
  })

  const run = useCallback(
    async (companyId: string) => {
      if (!companyId) return
      setLoading(true)
      setError(null)
      setResult(null)
      try {
        const res = await fetch(`/api/companies/${companyId}/ifrs-check`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        setResult((await res.json()) as IfrsResponse)
      } catch {
        setError(t("errorGeneric"))
      } finally {
        setLoading(false)
      }
    },
    [t],
  )

  const allSkipped = result != null && result.report.summary.score == null

  function fieldValue(field: string, values?: Record<string, number | string>): string {
    if (!values || values[field] === undefined) return "—"
    const v = values[field]
    if (field === "missing" || field === "unclassified") {
      return v === "—" || v === "" ? t("fields.none") : String(v)
    }
    return typeof v === "number" ? nf.format(v) : String(v)
  }

  /** Pre-format numeric values to localized strings for reason interpolation. */
  function fmtValues(values?: Record<string, number | string>): Record<string, string> {
    const out: Record<string, string> = {}
    if (!values) return out
    for (const [k, v] of Object.entries(values)) out[k] = typeof v === "number" ? nf.format(v) : String(v)
    return out
  }

  /** Map a non-pass (code, status) to its stable reason code; null for pass/skip. */
  function reasonCode(code: string, status: IfrsStatus, values?: Record<string, number | string>): string | null {
    if (status === "pass" || status === "skip") return null
    switch (code) {
      case "bs_balances":
        return "out_of_balance"
      case "bs_sections":
        return "missing_sections"
      case "bs_current_noncurrent":
        return "no_split"
      case "bs_equity_composition":
        return "equity_lumped"
      case "pnl_revenue":
        return status === "fail" ? "no_revenue_accounts" : "revenue_zero"
      case "pnl_cogs_opex_separation":
        if (status === "fail") return "no_cost_accounts"
        return Number(values?.cogsAccounts ?? 0) > 0 ? "only_cogs" : "only_opex"
      case "pnl_depreciation":
        return "no_da_line"
      case "pnl_equity_linkage":
        return "linkage_gap"
      default:
        return null
    }
  }

  /** Localized, detailed finding for a non-pass check (what's wrong + numbers). */
  function reasonText(c: IfrsCheck): string | null {
    const rc = reasonCode(c.code, c.status, c.values)
    if (!rc) return null
    return t(`reasons.${rc}` as never, fmtValues(c.values) as never)
  }

  const attentionChecks = result ? result.report.checks.filter((c) => c.status === "warn" || c.status === "fail") : []

  return (
    <div data-testid="data-control-ifrs-content">
      {/* Company selector */}
      <div className="flex flex-wrap items-end gap-3 mb-6">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t("selectCompany")}</span>
          <select
            value={selectedId}
            onChange={(e) => {
              setSelectedId(e.target.value)
              if (e.target.value) void run(e.target.value)
            }}
            className="min-w-[280px] rounded-md border bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
            data-testid="ifrs-company-select"
          >
            <option value="">{t("selectPlaceholder")}</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} · {c.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => void run(selectedId)}
          disabled={!selectedId || loading}
          className="rounded-md border bg-background px-4 py-2 text-sm font-medium shadow-sm hover:bg-muted disabled:opacity-50 transition-colors"
        >
          {loading ? t("running") : t("run")}
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          {error}
        </div>
      )}

      {result && (
        <div data-testid="ifrs-result">
          <div
            className={`mb-4 rounded-md border px-3 py-2 text-xs ${
              result.scope.status === "confirmed"
                ? "border-border/70 bg-muted/30 text-muted-foreground"
                : "border-amber-300/70 bg-amber-50 text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-200"
            }`}
            data-testid="ifrs-scope-disclosure"
          >
            {result.scope.status === "confirmed"
              ? t("scope.confirmed", {
                  period: result.period ?? "—",
                  bsRows: result.scope.balanceSheetRows,
                  plRows: result.scope.profitAndLossRows,
                })
              : result.scope.status === "ambiguous"
                ? t("scope.ambiguous", {
                    count: result.scope.sourcePlanCount,
                    period: result.period ?? "—",
                  })
                : t("scope.missing")}
          </div>
          {/* Header: score + summary */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mb-5 pb-4 border-b">
            <div className="flex items-baseline gap-2">
              <span className="text-sm text-muted-foreground">{t("scoreLabel")}</span>
              <span className={`text-3xl font-bold tabular-nums ${scoreColor(result.report.summary.score)}`}>
                {result.report.summary.score == null ? "—" : `${result.report.summary.score}%`}
              </span>
            </div>
            <div className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{result.company.code}</span> · {result.company.name}
              {result.period && (
                <span className="ml-3">
                  {t("periodLabel")}: <span className="font-medium text-foreground/80">{result.period}</span>
                </span>
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              {t("summaryLine", {
                pass: result.report.summary.pass,
                warn: result.report.summary.warn,
                fail: result.report.summary.fail,
                skip: result.report.summary.skip,
              })}
            </div>
          </div>

          {/* Why isn't it 100% — detailed reasons, or an all-good note. */}
          {!allSkipped && attentionChecks.length > 0 && (
            <div
              className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 mb-4 dark:border-amber-500/30 dark:bg-amber-500/10"
              data-testid="ifrs-why"
            >
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">{t("whyTitle")}</p>
              </div>
              <p className="text-xs text-amber-700/80 dark:text-amber-200/70 mt-1">
                {t("whyIntro", { n: attentionChecks.length })}
              </p>
              <ul className="mt-2.5 space-y-2">
                {attentionChecks.map((c) => {
                  const s = STATUS_STYLE[c.status]
                  return (
                    <li key={c.code} className="text-xs flex gap-2">
                      <s.Icon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${s.icon}`} />
                      <span className="text-foreground/80">
                        <span className="font-semibold text-foreground">
                          {t(`checks.${c.code}.label` as never)}
                        </span>
                        {" — "}
                        {reasonText(c)}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
          {!allSkipped && attentionChecks.length === 0 && (
            <div
              className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 mb-4 text-sm font-medium text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200"
              data-testid="ifrs-allgood"
            >
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              {t("allGood")}
            </div>
          )}

          {allSkipped ? (
            <div className="rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
              {result.scope.status === "ambiguous"
                ? t("scope.noResult")
                : t("noStatements")}
            </div>
          ) : (
            <ul className="space-y-2.5">
              {result.report.checks.map((c) => {
                const s = STATUS_STYLE[c.status]
                const fields = DETAIL_FIELDS[c.code] ?? []
                return (
                  <li
                    key={c.code}
                    className={`rounded-lg border border-l-4 bg-card shadow-sm p-4 ${s.accent} ${
                      c.status === "skip" ? "opacity-60" : ""
                    }`}
                    data-testid={`ifrs-check-${c.code}`}
                  >
                    <div className="flex items-start gap-3">
                      <s.Icon className={`w-5 h-5 mt-0.5 shrink-0 ${s.icon}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm text-foreground">
                            {t(`checks.${c.code}.label` as never)}
                          </span>
                          <span
                            className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${s.badge}`}
                            data-testid={`ifrs-status-${c.code}`}
                          >
                            {t(`status.${c.status}` as never)}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground/80 font-mono">
                            {t(`standard.${c.code}` as never)}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1.5 leading-snug">
                          {t(`checks.${c.code}.desc` as never)}
                        </p>
                        {c.status !== "skip" && c.status !== "pass" && reasonText(c) && (
                          <p
                            className={`text-xs mt-2 leading-snug font-medium ${s.reason}`}
                            data-testid={`ifrs-reason-${c.code}`}
                          >
                            {reasonText(c)}
                          </p>
                        )}
                        {c.status !== "skip" && fields.length > 0 && (
                          <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3 pt-3 border-t border-dashed">
                            {fields.map((f) => (
                              <span key={f} className="text-[11px] text-muted-foreground">
                                {t(`fields.${f}` as never)}:{" "}
                                <span className="font-semibold tabular-nums text-foreground/90">
                                  {fieldValue(f, c.values)}
                                </span>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
