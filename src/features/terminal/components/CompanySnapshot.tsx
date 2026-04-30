"use client";

/**
 * Phase B7 (Bloomberg uplift plan) — multi-chart company snapshot.
 *
 * Augments VarianceExplainerPanel's empty state (no IV selected). When
 * an `activeCompanyCode` IS set but no IV is drilled down, render 3
 * mini-sparkline cards stacked horizontally:
 *   - Gross Margin (IND_GROSS_MARGIN)
 *   - Net Margin (IND_NET_MARGIN)
 *   - OpEx Ratio (IND_OPEX_RATIO)
 *
 * If the active company doesn't have one or more of these IVs, that
 * card shows "no data" — total absence falls back to the original
 * "Pick a HeatMap cell" instruction.
 *
 * Plan §B7 listed "revenue / margin / FCF" as the trio; v1 ships
 * margin-trio because the existing indicators are ratio-shaped and
 * Phase 7.A.0 hasn't shipped revenue/FCF level indicators yet. 🔄'd.
 *
 * Data source: own `/api/indicators/matrix` fetch (small dup with
 * HeatMap + ComparePanel — covered by existing CARRYOVER 🔄). Refetches
 * via `useEventStream` on indicator:changed for live update.
 */

import React, { useMemo } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useMatrix } from "../hooks/use-matrix";
import { Sparkline, type SparklineStatus } from "./Sparkline";
import { useEventStream } from "@/lib/events/use-event-stream";
import { useTerminalStore } from "../store/terminalStore";
import { computeCompositeByCompany } from "@/lib/risk/composite-score";
import { DEFAULT_ALERT_RULE_IDS } from "@/lib/risk/alert-rules";
import { resolveIndicatorLabel } from "../lib/resolve-indicator-label";

// Sub-20: local MatrixCell/Company/Indicator types removed in favor of
// the canonical shapes exported by `useMatrix` hook (HeatMapCell from
// composite-score.ts + MatrixCompanyRow/MatrixIndicatorCol from the
// hook). Local `'missing'` literal was a UI fiction — endpoint emits
// only 4 IndicatorStatus values (green/amber/red/unknown).
import { statusShape, type HeatMapCell } from "@/lib/risk/heatmap-matrix";
import type {
  MatrixCompanyRow as MatrixCompany,
  MatrixIndicatorCol as MatrixIndicator,
} from "../hooks/use-matrix";
type MatrixCell = HeatMapCell;

const SNAPSHOT_INDICATOR_CODES = [
  "IND_GROSS_MARGIN",
  "IND_NET_MARGIN",
  "IND_OPEX_RATIO",
] as const;

interface Props {
  companyCode: string;
}

