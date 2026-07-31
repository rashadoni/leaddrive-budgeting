"use client"
/**
 * Phase 7.L — Risk Terminal Panel 4 card showing recent feed-crossing
 * impact forecasts for the active company.
 *
 * Each forecast displays 3 scenarios (best / likely / worst) with:
 *   - projectedIndicatorValue
 *   - plDeltaAZN (signed, formatted with M/K)
 *   - drivers (arithmetic anchors)
 *   - timeHorizon
 * Plus 3 recommendations + confidence chip + trigger source link.
 *
 * Renders nothing when no forecasts exist (graceful empty state — most
 * companies will have 0 rows until a feed crossing fires).
 */
import React, { useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { getDataSourceByCode } from "@/lib/intel/sources-catalog"
import { DEFAULT_CROSSING_RULES } from "@/lib/intel/crossing-rules-default-pack"

/** Static rule-id → human name lookup (rule.name from the default pack). */
const RULE_LABEL = new Map(
  DEFAULT_CROSSING_RULES.map((r) => [r.id, r.name]),
)

/** Short localized labels for the external metric codes used in crossing rules. */
const METRIC_LABELS: Record<string, { ru: string; en: string; az: string }> = {
  FAO_FFPI_NOMINAL: { ru: "Индекс прод. цен FAO", en: "FAO food price index", az: "FAO ərzaq qiymət indeksi" },
  FAO_MEAT_INDEX: { ru: "FAO: мясо", en: "FAO: meat", az: "FAO: ət" },
  FAO_DAIRY_INDEX: { ru: "FAO: молочка", en: "FAO: dairy", az: "FAO: süd" },
  FAO_CEREAL_INDEX: { ru: "FAO: зерновые", en: "FAO: cereals", az: "FAO: taxıl" },
  FAO_OILS_INDEX: { ru: "FAO: масла", en: "FAO: oils", az: "FAO: yağlar" },
  FAO_SUGAR_INDEX: { ru: "FAO: сахар", en: "FAO: sugar", az: "FAO: şəkər" },
  BRENT_USD_BBL: { ru: "Brent нефть", en: "Brent crude", az: "Brent neft" },
  AZN_USD: { ru: "Курс AZN/USD", en: "AZN/USD rate", az: "AZN/USD məzənnəsi" },
  AZ_CPI_FOOD: { ru: "ИПЦ продовольствие AZ", en: "AZ food CPI", az: "AZ ərzaq İSİ" },
}
function localMetric(code: string, locale: string): string {
  const m = METRIC_LABELS[code]
  if (!m) return code
  if (locale === "en") return m.en
  if (locale === "az") return m.az
  return m.ru
}

interface ImpactScenario {
  projectedIndicatorValue: number
  plDeltaAZN: number
  deltaPct: number
  drivers: string[]
  timeHorizon: string
}

interface RelatedNewsItem {
  id: string
  title: string
  url: string
  sourceLabel: string
  publishedAt: string | null
  relevanceScore: number
}

interface ImpactForecastRow {
  id: string
  triggerSourceCode: string
  triggerMetric: string
  triggerValueRounded: number
  triggerObservedAt: string
  ruleId: string
  scenarios: { best: ImpactScenario; likely: ImpactScenario; worst: ImpactScenario }
  recommendations: string[]
  confidence: "low" | "medium" | "high"
  language: string
  generatedAt: string
  relatedNews?: RelatedNewsItem[]
}

function fmtAZN(v: number): string {
  if (!Number.isFinite(v)) return "—"
  const abs = Math.abs(v)
  const sign = v < 0 ? "-" : v > 0 ? "+" : ""
  if (abs >= 1e9) return `${sign}₼${(abs / 1e9).toFixed(1)}B`
  if (abs >= 1e6) return `${sign}₼${(abs / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `${sign}₼${(abs / 1e3).toFixed(0)}K`
  return `${sign}₼${abs.toFixed(0)}`
}

function fmtDate(iso: string): string {
  return iso.slice(0, 10)
}

function ScenarioBlock({
  label,
  scenario,
  tone,
}: {
  label: string
  scenario: ImpactScenario
  tone: "best" | "likely" | "worst"
}) {
  const colorByTone = {
    best: "text-emerald-400 border-emerald-500/30 bg-emerald-500/5",
    likely: "text-amber-400 border-amber-500/30 bg-amber-500/5",
    worst: "text-red-400 border-red-500/30 bg-red-500/5",
  }
  return (
    <div className={`rounded border px-2 py-1.5 ${colorByTone[tone]}`}>
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="text-[9px] uppercase tracking-wider font-semibold opacity-80">
          {label}
        </span>
        <span className="text-[10px] text-gray-500">{scenario.timeHorizon}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-bold tabular-nums">
          {fmtAZN(scenario.plDeltaAZN)}
        </span>
        <span className="text-[10px] text-gray-500 tabular-nums">
          ({scenario.deltaPct >= 0 ? "+" : ""}
          {scenario.deltaPct.toFixed(1)}%)
        </span>
      </div>
      <ul className="mt-1 text-[10px] text-gray-400 leading-snug space-y-0.5">
        {scenario.drivers.slice(0, 3).map((d, i) => (
          <li key={i} className="break-words">
            · {d}
          </li>
        ))}
      </ul>
    </div>
  )
}

function ConfidenceChip({ confidence }: { confidence: "low" | "medium" | "high" }) {
  const t = useTranslations("terminal")
  const config = {
    high: { label: t("impactForecasts.confHigh"), cls: "bg-emerald-500/20 text-emerald-300" },
    medium: { label: t("impactForecasts.confMed"), cls: "bg-amber-500/20 text-amber-300" },
    low: { label: t("impactForecasts.confLow"), cls: "bg-gray-500/20 text-gray-400" },
  }
  const c = config[confidence]
  return (
    <span
      className={`inline-block px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider font-semibold ${c.cls}`}
    >
      {c.label}
    </span>
  )
}

function ForecastItem({ row }: { row: ImpactForecastRow }) {
  const t = useTranslations("terminal")
  const locale = useLocale()
  const source = getDataSourceByCode(row.triggerSourceCode)
  // Crossing-rule names ship English-only in the default pack. Prefer a
  // localized catalogue entry (`terminal.impactForecasts.rules.<ruleId>`)
  // and fall back to the pack name for rules that don't have one yet.
  const ruleKey = `impactForecasts.rules.${row.ruleId}`
  const ruleLabel = t.has(ruleKey as never)
    ? t(ruleKey as never)
    : (RULE_LABEL.get(row.ruleId) ?? row.ruleId)
  return (
    <article className="border border-gray-800 rounded p-2 bg-[#050814]">
      <header className="flex items-center justify-between gap-2 mb-1.5">
        <div className="text-[10px] text-gray-400 truncate flex-1" title={`${row.triggerMetric} · ${row.ruleId}`}>
          <span className="text-[#00D4AA] font-semibold">
            {localMetric(row.triggerMetric, locale)}
          </span>{" "}
          @ {row.triggerValueRounded}{" "}
          <span className="text-gray-600">·</span>{" "}
          <span className="text-gray-400">{ruleLabel}</span>
        </div>
        <ConfidenceChip confidence={row.confidence} />
      </header>

      <div className="grid grid-cols-3 gap-1.5 mb-2">
        <ScenarioBlock label={t("impactForecasts.scenarioBest")} scenario={row.scenarios.best} tone="best" />
        <ScenarioBlock
          label={t("impactForecasts.scenarioLikely")}
          scenario={row.scenarios.likely}
          tone="likely"
        />
        <ScenarioBlock
          label={t("impactForecasts.scenarioWorst")}
          scenario={row.scenarios.worst}
          tone="worst"
        />
      </div>

      <div className="border-t border-gray-800/60 pt-1.5">
        <div className="text-[9px] uppercase tracking-wider text-gray-500 mb-0.5">
          {t("impactForecasts.recommendations")}
        </div>
        <ol className="text-[11px] text-gray-300 space-y-0.5 list-decimal list-inside">
          {row.recommendations.map((r, i) => (
            <li key={i} className="break-words">
              {r}
            </li>
          ))}
        </ol>
      </div>

      {/*
        Phase 7.L 2026-05-18 — restore the clickable news citations that
        users had on the older intel feed surface. Two blocks:
          1. "Связанные новости" — 0-3 IntelItem rows whose industryTag
             matches the affected company's industry and that were
             published within ±14 days of the trigger observation. Each
             title is a real outbound link (target=_blank).
          2. Footer — vendor source name is now itself a clickable
             link (to sources-catalog.vendorUrl) so admins can audit
             the underlying feed without leaving the terminal.
      */}
      {row.relatedNews && row.relatedNews.length > 0 && (
        <div className="mt-1.5 border-t border-gray-800/60 pt-1.5">
          <div className="text-[9px] uppercase tracking-wider text-gray-500 mb-0.5">
            {t("impactForecasts.relatedNews")}
          </div>
          <ul className="text-[11px] text-gray-300 space-y-1">
            {row.relatedNews.map((n) => (
              <li key={n.id} className="leading-snug">
                <a
                  href={n.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#00D4AA] hover:underline break-words"
                >
                  {n.title}
                </a>
                <span className="text-[9px] text-gray-600 ml-1">
                  · {n.sourceLabel}
                  {n.publishedAt ? ` · ${fmtDate(n.publishedAt)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <footer className="mt-1.5 flex justify-between items-center text-[9px] text-gray-600">
        <span>
          {source?.vendorUrl ? (
            <a
              href={source.vendorUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-[#00D4AA] hover:underline"
            >
              {source.displayNameRu}
            </a>
          ) : (
            <span>{source ? source.displayNameRu : row.triggerSourceCode}</span>
          )}
          {" · "}
          {fmtDate(row.triggerObservedAt)}
        </span>
        <span className="font-mono">{fmtDate(row.generatedAt)}</span>
      </footer>
    </article>
  )
}

export function CompanyImpactForecastsCard({
  companyCode,
}: {
  companyCode: string
}) {
  const locale = useLocale()
  const t = useTranslations("terminal")
  // Phase 7.L 2026-05-18 — filter forecasts by current UI locale so a
  // RU user doesn't see EN narratives. If no row exists for the
  // current locale, empty state surfaces; admin can re-run the scan
  // via /budgeting/admin/data-sources button to generate it.
  const langParam: "en" | "ru" | "az" =
    locale === "en" || locale === "az" ? locale : "ru"
  const [rows, setRows] = useState<ImpactForecastRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Phase 7.L 2026-05-18 — bump counter to force re-fetch when the
  // user clicks the "Импакт" hotkey toolbar button. HotkeyToolbar
  // fires `terminal:impact-scan-done` on scan completion → this
  // component re-fetches without a page reload.
  const [refetchTick, setRefetchTick] = useState(0)
  useEffect(() => {
    const handler = () => setRefetchTick((t) => t + 1)
    window.addEventListener("terminal:impact-scan-done", handler)
    return () => window.removeEventListener("terminal:impact-scan-done", handler)
  }, [])

  useEffect(() => {
    if (!companyCode) return
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(
      `/api/terminal/impact-forecasts/${encodeURIComponent(companyCode)}?limit=3&language=${langParam}`,
    )
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const data = (await r.json()) as { forecasts: ImpactForecastRow[] }
        if (!cancelled) setRows(data.forecasts ?? [])
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [companyCode, langParam, refetchTick])

  if (loading && rows.length === 0) {
    return (
      <div className="text-[10px] text-gray-600 italic">
        {t("impactForecasts.loading")}
      </div>
    )
  }
  if (error) {
    return (
      <div className="text-[10px] text-red-500">
        {t("impactForecasts.loadError", { error })}
      </div>
    )
  }
  if (rows.length === 0) {
    return (
      <div className="text-[10px] text-gray-600 italic leading-relaxed">
        {t("impactForecasts.emptyState")}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">
        {t("impactForecasts.title", { count: rows.length })}
      </div>
      {rows.map((r) => (
        <ForecastItem key={r.id} row={r} />
      ))}
    </div>
  )
}
