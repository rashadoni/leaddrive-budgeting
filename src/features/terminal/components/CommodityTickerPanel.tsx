"use client"

/**
 * Phase 7.I — Sugar commodity + weather ticker pop-out.
 *
 * Two panes:
 *  - Sugar Price (USD/tonne) — trailing-24-month line chart, latest
 *    value + variance vs 12M mean. Source: IntelDataPoint with
 *    sourceCode='sugar-yahoo-sb-f', metric='SUGAR_RAW_USD_TONNE'.
 *  - Weather strip — per-region 90d rainfall + 30d mean temperature
 *    badges for the 3 configured Azerbaijani sugar-belt regions
 *    (Salyan / Imishli / Sabirabad).
 *
 * No new server endpoint needed — both consume /api/intel/data-points
 * which is sourceCode-agnostic.
 */

import { useMemo } from "react"
import { useTranslations } from "next-intl"
import { useQuery } from "@tanstack/react-query"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Loader2, TrendingUp, TrendingDown, Cloud, Thermometer } from "lucide-react"
import { Sparkline } from "./Sparkline"

interface DataPoint {
  metric: string
  datetime: string
  value: number
  unit: string | null
}

const SUGAR_SOURCE = "sugar-yahoo-sb-f"
const SUGAR_METRIC = "SUGAR_RAW_USD_TONNE"
const WEATHER_SOURCE = "weather-openmeteo"

const REGIONS = ["SALYAN", "IMISHLI", "SABIRABAD"] as const

