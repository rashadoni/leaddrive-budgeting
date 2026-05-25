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
import { NewsSummarySection } from "./NewsSummarySection";
import { MorningBriefIntro } from "./MorningBriefIntro";
import { MoversSection } from "./MoversSection";

/** Format large numbers compactly: -23189210599 → "-23.2B", 1500000 → "1.5M", 3200 → "3.2K" */
function fmtValue(v: number, unit: string): string {
  if (unit === "%") return `${v.toFixed(1)}%`;
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(1)}B ${unit}`.trim();
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(1)}M ${unit}`.trim();
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}K ${unit}`.trim();
  return `${v.toFixed(1)} ${unit}`.trim();
}
import { computeTopMovers, type MoverRow } from "@/lib/risk/movers";

interface WorstEntry {
  companyCode: string;
  indicatorCode: string;
  indicatorName: string;
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

/**
 * Phase 7.K 2026-05-18 — diversified worst-cells picker.
 *
 * Sort all red cells by magnitude (descending), then walk the list and
 * pick at most ONE per company until we have `topN`. This prevents one
 * dominant company (e.g. ATL with three -1000%+ margin cells) from
 * monopolizing the morning brief — the LLM now sees worst-of from
 * multiple business units and can write a holding-wide narrative
 * instead of an ATL-only one.
 *
 * Falls back to plain magnitude ordering if we exhaust unique companies
 * before reaching `topN` (small holdings).
 *
 * Phase 7.L 2026-05-18 — `broadcastIndicators` skip-set lets the caller
 * suppress country-wide macro signals (FX, CPI, trade balance) that
 * broadcast a single value to every company. Without this, a $23B
 * macro number outranked every per-company red cell by raw magnitude
 * — and listed the same broadcast value seven times in the panel
 * (one per services-tagged entity), which is meaningless ranking.
 */
/**
 * Indicator code prefixes that are always macro/country-level signals.
 * The auto-detector (`detectBroadcastIndicators`) catches most of them,
 * but country signals that only appear in 1-2 companies (below the ≥3
 * threshold) slip through. Hard-coded prefixes close the gap.
 */
const MACRO_SIGNAL_PREFIXES = ["SERV_AZ_", "AZ_MACRO_", "COUNTRY_"]

/**
 * True when a percentage value is so extreme it is almost certainly a
 * data artifact (division by near-zero revenue) rather than a real
 * business problem. Threshold: |value| > 300 % for %-unit indicators.
 */
function isExtremePercentArtifact(entry: WorstEntry): boolean {
  return entry.unit === "%" && Math.abs(entry.value) > 300
}

export function pickTopWorstDiversified(
  items: WorstEntry[],
  topN: number,
  broadcastIndicators?: ReadonlySet<string>,
): WorstEntry[] {
  const sorted = items
    .filter((t) => !broadcastIndicators?.has(t.indicatorCode))
    // Fix C: hard-exclude country-level macro signal indicator codes
    .filter((t) => !MACRO_SIGNAL_PREFIXES.some((p) => t.indicatorCode.startsWith(p)))
    // Fix A: hard-exclude extreme % artifacts (e.g. EBITDA -3188% from near-zero revenue)
    .filter((t) => !isExtremePercentArtifact(t))
    .map((t) => ({ t, s: Math.abs(t.value) }))
    .sort((a, b) => b.s - a.s)
    .map(({ t }) => t);
  const seen = new Set<string>();
  const out: WorstEntry[] = [];
  for (const r of sorted) {
    if (seen.has(r.companyCode)) continue;
    seen.add(r.companyCode);
    out.push(r);
    if (out.length >= topN) break;
  }
  // Backfill from highest-magnitude leftovers (different cells from
  // companies already covered) if we couldn't hit topN with unique
  // companies — keeps the list dense for very small holdings.
  if (out.length < topN) {
    for (const r of sorted) {
      if (out.includes(r)) continue;
      out.push(r);
      if (out.length >= topN) break;
    }
  }
  return out;
}

/**
 * Detect macro broadcast indicators: indicators where the same value
 * appears across ≥3 companies (or ≥50% of subscribers, whichever is
 * larger). These are usually country-wide macro signals — FX, CPI,
 * trade balance — that broadcast one number into every subscriber.
 * They poison the per-company "worst" ranking; see
 * `pickTopWorstDiversified` for the suppression mechanism.
 *
 * Floating-point round-trip noise from the recompute pipeline is
 * absorbed by rounding to 6 significant digits before counting.
 */
export function detectBroadcastIndicators(
  cells: ReadonlyArray<{
    indicatorId: string
    value: number | null
    status?: string
  }>,
  indicators: ReadonlyArray<{ id: string; code: string }>,
): ReadonlySet<string> {
  const indCodeById = new Map(indicators.map((i) => [i.id, i.code]))
  const freq = new Map<string, Map<string, number>>()
  for (const cell of cells) {
    if (cell.value == null || !Number.isFinite(cell.value)) continue
    const code = indCodeById.get(cell.indicatorId)
    if (!code) continue
    const bucketKey = cell.value.toPrecision(6)
    if (!freq.has(code)) freq.set(code, new Map())
    const m = freq.get(code)!
    m.set(bucketKey, (m.get(bucketKey) ?? 0) + 1)
  }
  const broadcast = new Set<string>()
  for (const [code, m] of freq) {
    // Total companies subscribed to this indicator = sum of buckets.
    const subscribers = Array.from(m.values()).reduce((a, b) => a + b, 0)
    const floor = Math.max(3, Math.floor(subscribers * 0.5))
    for (const count of m.values()) {
      if (count >= floor) {
        broadcast.add(code)
        break
      }
    }
  }
  return broadcast
}

export function TodayBrief() {
  const t = useTranslations("terminal");
  const { matrix } = useMatrix();
  const setActiveIv = useTerminalStore((s) => s.setActiveIndicatorValue);
  const setActivePanel = useTerminalStore((s) => s.setActivePanel);
  const setCompany = useTerminalStore((s) => s.selectCompany);
  const alertMatches = useTerminalStore((s) => s.alertMatches);

  const { worst, movers } = useMemo(() => {
    if (!matrix) return { worst: [] as WorstEntry[], movers: [] as MoverRow[] };
    const coById = new Map(matrix.companies.map((c) => [c.id, c.code]));
    const indById = new Map(matrix.indicators.map((i) => [i.id, i]));

    const reds: WorstEntry[] = [];
    for (const cell of matrix.cells) {
      const co = coById.get(cell.companyId);
      const ind = indById.get(cell.indicatorId);
      if (!co || !ind) continue;
      if (cell.status === "red" && Number.isFinite(cell.value)) {
        const indFull = ind as typeof ind & { nameRu?: string; nameEn?: string };
        reds.push({
          companyCode: co,
          indicatorCode: ind.code,
          indicatorName: indFull.nameRu ?? indFull.nameEn ?? ind.code,
          ivId: cell.indicatorValueId,
          value: cell.value,
          unit: ind.unit,
        });
      }
    }
    // Phase 7.H Feature 2 — movers now via shared helper, top-5 + sector
    // grouping (was top-3 inline, sector-blind).
    const moversTop5 = computeTopMovers(
      matrix.cells,
      matrix.companies,
      matrix.indicators,
      { topN: 5 },
    );
    // Phase 7.L 2026-05-18 — derive broadcast-indicator set first so the
    // worst-picker can skip macro signals (FX / CPI / trade-balance).
    // Without this, a $23B trade-balance number broadcasts to every
    // services entity and dominates the panel by raw magnitude.
    const broadcastIndicators = detectBroadcastIndicators(
      matrix.cells,
      matrix.indicators,
    );
    return {
      // Phase 7.K 2026-05-18 — diversified worst cells (top-1 per
      // company × 7 companies) so the morning brief covers the holding
      // breadth, not just one outlier. Old pickTop3 picked the absolute
      // 3 highest-magnitude cells, which were all ATL margins +
      // crowded out AAC / AZSEKER / SPARK / LLS reds.
      worst: pickTopWorstDiversified(reds, 7, broadcastIndicators),
      movers: moversTop5,
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
      className="font-mono text-[12px] text-gray-300 h-full w-full overflow-y-auto p-3 space-y-3"
      data-testid="today-brief"
    >
      <header className="border-b border-gray-800 pb-1">
        <h3 className="text-cyan-300 uppercase tracking-wider text-[10px]">{t("todayBrief.title")}</h3>
        <p className="text-gray-600 text-[9px] mt-0.5">{t("todayBrief.subtitle")}</p>
      </header>

      {/* Phase 7.E AI Morning Brief — narrative intro composed from
          worst/movers/alerts + last news bullets. Sits above the
          existing 4 derived sections. */}
      <MorningBriefIntro
        matrixReady={!!matrix}
        inputs={{
          worstCells: worst.map((w) => ({
            companyCode: w.companyCode,
            indicatorCode: w.indicatorCode,
            value: w.value,
            unit: w.unit,
          })),
          topMovers: movers.map((m) => ({
            companyCode: m.companyCode,
            indicatorCode: m.indicatorCode,
            deltaPct: m.deltaPct,
          })),
          activeAlerts: topAlerts.map((a) => ({
            severity: (a.severity as "info" | "warning" | "critical") ?? "info",
            message: a.message ?? "",
          })),
        }}
      />

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
                  // Phase 3.3 hover pattern — reveal full pair when truncated.
                  title={`${w.companyCode} · ${w.indicatorCode} — ${fmtValue(w.value, w.unit)}`}
                  className="w-full text-left flex items-baseline gap-2 px-1.5 py-1 rounded hover:bg-[#FF4757]/10 hover:text-[#FF4757]"
                >
                  <span className="font-mono text-cyan-300 text-[11px] w-28 truncate flex-shrink-0">{w.companyCode}</span>
                  <span className="font-mono text-gray-300 text-[12px] flex-1 truncate" title={w.indicatorCode}>{w.indicatorName}</span>
                  <span className="font-mono text-[#FF4757] text-[12px] tabular-nums flex-shrink-0">
                    {fmtValue(w.value, w.unit)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Movers — Phase 7.H Feature 2: top-5 grouped by sector. */}
      <MoversSection movers={movers} onOpen={handleOpen} />

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
                <span className="text-gray-400">{
                  // Localized message via `messageKey` + `messageParams`;
                  // alerts.messages.* lives under the terminal namespace
                  // (so `t` here = useTranslations("terminal")). Strip the
                  // "alerts.messages." namespace prefix produced by the
                  // engine; fall back to EN `message` if the key is
                  // missing in the locale file.
                  (() => {
                    const subKey = a.messageKey.startsWith("alerts.messages.")
                      ? `alerts.messages.${a.messageKey.slice("alerts.messages.".length)}`
                      : a.messageKey;
                    try {
                      // Cast through `unknown` — next-intl's t() generic
                      // demands compile-time-known keys; alert rule IDs are
                      // runtime-driven so we erase the type and rely on the
                      // catch fallback for missing keys.
                      const tt = t as unknown as (k: string, v: Record<string, string | number>) => string;
                      return tt(subKey, a.messageParams);
                    } catch {
                      return a.message;
                    }
                  })()
                }</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <NewsSummarySection />

      <footer className="text-[9px] text-gray-700 pt-1 border-t border-gray-800">
        {t("todayBrief.footerHint")}
      </footer>
    </div>
  );
}
