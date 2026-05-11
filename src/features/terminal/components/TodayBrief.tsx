"use client";

/**
 * Phase 7.G CLI Tier 2 #5 — Today's Brief panel.
 *
 * Renders inside Panel 3 (IndicatorDetail) as the default empty-state
 * content when no cell is selected. Bloomberg launchpad equivalent —
 * tells the CFO "what's bad today" in 3 seconds without a single click.
 *
 * 3 derived sections, all computed client-side from the active matrix:
 *   1. Top 3 worst — red cells sorted by absolute deviation from the red
 *      threshold (most-distant-from-safe first). Click → open that IV.
 *   2. Top 3 movers — cells with the largest sparkline trailing-12-month
 *      change (positive or negative magnitude). Surfaces silent drift
 *      that's not yet a red breach.
 *   3. Top 3 alerts — drawn from the rule-engine `alertMatches` slice
 *      (already populated by HeatMap on matrix fetch).
 *
 * Pure derived UI — no extra fetch, no extra store reads beyond what
 * IndicatorDetail already touches.
 */

import { useEffect, useMemo, useRef } from "react";
import { useTranslations } from "next-intl";
import { useMatrix } from "../hooks/use-matrix";
import { useTerminalStore } from "../store/terminalStore";
import { statusShape } from "@/lib/risk/heatmap-matrix";

interface MoverEntry {
  companyCode: string;
  indicatorCode: string;
  ivId?: string;
  delta: number;
  deltaPct: number;
  status: "green" | "amber" | "red" | "unknown";
}

interface WorstEntry {
  companyCode: string;
  indicatorCode: string;
  ivId?: string;
  value: number;
  unit: string;
}

