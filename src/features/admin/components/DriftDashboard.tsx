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
import { useTranslations } from "next-intl";
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

function useAgeLabel() {
  const t = useTranslations("adminDriftDashboard");
  return React.useCallback(
    (hours: number | null, cadence: "daily" | "monthly"): string => {
      if (hours === null) return t("neverFetched");
      if (cadence === "monthly" || hours > 48) {
        return t("daysAgo", { n: (hours / 24).toFixed(1) });
      }
      return t("hoursAgo", { n: hours.toFixed(1) });
    },
    [t],
  );
}

export function DriftDashboard() {
  const t = useTranslations("adminDriftDashboard");
  const ageLabel = useAgeLabel();
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
    <div
      className="p-6 max-w-[1400px] mx-auto space-y-6"
      data-testid="data-control-drift"
    >
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t("description")}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="default"
          onClick={fetchReport}
          disabled={loading}
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          {t("refreshBtn")}
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
            testId="data-control-drift-freshness"
            icon={<AlertTriangle className="text-amber-600" />}
            title={t("freshnessTitle")}
            subtitle={t("freshnessSubtitle")}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {report.referenceFreshness.map((s) => (
                <FreshnessCard key={s.sourceCode} source={s} onRefreshed={fetchReport} ageLabel={ageLabel} />
              ))}
            </div>
          </Section>

          <Section
            testId="data-control-drift-events"
            icon={<AlertCircle className="text-red-600" />}
            title={t("driftsTitle")}
            subtitle={t("driftsSubtitle", { n: report.recentDrifts.length })}
          >
            {report.recentDrifts.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-emerald-600">
                <CheckCircle2 size={14} /> {t("driftsEmpty")}
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
            testId="data-control-drift-onboarding"
            icon={<Clock className="text-amber-600" />}
            title={t("stalledTitle")}
            subtitle={t("stalledSubtitle", { n: report.stalePending.length })}
          >
            {report.stalePending.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-emerald-600">
                <CheckCircle2 size={14} /> {t("stalledEmpty")}
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
                        : t("neverAudited")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <p className="text-xs text-muted-foreground text-right">
            {t("generatedAt", { date: new Date(report.generatedAt).toLocaleString() })}
          </p>
        </>
      )}

      {!report && loading && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="animate-spin h-4 w-4" /> {t("loadingReport")}
        </div>
      )}
    </div>
  );
}

function Section({
  testId,
  icon,
  title,
  subtitle,
  children,
}: {
  testId: string;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3" data-testid={testId}>
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
  ageLabel,
}: {
  source: SourceFreshness;
  onRefreshed: () => void;
  ageLabel: (hours: number | null, cadence: "daily" | "monthly") => string;
}) {
  const t = useTranslations("adminDriftDashboard");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [configurePath, setConfigurePath] = React.useState<string | null>(null);
  const [lastResult, setLastResult] = React.useState<string | null>(null);

  const statusLabel: Record<SourceFreshness["status"], string> = {
    fresh: t("statusFresh"),
    stale: t("statusStale"),
    critical_stale: t("statusCriticalStale"),
    missing: t("statusMissing"),
  };

  const refresh = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setBusy(true);
    setErr(null);
    setConfigurePath(null);
    setLastResult(null);
    try {
      const res = await fetch(`/api/admin/drift/refresh-source?source=${encodeURIComponent(source.sourceCode)}`, {
        method: "POST",
      });
      const body = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok) {
        if (body.code === "api_key_missing") {
          setConfigurePath(
            typeof body.configurePath === "string"
              ? body.configurePath
              : "/budgeting/admin/api-keys",
          );
          throw new Error(t("apiKeyMissing", { code: source.sourceCode }));
        }
        if (res.status === 429) {
          const retryAfter =
            typeof body.retryAfterSec === "number"
              ? body.retryAfterSec
              : Number(res.headers?.get?.("Retry-After"));
          if (Number.isFinite(retryAfter) && retryAfter > 0) {
            throw new Error(t("retryAfter", { seconds: retryAfter }));
          }
        }
        throw new Error(
          typeof body.message === "string"
            ? body.message
            : typeof body.error === "string"
              ? body.error
              : `HTTP ${res.status}`,
        );
      }
      const inserted = typeof body.inserted === "number" ? body.inserted : 0;
      const errorMessages = Array.isArray(body.errors)
        ? body.errors.filter(
            (value: unknown): value is string => typeof value === "string",
          )
        : [];
      if (inserted === 0 && errorMessages.length > 0) {
        throw new Error(errorMessages[0]);
      }
      const errors = errorMessages.length;
      const errorsSuffix = errors > 0 ? t("errorsLabel", { n: errors }) : "";
      setLastResult(`${t("pointsLabel", { n: inserted })}${errorsSuffix}`);
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
          {statusLabel[source.status]}
        </span>
      </div>
      <div className="text-[10px] opacity-80 mb-2">
        {source.cadence === "daily" ? t("cadenceDaily") : t("cadenceMonthly")} ·{" "}
        {source.metricCount} {t("metrics")}
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
        title={t("fetchTitle", { code: source.sourceCode })}
        className="mt-2 w-full rounded border border-current/40 px-2 py-1 text-[10px] uppercase tracking-wider font-semibold hover:bg-current/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
      >
        {busy ? t("fetching") : t("refreshNow")}
      </button>
      {lastResult && (
        <div className="mt-1 text-[10px] text-emerald-700 dark:text-emerald-400">{lastResult}</div>
      )}
      {err && (
        <div className="mt-1 text-[10px] text-red-700 dark:text-red-400">
          {err}
          {configurePath && (
            <a className="ml-1 underline font-semibold" href={configurePath}>
              {t("configureApiKey")}
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function DriftEventRow({ event }: { event: DriftEvent }) {
  const t = useTranslations("adminDriftDashboard");
  const driftCount = event.drifts?.length ?? 0;
  return (
    <div className="rounded border border-red-500/30 bg-red-500/5 p-3 text-xs space-y-1.5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="font-mono font-semibold">
          {event.company?.code ?? t("unknownCompany")}
        </span>
        <span className="text-muted-foreground">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      <div className="text-muted-foreground">
        {t("runByLabel")} <span className="font-mono">{event.runBy ?? t("unknownUser")}</span> ·{" "}
        {driftCount === 1
          ? t("indicatorsDriftedOne", { n: driftCount })
          : t("indicatorsDriftedOther", { n: driftCount })}
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
              {t("moreDrifts", { n: event.drifts.length - 5 })}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
