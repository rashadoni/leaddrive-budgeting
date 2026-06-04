"use client";

/**
 * Panel-3 forecast subsystem — extracted from IndicatorDetail.tsx (Phase 8 D1
 * 2026-05-29). The `ForecastSection` component (next-period forecast + the
 * AI "explain" flow with fact-check flags) plus its block-internal helpers
 * (`forecastColor` / `forecastShape`) and types (`ForecastLanguage` /
 * `ForecastFactCheckFlag` / `ForecastExplainResponse` / `ExplainState`).
 * Reads data only through props (`ivId` / `sparkline` / `unit`) + the
 * shared format helpers; IndicatorDetail imports `ForecastSection` back.
 */

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { forecastNextPeriod, type ForecastConfidence } from "@/lib/risk/forecast";
import { statusShape } from "@/lib/risk/heatmap-matrix";
import { formatValue, formatHeadlineValue } from "./format";
import { localizeFactCheckFlag } from "../../lib/localize-fact-check";

function forecastColor(confidence: ForecastConfidence): string {
  if (confidence === "high") return "text-emerald-600 dark:text-emerald-400";
  if (confidence === "medium") return "text-amber-600 dark:text-amber-400";
  return "text-muted-foreground";
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
interface ForecastFactCheckFlag {
  reason: string;
  claim: string;
  severity: "warn" | "info";
  suggestion: string;
  /** Phase i18n — stable code + params for localizing reason/suggestion. */
  code?: "numberAbsent" | "numberUnmatched" | "futureYear";
  params?: Record<string, string | number>;
}
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
  /** Phase 7.O C3 — programmatic narrative fact-check. Optional for
   *  back-compat with older cached responses. */
  factCheck?: {
    flags: ForecastFactCheckFlag[];
    totalChecked: number;
    matched: number;
  };
}
type ExplainState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; data: ForecastExplainResponse }
  | { kind: "error"; message: string };