function pickTop3<T>(items: T[], scoreFn: (t: T) => number): T[] {
  return items
    .map((t) => ({ t, s: scoreFn(t) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 3)
    .map(({ t }) => t);
}

export function TodayBrief() {
  const t = useTranslations("terminal");
  const { matrix } = useMatrix();
  const setActiveIv = useTerminalStore((s) => s.setActiveIndicatorValue);
  const setActivePanel = useTerminalStore((s) => s.setActivePanel);
  const setCompany = useTerminalStore((s) => s.selectCompany);
  const alertMatches = useTerminalStore((s) => s.alertMatches);

  const { worst, movers } = useMemo(() => {
    if (!matrix) return { worst: [] as WorstEntry[], movers: [] as MoverEntry[] };
    const coById = new Map(matrix.companies.map((c) => [c.id, c.code]));
    const indById = new Map(matrix.indicators.map((i) => [i.id, i]));

    const reds: WorstEntry[] = [];
    const moverPool: MoverEntry[] = [];
    for (const cell of matrix.cells) {
      const co = coById.get(cell.companyId);
      const ind = indById.get(cell.indicatorId);
      if (!co || !ind) continue;
      // Worst = red cells, sorted by |value| (largest deviation first).
      if (cell.status === "red" && Number.isFinite(cell.value)) {
        reds.push({
          companyCode: co,
          indicatorCode: ind.code,
          ivId: cell.indicatorValueId,
          value: cell.value,
          unit: ind.unit,
        });
      }
      // Movers — sparkline available, take first vs last numeric values.
      if (cell.sparkline && cell.sparkline.length >= 2) {
        const vals = cell.sparkline.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
        if (vals.length >= 2) {
          const first = vals[0];
          const last = vals[vals.length - 1];
          if (Math.abs(first) > 0.0001) {
            const delta = last - first;
            const deltaPct = (delta / Math.abs(first)) * 100;
            if (Number.isFinite(deltaPct)) {
              moverPool.push({
                companyCode: co,
                indicatorCode: ind.code,
                ivId: cell.indicatorValueId,
                delta,
                deltaPct,
                status: cell.status,
              });
            }
          }
        }
      }
    }
    return {
      worst: pickTop3(reds, (r) => Math.abs(r.value)),
      movers: pickTop3(moverPool, (m) => Math.abs(m.deltaPct)),
    };
  }, [matrix]);

  const topAlerts = useMemo(() => {
    if (!alertMatches) return [];
    return alertMatches.slice(0, 3);
  }, [alertMatches]);

  const handleOpen = (companyCode: string, ivId?: string) => {
    setCompany(companyCode);
    if (ivId) {
      setActiveIv(ivId);
      setActivePanel(3);
      // CLI Tier 2 #7 — auto-fire Variance Explainer when user clicks
      // a Today's Brief row. One click → IV detail + AI narrative.
      // VarianceExplainerPanel internally caches per-IV-id so repeated
      // clicks on the same row don't burn LLM tokens.
      window.dispatchEvent(
        new CustomEvent("terminal:run-explainer", { detail: { id: ivId } }),
      );
    }
  };

  // CLI Tier 2 #7 — pre-warm AI Variance Explainer for the #1 worst red
  // cell on terminal mount. Single LLM call (~$0.05) gives CFO immediate
  // narrative when they switch to Panel 4. Subsequent mounts hit the
  // module-level cache in VarianceExplainerPanel (no re-spend).
  const preWarmedRef = useRef<string | null>(null);
  useEffect(() => {
    if (worst.length === 0) return;
    const topIvId = worst[0]?.ivId;
    if (!topIvId || preWarmedRef.current === topIvId) return;
    preWarmedRef.current = topIvId;
    // Slight delay so the matrix render finishes first.
    const handle = window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("terminal:run-explainer", { detail: { id: topIvId } }),
      );
    }, 1500);
    return () => window.clearTimeout(handle);
  }, [worst]);

  return (
    <div
      className="font-mono text-[11px] text-gray-300 h-full w-full overflow-y-auto p-3 space-y-3"
      data-testid="today-brief"
    >
      <header className="border-b border-gray-800 pb-1">
        <h3 className="text-cyan-300 uppercase tracking-wider text-[10px]">{t("todayBrief.title")}</h3>
        <p className="text-gray-600 text-[9px] mt-0.5">{t("todayBrief.subtitle")}</p>
      </header>

      {/* Worst */}
      <section>
        <h4 className="text-[10px] uppercase tracking-wider text-[#FF4757] mb-1">
          {statusShape("red")} {t("todayBrief.worstTitle")}
        </h4>
        {worst.length === 0 ? (
          <p className="text-[10px] text-gray-600">{t("todayBrief.empty")}</p>
        ) : (
          <ul className="space-y-0.5">
            {worst.map((w, i) => (
              <li key={`${w.companyCode}-${w.indicatorCode}-${i}`}>
                <button
                  type="button"
                  onClick={() => handleOpen(w.companyCode, w.ivId)}
                  className="w-full text-left flex items-baseline gap-2 px-1.5 py-0.5 rounded hover:bg-[#FF4757]/10 hover:text-[#FF4757]"
                >
                  <span className="font-mono text-cyan-300 text-[10px] w-32 truncate">{w.companyCode}</span>
                  <span className="font-mono text-gray-400 text-[10px] flex-1 truncate">{w.indicatorCode}</span>
                  <span className="font-mono text-[#FF4757] text-[10px] tabular-nums">
                    {w.value.toFixed(1)} {w.unit}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Movers */}
      <section>
        <h4 className="text-[10px] uppercase tracking-wider text-[#FFB020] mb-1">
          ↕ {t("todayBrief.moversTitle")}
        </h4>
        {movers.length === 0 ? (
          <p className="text-[10px] text-gray-600">{t("todayBrief.empty")}</p>
        ) : (
          <ul className="space-y-0.5">
            {movers.map((m, i) => {
              const arrow = m.delta > 0 ? "▲" : "▼";
              const tone = m.delta > 0 ? "text-emerald-400" : "text-rose-400";
              return (
                <li key={`${m.companyCode}-${m.indicatorCode}-${i}`}>
                  <button
                    type="button"
                    onClick={() => handleOpen(m.companyCode, m.ivId)}
                    className="w-full text-left flex items-baseline gap-2 px-1.5 py-0.5 rounded hover:bg-cyan-500/10"
                  >
                    <span className="font-mono text-cyan-300 text-[10px] w-32 truncate">{m.companyCode}</span>
                    <span className="font-mono text-gray-400 text-[10px] flex-1 truncate">{m.indicatorCode}</span>
                    <span className={`font-mono text-[10px] tabular-nums ${tone}`}>
                      {arrow} {m.deltaPct.toFixed(1)}%
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Alerts */}
      <section>
        <h4 className="text-[10px] uppercase tracking-wider text-amber-300 mb-1">
          ⚠ {t("todayBrief.alertsTitle")}
        </h4>
        {topAlerts.length === 0 ? (
          <p className="text-[10px] text-gray-600">{t("todayBrief.empty")}</p>
        ) : (
          <ul className="space-y-0.5">
            {topAlerts.map((a, i) => (
              <li key={`${a.ruleId}-${i}`} className="px-1.5 py-0.5 text-[10px] text-amber-200/90">
                <span className="text-cyan-300 font-mono mr-2">{a.ruleId}</span>
                <span className="text-gray-400">{a.message.slice(0, 80)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="text-[9px] text-gray-700 pt-1 border-t border-gray-800">
        {t("todayBrief.footerHint")}
      </footer>
    </div>
  );
}
