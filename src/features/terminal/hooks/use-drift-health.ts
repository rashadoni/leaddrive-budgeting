/**
 * 2026-05-27 — Drift health monitor for Risk Terminal.
 *
 * Polls /api/admin/drift every 5 min and exposes a compact health
 * summary: stale-feed count + recent-drift-event count + the
 * sourceCode → status / ageHours map so HeatMap cells can flag inputs
 * sourced from a stale feed.
 *
 * Light polling (5 min) — drift state changes when a watchdog cron
 * runs (currently manual `Refresh now` button), not on every keystroke.
 */
import { useEffect, useState } from "react"

export type FreshnessStatus = "fresh" | "stale" | "critical_stale" | "missing"

export interface SourceFreshness {
  sourceCode: string
  cadence: "daily" | "monthly"
  ageHours: number | null
  status: FreshnessStatus
  metricCount: number
  lastFetchedAt: string | null
}

interface DriftEvent {
  id: string
  createdAt: string
  company: { id: string; code: string; name: string } | null
  drifts: Array<{ indicatorCode: string }> | null
}

interface DriftReport {
  recentDrifts: DriftEvent[]
  referenceFreshness: SourceFreshness[]
}

export interface DriftHealth {
  /** Map: source-code (e.g. "weather-openmeteo") → freshness record. */
  byCode: Map<string, SourceFreshness>
  /** Number of feeds with status `stale` or `critical_stale`. */
  staleCount: number
  /** Total recent drift events in the last 30 days. */
  driftEventCount: number
  /** Set of company.code values that have a recent drift event. */
  driftedCompanies: Set<string>
  /** Set of `${companyCode}::${indicatorCode}` pairs that drifted recently. */
  driftedCells: Set<string>
  loading: boolean
  /** Last fetch error, or null. */
  error: string | null
}

const EMPTY: DriftHealth = {
  byCode: new Map(),
  staleCount: 0,
  driftEventCount: 0,
  driftedCompanies: new Set(),
  driftedCells: new Set(),
  loading: true,
  error: null,
}

const POLL_MS = 5 * 60 * 1000

export function useDriftHealth(): DriftHealth {
  const [state, setState] = useState<DriftHealth>(EMPTY)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const res = await fetch("/api/admin/drift", { cache: "no-store" })
        if (!res.ok) {
          // Non-admin users get 403 — treat as a no-op rather than a noisy
          // error. The HealthChip simply renders «—» for them.
          if (res.status === 403) {
            if (!cancelled) setState({ ...EMPTY, loading: false })
            return
          }
          throw new Error(`HTTP ${res.status}`)
        }
        const body = (await res.json()) as DriftReport
        if (cancelled) return
        const byCode = new Map<string, SourceFreshness>()
        let staleCount = 0
        for (const s of body.referenceFreshness) {
          byCode.set(s.sourceCode, s)
          if (s.status === "stale" || s.status === "critical_stale") staleCount++
        }
        const driftedCompanies = new Set<string>()
        const driftedCells = new Set<string>()
        for (const ev of body.recentDrifts) {
          if (ev.company?.code) {
            driftedCompanies.add(ev.company.code)
            for (const d of ev.drifts ?? []) {
              driftedCells.add(`${ev.company.code}::${d.indicatorCode}`)
            }
          }
        }
        setState({
          byCode,
          staleCount,
          driftEventCount: body.recentDrifts.length,
          driftedCompanies,
          driftedCells,
          loading: false,
          error: null,
        })
      } catch (e) {
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            loading: false,
            error: e instanceof Error ? e.message : String(e),
          }))
        }
      }
    }

    load()
    const id = setInterval(load, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  return state
}

/**
 * Map an indicator's `requiredInputs[]` element (e.g.
 * "weather:rainfall_mm_90d", "commodityPrice:sugar_price_stdev_12m",
 * "currencyRate") to the external-feed sourceCode that supplies it.
 *
 * Returns null when the input is internal (`budgetLine`, `counterparty`,
 * `operationalFact:*`, `company.settings.*`, `rollup:*`) — these don't
 * need a freshness check because the data is admin-curated.
 *
 * Keep in sync with `src/lib/risk/sources-catalog.ts` adapter codes.
 */
export function inputToSourceCode(input: string): string | null {
  if (input.startsWith("weather:")) return "weather-openmeteo"
  if (input === "currencyRate") return "cbar-official-fx"
  if (input.startsWith("commodityPrice:")) {
    // The catalog has multiple commodity feeds; tag by metric prefix.
    if (input.includes("sugar")) return "sugar-yahoo-sb-f"
    if (input.includes("oil") || input.includes("brent")) return "eia-energy"
    if (input.includes("wheat") || input.includes("grain")) return "yahoo-grains"
    if (input.includes("metal")) return "yahoo-metals"
    if (input.includes("fuel") || input.includes("bdi")) return "yahoo-fuel-bdi"
    if (input.includes("food") || input.includes("fao")) return "fao-food-prices"
    return null
  }
  if (input.startsWith("macro:") || input === "cpi") return "worldbank-cpi"
  // Internal inputs — no external freshness applies.
  return null
}