function fmtNum(n: number | null, fractionDigits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—"
  return n.toLocaleString("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })
}

function meanOf(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((s, v) => s + v, 0) / values.length
}

export function CommodityTickerPanel() {
  const t = useTranslations("terminal")
  // Sugar series — 24 monthly bars
  const { data: sugarRows, isLoading: sugarLoading } = useQuery<DataPoint[]>({
    queryKey: ["intel-sugar"],
    queryFn: async () => {
      const url = new URL(
        "/api/intel/data-points",
        typeof window !== "undefined" ? window.location.origin : "http://localhost",
      )
      url.searchParams.set("sourceCode", SUGAR_SOURCE)
      url.searchParams.set("metric", SUGAR_METRIC)
      url.searchParams.set("limit", "24")
      const res = await fetch(url.toString())
      if (!res.ok) return []
      const body = await res.json()
      return body.rows ?? []
    },
  })

  const sugarSeries = useMemo(() => {
    const sorted = (sugarRows ?? [])
      .slice()
      .sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime())
    const values = sorted.map((r) => r.value)
    const latest = values.length > 0 ? values[values.length - 1] : null
    const last12 = values.slice(-12)
    const mean12 = meanOf(last12)
    const variancePct =
      latest != null && mean12 != null && mean12 !== 0
        ? ((latest - mean12) / mean12) * 100
        : null
    return { sorted, values, latest, mean12, variancePct }
  }, [sugarRows])

  // Weather rows — one fetch per region, but cached separately to keep
  // payload manageable. The query keys differ per region so React Query
  // dedupes correctly.
  const weatherQueries = REGIONS.map((region) => {
    // REGIONS is a module-level constant array, so the hook count + order is
    // invariant across renders; one useQuery per static region is safe.
    // (Cleaner long-term: a <WeatherRegionQuery> child component calling
    // useQuery once — tracked follow-up. The rule stays at error so genuine
    // violations still fail lint; only this known-safe site is exempted.)
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const { data, isLoading } = useQuery<DataPoint[]>({
      queryKey: ["intel-weather", region],
      queryFn: async () => {
        const url = new URL(
          "/api/intel/data-points",
          typeof window !== "undefined" ? window.location.origin : "http://localhost",
        )
        url.searchParams.set("sourceCode", WEATHER_SOURCE)
        url.searchParams.set("limit", "10")
        const res = await fetch(url.toString())
        if (!res.ok) return []
        const body = await res.json()
        return (body.rows ?? []).filter((r: DataPoint) =>
          r.metric.startsWith(`${region}_`),
        )
      },
    })
    return { region, data: data ?? [], loading: isLoading }
  })

  return (
    <div className="space-y-4">
      {/* Sugar price card */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">
              {t("commodityTicker.sugarTitle")}
            </h3>
            <Badge variant="outline" className="text-[10px]">
              {SUGAR_SOURCE}
            </Badge>
          </div>

          {sugarLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />{" "}
              {t("commodityTicker.loading")}
            </div>
          )}

          {!sugarLoading && sugarSeries.values.length === 0 && (
            <div className="text-sm text-muted-foreground">
              {t("commodityTicker.sugarEmpty")}
            </div>
          )}

          {sugarSeries.values.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-center">
              <div className="space-y-1">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {t("commodityTicker.latest")}
                </div>
                <div
                  data-testid="sugar-latest"
                  className="text-2xl font-bold tabular-nums"
                >
                  ${fmtNum(sugarSeries.latest, 1)}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {t("commodityTicker.unitUsdTonne")}
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {t("commodityTicker.mean12m")}
                </div>
                <div className="text-lg font-semibold tabular-nums">
                  ${fmtNum(sugarSeries.mean12, 1)}
                </div>
                {sugarSeries.variancePct != null && (
                  <div
                    className={`text-xs font-medium flex items-center gap-1 ${
                      sugarSeries.variancePct >= 0
                        ? "text-emerald-500"
                        : "text-red-500"
                    }`}
                  >
                    {sugarSeries.variancePct >= 0 ? (
                      <TrendingUp className="h-3 w-3" />
                    ) : (
                      <TrendingDown className="h-3 w-3" />
                    )}
                    {t("commodityTicker.vsMean12m", {
                      delta: `${sugarSeries.variancePct >= 0 ? "+" : ""}${fmtNum(sugarSeries.variancePct, 1)}`,
                    })}
                  </div>
                )}
              </div>
              <div className="space-y-1">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {t("commodityTicker.trailing24m")}
                </div>
                <Sparkline
                  ariaLabel={t("commodityTicker.sparklineAria")}
                  data={sugarSeries.values.slice(-24)}
                  status={
                    sugarSeries.variancePct == null
                      ? "unknown"
                      : sugarSeries.variancePct >= 0
                        ? "green"
                        : "red"
                  }
                  compact={false}
                />
                <div className="text-[10px] text-muted-foreground">
                  {t("commodityTicker.observations", {
                    count: sugarSeries.values.length,
                  })}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Weather strip */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">
              {t("commodityTicker.weatherTitle")}
            </h3>
            <Badge variant="outline" className="text-[10px]">
              {WEATHER_SOURCE}
            </Badge>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {weatherQueries.map(({ region, data, loading }) => {
              const rainfallRow = data.find((r) => r.metric === `${region}_RAINFALL_MM_90D`)
              const tempRow = data.find((r) => r.metric === `${region}_TEMP_AVG_C_30D`)
              return (
                <div
                  key={region}
                  className="rounded border border-border/60 p-2 space-y-1"
                >
                  <div className="text-[11px] font-semibold uppercase tracking-wider">
                    {region.charAt(0) + region.slice(1).toLowerCase()}
                  </div>
                  {loading && (
                    <div className="text-[10px] text-muted-foreground">
                      <Loader2 className="inline h-2.5 w-2.5 animate-spin" />{" "}
                      {t("commodityTicker.weatherLoading")}
                    </div>
                  )}
                  {!loading && !rainfallRow && !tempRow && (
                    <div className="text-[10px] text-muted-foreground">
                      {t("commodityTicker.noDataYet")}
                    </div>
                  )}
                  {rainfallRow && (
                    <div className="flex items-center gap-1.5 text-xs">
                      <Cloud className="h-3 w-3 text-blue-400" />
                      <span className="tabular-nums font-semibold">
                        {fmtNum(rainfallRow.value, 0)}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {t("commodityTicker.rainfallUnit")}
                      </span>
                    </div>
                  )}
                  {tempRow && (
                    <div className="flex items-center gap-1.5 text-xs">
                      <Thermometer className="h-3 w-3 text-orange-400" />
                      <span className="tabular-nums font-semibold">
                        {fmtNum(tempRow.value, 1)}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {t("commodityTicker.tempUnit")}
                      </span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <div className="text-[10px] text-muted-foreground">
            {t("commodityTicker.weatherSource")}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
