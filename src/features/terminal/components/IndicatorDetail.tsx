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
import { useTerminalStore } from "../store/terminalStore";

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
