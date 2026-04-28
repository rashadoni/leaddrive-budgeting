"use client";

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
import { Sparkline, type SparklineStatus } from "./Sparkline";
import { useTerminalStore } from "../store/terminalStore";
import {
  forecastNextPeriod,
  type ForecastConfidence,
} from "@/lib/risk/forecast";

interface IndicatorMeta {
  id: string;
  code: string;
  nameEn: string;
  unit: string;
  direction: "higher_better" | "lower_better" | "band";
  formula: string;
  thresholds: unknown;
  hintTemplateEn: string | null;
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

export function IndicatorDetail() {
  const ivId = useTerminalStore((s) => s.activeIndicatorValueId);
  const setActivePanel = useTerminalStore((s) => s.setActivePanel);

  const [detail, setDetail] = useState<IndicatorValueDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  }, [ivId]);

  if (!ivId) {
    return (
      <div className="text-gray-700 font-mono text-xs leading-relaxed">
        Click any HeatMap cell to drill down.
        <br />
        <br />
        <span className="text-gray-600">
          Or type <span className="text-[#FFB800]">IND_OPEX_RATIO IND GO</span> in the
          command bar.
        </span>
      </div>
    );
  }
  if (loading) {
    return <span className="text-gray-700 font-mono text-xs">Loading...</span>;
  }
  if (error) {
    return <span className="text-[#FF4757] font-mono text-xs">Error: {error}</span>;
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
            {ind.code} <span className="text-gray-500 font-normal">— {ind.nameEn}</span>
          </div>
          <div className="text-gray-600 text-[10px] mt-0.5">
            period {period} · direction {ind.direction} · unit {ind.unit}
          </div>
        </div>
        <div className="text-right shrink-0">
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
            {status}
          </div>
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
            12mo trend
          </span>
          <Sparkline
            data={detail.sparkline}
            status={status as SparklineStatus}
            ariaLabel={`${ind.code} 12-month trend for ${co.code}`}
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

      {/* Phase C2 v1 — predictive forecast for the next period. Pulls
          from the same sparkline series; rendered only when the
          forecast helper has ≥3 contributing points. Confidence drives
          the color tone (high=green, medium=amber, low=gray). */}
      {detail.sparkline && detail.sparkline.length > 0 && (() => {
        const forecast = forecastNextPeriod(detail.sparkline);
        if (!forecast) return null;
        // Treat near-zero slopes as "no change expected" — caller
        // semantic from forecast.ts jsdoc; avoids "high-confidence
        // flat" being interpreted as a meaningful directional signal.
        const isFlat = Math.abs(forecast.slope) < 1e-9;
        const sign =
          isFlat ? "" : forecast.predicted > 0 && forecast.slope > 0 ? "+" : "";
        const trendArrow = isFlat ? "→" : forecast.slope > 0 ? "↑" : "↓";
        return (
          <div
            className="flex items-center gap-2 rounded border border-gray-800/60 bg-[#0A0E27]/40 px-2 py-1.5"
            data-testid="indicator-forecast"
          >
            <span className="text-[9px] uppercase tracking-wider text-gray-500 shrink-0">
              Next-period forecast
            </span>
            <span
              className={`text-[11px] font-mono tabular-nums ${forecastColor(forecast.confidence)}`}
            >
              {trendArrow} {sign}
              {formatValue(forecast.predicted)}
            </span>
            <span className="text-[9px] text-gray-500 ml-auto">
              {isFlat
                ? "no change expected"
                : `${forecast.confidence} confidence · R² ${(forecast.r2).toFixed(2)} · ${forecast.contributingCount}/12 pts`}
            </span>
          </div>
        );
      })()}

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
          ⚠ Calibrated against US benchmark (Damodaran). AZ-market data
          pending — treat as directional signal only.
        </p>
      )}

      {errPayload && (
        <div className="rounded border border-[#6B7280]/40 bg-[#6B7280]/10 px-2 py-1.5">
          <div className="text-[#FFB020] text-[10px] uppercase tracking-wider mb-0.5">
            Pipeline note
          </div>
          <div className="text-gray-300 text-[11px]">
            <span className="text-gray-500">{errPayload.code}:</span> {errPayload.reason}
          </div>
        </div>
      )}

      <section>
        <div className="text-gray-500 uppercase tracking-wider text-[9px] mb-0.5">
          Formula
        </div>
        <code className="block bg-[#050814] rounded border border-gray-800 px-2 py-1 text-[#00D4AA] text-[11px] whitespace-pre-wrap break-all">
          {ind.formula}
        </code>
      </section>

      <section>
        <div className="text-gray-500 uppercase tracking-wider text-[9px] mb-0.5">
          Resolved variables
        </div>
        {Object.keys(resolved).length === 0 ? (
          <p className="text-gray-700 text-[11px]">
            (none — likely missing-data / unknown status)
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
          Aggregates
        </div>
        {Object.keys(aggregates).length === 0 ? (
          <p className="text-gray-700 text-[11px]">(none)</p>
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
              ? "Variance explainer is for amber / red / unknown only"
              : "Open AI Variance Explainer in Panel 4 + run for current cell"
          }
        >
          Explain →
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
