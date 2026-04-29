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

import React from "react";
import { useMatrix } from "../hooks/use-matrix";
import { Sparkline, type SparklineStatus } from "./Sparkline";
import { useEventStream } from "@/lib/events/use-event-stream";

// Sub-20: local MatrixCell/Company/Indicator types removed in favor of
// the canonical shapes exported by `useMatrix` hook (HeatMapCell from
// composite-score.ts + MatrixCompanyRow/MatrixIndicatorCol from the
// hook). Local `'missing'` literal was a UI fiction — endpoint emits
// only 4 IndicatorStatus values (green/amber/red/unknown).
import type { HeatMapCell } from "@/lib/risk/heatmap-matrix";
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
  // Sub-20: shared `useMatrix()` hook. Module cache means CompanySnapshot
  // mounts (one per active company drilldown) reuse HeatMap's already-
  // fetched matrix instead of N round-trips. SSE-driven refetch goes
  // through `refresh()` so the cache invalidates and HeatMap +
  // ComparePanel + this snapshot all see fresh data.
  const { matrix: data, loading, error, refresh } = useMatrix();

  // SSE live-update on indicator changes (B1).
  useEventStream({
    onIndicatorChanged: () => {
      refresh();
    },
  });

  if (loading && !data) {
    return (
      <div className="text-gray-700 font-mono text-xs leading-relaxed">
        Loading snapshot…
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="text-[#FF4757] font-mono text-xs">
        Snapshot error: {error ?? "no data"}
      </div>
    );
  }

  const company = data.companies.find((c) => c.code === companyCode);
  if (!company) {
    return (
      <div className="text-gray-700 font-mono text-xs">
        Company <code>{companyCode}</code> not in current matrix.
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
  if (cards.length === 0) {
    return (
      <div className="text-gray-700 font-mono text-xs leading-relaxed">
        No P&L margin indicators available for{" "}
        <span className="text-[#FFB020]">{companyCode}</span>.
        <br />
        Pick a HeatMap cell to drill into this company's data.
      </div>
    );
  }

  return (
    <div className="font-mono text-xs flex flex-col gap-2">
      <div className="text-[10px] uppercase tracking-wider text-gray-500 flex items-center justify-between">
        <span>
          Snapshot · <span className="text-[#FFB020]">{company.code}</span>
        </span>
        <span className="text-gray-600">12mo trend</span>
      </div>
      {/* Architect Round-1 sub-10 closure: was `grid grid-cols-3` which
          overflowed at narrow Panel 4 widths (Analyst preset 40% × 40%
          = 16% of viewport). Switched to flex-wrap with min-width per
          card so cards stack to 1 or 2 columns when Panel 4 narrows
          and fan out to 3 when there's room. */}
      <div className="flex flex-wrap gap-2">
        {cards.map(({ indicator, cell }) => (
          <div key={indicator.id} className="flex-1 min-w-[120px]">
            <SnapshotCard indicator={indicator} cell={cell} />
          </div>
        ))}
      </div>
      <p className="text-[10px] text-gray-600 mt-1">
        Click any HeatMap cell for the full Variance Explainer narrative.
      </p>
    </div>
  );
}

function SnapshotCard({
  indicator,
  cell,
}: {
  indicator: MatrixIndicator;
  cell: MatrixCell | undefined;
}) {
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
        {indicator.nameEn}
      </div>
      <div className="flex items-baseline gap-1">
        <span className={`tabular-nums font-semibold text-sm ${statusColor}`}>
          {cell ? formatValue(cell.value, indicator.unit) : "—"}
        </span>
      </div>
      <Sparkline
        data={sparkline ?? Array(12).fill(null)}
        status={status}
        ariaLabel={`${indicator.code} 12-month trend`}
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
