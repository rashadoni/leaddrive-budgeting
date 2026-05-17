"use client";

/**
 * Phase 7.G Turn CI (Phase 7.E #3 v2 E.2d UI half) — predictive breach panel.
 *
 * Bloomberg-style overlay listing the org's predictive breach forecasts.
 * Reads `GET /api/indicators/breaches` (LXXXXIX) which proxies to
 * `getPredictiveBreaches` (LXXXXVIII Prisma+memory dual-read).
 *
 * Opens on the `terminal:open-breach` window event (CommandBar `BREACH GO`
 * dispatch) — same overlay pattern as ScenarioPanel / IntelFeedPanel /
 * AlertsPanel.
 *
 * Filters:
 *   - period (defaults to "all" — empty filter)
 *   - minConfidenceBand (low | medium | high; default "medium" so noisy low-
 *     confidence forecasts don't dominate the list — admins can flip to "low"
 *     when they want full visibility).
 *
 * Each row shows:
 *   - companyId · indicatorCode @ period (+horizon step)
 *   - currentStatus → predictedStatus pill transition (color-coded)
 *   - predictedValue ± CI (when present)
 *   - confidenceBand chip
 *
 * v2 follow-ups (separate-turn items):
 *   - Click-row → open VarianceExplainerPanel pre-loaded with the forecast
 *     context (drill-down into "why is it declining").
 *   - LLM digest of top breaches (E.2e LLM half).
 *   - Multi-variate OLS overlay showing macro drivers (E.2c).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, X } from "lucide-react";

interface BreachRow {
  companyId: string;
  indicatorCode: string;
  period: string;
  horizonStep: number;
  currentStatus: "green" | "amber" | "red" | "unknown";
  predictedStatus: "green" | "amber" | "red" | "unknown";
  forecastConfidence: number;
  confidenceBand: "low" | "medium" | "high";
  predictedValue: number;
  predictedLower?: number;
  predictedUpper?: number;
  drivers?: Record<string, unknown>;
  computedAt: string;
}

type ConfidenceFilter = "low" | "medium" | "high";

interface BreachesResponse {
  breaches: BreachRow[];
  filter: { period: string | null; minConfidenceBand: ConfidenceFilter | null };
  count: number;
}

const STATUS_PILL: Record<BreachRow["currentStatus"], string> = {
  green: "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/40",
  amber: "bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/40",
  red: "bg-red-500/15 text-red-400 ring-1 ring-red-500/40",
  unknown: "bg-slate-500/15 text-slate-400 ring-1 ring-slate-500/40",
};

const BAND_PILL: Record<ConfidenceFilter, string> = {
  high: "bg-emerald-500/15 text-emerald-400",
  medium: "bg-amber-500/15 text-amber-400",
  low: "bg-slate-500/15 text-slate-400",
};

function pluralize(
  count: number,
  one: string,
  few: string,
  many: string,
): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function BreachForecastPanel() {
  const t = useTranslations("terminal");
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState<string>("");
  const [minBand, setMinBand] = useState<ConfidenceFilter>("medium");
  const [data, setData] = useState<BreachesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Open on `terminal:open-breach` event
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("terminal:open-breach", onOpen);
    return () => window.removeEventListener("terminal:open-breach", onOpen);
  }, []);

  // Esc to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const fetchBreaches = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const params = new URLSearchParams();
      if (period) params.set("period", period);
      if (minBand) params.set("minConfidenceBand", minBand);
      const url = `/api/indicators/breaches${params.toString() ? `?${params.toString()}` : ""}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
      const body = (await res.json()) as BreachesResponse;
      setData(body);
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [period, minBand]);

  // Re-fetch on open + when filters change
  useEffect(() => {
    if (!open) return;
    void fetchBreaches();
  }, [open, fetchBreaches]);

  // Group rows by company for visual scanability
  const grouped = useMemo(() => {
    if (!data) return new Map<string, BreachRow[]>();
    const m = new Map<string, BreachRow[]>();
    for (const b of data.breaches) {
      const key = b.companyId;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(b);
    }
    return m;
  }, [data]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("breach.dialogAriaLabel")}
      data-testid="breach-forecast-panel"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="relative w-full max-w-5xl max-h-[85vh] overflow-y-auto rounded-lg border border-input bg-background shadow-2xl">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/95 px-6 py-3 backdrop-blur">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-red-600 dark:text-red-400" aria-hidden="true" />
            <div>
              <h2 className="text-lg font-semibold tracking-tight">{t("breach.title")}</h2>
              <p className="text-xs text-muted-foreground">
                {t("breach.subtitle")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={t("breach.closeAriaLabel")}
            data-testid="breach-close"
            className="rounded border border-input px-2 py-1 text-sm hover:bg-muted/50"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </header>

        {/* Filter row */}
        <section className="px-6 py-3 border-b border-border flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground uppercase tracking-wider">{t("breach.periodLabel")}</span>
            <input
              type="text"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              placeholder={t("breach.periodPlaceholder")}
              data-testid="breach-period-input"
              className="font-mono px-2 py-1 rounded border border-input bg-black/30 text-sm w-40"
            />
          </label>
          <label className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground uppercase tracking-wider">{t("breach.minConfidenceLabel")}</span>
            <select
              value={minBand}
              onChange={(e) => setMinBand(e.target.value as ConfidenceFilter)}
              data-testid="breach-band-select"
              className="font-mono px-2 py-1 rounded border border-input bg-black/30 text-sm"
            >
              <option value="low">{t("breach.bandLow")}</option>
              <option value="medium">{t("breach.bandMedium")}</option>
              <option value="high">{t("breach.bandHigh")}</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => void fetchBreaches()}
            disabled={loading}
            data-testid="breach-refresh"
            className="ml-auto rounded border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 px-3 py-1 text-xs hover:bg-cyan-500/20 disabled:opacity-50"
          >
            {loading ? t("breach.loading") : t("breach.refresh")}
          </button>
        </section>

        {/* Results */}
        <section className="px-6 py-4">
          {loading && data === null ? (
            <p className="text-sm text-muted-foreground" data-testid="breach-loading">
              {t("breach.loadingForecasts")}
            </p>
          ) : fetchError ? (
            <p
              role="alert"
              className="text-sm text-red-600 dark:text-red-400"
              data-testid="breach-fetch-error"
            >
              {fetchError}
            </p>
          ) : data === null ? null : data.count === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="breach-empty">
              {t("breach.emptyPrefix")}{" "}
              <span className="font-mono">{t("breach.bandLow")}</span>{t("breach.emptySuffix")}
            </p>
          ) : (
            <div className="space-y-4" data-testid="breach-results">
              <p className="text-xs text-muted-foreground">
                {data.count}{" "}
                {pluralize(data.count, t("breach.forecastOne"), t("breach.forecastFew"), t("breach.forecastMany"))}{" "}
                {t("breach.summaryAcross")}{" "}
                {grouped.size}{" "}
                {pluralize(grouped.size, t("breach.companyOne"), t("breach.companyFew"), t("breach.companyMany"))}
              </p>
              {Array.from(grouped.entries()).map(([companyId, rows]) => (
                <div
                  key={companyId}
                  className="rounded border border-border bg-black/20"
                  data-testid={`breach-group-${companyId}`}
                >
                  <header className="flex items-center justify-between px-4 py-2 border-b border-border bg-black/30">
                    <h3 className="text-sm font-mono font-semibold tracking-wide">{companyId}</h3>
                    <span className="text-xs text-muted-foreground">
                      {rows.length}{" "}
                      {pluralize(rows.length, t("breach.forecastOne"), t("breach.forecastFew"), t("breach.forecastMany"))}
                    </span>
                  </header>
                  <ul className="divide-y divide-gray-800">
                    {rows.map((b, idx) => (
                      <li
                        key={`${b.indicatorCode}-${b.period}-${b.horizonStep}-${idx}`}
                        className="px-4 py-3 grid grid-cols-1 md:grid-cols-[2fr_2fr_1fr_1fr] gap-3 items-center text-sm"
                        data-testid={`breach-row-${b.indicatorCode}-${b.horizonStep}`}
                      >
                        <div>
                          <div className="font-mono font-medium">{b.indicatorCode}</div>
                          <div className="text-xs text-muted-foreground">
                            {b.period} · {t("breach.stepLabel")} +{b.horizonStep}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono uppercase ${STATUS_PILL[b.currentStatus]}`}
                          >
                            {b.currentStatus}
                          </span>
                          <span className="text-muted-foreground">→</span>
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono uppercase ${STATUS_PILL[b.predictedStatus]}`}
                          >
                            {b.predictedStatus}
                          </span>
                        </div>
                        <div className="text-right tabular-nums font-mono text-xs">
                          {b.predictedValue.toFixed(2)}
                          {b.predictedLower !== undefined && b.predictedUpper !== undefined && (
                            <div className="text-muted-foreground">
                              [{b.predictedLower.toFixed(1)}, {b.predictedUpper.toFixed(1)}]
                            </div>
                          )}
                        </div>
                        <div className="text-right">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono uppercase ${BAND_PILL[b.confidenceBand]}`}
                          >
                            {b.confidenceBand}
                          </span>
                          <div className="text-[10px] text-muted-foreground mt-0.5">
                            {(b.forecastConfidence * 100).toFixed(0)}%
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>

        <footer className="px-6 py-3 border-t border-border text-xs text-muted-foreground">
          {t("breach.footerNote")}
        </footer>
      </div>
    </div>
  );
}
