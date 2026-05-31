"use client"
/**
 * Phase 7.M Tier 4 (2026-05-19) — Risk Terminal strategic-context card.
 *
 * Shows aggregated strategic context for the active company:
 *   • Strategic description + competitive advantage (Phase 7.M Tier 3
 *     parsed from Təsvir sheet)
 *   • Land registry summary (hectares, regions, expiring contracts)
 *   • CAPEX initiatives summary (top 5 by amount, OPEX/CAPEX split)
 *   • Forward forecast 2027-2035 (10-year revenue projection from İcmal)
 *
 * Renders nothing when none of these are populated (graceful empty state).
 */
import React, { useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"

interface LandSummary {
  parcelCount: number
  totalHectares: number
  totalAnnualRentAzn: number
  regions: string[]
  contractsExpiringWithinYears: number
}

interface CapexTopItem {
  description: string
  amountAzn: number
  type: "CAPEX" | "OPEX"
  category: string | null
}

interface CapexSummary {
  totalItems: number
  totalAzn: number
  capexCount: number
  opexCount: number
  topByAmount: CapexTopItem[]
}

interface ForwardForecast {
  source: string
  hasTerminalValue: boolean
  years: Array<{
    year: number
    totalRevenueAzn: number
    topBu: { businessUnit: string; revenueAzn: number } | null
  }>
}

interface RiskRegistry {
  itemCount: number
  source: string | null
  importedAt: string | null
  pendingVerification: boolean
}

interface StrategicContext {
  companyCode: string
  companyName: string
  strategicDescription: string | null
  competitiveAdvantage: string | null
  landSummary: LandSummary | null
  capexSummary: CapexSummary | null
  forwardForecast: ForwardForecast | null
  riskRegistry: RiskRegistry | null
  hasAnyContent: boolean
}

function fmtAZN(v: number): string {
  if (!Number.isFinite(v)) return "—"
  if (v >= 1e9) return `₼${(v / 1e9).toFixed(1)}B`
  if (v >= 1e6) return `₼${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `₼${(v / 1e3).toFixed(0)}K`
  return `₼${v.toFixed(0)}`
}

/** Localize Azerbaijani crop/business-unit names from the farming strategy
 *  spreadsheet (İcmal). The source is Azeri; RU + EN get readable labels, and
 *  the AZ view keeps the original spreadsheet term. Unknown names pass through. */
const BU_LABELS: Record<string, { ru: string; en: string }> = {
  "Buğda":              { ru: "Пшеница",     en: "Wheat" },
  "Tekstil":            { ru: "Хлопок",      en: "Cotton" },
  "Pambıq":             { ru: "Хлопок",      en: "Cotton" },
  "Şəkər çuğunduru":    { ru: "Сах. свёкла", en: "Sugar beet" },
  "Qarğıdalı":          { ru: "Кукуруза",    en: "Maize" },
  "Arpa":               { ru: "Ячмень",      en: "Barley" },
  "Torpaq icarəsi":     { ru: "Аренда земли", en: "Land lease" },
  "Lab services":       { ru: "Лаб. услуги", en: "Lab services" },
  "Yem":                { ru: "Корма",       en: "Feed" },
  "Digər":              { ru: "Прочее",      en: "Other" },
}
function localBu(raw: string, locale: string): string {
  const m = BU_LABELS[raw]
  if (!m) return raw
  if (locale === "en") return m.en
  if (locale === "ru") return m.ru
  return raw // az → original spreadsheet term
}

export function CompanyStrategicContextCard({
  companyCode,
}: {
  companyCode: string
}) {
  const t = useTranslations("terminal")
  const locale = useLocale()
  const [data, setData] = useState<StrategicContext | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!companyCode) return
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(
      `/api/terminal/strategic-context/${encodeURIComponent(companyCode)}`,
    )
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const body = (await r.json()) as StrategicContext
        if (!cancelled) setData(body)
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
  }, [companyCode])

  if (loading && !data) {
    return (
      <div className="text-[10px] text-gray-600 italic">
        {t("strategicContext.loading")}
      </div>
    )
  }
  if (error) {
    return (
      <div className="text-[10px] text-red-400">
        {t("strategicContext.loadError", { error })}
      </div>
    )
  }
  if (!data || !data.hasAnyContent) return null

  return (
    <div className="space-y-3 text-[11px]">
      <div className="text-[10px] text-gray-500 uppercase tracking-wider font-bold">
        {t("strategicContext.title")}
      </div>

      {/* ── Strategic description ──────────────────────────────── */}
      {/* 2026-05-28 — replaced banned `border-l-2 border-blue-500/40`
          side-stripe (impeccable absolute ban) with full hairline border
          + faint blue bg tint. Same visual grouping, no side stripe. */}
      {data.strategicDescription && (
        <div className="rounded border border-blue-500/20 bg-blue-500/5 px-2 py-1.5">
          <div className="text-[9px] text-blue-300/80 uppercase mb-1">
            {t("strategicContext.businessModel")}
          </div>
          <div className="text-gray-300 leading-snug">
            {data.strategicDescription}
          </div>
          {data.competitiveAdvantage && (
            <div className="mt-1 text-[10px] text-blue-300 italic">
              💡 {data.competitiveAdvantage}
            </div>
          )}
        </div>
      )}

      {/* ── Land summary (EDEN only) ───────────────────────────── */}
      {data.landSummary && (
        <div className="rounded border border-emerald-500/20 bg-emerald-500/5 px-2 py-1.5">
          <div className="text-[9px] text-emerald-300/80 uppercase mb-1">
            {t("strategicContext.landRegistry")}
          </div>
          <div className="text-gray-300">
            <span className="text-emerald-300 font-mono font-bold">
              {data.landSummary.totalHectares.toLocaleString(undefined, {
                maximumFractionDigits: 0,
              })}{" "}
              ha
            </span>{" "}
            {t("strategicContext.leased")} · {data.landSummary.parcelCount}{" "}
            {t("strategicContext.parcels")} ·{" "}
            {fmtAZN(data.landSummary.totalAnnualRentAzn)}
            {t("strategicContext.perYear")}
          </div>
          <div className="text-gray-500 text-[10px] mt-0.5">
            {t("strategicContext.regionsLabel")} {data.landSummary.regions.join(", ")}
          </div>
          {data.landSummary.contractsExpiringWithinYears > 0 && (
            <div className="text-amber-300 text-[10px] mt-0.5">
              {t("strategicContext.contractsExpiring", { count: data.landSummary.contractsExpiringWithinYears })}
            </div>
          )}
        </div>
      )}

      {/* ── CAPEX summary ──────────────────────────────────────── */}
      {data.capexSummary && (
        <div className="rounded border border-amber-500/20 bg-amber-500/5 px-2 py-1.5">
          <div className="text-[9px] text-amber-300/80 uppercase mb-1">
            🏗 CAPEX 2026
          </div>
          <div className="text-gray-300">
            <span className="text-amber-300 font-mono font-bold">
              {fmtAZN(data.capexSummary.totalAzn)}
            </span>{" "}
            · {data.capexSummary.totalItems} initiatives (
            {data.capexSummary.capexCount} CAPEX +{" "}
            {data.capexSummary.opexCount} OPEX)
          </div>
          <div className="mt-1 space-y-0.5">
            {data.capexSummary.topByAmount.slice(0, 3).map((item, i) => (
              <div
                key={i}
                className="text-[10px] text-gray-400 flex justify-between gap-2"
              >
                <span className="truncate">{item.description}</span>
                <span className="text-amber-300 font-mono shrink-0">
                  {fmtAZN(item.amountAzn)}
                </span>
              </div>
            ))}
            {data.capexSummary.topByAmount.length > 3 && (
              <div className="text-[9px] text-gray-600 italic">
                ... +{data.capexSummary.topByAmount.length - 3} more
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Forward forecast ───────────────────────────────────── */}
      {data.forwardForecast && data.forwardForecast.years.length > 0 && (
        <div className="rounded border border-purple-500/20 bg-purple-500/5 px-2 py-1.5">
          <div className="text-[9px] text-purple-300/80 uppercase mb-1 flex items-baseline gap-2 flex-wrap">
            <span>📈 Forward forecast (consolidated holding)</span>
            {data.forwardForecast.hasTerminalValue && (
              <span className="text-purple-300">+ Terminal value</span>
            )}
            <span className="text-gray-600 normal-case not-italic text-[8px]">
              {t("strategicContext.sourceLabel", { source: data.forwardForecast.source ?? "EDEN İcmal" })}
            </span>
          </div>
          <div className="space-y-0.5">
            {data.forwardForecast.years.slice(0, 5).map((y) => (
              <div
                key={y.year}
                className="text-[10px] text-gray-400 flex justify-between gap-2"
              >
                <span className="font-mono">{y.year}</span>
                <span className="text-purple-300 font-mono">
                  {fmtAZN(y.totalRevenueAzn)}
                </span>
                {y.topBu && (
                  <span
                    className="text-gray-500 truncate text-right"
                    title={y.topBu.businessUnit}
                  >
                    {localBu(y.topBu.businessUnit, locale)}
                  </span>
                )}
              </div>
            ))}
            {data.forwardForecast.years.length > 5 && (
              <div className="text-[9px] text-gray-600 italic">
                ... +{data.forwardForecast.years.length - 5} more years
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Risk Registry (Phase 8 A1) ────────────────────────────
          Renders for every level-2 operational entity. When the
          KRI list is empty (5 of 6 entities today), shows a clear
          «Pending client verification» badge so finance users don't
          confuse «no data» with «no risks». EDEN's 15 real KRIs show
          a count instead. */}
      {data.riskRegistry && (
        <div
          className={`rounded border px-2 py-1.5 ${
            data.riskRegistry.pendingVerification
              ? "border-rose-500/30 bg-rose-500/5"
              : "border-emerald-500/20 bg-emerald-500/5"
          }`}
          data-testid="risk-registry-section"
        >
          <div
            className={`text-[9px] uppercase mb-1 flex items-baseline gap-2 flex-wrap ${
              data.riskRegistry.pendingVerification
                ? "text-rose-300/80"
                : "text-emerald-300/80"
            }`}
          >
            <span>📑 Risk Registry (KRI)</span>
            {data.riskRegistry.source && (
              <span className="text-gray-600 normal-case not-italic text-[8px]">
                {t("strategicContext.sourceLabel", { source: data.riskRegistry.source })}
              </span>
            )}
          </div>
          {data.riskRegistry.pendingVerification ? (
            <div
              className="text-rose-300 text-[11px] leading-snug"
              data-testid="risk-registry-pending"
            >
              {t("strategicContext.riskPending")}
            </div>
          ) : (
            <div className="text-emerald-300 text-[11px]">
              <span className="font-mono font-bold">
                {data.riskRegistry.itemCount}
              </span>{" "}
              {t("strategicContext.kriEntered")}
              {data.riskRegistry.importedAt && (
                <span className="text-gray-500 text-[10px] ml-1.5">
                  · {new Date(data.riskRegistry.importedAt).toLocaleDateString()}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