export function ForecastSection(props: {
  ivId: string;
  sparkline: (number | null)[];
  unit: string;
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
      className="flex flex-col gap-1 rounded border border-border/60 bg-[#0A0E27]/40 px-2 py-1.5"
      data-testid="indicator-forecast"
    >
      {/* Row 1 — always-visible badge (sub-13 v1 contract). */}
      <div className="flex items-center gap-2">
        <span className="text-[9px] uppercase tracking-wider text-muted-foreground shrink-0">
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
          {formatHeadlineValue(forecast.predicted, props.unit)}
        </span>
        {/* Sub-24 — 95% prediction interval as ±range. Tabular-nums to
            keep the badge stable when CI value swaps width on
            re-render (different IV with different residuals). */}
        {showCi && (
          <span
            className="text-[10px] font-mono tabular-nums text-muted-foreground"
            data-testid="forecast-ci"
            title={`${t('indicatorDetail.forecastCITitle')} (n=${forecast.contributingCount}, df=${ci.degreesOfFreedom})`}
          >
            ±{formatHeadlineValue(ci.marginOfError, props.unit)}
          </span>
        )}
        <span className="text-[9px] text-muted-foreground ml-auto">
          {isFlat
            ? t('indicatorDetail.forecastNoChange')
            : (() => {
                // Phase 7.G Turn VII — localize confidence value
                // (high/medium/low). Pre-Turn-VII rendered raw EN
                // alongside the localized "уверенность"/"inam" label.
                const confidenceKey =
                  forecast.confidence === 'high'
                    ? 'indicatorDetail.confidenceHigh'
                    : forecast.confidence === 'low'
                      ? 'indicatorDetail.confidenceLow'
                      : 'indicatorDetail.confidenceMedium';
                return `${t(confidenceKey)} ${t('indicatorDetail.forecastConfidence')} · R² ${forecast.r2.toFixed(2)} · ${forecast.contributingCount}/12 ${t('indicatorDetail.forecastPts')}`;
              })()}
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
                  ? "border-emerald-500 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
                  : "border-border text-muted-foreground hover:border-input hover:text-foreground"
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
            className="text-[10px] font-mono px-2 py-0.5 rounded border border-emerald-500/40 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/15 disabled:opacity-50 disabled:cursor-not-allowed ml-auto"
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
          className="mt-1 border-t border-border/40 pt-1.5 space-y-1.5"
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
              <span className="text-[9px] uppercase tracking-wider text-muted-foreground shrink-0">
                {t('indicatorDetail.forecastHorizon')}
              </span>
              {explain.data.horizon.map((h) => (
                <span
                  key={h.step}
                  className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-border/60 bg-[#0A0E27]/60 text-muted-foreground"
                  data-testid={`forecast-horizon-step-${h.step}`}
                >
                  <span className="text-muted-foreground">t+{h.step}</span>{" "}
                  <span className="tabular-nums">
                    {h.predicted > 0 ? "+" : ""}
                    {formatValue(h.predicted)}
                  </span>
                </span>
              ))}
              <span className="text-[9px] text-muted-foreground ml-auto">
                {t('indicatorDetail.extrapolationCaveat')}
              </span>
            </div>
          )}
          <p className="text-[11px] text-gray-200 leading-snug">
            {explain.data.narrative}
          </p>
          {/* Phase 7.O C3 — fact-check banner. Amber when hallucinated
              numbers found in narrative; subtle green tick when all cited
              values matched the forecast snapshot. */}
          {explain.data.factCheck && explain.data.factCheck.flags.length > 0 && (
            <div
              className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5"
              role="status"
              aria-live="polite"
              data-testid="forecast-fact-check"
            >
              <div className="text-amber-600 dark:text-amber-400 text-[10px] uppercase tracking-wider mb-0.5">
                {t('varianceExplainer.factCheck.title')}
              </div>
              <ul className="space-y-1">
                {explain.data.factCheck.flags.map((f, i) => {
                  const localized = localizeFactCheckFlag(f, t);
                  return (
                    <li key={i} className="text-[10px] leading-snug text-gray-200">
                      <span className="font-mono px-1 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300">
                        {f.claim}
                      </span>{" "}
                      — {localized.reason}{" "}
                      <span className="text-muted-foreground">{localized.suggestion}</span>
                    </li>
                  );
                })}
              </ul>
              <p className="text-muted-foreground text-[9px] mt-1">
                {t('varianceExplainer.factCheck.summary', {
                  matched: explain.data.factCheck.matched,
                  total: explain.data.factCheck.totalChecked,
                })}
              </p>
            </div>
          )}
          {explain.data.factCheck &&
            explain.data.factCheck.flags.length === 0 &&
            explain.data.factCheck.totalChecked > 0 && (
              <p className="text-[9px] text-emerald-600 dark:text-emerald-400">
                ✓{' '}
                {t('varianceExplainer.factCheck.allMatched', {
                  total: explain.data.factCheck.totalChecked,
                })}
              </p>
            )}
          {explain.data.driverHypotheses.length > 0 && (
            <div>
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground mb-0.5">
                {t('indicatorDetail.likelyDrivers')}
              </div>
              <ul className="text-[10px] text-muted-foreground space-y-0.5 list-disc pl-4">
                {explain.data.driverHypotheses.map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ul>
            </div>
          )}
          {explain.data.riskFactors.length > 0 && (
            <div>
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground mb-0.5">
                {t('indicatorDetail.riskFactors')}
              </div>
              <ul className="text-[10px] text-[#FFB800] space-y-0.5 list-disc pl-4">
                {explain.data.riskFactors.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="text-[9px] text-muted-foreground mt-1 flex items-center gap-2">
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
          className="text-[10px] text-red-600 dark:text-red-400 mt-1"
          data-testid="forecast-explain-error"
        >
          {/* Neutral, localized — never the raw provider error. */}
          {t('aiUnavailable')}
        </p>
      )}
    </div>
  );
}

