"use client";

import { useTranslations, useLocale } from 'next-intl';

/**
 * Phase 7.D — Panel 3 drill-down for a clicked HeatMap cell.
 *
 * Renders an `IndicatorValue` with: status badge, formula text, every
 * resolved variable + its value, the per-namespace aggregate
 * breakdowns, and the seed-defined hint template (the "what is this
 * indicator" sentence). Plus a button that activates Panel 4
 * (VarianceExplainerPanel) — the user's path from "see red cell" to
 * "see why" is a single click each.
 */

import React, { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Sparkline, type SparklineStatus } from "./Sparkline";
import { useTerminalStore } from "../store/terminalStore";
import {
  forecastNextPeriod,
  type ForecastConfidence,
} from "@/lib/risk/forecast";
import { statusShape } from "@/lib/risk/heatmap-matrix";
import { resolveIndicatorLabel } from "../lib/resolve-indicator-label";

interface IndicatorMeta {
  id: string;
  code: string;
  nameEn: string;
  nameAz?: string | null;
  nameRu?: string | null;
  unit: string;
  direction: "higher_better" | "lower_better" | "band";
  formula: string;
  thresholds: unknown;
  hintTemplateEn: string | null;
  hintTemplateAz?: string | null;
  hintTemplateRu?: string | null;
  requiredInputs: string[];
}

interface CompanyMeta {
  id: string;
  code: string;
  name: string;
  industry: string | null;
}

interface IndicatorValueDetail {
  id: string;
  value: number;
  status: "green" | "amber" | "red" | "unknown";
  period: string;
  computedAt: string;
  inputs: {
    resolved?: Record<string, number>;
    aggregates?: Record<string, unknown>;
    error?: { code: string; reason: string };
  } | null;
  /** Phase B2/B3 — 12-slot trailing-month series; nulls = evaluation gap. */
  sparkline: (number | null)[] | null;
  indicator: IndicatorMeta;
  company: CompanyMeta;
}

const STATUS_HEX: Record<IndicatorValueDetail["status"], string> = {
  green: "#00D4AA",
  amber: "#FFB020",
  red: "#FF4757",
  unknown: "#6B7280",
};

/**
 * Phase 7.E phase 2 hardening (sub-40) — per-IV recompute state machine.
 * The "Recompute" button below the status badge POSTs to /api/indicators
 * with `{period, companyId, indicatorCode}` — the only path that hits the
 * route's single-IV branch (`withSparkline=true`), which is in turn the
 * only path that triggers phase-2's inline `computeSparkline`. Without
 * this affordance, phase-2 wiring exists in `recomputeIndicator` but no
 * UI flow ever exercises it.
 */
type RecomputeState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'done' }
  | { kind: 'error'; message: string };

