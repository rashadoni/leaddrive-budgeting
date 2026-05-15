"use client"

/**
 * Phase 7.I — Agro / Sugar pilot dashboard pop-out panel.
 *
 * Surfaces per-company operational reality for AzerSheker (or any
 * `agro_crops` / `food_processing` company): yield-per-hectare trend,
 * sugar-content trend, hectares planted by region, recent agronomy
 * entries. Reads OperationalFact + Company.settings; no new API surface.
 *
 * Visible only when the active company's industry is agro_crops or
 * food_processing — for other industries the panel renders a neutral
 * "not applicable" hint instead of generic fallbacks.
 */

import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { useSession } from "next-auth/react"
import { useTerminalStore } from "../store/terminalStore"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Sparkline } from "./Sparkline"
import { Loader2, Sprout, Droplets, Beaker, MapPin } from "lucide-react"

interface OperationalFact {
  metric: string
  date: string
  value: number
  unit: string | null
}

interface CompanySettings {
  industry: string | null
  settings: Record<string, unknown>
}

const AGRO_INDUSTRIES = new Set(["agro_crops", "food_processing"])
const TRACKED_METRICS = [
  "yield_per_ha",
  "sugar_content_pct",
  "water_use_m3_per_ha",
  "fertilizer_kg_per_ha",
  "extraction_rate_pct",
  "harvest_tons",
] as const

interface MetricSeries {
  metric: string
  values: (number | null)[] // 12 trailing slots, oldest first
  latest: number | null
  unit: string | null
}

function buildSeries(facts: OperationalFact[], metric: string): MetricSeries {
  const matching = facts
    .filter((f) => f.metric === metric)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
  const last12 = matching.slice(-12)
  const values: (number | null)[] = Array(Math.max(12 - last12.length, 0))
    .fill(null)
    .concat(last12.map((f) => f.value))
  return {
    metric,
    values: values.slice(-12),
    latest: last12.length > 0 ? last12[last12.length - 1].value : null,
    unit: last12.length > 0 ? last12[last12.length - 1].unit : null,
  }
}

function fmtNum(n: number | null, fractionDigits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—"
  return n.toFixed(fractionDigits)
}

const METRIC_LABEL: Record<(typeof TRACKED_METRICS)[number], { en: string; icon: typeof Sprout }> = {
  yield_per_ha: { en: "Yield (t/ha)", icon: Sprout },
  sugar_content_pct: { en: "Sugar content (%)", icon: Beaker },
  water_use_m3_per_ha: { en: "Water (m³/ha)", icon: Droplets },
  fertilizer_kg_per_ha: { en: "Fertilizer (kg/ha)", icon: Sprout },
  extraction_rate_pct: { en: "Extraction (%)", icon: Beaker },
  harvest_tons: { en: "Harvest (tons)", icon: Sprout },
}

