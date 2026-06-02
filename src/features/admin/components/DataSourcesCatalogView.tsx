"use client"
/**
 * Phase 7.K — client-facing Data Sources Catalog view.
 *
 * Renders the 12-entry catalog from `src/lib/intel/sources-catalog.ts`
 * as a 2-column grid of cards. Each card explains in plain Russian:
 *   - What the source is (FAO / EIA / CBAR / Yahoo / etc.)
 *   - Why the holding cares (business value)
 *   - Live freshness state (IntelDataPoint count + last fetch from API)
 *   - Which indicators it powers (clickable to Risk Terminal)
 *   - A current sample value with plain-language interpretation
 *
 * Designed to be opened during a client demo when someone asks
 * "where does this number come from?". One page = one explanation.
 */
import React, { useEffect, useState } from "react"
import {
  DATA_SOURCES_CATALOG,
  type DataSourceEntry,
} from "@/lib/intel/sources-catalog"
import { localizedSource } from "@/lib/intel/sources-catalog-i18n"
import { RecentCrossingsWidget } from "./RecentCrossingsWidget"
import { useLocale, useTranslations } from "next-intl"
import {
  CheckCircle2,
  Clock,
  AlertTriangle,
  AlertCircle,
  ExternalLink,
  Key,
  KeyRound,
  Loader2,
} from "lucide-react"

interface FreshnessSnapshot {
  sourceCode: string
  ageHours: number | null
  status: "fresh" | "stale" | "critical_stale" | "missing"
  lastFetchedAt: string | null
  metricCount: number
}

