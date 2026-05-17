"use client";

/**
 * Phase 7.H Feature 3 — Peer Benchmarking modal.
 *
 * Triggered from IndicatorDetail's "BENCHMARK" button. Fetches
 * /api/indicators/values/[id]/benchmark, renders a 3-line chart
 * (own / median / p75) over the trailing 12 periods + a sidebar
 * showing latest values + rank.
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, AlertCircle, X, BarChart3 } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

interface BenchmarkResponse {
  indicatorValueId: string;
  company: { code: string; name: string; industry: string | null };
  indicator: { code: string; direction: string; unit: string };
  period: string;
  periods: string[];
  ownSeries: { period: string; value: number | null }[];
  medianSeries: { period: string; value: number | null }[];
  p75Series: { period: string; value: number | null }[];
  rank: { position: number; total: number } | null;
  cohortSize: number;
  insufficientPeers: boolean;
  direction: string;
}

interface Props {
  ivId: string;
  onClose: () => void;
}

type State =
  | { kind: "loading" }
  | { kind: "loaded"; data: BenchmarkResponse }
  | { kind: "error"; message: string };

export function PeerBenchmarkModal({ ivId, onClose }: Props) {
  const t = useTranslations("terminal");
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(
          `/api/indicators/values/${encodeURIComponent(ivId)}/benchmark`,
          { cache: "no-store" },
        );
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          if (alive) setState({ kind: "error", message: body.error || `HTTP ${r.status}` });
          return;
        }
        const data = (await r.json()) as BenchmarkResponse;
        if (alive) setState({ kind: "loaded", data });
      } catch (e) {
        if (alive) setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => { alive = false; };
  }, [ivId]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-lg shadow-xl max-w-3xl w-full p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary">
              <BarChart3 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">
                {t("benchmark.title")}
              </h2>
              {state.kind === "loaded" && (
                <p className="text-xs text-muted-foreground">
                  {state.data.company.code} · {state.data.indicator.code} ·{" "}
                  {state.data.company.industry}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label={t("benchmark.close")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {state.kind === "loading" && (
          <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">{t("benchmark.loading")}</span>
          </div>
        )}

        {state.kind === "error" && (
          <div className="flex items-start gap-2 p-3 rounded bg-destructive/10 text-destructive text-sm" role="alert">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{state.message}</span>
          </div>
        )}

        {state.kind === "loaded" && state.data.insufficientPeers && (
          <div className="flex items-start gap-2 p-3 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 text-sm">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              {t("benchmark.insufficientPeers", { count: state.data.cohortSize })}
            </span>
          </div>
        )}

        {state.kind === "loaded" && !state.data.insufficientPeers && (
          <BenchmarkBody data={state.data} t={t} />
        )}
      </div>
    </div>
  );
}

function BenchmarkBody({
  data,
  t,
}: {
  data: BenchmarkResponse;
  t: ReturnType<typeof useTranslations>;
}) {
  // Merge series into one row per period for Recharts.
  const rows = data.periods.map((p, i) => ({
    period: p,
    own: data.ownSeries[i]?.value ?? null,
    median: data.medianSeries[i]?.value ?? null,
    p75: data.p75Series[i]?.value ?? null,
  }));
  const lastIdx = data.periods.length - 1;
  const ownLast = data.ownSeries[lastIdx]?.value ?? null;
  const medianLast = data.medianSeries[lastIdx]?.value ?? null;
  const p75Last = data.p75Series[lastIdx]?.value ?? null;
  const unit = data.indicator.unit ?? "";

  return (
    <div className="grid grid-cols-3 gap-4">
      {/* Chart */}
      <div className="col-span-2 h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <XAxis dataKey="period" fontSize={10} stroke="#64748b" />
            <YAxis fontSize={10} stroke="#64748b" />
            <Tooltip
              contentStyle={{ background: "#0f172a", border: "1px solid #334155", fontSize: 11 }}
              labelStyle={{ color: "#cbd5e1" }}
            />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Line
              type="monotone"
              dataKey="own"
              name={data.company.code}
              stroke="#00D4AA"
              strokeWidth={2}
              dot={{ r: 3 }}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="median"
              name={t("benchmark.medianLabel")}
              stroke="#FFB020"
              strokeWidth={1.5}
              strokeDasharray="4 2"
              dot={false}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="p75"
              name={t("benchmark.topQuartileLabel")}
              stroke="#0ea5e9"
              strokeWidth={1.5}
              strokeDasharray="2 2"
              dot={false}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Sidebar */}
      <aside className="space-y-3 text-sm">
        <div>
          <div className="text-xs text-muted-foreground uppercase tracking-wider">
            {t("benchmark.you")}
          </div>
          <div className="text-2xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
            {fmt(ownLast, unit)}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground uppercase tracking-wider">
            {t("benchmark.median")}
          </div>
          <div className="text-lg tabular-nums text-amber-600 dark:text-amber-400">
            {fmt(medianLast, unit)}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground uppercase tracking-wider">
            {t("benchmark.topQuartile")}
          </div>
          <div className="text-lg tabular-nums text-[#0ea5e9]">
            {fmt(p75Last, unit)}
          </div>
        </div>
        {data.rank && (
          <div className="pt-2 border-t border-border/40">
            <div className="text-xs text-muted-foreground uppercase tracking-wider">
              {t("benchmark.rank")}
            </div>
            <div className="text-lg tabular-nums">
              {data.rank.position} {t("benchmark.rankOf")} {data.rank.total}
            </div>
            <div className="text-[10px] text-muted-foreground">
              {t("benchmark.cohort", { sector: data.company.industry ?? "—" })}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

function fmt(v: number | null, unit: string): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  const formatted =
    abs >= 1_000_000
      ? (v / 1_000_000).toFixed(1) + "M"
      : abs >= 1_000
        ? (v / 1_000).toFixed(1) + "K"
        : abs >= 10
          ? v.toFixed(1)
          : v.toFixed(2);
  return unit ? `${formatted} ${unit}` : formatted;
}
