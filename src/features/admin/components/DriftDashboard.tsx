"use client";
/**
 * Financial-truth-infra Phase D.3 — drift dashboard.
 *
 * Lives at /budgeting/admin/drift. Surfaces three classes of data-quality
 * signal that the system would otherwise hide:
 *   - Recent drift events (last 30 days from audit log)
 *   - Reference-data feed freshness (weather/commodity/FX age)
 *   - Stale-pending companies (onboarding stalled > 7 days)
 *
 * All sections refresh on page mount via a single API call. Re-runs
 * cost ~50ms; no client-side polling — user clicks Refresh if they want
 * to re-pull after a watchdog run.
 */
import React from "react";
import { RefreshCw, AlertTriangle, Clock, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DriftEvent {
  id: string;
  createdAt: string;
  runBy: string | null;
  company: { id: string; code: string; name: string } | null;
  drifts: Array<{
    indicatorCode: string;
    beforeBand: string | null;
    afterBand: string | null;
    beforeValue: number;
    afterValue: number;
    valueDriftPct: number;
  }> | null;
}

interface SourceFreshness {
  sourceCode: string;
  cadence: "daily" | "monthly";
  ageHours: number | null;
  thresholds: { staleHours: number; criticalHours: number };
  status: "fresh" | "stale" | "critical_stale" | "missing";
  lastFetchedAt: string | null;
  metricCount: number;
}

interface StalePending {
  code: string;
  name: string;
  level: number;
  lastReconciledAt: string | null;
}

interface DriftReport {
  recentDrifts: DriftEvent[];
  referenceFreshness: SourceFreshness[];
  stalePending: StalePending[];
  generatedAt: string;
}

const FRESH_COLOR: Record<SourceFreshness["status"], string> = {
  fresh: "border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300",
  stale: "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-300",
  critical_stale: "border-red-500/40 bg-red-500/5 text-red-700 dark:text-red-300",
  missing: "border-gray-500/40 bg-gray-500/5 text-gray-600",
};

function ageLabel(hours: number | null, cadence: "daily" | "monthly"): string {
  if (hours === null) return "never fetched";
  if (cadence === "monthly" || hours > 48) {
    const days = hours / 24;
    return `${days.toFixed(1)} days ago`;
  }
  return `${hours.toFixed(1)} hours ago`;
}

export function DriftDashboard() {
  const [report, setReport] = React.useState<DriftReport | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const fetchReport = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/drift");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      setReport(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Drift Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Data-quality signals: recent drift events, reference-feed freshness,
            and stalled onboarding cases. Refresh re-pulls live state.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="default"
          onClick={fetchReport}
          disabled={loading}
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Refresh
        </Button>
      </header>

      {error && (
        <div className="rounded border border-red-500/40 bg-red-500/5 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {report && (
        <>
          <Section
            icon={<AlertTriangle className="text-amber-600" />}
            title="Reference-data freshness"
            subtitle="Weather, commodity, FX feeds — age vs expected cadence"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {report.referenceFreshness.map((s) => (
                <FreshnessCard key={s.sourceCode} source={s} onRefreshed={fetchReport} />
              ))}
            </div>
          </Section>

          <Section
            icon={<AlertCircle className="text-red-600" />}
            title="Recent drift events"
            subtitle={`Last 30 days · ${report.recentDrifts.length} events`}
          >
            {report.recentDrifts.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-emerald-600">
                <CheckCircle2 size={14} /> No drift detected in the last 30 days.
              </div>
            ) : (
              <div className="space-y-2">
                {report.recentDrifts.map((d) => (
                  <DriftEventRow key={d.id} event={d} />
                ))}
              </div>
            )}
          </Section>

          <Section
            icon={<Clock className="text-amber-600" />}
            title="Stalled onboarding"
            subtitle={`Op-cos not audited in 7+ days · ${report.stalePending.length}`}
          >
            {report.stalePending.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-emerald-600">
                <CheckCircle2 size={14} /> Every leaf entity audited within the last 7 days.
              </div>
            ) : (
              <ul className="space-y-1 text-sm">
                {report.stalePending.map((c) => (
                  <li key={c.code} className="flex items-center justify-between gap-3 py-1 border-b border-border/40">
                    <span className="font-mono">{c.code}</span>
                    <span className="text-muted-foreground truncate flex-1">{c.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {c.lastReconciledAt
                        ? new Date(c.lastReconciledAt).toLocaleDateString()
                        : "never audited"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <p className="text-xs text-muted-foreground text-right">
            Generated {new Date(report.generatedAt).toLocaleString()}
          </p>
        </>
      )}

      {!report && loading && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="animate-spin h-4 w-4" /> Loading drift report…
        </div>
      )}
    </div>
  );
}

function Section({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="h-4 w-4 shrink-0">{icon}</div>
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>
      <p className="text-sm text-muted-foreground -mt-2 ml-6">{subtitle}</p>
      <div className="border rounded-lg bg-card text-card-foreground p-4">{children}</div>
    </section>
  );
}

function FreshnessCard({
  source,
  onRefreshed,
}: {
  source: SourceFreshness;
  onRefreshed: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [lastResult, setLastResult] = React.useState<string | null>(null);

  const refresh = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setBusy(true);
    setErr(null);
    setLastResult(null);
    try {
      const res = await fetch(`/api/admin/drift/refresh-source?source=${encodeURIComponent(source.sourceCode)}`, {
        method: "POST",
      });
      const body = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok) {
        throw new Error(typeof body.error === "string" ? body.error : `HTTP ${res.status}`);
      }
      const inserted = typeof body.inserted === "number" ? body.inserted : 0;
      const errors = Array.isArray(body.errors) ? body.errors.length : 0;
      setLastResult(`+${inserted} points${errors > 0 ? `, ${errors} errors` : ""}`);
      onRefreshed();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`rounded border p-3 text-xs ${FRESH_COLOR[source.status]} relative group`}>
      <div className="flex items-center justify-between mb-1">
        <span className="font-mono font-semibold uppercase text-[11px]">{source.sourceCode}</span>
        <span className="uppercase tracking-wider text-[9px] px-1.5 py-0.5 rounded border border-current">
          {source.status.replace("_", " ")}
        </span>
      </div>
      <div className="text-[10px] opacity-80 mb-2">
        {source.cadence === "daily" ? "daily cadence" : "monthly cadence"} ·{" "}
        {source.metricCount} metrics
      </div>
      <div className="text-sm">{ageLabel(source.ageHours, source.cadence)}</div>
      {source.lastFetchedAt && (
        <div className="text-[10px] opacity-70 mt-1">
          {new Date(source.lastFetchedAt).toLocaleString()}
        </div>
      )}
      <button
        type="button"
        onClick={refresh}
        disabled={busy}
        title={`Fetch ${source.sourceCode} now`}
        className="mt-2 w-full rounded border border-current/40 px-2 py-1 text-[10px] uppercase tracking-wider font-semibold hover:bg-current/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
      >
        {busy ? "Fetching…" : "Refresh now"}
      </button>
      {lastResult && (
        <div className="mt-1 text-[10px] text-emerald-700 dark:text-emerald-400">{lastResult}</div>
      )}
      {err && (
        <div className="mt-1 text-[10px] text-red-700 dark:text-red-400">{err}</div>
      )}
    </div>
  );
}

function DriftEventRow({ event }: { event: DriftEvent }) {
  const driftCount = event.drifts?.length ?? 0;
  return (
    <div className="rounded border border-red-500/30 bg-red-500/5 p-3 text-xs space-y-1.5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="font-mono font-semibold">
          {event.company?.code ?? "(unknown company)"}
        </span>
        <span className="text-muted-foreground">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      <div className="text-muted-foreground">
        Run by: <span className="font-mono">{event.runBy ?? "(unknown)"}</span> ·{" "}
        {driftCount} indicator{driftCount === 1 ? "" : "s"} drifted
      </div>
      {event.drifts && event.drifts.length > 0 && (
        <ul className="space-y-0.5 pl-3">
          {event.drifts.slice(0, 5).map((d, i) => (
            <li key={i} className="text-[11px]">
              <span className="font-mono">{d.indicatorCode}</span>
              {": "}
              <span className="opacity-80">
                {d.beforeBand ?? "—"} → {d.afterBand ?? "—"} · value{" "}
                {d.beforeValue.toLocaleString()} → {d.afterValue.toLocaleString()} (
                {d.valueDriftPct.toFixed(2)}%)
              </span>
            </li>
          ))}
          {event.drifts.length > 5 && (
            <li className="text-[10px] opacity-70 pl-3">
              + {event.drifts.length - 5} more drifts
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