function StatusBadge({
  status,
}: {
  status: FreshnessSnapshot["status"] | "unknown"
}) {
  const t = useTranslations("adminDataSources")
  const config: Record<
    string,
    { label: string; bg: string; fg: string; Icon: typeof CheckCircle2 }
  > = {
    fresh: {
      label: t("status.fresh"),
      bg: "bg-green-100 text-green-700",
      fg: "text-green-700",
      Icon: CheckCircle2,
    },
    stale: {
      label: t("status.stale"),
      bg: "bg-amber-100 text-amber-700",
      fg: "text-amber-700",
      Icon: Clock,
    },
    critical_stale: {
      label: t("status.critical_stale"),
      bg: "bg-red-100 text-red-700",
      fg: "text-red-700",
      Icon: AlertTriangle,
    },
    missing: {
      label: t("status.missing"),
      bg: "bg-gray-100 text-gray-700",
      fg: "text-gray-700",
      Icon: AlertCircle,
    },
    unknown: {
      label: "?",
      bg: "bg-gray-100 text-gray-700",
      fg: "text-gray-700",
      Icon: AlertCircle,
    },
  }
  const c = config[status] ?? config.unknown
  const Icon = c.Icon
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${c.bg}`}
    >
      <Icon size={12} className={c.fg} />
      {c.label}
    </span>
  )
}

function CostBadge({ cost }: { cost: DataSourceEntry["cost"] }) {
  const t = useTranslations("adminDataSources")
  if (cost === "free") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-green-50 text-green-700 border border-green-200">
        {t("cost.free")}
      </span>
    )
  }
  if (cost === "free-tier") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-blue-50 text-blue-700 border border-blue-200">
        <Key size={11} /> {t("cost.freeTier")}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-orange-50 text-orange-700 border border-orange-200">
      <KeyRound size={11} /> {t("cost.paid")}
    </span>
  )
}

function formatAge(
  hours: number | null,
  t: (k: string, vars?: Record<string, string | number>) => string,
): string {
  if (hours == null) return "—"
  if (hours < 1) return t("age.minutes", { n: Math.round(hours * 60) })
  if (hours < 24) return t("age.hours", { n: Math.round(hours) })
  return t("age.days", { n: Math.round(hours / 24) })
}

function SourceCard({
  source,
  freshness,
  live,
}: {
  source: DataSourceEntry
  freshness: FreshnessSnapshot | undefined
  live: { value: number; unit: string | null; datetime: string } | undefined
}) {
  const t = useTranslations("adminDataSources")
  const locale = useLocale()
  const L = localizedSource(source, locale)
  const status = freshness?.status ?? "unknown"
  return (
    <article className="border rounded-lg bg-white shadow-sm overflow-hidden">
      <header className="px-5 py-4 border-b bg-gray-50 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <code className="text-[10px] font-mono uppercase tracking-wider text-gray-500">
              {source.sourceCode}
            </code>
            <CostBadge cost={source.cost} />
          </div>
          <h3 className="text-base font-semibold text-gray-900">
            {L.displayName}
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {source.vendor} ·{" "}
            <a
              href={source.vendorUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 text-blue-600 hover:text-blue-800 hover:underline"
            >
              {new URL(source.vendorUrl).hostname.replace("www.", "")}
              <ExternalLink size={10} />
            </a>
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <StatusBadge status={status} />
          <span className="text-[10px] text-gray-500">
            {formatAge(freshness?.ageHours ?? null, t)}
          </span>
        </div>
      </header>

      <div className="px-5 py-4 space-y-3">
        <section>
          <h4 className="text-xs font-semibold uppercase text-gray-500 mb-1">
            {t("section.whatItIs")}
          </h4>
          <p className="text-sm text-gray-800 leading-relaxed">
            {L.whatItIs}
          </p>
        </section>

        <section>
          <h4 className="text-xs font-semibold uppercase text-gray-500 mb-1">
            {t("section.businessValue")}
          </h4>
          <p className="text-sm text-gray-800 leading-relaxed">
            {L.businessValue}
          </p>
        </section>

        <section className="rounded bg-gray-50 border border-gray-200 px-3 py-2">
          <h4 className="text-xs font-semibold uppercase text-gray-500 mb-1">
            {t("section.freshExample")}
          </h4>
          <div className="text-sm">
            <div className="flex items-baseline gap-2 flex-wrap">
              <code className="text-xs font-mono text-gray-600">
                {source.sampleLatest.metric}
              </code>
              {live ? (
                <>
                  <span className="text-base font-bold text-gray-900">
                    {live.value.toLocaleString(locale)}
                    {live.unit ? ` ${live.unit}` : ""}
                  </span>
                  <span className="text-[11px] text-gray-500">
                    {t("section.asOf", {
                      date: new Date(live.datetime).toLocaleDateString(locale),
                    })}
                  </span>
                </>
              ) : (
                <span className="text-sm italic text-gray-400">
                  {t("section.noData")}
                </span>
              )}
            </div>
            <p className="text-xs text-gray-700 mt-1 italic">
              {L.interpretation}
            </p>
          </div>
        </section>

        <section>
          <h4 className="text-xs font-semibold uppercase text-gray-500 mb-1">
            {t("section.poweredIndicators", { n: source.indicatorsPowered.length })}
          </h4>
          <div className="flex flex-wrap gap-1">
            {source.indicatorsPowered.map((code) => (
              <code
                key={code}
                className="text-[10px] font-mono px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded border border-blue-200"
              >
                {code}
              </code>
            ))}
          </div>
        </section>

        <section className="flex items-center justify-between text-xs text-gray-500 pt-1 border-t border-gray-100">
          <span>
            <strong>{t("footer.cadence")}:</strong> {L.cadence}
          </span>
          <span>
            <strong>{t("footer.metrics")}:</strong> {source.metricsEmitted.length}
          </span>
        </section>

        {/* Phase 7.L — recent feed-crossing events for this source.
         *  Shows empty state when no crossings have fired yet (most
         *  demo orgs); fills in as scheduler ticks accumulate breaches. */}
        <section className="pt-2 border-t border-gray-100">
          <h4 className="text-xs font-semibold uppercase text-gray-500 mb-1">
            {t("section.recentCrossings")}
          </h4>
          <RecentCrossingsWidget sourceCode={source.sourceCode} />
        </section>
      </div>
    </article>
  )
}

function RunImpactScanButton() {
  // Phase 7.L 2026-05-18 — single admin click generates forecasts in
  // ALL 3 locales (EN/RU/AZ) so the user doesn't have to switch UI
  // language and re-run. Cost: ~3× tokens (~$1.20 per scan vs $0.40
  // for one locale) — acceptable trade-off for one-click UX. Cache
  // layer (7-day TTL per language) absorbs repeat scans.
  void useLocale() // keep hook called for parity with other parts of
                    // the page that read locale; not used here.
  const t = useTranslations("adminDataSources")
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const onClick = async () => {
    if (running) return
    setRunning(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch("/api/admin/run-crossing-scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ languages: ["en", "ru", "az"] }),
      })
      const body = (await res.json()) as Record<string, unknown>
      if (!res.ok) {
        setError(String(body.error ?? `HTTP ${res.status}`))
      } else {
        const langs = Array.isArray(body.languages)
          ? (body.languages as string[]).join("/")
          : "?"
        setResult(
          `[${langs}] ${body.matchesFound} matches · ${body.forecastsGenerated} new forecasts · ${body.cacheHits} cache hits · ${body.skippedNoFinancials} skipped · ${body.errors ? (body.errors as string[]).length : 0} errors · ${body.durationMs}ms`,
        )
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="flex items-center gap-3 text-sm">
      <button
        type="button"
        onClick={onClick}
        disabled={running}
        className={`px-3 py-1.5 rounded font-medium ${
          running
            ? "bg-gray-200 text-gray-500 cursor-not-allowed"
            : "bg-blue-600 text-white hover:bg-blue-700"
        }`}
      >
        {running ? t("impactScan.running") : t("impactScan.button")}
      </button>
      {result && (
        <span className="text-xs text-emerald-700 font-mono">{result}</span>
      )}
      {error && <span className="text-xs text-red-600">⚠ {error}</span>}
    </div>
  )
}

export function DataSourcesCatalogView() {
  const t = useTranslations("adminDataSources")
  const [freshness, setFreshness] = useState<Record<string, FreshnessSnapshot>>(
    {},
  )
  const [latest, setLatest] = useState<
    Record<string, { value: number; unit: string | null; datetime: string }>
  >({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/admin/drift")
      .then((r) => r.json())
      .then((data) => {
        const map: Record<string, FreshnessSnapshot> = {}
        for (const f of data.feedFreshness ?? []) {
          map[f.sourceCode] = f
        }
        setFreshness(map)
      })
      .catch(() => {
        // Silent — cards will render with "unknown" badges.
      })
      .finally(() => setLoading(false))
  }, [])

  // Real latest value per source (display metric) — replaces the hardcoded
  // sample so the card shows a genuine, dated, source-attributed number.
  useEffect(() => {
    fetch("/api/admin/source-latest")
      .then((r) => r.json())
      .then((data) => setLatest(data.latest ?? {}))
      .catch(() => {
        // Silent — cards fall back to "no recent data".
      })
  }, [])

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          {t("title")}
        </h1>
        <p className="text-gray-600 max-w-3xl">
          {t("subtitle", { n: DATA_SOURCES_CATALOG.length })}
        </p>
        {loading && (
          <div className="mt-3 inline-flex items-center gap-2 text-sm text-gray-500">
            <Loader2 size={14} className="animate-spin" /> {t("loading")}
          </div>
        )}
        {/* Phase 7.L — manual trigger for the impact-forecast scan.
         *  Dev server has ANTHROPIC_API_KEY in its env; clicking this
         *  fires the scan in the server process (no CLI / no shell-
         *  history leak). Result counts + duration shown inline. */}
        <div className="mt-4">
          <RunImpactScanButton />
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {DATA_SOURCES_CATALOG.map((source) => (
          <SourceCard
            key={source.sourceCode}
            source={source}
            freshness={freshness[source.sourceCode]}
            live={
              latest[`${source.sourceCode}:${source.sampleLatest.metric}`]
            }
          />
        ))}
      </div>

      <footer className="mt-8 pt-6 border-t text-xs text-gray-500 space-y-1">
        <p>
          {t.rich("pageFooter.sourceOfTruth", {
            code: (chunks) => <code className="font-mono">{chunks}</code>,
            strong: (chunks) => <strong>{chunks}</strong>,
          })}
        </p>
        <p>
          {t.rich("pageFooter.freshnessLine", {
            strong: (chunks) => <strong>{chunks}</strong>,
            driftLink: (chunks) => (
              <a
                href="/budgeting/admin/drift"
                className="text-blue-600 hover:underline"
              >
                {chunks}
              </a>
            ),
          })}
        </p>
      </footer>
    </div>
  )
}