export function AgroDashboardPanel() {
  const { data: session } = useSession()
  const orgId = (session?.user as any)?.organizationId
  const activeCompanyCode = useTerminalStore((s) => s.activeCompanyCode)

  // Resolve company id by code via /api/companies (org-scoped).
  const { data: companies } = useQuery({
    queryKey: ["agro-companies", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const res = await fetch("/api/companies", {
        headers: { "x-organization-id": orgId },
      })
      if (!res.ok) return []
      const body = await res.json()
      return Array.isArray(body) ? body : (body.rows ?? body.companies ?? [])
    },
  })

  const activeCompany = useMemo(
    () => (companies ?? []).find((c: any) => c.code === activeCompanyCode),
    [companies, activeCompanyCode],
  )
  const activeIndustry = activeCompany?.industry as string | null | undefined

  const { data: settings } = useQuery<CompanySettings>({
    queryKey: ["agro-settings", activeCompany?.id],
    enabled: !!activeCompany?.id,
    queryFn: async () => {
      const res = await fetch(`/api/companies/${activeCompany.id}/settings`)
      return res.json()
    },
  })

  // Pull last 24 months of facts for the tracked metrics — enough for a
  // 12-slot sparkline + 12-slot history. We rely on the existing
  // /api/operational-facts endpoint which already supports company + metric
  // filters.
  const { data: facts, isLoading: factsLoading } = useQuery<OperationalFact[]>({
    queryKey: ["agro-facts", activeCompany?.id],
    enabled: !!activeCompany?.id,
    queryFn: async () => {
      const url = new URL(
        `/api/operational-facts`,
        typeof window !== "undefined" ? window.location.origin : "http://localhost",
      )
      url.searchParams.set("companyId", activeCompany.id)
      const res = await fetch(url.toString())
      if (!res.ok) return []
      const body = await res.json()
      return Array.isArray(body) ? body : (body.rows ?? [])
    },
  })

  const seriesByMetric = useMemo(() => {
    const map: Record<string, MetricSeries> = {}
    for (const m of TRACKED_METRICS) {
      map[m] = buildSeries(facts ?? [], m)
    }
    return map
  }, [facts])

  if (!activeCompanyCode) {
    return (
      <div className="p-6 text-center text-sm text-gray-500">
        Select a company in the company tree to view agro dashboard.
      </div>
    )
  }

  if (activeIndustry && !AGRO_INDUSTRIES.has(activeIndustry)) {
    return (
      <div className="p-6 text-center text-sm text-gray-500">
        Agro dashboard applies to <strong>agro_crops</strong> and <strong>food_processing</strong> companies.
        <br />
        Active company {activeCompanyCode} is{" "}
        <Badge variant="outline" className="text-[10px]">
          {activeIndustry}
        </Badge>
        .
      </div>
    )
  }

  const settingsBag = (settings?.settings ?? {}) as Record<string, unknown>
  const region = typeof settingsBag.region === "string" ? settingsBag.region : null
  const cropType = typeof settingsBag.cropType === "string" ? settingsBag.cropType : null
  const hectares =
    typeof settingsBag.hectaresPlanted === "number" ? settingsBag.hectaresPlanted : null
  const yieldTarget =
    typeof settingsBag.yieldTarget === "number" ? settingsBag.yieldTarget : null

  return (
    <div className="space-y-4">
      {/* Header — sector descriptor */}
      <div className="flex flex-wrap items-baseline gap-3 px-1">
        <h2 className="text-base font-bold">{activeCompany?.name ?? activeCompanyCode}</h2>
        <Badge variant="secondary" className="text-[10px]">
          {activeIndustry ?? "—"}
        </Badge>
        {cropType && (
          <span className="text-xs text-gray-400">
            <Sprout className="inline h-3 w-3 mr-1" /> {cropType}
          </span>
        )}
        {region && (
          <span className="text-xs text-gray-400">
            <MapPin className="inline h-3 w-3 mr-1" /> {region}
          </span>
        )}
        {hectares != null && (
          <span className="text-xs text-gray-400">
            {hectares.toLocaleString("en-US")} ha planted
          </span>
        )}
        {yieldTarget != null && (
          <span className="text-xs text-gray-400">target {yieldTarget} t/ha</span>
        )}
      </div>

      {factsLoading && (
        <div className="text-sm text-gray-500 flex items-center gap-2">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading agronomy data…
        </div>
      )}

      {/* Metric grid — sparklines per tracked metric */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {TRACKED_METRICS.map((m) => {
          const s = seriesByMetric[m]
          const label = METRIC_LABEL[m]
          const Icon = label.icon
          const isYield = m === "yield_per_ha"
          const onTarget =
            isYield && yieldTarget != null && s.latest != null && s.latest >= yieldTarget
          const status: "green" | "amber" | "red" | "unknown" =
            s.latest == null ? "unknown" : isYield ? (onTarget ? "green" : "amber") : "unknown"
          return (
            <Card key={m} className="bg-card/40">
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-gray-400">
                  <Icon className="h-3 w-3" />
                  {label.en}
                </div>
                <div className="text-xl font-bold tabular-nums">
                  {fmtNum(s.latest, m === "harvest_tons" ? 0 : 1)}
                  {s.unit && <span className="text-xs font-normal text-gray-500 ml-1">{s.unit}</span>}
                </div>
                <Sparkline data={s.values} status={status} compact={false} />
                <div className="text-[10px] text-gray-500">
                  {s.values.filter((v) => v != null).length} observation(s)
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Recent agronomy entries */}
      <Card>
        <CardContent className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-2">
            Recent agronomy entries
          </div>
          {(facts ?? []).length === 0 ? (
            <div className="text-xs text-gray-500">
              No OperationalFact rows yet for this company. Use{" "}
              <code className="text-[10px] bg-muted px-1 rounded">KPI GO</code> to add.
            </div>
          ) : (
            <div className="divide-y divide-gray-800/60">
              {(facts ?? [])
                .slice()
                .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                .slice(0, 8)
                .map((f, i) => (
                  <div
                    key={`${f.metric}-${f.date}-${i}`}
                    className="flex items-center gap-3 py-1.5 text-xs"
                  >
                    <span className="text-gray-500 w-20 shrink-0 tabular-nums">
                      {new Date(f.date).toISOString().slice(0, 10)}
                    </span>
                    <span className="flex-1 font-mono text-[10px] text-gray-400">{f.metric}</span>
                    <span className="tabular-nums w-20 text-right">{fmtNum(f.value, 2)}</span>
                    {f.unit && <span className="w-16 text-[10px] text-gray-500">{f.unit}</span>}
                  </div>
                ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