export function CompanySnapshot({ companyCode }: Props) {
  const t = useTranslations("terminal");
  const locale = useLocale();
  // Sub-20: shared `useMatrix()` hook. Module cache means CompanySnapshot
  // mounts (one per active company drilldown) reuse HeatMap's already-
  // fetched matrix instead of N round-trips. SSE-driven refetch goes
  // through `refresh()` so the cache invalidates and HeatMap +
  // ComparePanel + this snapshot all see fresh data.
  const { matrix: data, loading, error, refresh } = useMatrix();
  // Sub-27 cont'd Round-5 — extend snapshot toward GU-equivalent
  // CompanyOverview per plan §1: composite + status chips + top alerts.
  const alertMatches = useTerminalStore((s) => s.alertMatches);

  // SSE live-update on indicator changes (B1).
  useEventStream({
    onIndicatorChanged: () => {
      refresh();
    },
  });

  // computed before early returns so React hook order stays stable
  const company = data?.companies.find((c) => c.code === companyCode);
  const compositeByCo = useMemo(() => {
    if (!data) return new Map();
    return computeCompositeByCompany(data.cells);
  }, [data]);
  const composite = company ? compositeByCo.get(company.id) : null;
  const statusCounts = useMemo(() => {
    if (!data || !company) return null;
    const cells = data.cells.filter(
      (c) => c.companyId === company.id && !c.isSubgroupRollup,
    );
    return {
      green: cells.filter((c) => c.status === "green").length,
      amber: cells.filter((c) => c.status === "amber").length,
      red: cells.filter((c) => c.status === "red").length,
      unknown: cells.filter((c) => c.status === "unknown").length,
      total: cells.length,
    };
  }, [data, company]);
  const companyAlerts = useMemo(() => {
    if (!alertMatches || !company) return [];
    return alertMatches
      .filter((m) => m.affectedCompanyIds.includes(company.id))
      .slice(0, 3);
  }, [alertMatches, company]);

  if (loading && !data) {
    return (
      <div className="text-gray-700 font-mono text-xs leading-relaxed">
        {t("snapshot.loading")}
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="text-[#FF4757] font-mono text-xs">
        {t("snapshot.error")}: {error ?? "no data"}
      </div>
    );
  }

  if (!company) {
    return (
      <div className="text-gray-700 font-mono text-xs">
        {t("snapshot.companyNotInMatrix")} <code>{companyCode}</code>.
      </div>
    );
  }

  const cards = SNAPSHOT_INDICATOR_CODES.map((code) => {
    const ind = data.indicators.find((i) => i.code === code);
    if (!ind) return null;
    const cell = data.cells.find(
      (c) => c.companyId === company.id && c.indicatorId === ind.id,
    );
    return { indicator: ind, cell };
  }).filter((x): x is { indicator: MatrixIndicator; cell: MatrixCell | undefined } => x !== null);

  // No matching indicators at all (sector mismatch) → fall back gracefully.
  const noPLIndicators = cards.length === 0;

  return (
    <div className="font-mono text-xs flex flex-col gap-2">
      <div className="text-[10px] uppercase tracking-wider text-gray-500 flex items-center justify-between">
        <span>
          {t("snapshot.title")} · <span className="text-[#FFB020]">{company.code}</span>
          {company.industry && (
            <span className="text-gray-600 ml-1.5 normal-case font-sans text-[9px]">
              {company.industry}
            </span>
          )}
        </span>
        <span className="text-gray-600">{t("snapshot.trend12mo")}</span>
      </div>

      {/* Sub-27 cont'd Round-5 GU-equivalent overview: composite badge +
          status chip strip. Density punch — one row of 4 chips covering
          Bloomberg's "everything at a glance" pattern. */}
      <div className="flex items-center gap-2 px-2 py-1.5 rounded border border-gray-800/60 bg-[#0A0E27]/60">
        <CompositeBadgeBig score={composite?.score ?? null} />
        {statusCounts && statusCounts.total > 0 && (
          <div className="flex items-center gap-1 text-[9px] tabular-nums">
            <StatusChip count={statusCounts.green} color="#00D4AA" label="G" shape={statusShape("green")} />
            <StatusChip count={statusCounts.amber} color="#FFB020" label="A" shape={statusShape("amber")} />
            <StatusChip count={statusCounts.red} color="#FF4757" label="R" shape={statusShape("red")} />
            {statusCounts.unknown > 0 && (
              <StatusChip count={statusCounts.unknown} color="#6B7280" label="?" shape={statusShape("unknown")} />
            )}
          </div>
        )}
        <span className="text-[9px] text-gray-600 ml-auto">
          {statusCounts?.total ?? 0} {t("snapshot.indicators")}
        </span>
      </div>

      {/* Top alerts for this company — Bloomberg-grade "what needs my
          attention RIGHT NOW" surface. Pulls from terminalStore.alertMatches
          (populated by HeatMap's evaluateAlertRules). Empty-state suppressed
          (no chip = no alerts = good news). */}
      {companyAlerts.length > 0 && (
        <div className="flex flex-col gap-1 px-2 py-1.5 rounded border border-[#FFB020]/30 bg-[#FFB020]/5">
          <div className="text-[9px] uppercase tracking-wider text-[#FFB020]">
            {t("snapshot.topAlerts")} · {companyAlerts.length}
          </div>
          <ul className="text-[10px] space-y-0.5">
            {companyAlerts.map((m, i) => {
              const dotColor =
                m.severity === "critical"
                  ? "bg-[#FF4757]"
                  : m.severity === "warning"
                    ? "bg-[#FFB020]"
                    : "bg-gray-500";
              // Tier-3 sub-29 Round-18 closure — color-blind safe redundant
              // signal for top-alert severity dots. Map alert-severity
              // (critical/warning/info) → IndicatorStatus (red/amber/unknown)
              // → statusShape glyph (■/▲/◇). Glyph sits next to the dot at
              // matching color; for color-blind users the shape is the
              // primary cue, dot becomes secondary.
              const dotShapeStatus =
                m.severity === "critical"
                  ? "red"
                  : m.severity === "warning"
                    ? "amber"
                    : "unknown";
              const dotTextColor =
                m.severity === "critical"
                  ? "text-[#FF4757]"
                  : m.severity === "warning"
                    ? "text-[#FFB020]"
                    : "text-gray-500";
              // Sub-35 — locale-aware alert message body. Built-in
              // rules use the i18n template; custom / synthetic ids fall
              // back to engine-emitted English `m.message`.
              let alertBody = m.message;
              if (m.messageKey && DEFAULT_ALERT_RULE_IDS.has(m.ruleId)) {
                try {
                  alertBody = t(
                    m.messageKey as never,
                    m.messageParams as never,
                  );
                } catch {
                  alertBody = m.message;
                }
              }
              return (
                <li key={i} className="flex items-start gap-1.5 leading-tight">
                  <span className={`w-1 h-1 rounded-full mt-1 shrink-0 ${dotColor}`} />
                  <span
                    aria-hidden="true"
                    className={`text-[8px] leading-none mt-0.5 shrink-0 ${dotTextColor}`}
                  >
                    {statusShape(dotShapeStatus)}
                  </span>
                  <span className="text-gray-300 truncate">{alertBody}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Margin trio cards (existing) */}
      {!noPLIndicators ? (
        <div className="flex flex-wrap gap-2">
          {cards.map(({ indicator, cell }) => (
            <div key={indicator.id} className="flex-1 min-w-[120px]">
              <SnapshotCard indicator={indicator} cell={cell} locale={locale} />
            </div>
          ))}
        </div>
      ) : (
        <div className="text-gray-700 text-[11px] leading-relaxed">
          {t("snapshot.noPlIndicators")}{" "}
          <span className="text-[#FFB020]">{companyCode}</span>.
        </div>
      )}

      <p className="text-[10px] text-gray-600 mt-1">
        {t("snapshot.footerHint")}
      </p>
    </div>
  );
}

function CompositeBadgeBig({ score }: { score: number | null }) {
  // Round-11 architect closure — locale-aware label. Was hardcoded
  // English "Score" regardless of selected locale.
  const t = useTranslations("terminal");
  if (score === null) {
    return (
      <div className="flex flex-col items-center px-2 py-0.5 rounded border border-gray-800 bg-[#050814]">
        <span className="text-[9px] text-gray-600 uppercase tracking-wider">
          {t("snapshot.scoreLabel")}
        </span>
        <span className="text-gray-700 font-mono text-base font-bold">—</span>
      </div>
    );
  }
  const tone =
    score >= 67 ? "#00D4AA" : score >= 34 ? "#FFB020" : "#FF4757";
  // Tier-3 sub-29 M7 — shape glyph alongside score for color-blind parity.
  // Round-15 architect 💡 closure — DRY: route band → statusShape() so
  // glyph mapping stays single-source-of-truth in heatmap-matrix.ts.
  const band = score >= 67 ? "green" : score >= 34 ? "amber" : "red";
  const shape = statusShape(band);
  return (
    <div
      className="flex flex-col items-center px-2 py-0.5 rounded border bg-[#050814]"
      style={{ borderColor: `${tone}66` }}
    >
      <span className="text-[9px] text-gray-500 uppercase tracking-wider">
        {t("snapshot.scoreLabel")}
      </span>
      <span
        className="font-mono text-base font-bold tabular-nums flex items-center gap-1"
        style={{ color: tone }}
      >
        <span aria-hidden="true" className="text-[10px] opacity-70">
          {shape}
        </span>
        {score}
      </span>
    </div>
  );
}

function StatusChip({
  count,
  color,
  label,
  shape,
}: {
  count: number;
  color: string;
  label: string;
  /** Tier-3 sub-29 M7 — single-glyph shape paired with status for
   *  color-blind redundancy. Optional for back-compat with any future
   *  caller that doesn't supply one. */
  shape?: string;
}) {
  return (
    <span
      className="px-1 py-0.5 rounded font-bold tabular-nums"
      style={{
        color,
        backgroundColor: `${color}1A`,
        opacity: count > 0 ? 1 : 0.4,
      }}
      title={`${count} ${label}`}
    >
      {shape && (
        <span aria-hidden="true" className="mr-0.5 opacity-70">
          {shape}
        </span>
      )}
      {count}
      <span className="ml-0.5 opacity-70">{label}</span>
    </span>
  );
}

function SnapshotCard({
  indicator,
  cell,
  locale,
}: {
  indicator: MatrixIndicator;
  cell: MatrixCell | undefined;
  locale: string;
}) {
  // Sub-33 Round-30 closure — local i18n hook for the sparkline
  // ariaLabel (was hardcoded `${indicator.code} 12-month trend`
  // English-only).
  const t = useTranslations("terminal");
  const status = (cell?.status ?? "missing") as SparklineStatus;
  const statusColor =
    status === "green"
      ? "text-[#00D4AA]"
      : status === "amber"
        ? "text-[#FFB020]"
        : status === "red"
          ? "text-[#FF4757]"
          : "text-gray-500";

  const sparkline =
    Array.isArray(cell?.sparkline) ? cell!.sparkline : undefined;

  return (
    <div className="rounded border border-gray-800/60 bg-[#0A0E27]/60 px-2 py-1.5 flex flex-col gap-1">
      <div className="text-[9px] uppercase tracking-wider text-gray-600 truncate">
        {resolveIndicatorLabel(indicator, locale)}
      </div>
      <div className="flex items-baseline gap-1">
        {/* Tier-3 sub-29 Round-16 closure — shape glyph alongside
            colored value text. Same status→shape mapping as HeatMap
            cells; aria-hidden because the surrounding context already
            conveys status semantically. */}
        <span aria-hidden="true" className={`text-[10px] opacity-70 ${statusColor}`}>
          {statusShape(status)}
        </span>
        <span className={`tabular-nums font-semibold text-sm ${statusColor}`}>
          {cell ? formatValue(cell.value, indicator.unit) : "—"}
        </span>
      </div>
      <Sparkline
        data={sparkline ?? Array(12).fill(null)}
        status={status}
        ariaLabel={t('heatMap.sparklineTrendAriaLabelSelf', {
          indCode: indicator.code,
        })}
      />
    </div>
  );
}

function formatValue(v: number, unit: string): string {
  if (!Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  const rounded =
    abs >= 1000 ? v.toFixed(0) : abs >= 10 ? v.toFixed(1) : v.toFixed(2);
  return `${rounded} ${unit}`;
}
