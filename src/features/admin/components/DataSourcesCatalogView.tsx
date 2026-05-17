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
import { RecentCrossingsWidget } from "./RecentCrossingsWidget"
import { useLocale } from "next-intl"
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
  const config: Record<
    string,
    { label: string; bg: string; fg: string; Icon: typeof CheckCircle2 }
  > = {
    fresh: {
      label: "Свежее",
      bg: "bg-green-100 text-green-700",
      fg: "text-green-700",
      Icon: CheckCircle2,
    },
    stale: {
      label: "Устарело",
      bg: "bg-amber-100 text-amber-700",
      fg: "text-amber-700",
      Icon: Clock,
    },
    critical_stale: {
      label: "Критично",
      bg: "bg-red-100 text-red-700",
      fg: "text-red-700",
      Icon: AlertTriangle,
    },
    missing: {
      label: "Нет данных",
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
  if (cost === "free") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-green-50 text-green-700 border border-green-200">
        free
      </span>
    )
  }
  if (cost === "free-tier") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-blue-50 text-blue-700 border border-blue-200">
        <Key size={11} /> free key
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-orange-50 text-orange-700 border border-orange-200">
      <KeyRound size={11} /> paid
    </span>
  )
}

function formatAge(hours: number | null): string {
  if (hours == null) return "—"
  if (hours < 1) return `${Math.round(hours * 60)} мин назад`
  if (hours < 24) return `${Math.round(hours)} ч назад`
  return `${Math.round(hours / 24)} дн назад`
}

function SourceCard({
  source,
  freshness,
}: {
  source: DataSourceEntry
  freshness: FreshnessSnapshot | undefined
}) {
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
            {source.displayNameRu}
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
            {formatAge(freshness?.ageHours ?? null)}
          </span>
        </div>
      </header>

      <div className="px-5 py-4 space-y-3">
        <section>
          <h4 className="text-xs font-semibold uppercase text-gray-500 mb-1">
            Что это
          </h4>
          <p className="text-sm text-gray-800 leading-relaxed">
            {source.whatItIsRu}
          </p>
        </section>

        <section>
          <h4 className="text-xs font-semibold uppercase text-gray-500 mb-1">
            Зачем холдингу
          </h4>
          <p className="text-sm text-gray-800 leading-relaxed">
            {source.businessValueRu}
          </p>
        </section>

        <section className="rounded bg-gray-50 border border-gray-200 px-3 py-2">
          <h4 className="text-xs font-semibold uppercase text-gray-500 mb-1">
            Свежий пример
          </h4>
          <div className="text-sm">
            <div className="flex items-baseline gap-2">
              <code className="text-xs font-mono text-gray-600">
                {source.sampleLatest.metric}
              </code>
              <span className="text-base font-bold text-gray-900">
                {source.sampleLatest.value}
              </span>
            </div>
            <p className="text-xs text-gray-700 mt-1 italic">
              {source.sampleLatest.interpretation}
            </p>
          </div>
        </section>

        <section>
          <h4 className="text-xs font-semibold uppercase text-gray-500 mb-1">
            Питает индикаторы ({source.indicatorsPowered.length})
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
            <strong>Частота:</strong> {source.cadenceRu}
          </span>
          <span>
            <strong>Метрик:</strong> {source.metricsEmitted.length}
          </span>
        </section>

        {/* Phase 7.L — recent feed-crossing events for this source.
         *  Shows empty state when no crossings have fired yet (most
         *  demo orgs); fills in as scheduler ticks accumulate breaches. */}
        <section className="pt-2 border-t border-gray-100">
          <h4 className="text-xs font-semibold uppercase text-gray-500 mb-1">
            Недавние crossing-события
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
        {running
          ? "Запуск… (EN + RU + AZ)"
          : "▶ Запустить impact-scan сейчас (EN/RU/AZ)"}
      </button>
      {result && (
        <span className="text-xs text-emerald-700 font-mono">{result}</span>
      )}
      {error && <span className="text-xs text-red-600">⚠ {error}</span>}
    </div>
  )
}

export function DataSourcesCatalogView() {
  const [freshness, setFreshness] = useState<Record<string, FreshnessSnapshot>>(
    {},
  )
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

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          Каталог источников данных
        </h1>
        <p className="text-gray-600 max-w-3xl">
          {DATA_SOURCES_CATALOG.length} внешних API + публичных источников
          питают индикаторы Risk Terminal. Каждая карточка показывает что это,
          зачем холдингу, текущий live-сигнал и какие индикаторы зависят от
          этого источника. Открывайте эту страницу когда клиент спрашивает «а
          откуда у вас эта цифра?».
        </p>
        {loading && (
          <div className="mt-3 inline-flex items-center gap-2 text-sm text-gray-500">
            <Loader2 size={14} className="animate-spin" /> Загружаю свежесть
            источников…
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
          />
        ))}
      </div>

      <footer className="mt-8 pt-6 border-t text-xs text-gray-500 space-y-1">
        <p>
          <strong>Источник правды:</strong>{" "}
          <code className="font-mono">src/lib/intel/sources-catalog.ts</code> —
          одна запись на источник. UI авто-перерендеривается при добавлении
          нового адаптера.
        </p>
        <p>
          <strong>Свежесть данных</strong> подтягивается из{" "}
          <a
            href="/budgeting/admin/drift"
            className="text-blue-600 hover:underline"
          >
            Drift Dashboard
          </a>{" "}
          (зелёный = свежее, жёлтый = устарело, красный = критично).
        </p>
      </footer>
    </div>
  )
}