export function IndicatorDetail() {
  const t = useTranslations('terminal');
  const locale = useLocale();
  const ivId = useTerminalStore((s) => s.activeIndicatorValueId);
  const setActivePanel = useTerminalStore((s) => s.setActivePanel);

  const [detail, setDetail] = useState<IndicatorValueDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recomputeState, setRecomputeState] = useState<RecomputeState>({ kind: 'idle' });
  // Bumped after a successful recompute to force the IV-fetch effect to
  // re-run (the existing dep array tracks `ivId` only; without this tick,
  // the user clicks Recompute, the API persists fresh value+sparkline,
  // but the panel keeps showing stale data).
  const [refetchTick, setRefetchTick] = useState(0);

  useEffect(() => {
    if (!ivId) {
      setDetail(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/indicators/values/${encodeURIComponent(ivId)}`)
      .then((r) =>
        r.ok ? r.json() : r.text().then((t) => Promise.reject(new Error(t || `HTTP ${r.status}`))),
      )
      .then((data: IndicatorValueDetail) => {
        if (!cancelled) setDetail(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ivId, refetchTick]);

  const triggerRecompute = async () => {
    if (recomputeState.kind === 'running' || !detail) return;
    setRecomputeState({ kind: 'running' });
    try {
      const res = await fetch('/api/indicators', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          period: detail.period,
          companyId: detail.company.id,
          indicatorCode: detail.indicator.code,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      setRecomputeState({ kind: 'done' });
      setRefetchTick((tick) => tick + 1);
      // Auto-clear the "Updated" pill after 1.5s so it doesn't linger.
      // Uses the functional-set form so a parallel running-state from a
      // rapid second click can't accidentally roll back to idle.
      setTimeout(() => {
        setRecomputeState((s) => (s.kind === 'done' ? { kind: 'idle' } : s));
      }, 1500);
    } catch (err) {
      setRecomputeState({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  if (!ivId) {
    // Sub-36 cont'd Round-33 — empty-state centered both axes so the
    // placeholder visibly fills the panel slot rather than top-anchoring
    // and leaving dead space below. User feedback "тяни нижнию часть
    // не тянется" was about the visual filling, not the underlying
    // height resolution (which already worked via items-stretch).
    return (
      <div className="text-gray-700 font-mono text-xs leading-relaxed h-full w-full flex flex-col items-center justify-center text-center px-4">
        <div>
          {t('indicatorDetail.emptyDrillDown')}
          <br />
          <br />
          <span className="text-gray-600">
            {t('indicatorDetail.emptyOrTypePrefix')}{' '}
            <span className="text-[#FFB800]">IND_OPEX_RATIO IND GO</span>{' '}
            {t('indicatorDetail.emptyOrTypeSuffix')}
          </span>
        </div>
      </div>
    );
  }
  if (loading) {
    return <div className="text-gray-700 font-mono text-xs h-full w-full flex items-center justify-center">{t('indicatorDetail.loading')}</div>;
  }
  if (error) {
    return <div className="text-[#FF4757] font-mono text-xs h-full w-full flex items-center justify-center">{t('indicatorDetail.error')} {error}</div>;
  }
  if (!detail) return null;

  const { indicator: ind, company: co, status, value, period, inputs } = detail;
  const statusColor = STATUS_HEX[status];

  const resolved = inputs?.resolved ?? {};
  const aggregates = inputs?.aggregates ?? {};
  const errPayload = inputs?.error;

  const hint = ind.hintTemplateEn
    ? ind.hintTemplateEn
        .replace("{value}", formatValue(value))
        .replace("{status}", status.toUpperCase())
    : null;

  return (
    <div className="font-mono text-[11px] text-gray-300 w-full h-full flex flex-col gap-2 overflow-auto">
      <header className="shrink-0 flex items-start justify-between gap-2 pb-1.5 border-b border-gray-800/60">
        <div>
          <div className="text-gray-500 uppercase tracking-wider text-[9px]">
            {co.code} · {co.name}
            {co.industry && (
              <span className="ml-2 text-gray-700">({co.industry})</span>
            )}
          </div>
          <div className="text-[#E8EDF5] font-semibold text-sm tracking-tight mt-0.5">
            <span className="text-gray-500 font-normal text-[10px]" title={ind.code}>
              {ind.code}
            </span>{' '}
            <span className="text-[#E8EDF5]">
              {/* Round-24 Stage 3 — shared resolver. */}
              {resolveIndicatorLabel(ind, locale)}
            </span>
          </div>
          <div className="text-gray-600 text-[10px] mt-0.5">
            period {period} · direction {ind.direction} · unit {ind.unit}
          </div>
        </div>
        <div className="text-right shrink-0 flex flex-col items-end gap-1">
          <div
            className="text-2xl tabular-nums font-semibold"
            style={{ color: statusColor }}
          >
            {formatValue(value)}
          </div>
          <div
            className="text-[10px] uppercase tracking-wider"
            style={{ color: statusColor }}
          >
            {/* Tier-3 sub-29 M7 sweep — shape glyph next to status word.
                Decorative (status word already conveys meaning to screen
                readers); shape adds visual redundancy for color-blind users. */}
            <span aria-hidden="true" className="mr-0.5 opacity-80">
              {statusShape(status)}
            </span>
            {status}
          </div>
          {/* Phase 7.E phase 2 hardening (sub-40) — per-IV recompute
              affordance. Single-IV path (companyId+indicatorCode) is
              the only branch that flips withSparkline=true on the API
              route, so this is the user-facing trigger for inline
              sparkline refresh. */}
          {/* Sub-41 architect Round-1 closure — a11y polish: title attr
              gives sighted hover users a tooltip; aria-describedby pins
              the same description to the button's accessible-description
              slot for screen-reader users (mirror via sr-only span so SR
              hears it after the visible button name). The text is now
              user-facing (no internal-tech jargon like "POST
              /api/indicators"). State-changing visible text remains the
              accessible name (announced first). */}
          <button
            type="button"
            onClick={triggerRecompute}
            disabled={recomputeState.kind === 'running'}
            title={t('indicatorDetail.recomputeTitle')}
            aria-describedby="indicator-detail-recompute-desc"
            className="flex items-center gap-1 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border border-gray-800 hover:border-[#00D4AA]/60 hover:text-[#00D4AA] hover:bg-[#00D4AA]/5 disabled:opacity-40 disabled:hover:border-gray-800 disabled:hover:text-gray-500 disabled:hover:bg-transparent transition-colors text-gray-500"
          >
            <RefreshCw
              size={10}
              className={recomputeState.kind === 'running' ? 'animate-spin' : ''}
              aria-hidden="true"
            />
            <span>
              {recomputeState.kind === 'running'
                ? t('indicatorDetail.recomputing')
                : recomputeState.kind === 'done'
                  ? t('indicatorDetail.recomputeDone')
                  : recomputeState.kind === 'error'
                    ? t('indicatorDetail.recomputeFailed')
                    : t('indicatorDetail.recompute')}
            </span>
          </button>
          <span id="indicator-detail-recompute-desc" className="sr-only">
            {t('indicatorDetail.recomputeTitle')}
          </span>
          {recomputeState.kind === 'error' && (
            <div
              className="text-[9px] text-[#FF4757] max-w-[180px] text-right leading-tight"
              role="alert"
            >
              {recomputeState.message}
            </div>
          )}
        </div>
      </header>

      {hint && (
        <p className="text-gray-300 leading-snug">{hint}</p>
      )}

      {/* Phase B3 — trailing 12-month sparkline. Renders empty baseline
          when sparkline is null/empty (IV pre-dates B2 batch run); user
          sees the column slot reserved without misleading "0" data. */}
      {detail.sparkline && detail.sparkline.length > 0 && (
        <div className="flex items-center gap-2 rounded border border-gray-800/60 bg-[#0A0E27]/40 px-2 py-1.5">
          <span className="text-[9px] uppercase tracking-wider text-gray-500 shrink-0">
            {t('snapshot.trend12mo')}
          </span>
          <Sparkline
            data={detail.sparkline}
            status={status as SparklineStatus}
            ariaLabel={t('heatMap.sparklineTrendAriaLabel', {
              indCode: ind.code,
              coCode: co.code,
            })}
          />
          {(() => {
            const numeric = detail.sparkline.filter(
              (v): v is number => typeof v === "number",
            );
            if (numeric.length < 2) return null;
            const first = numeric[0];
            const last = numeric[numeric.length - 1];
            const delta = last - first;
            const sign = delta > 0 ? "+" : "";
            return (
              <span className="text-[10px] text-gray-500 ml-auto tabular-nums">
                {numeric.length}/12 pts · Δ {sign}{formatValue(delta)}
              </span>
            );
          })()}
        </div>
      )}

      {/* Phase C2 v1 — predictive forecast badge.
          Phase C2 v2 (sub-22) — extended with LLM-narrated "Explain"
          button + EN/RU/AZ language picker + narrative panel. Pure
          v1 badge kept above the explain panel for at-a-glance
          reading; LLM call only fires on explicit click. */}
      {detail.sparkline && detail.sparkline.length > 0 && (
        <ForecastSection
          ivId={detail.id}
          sparkline={detail.sparkline}
        />
      )}

      {/* Phase 7.E (Turn 16) — services thresholds calibrated against
          Damodaran US-market ballpark; AZ-market reality may differ. Banner
          shows for any SVC_* indicator until enough AZ services-companies
          arrive to local-calibrate. Reframed from a stale user-owned
          "needs 5+ AZ services-co data" 🔄 to an explicit UI signal. */}
      {ind.code.startsWith("SVC_") && (
        <p
          className="text-[10px] leading-snug rounded border border-yellow-500/30 bg-yellow-500/5 px-2 py-1.5 text-yellow-200"
          role="note"
        >
          {t('indicatorDetail.damodaranBanner')}
        </p>
      )}

      {errPayload && (
        <div className="rounded border border-[#6B7280]/40 bg-[#6B7280]/10 px-2 py-1.5">
          <div className="text-[#FFB020] text-[10px] uppercase tracking-wider mb-0.5">
            {t('indicatorDetail.pipelineNote')}
          </div>
          <div className="text-gray-300 text-[11px]">
            <span className="text-gray-500">{errPayload.code}:</span> {errPayload.reason}
          </div>
        </div>
      )}

      <section>
        <div className="text-gray-500 uppercase tracking-wider text-[9px] mb-0.5">
          {t('indicatorDetail.formula')}
        </div>
        <code className="block bg-[#050814] rounded border border-gray-800 px-2 py-1 text-[#00D4AA] text-[11px] whitespace-pre-wrap break-all">
          {ind.formula}
        </code>
      </section>

      <section>
        <div className="text-gray-500 uppercase tracking-wider text-[9px] mb-0.5">
          {t('indicatorDetail.resolvedVariables')}
        </div>
        {Object.keys(resolved).length === 0 ? (
          <p className="text-gray-700 text-[11px]">
            {t('indicatorDetail.noneMissingData')}
          </p>
        ) : (
          <table className="text-[11px] tabular-nums w-full">
            <tbody>
              {Object.entries(resolved).map(([k, v]) => (
                <tr key={k} className="border-b border-gray-800/30 last:border-b-0">
                  <td className="py-0.5 pr-3 text-gray-400 font-mono">{k}</td>
                  <td className="py-0.5 text-gray-200 text-right">
                    {formatValue(v)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <div className="text-gray-500 uppercase tracking-wider text-[9px] mb-0.5">
          {t('indicatorDetail.aggregates')}
        </div>
        {Object.keys(aggregates).length === 0 ? (
          <p className="text-gray-700 text-[11px]">{t('indicatorDetail.none')}</p>
        ) : (
          <ul className="space-y-1">
            {Object.entries(aggregates).map(([ns, data]) => (
              <li key={ns} className="text-[10px]">
                <div className="text-gray-500 uppercase">{ns}</div>
                <pre className="text-gray-400 text-[10px] whitespace-pre-wrap break-words bg-[#050814] rounded border border-gray-800 px-1.5 py-1 mt-0.5">
                  {JSON.stringify(data, null, 2)}
                </pre>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="shrink-0 pt-1.5 border-t border-gray-800/60 flex justify-end">
        <button
          type="button"
          onClick={() => {
            // Switch focus to Panel 4 AND dispatch the explainer trigger.
            // Panel 4's listener is what actually fires the LLM call —
            // keeping that boundary explicit means a user navigating the
            // HeatMap doesn't accidentally rack up token spend.
            setActivePanel(4);
            window.dispatchEvent(
              new CustomEvent("terminal:run-explainer", {
                detail: { id: detail.id },
              }),
            );
          }}
          disabled={status === "green"}
          className="bg-[#00D4AA] text-[#050814] px-3 py-1 rounded font-semibold text-[11px] uppercase tracking-wider disabled:bg-gray-800 disabled:text-gray-600 disabled:cursor-not-allowed hover:bg-[#00E5BB]"
          title={
            status === "green"
              ? t('indicatorDetail.explainGreenDisabled')
              : t('indicatorDetail.explainTitle')
          }
        >
          {t('indicatorDetail.explainButton')}
        </button>
      </section>
    </div>
  );
}

function formatValue(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return Math.abs(v) >= 1000
    ? v.toFixed(0)
    : Math.abs(v) >= 10
    ? v.toFixed(1)
    : v.toFixed(2);
}

function forecastColor(confidence: ForecastConfidence): string {
  if (confidence === "high") return "text-[#00D4AA]";
  if (confidence === "medium") return "text-[#FFB800]";
  return "text-gray-400";
}

/**
 * Tier-3 sub-29 Round-17 closure — color-blind safe redundant signal
 * for forecast confidence band. Mirror of `forecastColor` shape side:
 *   high    → ● (green-status equivalent)
 *   medium  → ▲ (amber-status equivalent)
 *   low     → ◇ (unknown-status equivalent — "no strong signal")
 */
function forecastShape(confidence: ForecastConfidence): string {
  if (confidence === "high") return statusShape("green");
  if (confidence === "medium") return statusShape("amber");
  return statusShape("unknown");
}

/**
 * Phase C2 v2 (sub-22) — forecast badge + LLM-narrated explain panel.
 *
 * Layered UX:
 *   1. Always-visible badge (sub-13 v1 contract preserved): trend arrow,
 *      predicted value, confidence band + R² + n/12 pts.
 *   2. "Explain forecast" button — POSTs to
 *      `/api/indicators/values/[id]/forecast/explain`; transitions
 *      through loading → narrative card with 3 driver hypotheses + 3
 *      risk factors + LLM self-rated confidence. Auto-emits
 *      `ai_forecast_explainer_run` audit_event server-side.
 *   3. EN/RU/AZ language tabs (per `project_ai_output_language.md` —
 *      UI stays English, only LLM narrative switches).
 *
 * Mirror of the Variance Explainer panel UX from Phase 7.E (`/explain`
 * endpoint + Panel 4 narrative). Both exist because they answer
 * different CFO questions:
 *   - Variance: "this cell is red — why?" (reactive)
 *   - Forecast: "this cell is green but trajectory points down — what's coming?" (proactive)
 */
type ForecastLanguage = "en" | "ru" | "az";
interface ForecastExplainResponse {
  indicatorValueId: string;
  narrative: string;
  driverHypotheses: string[];
  riskFactors: string[];
  confidence: number;
  modelName: string;
  promptVersion: string;
  usage?: { inputTokens: number; outputTokens: number };
  /** Sub-23 — multi-step horizon (typically 3 steps: t+1, t+2, t+3). */
  horizon?: Array<{ step: number; predicted: number }>;
}
type ExplainState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; data: ForecastExplainResponse }
  | { kind: "error"; message: string };

function ForecastSection(props: {
  ivId: string;
  sparkline: (number | null)[];
}) {
  const t = useTranslations('terminal');
  const forecast = forecastNextPeriod(props.sparkline);
  const [language, setLanguage] = React.useState<ForecastLanguage>("en");
  const [explain, setExplain] = React.useState<ExplainState>({ kind: "idle" });

  if (!forecast) return null;
  // Treat near-zero slopes as "no change expected" — caller semantic
  // from forecast.ts jsdoc; avoids low-confidence-flat outputs being
  // interpreted as directional signals.
  const isFlat = Math.abs(forecast.slope) < 1e-9;
  // Sign mirrors 12mo trend Δ pattern: "+" on positive, none on
  // zero/negative. Architect sub-13 closure.
  const sign = forecast.predicted > 0 ? "+" : "";
  const trendArrow = isFlat ? "→" : forecast.slope > 0 ? "↑" : "↓";
  // Sub-24 — 95% prediction interval. Surfaces in v1 badge as
  // `±marginOfError` text. Hidden when interval collapses to ±0
  // (perfect-fit edge case — would clutter badge with redundant "±0").
  const ci = forecast.predictionInterval;
  const showCi = ci && ci.marginOfError > 1e-6;

  // Architect sub-22 ⚠️ closure: loosened UI gate to permit low-
  // confidence callers — system prompt has an explicit "LEAD WITH THE
  // LIMITATION" branch when r²<0.4 + n<5, so the LLM surfaces the
  // caveat rather than producing false-precision narration. Only
  // truly-flat slopes (no directional signal at all) hide the
  // affordance — those produce zero useful narration even with the
  // limitation caveat.
  const explainable = !isFlat;

  const runExplain = async () => {
    if (!explainable || explain.kind === "loading") return;
    setExplain({ kind: "loading" });
    try {
      const res = await fetch(
        `/api/indicators/values/${encodeURIComponent(props.ivId)}/forecast/explain`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ language }),
        },
      );
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(errBody.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as ForecastExplainResponse;
      setExplain({ kind: "ok", data });
    } catch (err: unknown) {
      setExplain({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <div
      className="flex flex-col gap-1 rounded border border-gray-800/60 bg-[#0A0E27]/40 px-2 py-1.5"
      data-testid="indicator-forecast"
    >
      {/* Row 1 — always-visible badge (sub-13 v1 contract). */}
      <div className="flex items-center gap-2">
        <span className="text-[9px] uppercase tracking-wider text-gray-500 shrink-0">
          {t('indicatorDetail.forecastNextPeriod')}
        </span>
        <span
          className={`text-[11px] font-mono tabular-nums ${forecastColor(forecast.confidence)}`}
        >
          {/* Round-17 closure — shape glyph next to predicted value
              encodes confidence band redundantly (color-blind safe). */}
          <span aria-hidden="true" className="mr-0.5 opacity-70">
            {forecastShape(forecast.confidence)}
          </span>
          {trendArrow} {sign}
          {formatValue(forecast.predicted)}
        </span>
        {/* Sub-24 — 95% prediction interval as ±range. Tabular-nums to
            keep the badge stable when CI value swaps width on
            re-render (different IV with different residuals). */}
        {showCi && (
          <span
            className="text-[10px] font-mono tabular-nums text-gray-500"
            data-testid="forecast-ci"
            title={`${t('indicatorDetail.forecastCITitle')} (n=${forecast.contributingCount}, df=${ci.degreesOfFreedom})`}
          >
            ±{formatValue(ci.marginOfError)}
          </span>
        )}
        <span className="text-[9px] text-gray-500 ml-auto">
          {isFlat
            ? t('indicatorDetail.forecastNoChange')
            : `${forecast.confidence} ${t('indicatorDetail.forecastConfidence')} · R² ${forecast.r2.toFixed(2)} · ${forecast.contributingCount}/12 ${t('indicatorDetail.forecastPts')}`}
        </span>
      </div>

      {/* Row 2 — explain affordance (Phase C2 v2). Hidden when
          forecast.confidence='low' or slope is flat (LLM has nothing
          meaningful to add). */}
      {explainable && (
        <div className="flex items-center gap-1.5 mt-0.5">
          {/* Language tabs — EN default; user can flip to RU/AZ before
              clicking Explain. Disabled while a request is in-flight. */}
          {(["en", "ru", "az"] as const).map((lang) => (
            <button
              key={lang}
              type="button"
              onClick={() => {
                if (explain.kind === "loading") return;
                setLanguage(lang);
                // If a narrative is already shown, clear it — clicking a
                // different language tab telegraphs intent to re-run.
                if (explain.kind === "ok" || explain.kind === "error") {
                  setExplain({ kind: "idle" });
                }
              }}
              disabled={explain.kind === "loading"}
              data-testid={`forecast-lang-${lang}`}
              className={`text-[9px] uppercase font-mono px-1.5 py-0.5 rounded border transition-colors ${
                language === lang
                  ? "border-[#00D4AA] text-[#00D4AA] bg-[#00D4AA]/10"
                  : "border-gray-800 text-gray-500 hover:border-gray-700 hover:text-gray-400"
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {lang}
            </button>
          ))}
          <button
            type="button"
            onClick={runExplain}
            disabled={explain.kind === "loading"}
            data-testid="forecast-explain-button"
            className="text-[10px] font-mono px-2 py-0.5 rounded border border-[#00D4AA]/40 bg-[#00D4AA]/5 text-[#00D4AA] hover:bg-[#00D4AA]/15 disabled:opacity-50 disabled:cursor-not-allowed ml-auto"
          >
            {explain.kind === "loading"
              ? t('indicatorDetail.explaining')
              : explain.kind === "ok"
                ? t('indicatorDetail.reRun')
                : t('indicatorDetail.explainButton')}
          </button>
        </div>
      )}

      {/* Row 3 — narrative card (only after successful response). */}
      {explain.kind === "ok" && (
        <div
          className="mt-1 border-t border-gray-800/40 pt-1.5 space-y-1.5"
          data-testid="forecast-narrative"
        >
          {/* Sub-23 — multi-step horizon strip (3 future steps).
              Renders as a sequence of step+N badges so the customer
              sees trajectory across the next quarter, not just one
              period. Hidden when horizon absent (single-step v2). */}
          {explain.data.horizon && explain.data.horizon.length > 1 && (
            <div
              className="flex items-center gap-1.5 flex-wrap"
              data-testid="forecast-horizon"
            >
              <span className="text-[9px] uppercase tracking-wider text-gray-500 shrink-0">
                {t('indicatorDetail.forecastHorizon')}
              </span>
              {explain.data.horizon.map((h) => (
                <span
                  key={h.step}
                  className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-gray-800/60 bg-[#0A0E27]/60 text-gray-300"
                  data-testid={`forecast-horizon-step-${h.step}`}
                >
                  <span className="text-gray-500">t+{h.step}</span>{" "}
                  <span className="tabular-nums">
                    {h.predicted > 0 ? "+" : ""}
                    {formatValue(h.predicted)}
                  </span>
                </span>
              ))}
              <span className="text-[9px] text-gray-600 ml-auto">
                {t('indicatorDetail.extrapolationCaveat')}
              </span>
            </div>
          )}
          <p className="text-[11px] text-gray-200 leading-snug">
            {explain.data.narrative}
          </p>
          {explain.data.driverHypotheses.length > 0 && (
            <div>
              <div className="text-[9px] uppercase tracking-wider text-gray-500 mb-0.5">
                {t('indicatorDetail.likelyDrivers')}
              </div>
              <ul className="text-[10px] text-gray-300 space-y-0.5 list-disc pl-4">
                {explain.data.driverHypotheses.map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ul>
            </div>
          )}
          {explain.data.riskFactors.length > 0 && (
            <div>
              <div className="text-[9px] uppercase tracking-wider text-gray-500 mb-0.5">
                {t('indicatorDetail.riskFactors')}
              </div>
              <ul className="text-[10px] text-[#FFB800] space-y-0.5 list-disc pl-4">
                {explain.data.riskFactors.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="text-[9px] text-gray-500 mt-1 flex items-center gap-2">
            <span>
              {t('indicatorDetail.llmConfidence')}: {(explain.data.confidence * 100).toFixed(0)}%
            </span>
            <span className="opacity-60">·</span>
            <span className="font-mono">{explain.data.modelName}</span>
            {explain.data.usage && (
              <>
                <span className="opacity-60">·</span>
                <span className="font-mono">
                  {explain.data.usage.inputTokens}/{explain.data.usage.outputTokens} tok
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Error state. */}
      {explain.kind === "error" && (
        <p
          role="alert"
          className="text-[10px] text-[#FF4757] mt-1"
          data-testid="forecast-explain-error"
        >
          {t('indicatorDetail.forecastExplainFailed')}: {explain.message}
        </p>
      )}
    </div>
  );
}
