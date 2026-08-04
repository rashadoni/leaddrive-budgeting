"use client";

/**
 * Per-cell <td> renderer for the Risk Terminal HeatMap — extracted from
 * HeatMap.tsx (Phase 8 D1 2026-05-29; was the file's biggest block at ~535
 * LOC). Renders one matrix cell: status colour + shape, value, sparkline,
 * and the hover Tooltip. Includes its
 * CellTd-only formatters (formatValue / formatValueCompact /
 * localizeFormulaError). The main HeatMap component imports HeatMapCellTd
 * back; behaviour + rendering unchanged (verified by the visual-baseline gate).
 */

import React, { useEffect, useRef, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { indicatorProvenance } from "@/lib/risk/indicator-provenance";
import {
  statusShape,
  statusColor,
  hasStatementMismatch,
  hasEvidencedValue,
  type HeatMapCell,
} from "@/lib/risk/heatmap-matrix";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Sparkline, type SparklineStatus } from "../Sparkline";
import { resolveIndicatorLabel } from "../../lib/resolve-indicator-label";
import { localizeFormulaError } from "../../lib/localize-formula-error";
import type { ApplicabilityReason } from "../../lib/indicator-applicability";
import type { CompanyRow, IndicatorCol } from "./types";

function formatValue(value: number, unit: string): string {
  if (!Number.isFinite(value)) return '—';
  const rounded =
    Math.abs(value) >= 1000
      ? value.toFixed(0)
      : Math.abs(value) >= 10
      ? value.toFixed(1)
      : value.toFixed(2);
  return `${rounded} ${unit}`;
}

// CLI Bloomberg-sweep: compact in-cell number formatter. Trims to K/M/B
// magnitudes for large currency amounts (AZN revenue ≥ 1e6 prints "1.2M ₼"
// instead of "1234567 AZN"). Percentages keep 1 dp; ratios keep 2 dp.
// Currency code AZN → glyph ₼ for visual density. Other units fall through
// to compact decimal + suffix.
function formatValueCompact(value: number, unit: string): string {
  if (!Number.isFinite(value)) return '—';
  if (unit === '%') {
    return `${value.toFixed(Math.abs(value) >= 100 ? 0 : 1)}%`;
  }
  if (unit === 'ratio') {
    return value.toFixed(2);
  }
  // Money / large units (AZN, USD, EUR, count of nights, kg, ton…)
  const abs = Math.abs(value);
  let mantissa: string;
  let suffix: string;
  if (abs >= 1e9) { mantissa = (value / 1e9).toFixed(1); suffix = 'B'; }
  else if (abs >= 1e6) { mantissa = (value / 1e6).toFixed(1); suffix = 'M'; }
  else if (abs >= 1e3) { mantissa = (value / 1e3).toFixed(1); suffix = 'K'; }
  else { mantissa = abs >= 10 ? value.toFixed(0) : value.toFixed(1); suffix = ''; }
  const unitTag = unit === 'AZN' ? '₼' : unit === 'USD' ? '$' : unit === 'EUR' ? '€' : unit ? ` ${unit}` : '';
  return `${mantissa}${suffix}${unitTag}`;
}

function formatValueTiny(value: number, unit: string): string {
  if (!Number.isFinite(value)) return '—';
  if (unit === '%') return `${value.toFixed(Math.abs(value) >= 100 ? 0 : 1)}%`;
  if (unit === 'ratio') return value.toFixed(2);

  const abs = Math.abs(value);
  let mantissa: string;
  let suffix: string;
  if (abs >= 1e9) { mantissa = (value / 1e9).toFixed(1); suffix = 'B'; }
  else if (abs >= 1e6) { mantissa = (value / 1e6).toFixed(1); suffix = 'M'; }
  else if (abs >= 1e3) { mantissa = (value / 1e3).toFixed(1); suffix = 'K'; }
  else { mantissa = abs >= 100 ? value.toFixed(0) : abs >= 10 ? value.toFixed(1) : value.toFixed(1); suffix = ''; }

  const unitTag = unit === 'AZN' ? '₼' : unit === 'USD' ? '$' : unit === 'EUR' ? '€' : '';
  return `${mantissa}${suffix}${unitTag}`;
}

type HeatMapCellTdProps = {
  co: CompanyRow;
  ind: IndicatorCol;
  cell: HeatMapCell | undefined;
  /** Resolved from CompanyIndicator override first, then activity taxonomy. */
  isApplicable: boolean;
  /** Why a known N/A pair is excluded; null for applicable pairs. */
  applicabilityReason: ApplicabilityReason | null;
  compactMode: boolean;
  onCellClick?: () => void;
  /** Phase 7.N — scenario delta: scenario status for this cell, or undefined if unchanged. */
  scenarioStatus?: string;
  /**
   * 2026-05-27 Drift bridge — when set, indicator depends on at least
   * one external feed that is currently stale/critical_stale. HeatMap
   * draws a small ⏳ marker on the cell so the user sees the cell's
   * grayness has a real reason (data is old, not missing). Empty when
   * no input is stale.
   */
  staleInputSourceCode?: string;
  staleInputStatus?: "stale" | "critical_stale";
  /**
   * 2026-05-27 Drift bridge — when true, this cell appeared in a
   * recent drift event (value swung dramatically). HeatMap draws an
   * orange ring around the cell to invite investigation.
   */
  driftedRecently?: boolean;
};


// Eager Radix Tooltip per cell — at idle, no DOM portals exist (Radix only
// renders the floating content via Presence + Portal when the trigger is
// hovered, after provider's 300ms `delayDuration`). 676 wrappers therefore
// cost only React component instances + context subscriptions, not DOM
// nodes. Earlier `defaultOpen` lazy-mount caused tooltip pile-up on cursor
// sweep (each cell's Tooltip initialized to open=true and Radix did not
// transition to closed on pointerleave from the forced-open initial state).
export function HeatMapCellTd({
  co,
  ind,
  cell,
  isApplicable,
  applicabilityReason,
  compactMode,
  scenarioStatus,
  onCellClick,
  staleInputSourceCode,
  staleInputStatus,
  driftedRecently,
}: HeatMapCellTdProps) {
  // CLI Tier 2 — distinguish "N/A" (indicator not applicable to this
  // company's industry — e.g. AGRO_YIELD on services entity) from
  // "missing" (applicable but no computed value). Empty industries[]
  // means sector-agnostic indicator (applies everywhere). Status taxonomy
  // is local-only; matrix payload still uses the 4 core statuses.
  const isNotApplicable = !isApplicable;
  const status = cell?.status ?? (isNotApplicable ? 'na' : 'missing');
  const ivId = cell?.indicatorValueId;
  const t = useTranslations('terminal');
  // 11.66 — classify once per cell; see the marker below.
  const provenance = indicatorProvenance(ind);
  const locale = useLocale();
  // N/A stays neutral but readable when the user reveals the full catalogue.
  // Other statuses use the shared palette helper. Cast N/A to missing for the
  // shared color helper input contract; its neutral color is overridden below.
  //
  // Financial-truth-infra Phase A.3 — `unknown` status also gets a neutral
  // background (no green/amber/red color band) + a "—" placeholder in
  // place of the numeric value. Reason: user reported that
  // `AGRO_YIELD: 0 [unknown]` looked like "actual yield of 0 tons/ha" —
  // an alarming red signal — when it actually meant "no data ingested
  // yet". Both `na` and `unknown` are now visually neutral, the
  // distinction (industry-not-applicable vs no-data) is conveyed via
  // tooltip text. `missing` is also kept neutral.
  const baseColor = statusColor(status === 'na' || status === 'unknown' ? 'missing' : status);
  const color = status === 'na' ? '#111827' : status === 'unknown' ? '#0A0E27' : baseColor;
  // Phase 7.N — scenario overlay: if scenarioStatus set, use it as the effective color.
  // M7 gate: scenarioShape companion ensures color-blind safe glyph is rendered in the
  // scenario badge span below (aria-hidden=true, bottom-left corner of cell).
  // An N/A pair cannot acquire risk colour from an out-of-scope scenario
  // result. The HeatMap also suppresses it before this component; this local
  // guard keeps the cell safe for direct/reused renders.
  const resolvedScenarioStatus = isNotApplicable ? undefined : scenarioStatus;
  const effectiveStatus = resolvedScenarioStatus ?? status;
  const scenarioColor = resolvedScenarioStatus ? statusColor(resolvedScenarioStatus as 'green' | 'amber' | 'red') : null;
  const scenarioShape = resolvedScenarioStatus ? statusShape(resolvedScenarioStatus as Parameters<typeof statusShape>[0]) : null; // M7 shape companion
  const cellBgColor = scenarioColor ?? color;
  const statusColorClass =
    effectiveStatus === 'red'
      ? 'text-[#FF4757]'
      : effectiveStatus === 'amber'
      ? 'text-[#FFA502]'
      : effectiveStatus === 'green'
      ? 'text-[#00D4AA]'
      : 'text-muted-foreground';

  // Phase B3 — flash animation on B1 SSE-driven update. We compare the
  // current value against the previously-rendered one; on change, briefly
  // toggle a CSS class that pulses opacity. Useful both for indicator-
  // value-changed signals AND organic refetches (matrix re-fired by other
  // SSE events). 600ms decay matches Bloomberg's quote-tick highlighting.
  const prevValueRef = useRef<number | undefined>(undefined);
  const [flashing, setFlashing] = useState(false);
  useEffect(() => {
    if (cell && prevValueRef.current !== undefined && prevValueRef.current !== cell.value) {
      setFlashing(true);
      const t = setTimeout(() => setFlashing(false), 600);
      return () => clearTimeout(t);
    }
    if (cell) prevValueRef.current = cell.value;
  }, [cell?.value]);

  // Phase 7.H F4.v2.4 — SASB materiality dimming. `low_materiality`
  // cells render at ~30% opacity (still legible, status color preserved
  // — analyst can drill in but the cell isn't competing for attention).
  // `not_material` cells render at ~12% with status color stripped to
  // a neutral background (effectively "this metric doesn't apply to
  // this sector"). Material cells (the default) are unaffected.
  const materialityOpacityScale =
    cell?.materiality === 'not_material'
      ? 0.12
      : cell?.materiality === 'low_materiality'
        ? 0.45
        : 1;
  // Phase 7.N — use scenarioColor for background when scenario active
  const materialityBackground =
    cell?.materiality === 'not_material' ? '#1F2937' : cellBgColor;
  // Phase 7.M Step 2 (2026-05-18) — `signalConfidence` visual cue.
  // Only `low` cells get a marker; `medium` and `high` render normally
  // so the HeatMap doesn't drown in noise. The marker is an inset
  // 1px ring in muted amber (#F59E0B at 40% alpha) — clearly visible
  // but doesn't compete with the status color, the modeled-source `e`
  // glyph at top-left or the materiality dimming above.
  //
  // What "low" means: the recompute pipeline flagged this cell with an
  // `error.code` such as `no_budget_lines`, `rollup_no_children` or
  // `out_of_range`. The numeric value is unreliable — finance users
  // should treat the cell as "data missing, not a measurement".
  //
  // Flashing animation takes precedence (orange ring would look stale
  // against the green flash); when not flashing the confidence ring
  // shows.
  const isLowConfidence = cell?.signalConfidence === 'low';
  // Phase 11.91 — this number disagrees with the client's own statement.
  //
  // Deliberately NOT rendered in the status palette. Green/amber/red already
  // mean "how is the business doing", and a red cell that is also wrong would
  // be indistinguishable from a red cell that is right — which is the worse of
  // the two situations and the one that has to stand out. Fuchsia is unused
  // elsewhere on this grid (status green/amber/red, low-confidence amber ring,
  // provenance sky/gray dot), so it can only mean this.
  //
  // Loud on purpose: a ring around the whole tile plus a `≠` glyph, not a
  // corner dot. The instruction was that a discrepancy be visible at a glance
  // rather than on hover, and every subtler marker on this grid has to be
  // hunted for.
  const statementMismatch = hasStatementMismatch(cell ?? {});
  const mismatchTitle =
    statementMismatch && cell
      ? t('heatMap.statementMismatchTitle', {
          actual: formatValue(cell.value, ind.unit),
          expected: formatValue(cell.reconExpected ?? 0, ind.unit),
          delta: formatValue(cell.value - (cell.reconExpected ?? 0), ind.unit),
        })
      : undefined;
  const notApplicableReasonText =
    applicabilityReason === 'explicit_disabled'
      ? t('heatMap.notApplicableDisabled')
      : applicabilityReason === 'entity_level_mismatch'
        ? t('heatMap.notApplicableEntityLevel')
        : t('heatMap.notApplicableActivity');
  const localizedStatus =
    status === 'na'
      ? notApplicableReasonText
      : status === 'missing'
        ? t('heatMap.missingData')
        : t(`status.${status}` as never);
  const baseAriaLabel =
    cell && cell.status !== 'unknown'
      ? t('heatMap.cellAriaWithValue', {
          company: co.code,
          indicator: ind.code,
          status: localizedStatus,
          value: formatValue(cell.value, ind.unit),
        })
      : t('heatMap.cellAriaWithoutValue', {
          company: co.code,
          indicator: ind.code,
          status: localizedStatus,
        });
  const materialityLabel =
    cell?.materiality === 'not_material'
      ? t('indicatorDetail.materiality.notMaterial')
      : cell?.materiality === 'low_materiality'
        ? t('indicatorDetail.materiality.lowMateriality')
        : null;
  const cellAriaLabel = [
    baseAriaLabel,
    materialityLabel
      ? t('heatMap.cellAriaMateriality', { materiality: materialityLabel })
      : null,
    isLowConfidence ? t('heatMap.cellAriaLowConfidence') : null,
    // 11.91 — a ring and a glyph are invisible to a screen reader, and this is
    // the one marker on the grid that changes whether the number should be
    // acted on at all.
    statementMismatch ? t('heatMap.cellAriaStatementMismatch') : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join('. ');
  const staleStatusLabel =
    staleInputStatus === 'critical_stale'
      ? t('heatMap.staleInputCritical')
      : t('heatMap.staleInputStale');
  return (
    <td
      className="relative border-b border-gray-800/40 p-0"
      data-materiality={cell?.materiality ?? undefined}
      data-signal-confidence={cell?.signalConfidence ?? undefined}
      data-provenance={provenance === "client-data" ? undefined : provenance}
      data-recon={cell?.reconStatus ?? undefined}
    >
      {/* 11.66 — mark where this number comes from.
          After a reset that provably emptied every financial table these tiles
          stayed lit, and the screen never said that their inputs are not the
          client's data at all: «при удалении почему риск терминал не удален?».
          Measured on production — 531 of 6,426 values survived, every one from
          a market/weather feed or from a constant.
          ABSOLUTELY positioned on purpose: the column is fixed-width with
          `truncate`, so any inline glyph could push the indicator code into
          an ellipsis. A corner dot consumes no layout at all, which also means
          it cannot move the committed visual baseline. */}
      {provenance !== "client-data" && (
        <span
          aria-hidden="true"
          data-testid={`tile-provenance-${provenance}`}
          title={t(`heatMap.provenance.${provenance}` as never)}
          className={`pointer-events-none absolute right-[1px] top-[1px] text-[7px] leading-none ${
            provenance === "constant" ? "text-gray-600" : "text-sky-400/70"
          }`}
        >
          {provenance === "external-feed" ? "~" : "="}
        </span>
      )}
      {/* 11.91 — the tile disagrees with the client's own statement.
          Ring + glyph, both absolutely positioned so the fixed-width column
          keeps its layout and the committed visual baseline is unmoved on
          every cell that has no mismatch (which today is all of them). */}
      {statementMismatch && (
        <>
          {/* Measured 2026-08-02, after looking at a render instead of trusting
              the test that said the marker was present: fuchsia #E879F9 sits at
              1.25–1.36:1 against every status tile (green 1.29, amber 1.25, red
              1.36). That is no luminance separation at all — the ring read only
              as an edge, and on amber barely that. The brief was «чтоб было
              заметно сразу».

              So the marker carries a DARK component, which is what actually
              separates here: #0A0E27 — the terminal's own background — gives
              10.0 : 9.6 : 5.7 against the same three. Fuchsia stays as the
              identity colour tying the tile to the header badge; it is no
              longer asked to do the contrast work on its own.

              Two stacked rings rather than one thick one: a dark halo on the
              outside and the fuchsia line inside it, so the marker reads
              against a light tile AND against the dark grid gutter. */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-[1px] ring-2 ring-inset ring-[#0A0E27]"
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-[2px] rounded-[1px] ring-[1.5px] ring-inset ring-[#E879F9]"
          />
          <span
            aria-hidden="true"
            data-testid="tile-statement-mismatch"
            title={mismatchTitle}
            className="pointer-events-none absolute left-[2px] bottom-[2px] rounded-[2px] bg-[#0A0E27] px-[2px] text-[9px] leading-[1.1] font-bold text-[#E879F9]"
          >
            ≠
          </span>
        </>
      )}
      {/* Dense matrix cells sit directly beside each other. Radix's default
          hoverable-content grace area can keep the previous cell's tooltip
          open while the pointer is already over the next cell, so a tooltip
          that started on a missing cell appears to describe red/green cells.
          Cell tooltips contain no interactive controls, so closing them as
          soon as the trigger is left is both safe and keeps hover data exact. */}
      <Tooltip disableHoverableContent>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={isNotApplicable ? undefined : onCellClick}
            aria-disabled={isNotApplicable || undefined}
            aria-label={cellAriaLabel}
            data-company-code={co.code}
            data-indicator-code={ind.code}
            data-indicator-value-id={ivId}
            data-applicability-reason={
              isNotApplicable ? applicabilityReason : undefined
            }
            className={`relative block border-0 p-0 text-left transition-shadow focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#6AD5CB] ${
              isNotApplicable ? 'cursor-help' : 'cursor-pointer'
            } ${
              flashing
                ? 'shadow-[inset_0_0_0_2px_#00D4AA]'
                : isLowConfidence
                  ? 'shadow-[inset_0_0_0_1px_rgba(245,158,11,0.55)]'
                  : ''
            }`}
            style={{
              width: compactMode ? 40 : 54,
              // CLI Bloomberg-sweep: normal cells expand 18 → 30 to host
              // inline sparkline + numeric value below status glyph.
              // Compact mode unchanged to preserve density (sparkline +
              // value only show in tooltip there).
              height: compactMode ? 12 : 30,
              backgroundColor: materialityBackground,
              // N/A is intentionally neutral, but fully legible after the
              // user reveals the complete catalogue. Missing remains muted;
              // computed statuses keep their established visual weight.
              opacity:
                (status === 'na' ? 1 : status === 'missing' ? 0.25 : 0.85) *
                materialityOpacityScale,
            }}
          >
            {/* Tier-3 sub-29 M7 — color-blind safe redundant signal.
                Round-15 architect 💡 closure — Tiny shape glyph at
                top-right of each cell. Uses `mix-blend-mode: difference`
                with white text so the glyph stays visible on BOTH light
                cells (#00D4AA green / #FFB020 amber) and dark cells
                (#FF4757 red / #1F2937 missing) without per-status color
                logic. Round-16 architect ⚠️ closure — `unknown` cells
                (#6B7280 slate-500) are middle-gray; `255-107=148` and
                `148` differ by 41 → low-contrast glyph. Bump opacity to
                full and skip mix-blend on `unknown` so the glyph
                renders white-on-gray (high contrast). All other
                statuses keep the difference-blend rule. */}
            {/* Status glyph hidden for 'na' (no symbol = "not applicable").
                Phase A.3 — also hidden for `unknown` so the cell reads as
                an empty placeholder ("—") rather than a status-bearing
                signal. Tooltip carries the "no data ingested" copy. */}
            {status !== 'na' && status !== 'unknown' && (
              <span
                aria-hidden="true"
                className="absolute top-0 right-0.5 leading-none"
                style={{
                  fontSize: compactMode ? 7 : 9,
                  opacity: 0.7,
                  color: '#FFFFFF',
                  mixBlendMode: 'difference',
                  pointerEvents: 'none',
                }}
              >
                {statusShape(status)}
              </span>
            )}
            {/* Phase 7.N — scenario shape glyph (M7 companion for scenarioColor).
                Renders a tiny shape at bottom-left when scenario is active on this
                cell. Gives color-blind users a redundant signal that the cell status
                changed under the scenario. */}
            {scenarioShape && (
              <span
                aria-hidden="true"
                data-testid="heatmap-scenario-shape"
                className="absolute bottom-0 left-0.5 leading-none"
                style={{
                  fontSize: compactMode ? 6 : 8,
                  opacity: 0.9,
                  color: '#FFFFFF',
                  mixBlendMode: 'difference',
                  pointerEvents: 'none',
                }}
              >
                {scenarioShape}
              </span>
            )}
            {/* Phase 7.H F4.v2.1 — modeled-source marker at top-LEFT
                (opposite corner from the status glyph). Lowercase italic
                `e` = estimate. Renders for `modeled_generic` /
                `modeled_industry` only — `disclosed`, `macro`,
                `computed` show no marker (real or single-value-by-design
                cells aren't "estimates"). Tooltip text exists in the
                cell tooltip (`heatMap.tooltipProvenance`) so a hover
                resolves the ambiguity ("e" = what?). */}
            {cell &&
              (cell.valueSource === 'modeled_generic' ||
                cell.valueSource === 'modeled_industry') && (
                <span
                  aria-hidden="true"
                  data-testid="heatmap-modeled-marker"
                  data-source={cell.valueSource}
                  className="absolute top-0 left-0.5 leading-none italic font-mono"
                  style={{
                    fontSize: compactMode ? 7 : 9,
                    opacity: 0.85,
                    color: '#FFFFFF',
                    mixBlendMode: 'difference',
                    pointerEvents: 'none',
                  }}
                >
                  e
                </span>
              )}
            {/* 2026-05-27 — `d` marker for disclosed (company-reported)
                cells. Mirrors the `e` (estimate) marker shape so the
                pair is learnable at-a-glance: top-left letter encodes
                provenance (d = disclosed/real, e = estimated/modelled,
                no letter = computed/derived from real data). Macro
                cells use `m`. */}
            {cell && cell.valueSource === 'disclosed' && (
              <span
                aria-hidden="true"
                data-testid="heatmap-disclosed-marker"
                data-source={cell.valueSource}
                className="absolute top-0 left-0.5 leading-none font-mono font-bold"
                style={{
                  fontSize: compactMode ? 7 : 9,
                  opacity: 0.9,
                  color: '#FFFFFF',
                  mixBlendMode: 'difference',
                  pointerEvents: 'none',
                }}
              >
                d
              </span>
            )}
            {cell && cell.valueSource === 'macro' && (
              <span
                aria-hidden="true"
                data-testid="heatmap-macro-marker"
                data-source={cell.valueSource}
                className="absolute top-0 left-0.5 leading-none font-mono"
                style={{
                  fontSize: compactMode ? 7 : 9,
                  opacity: 0.85,
                  color: '#FFFFFF',
                  mixBlendMode: 'difference',
                  pointerEvents: 'none',
                }}
              >
                m
              </span>
            )}
            {/* 2026-05-27 Drift bridge — stale input marker. Top-right
                corner, opposite the provenance d/e/m letter at top-left.
                Color tracks status severity: amber for stale, rose for
                critical-stale (older than 2× expected cadence).
                Rev2: ⏳ emoji rendered illegibly at 9px (looked like a
                smudge); switched to a filled dot + ring so the visual
                contrast survives the tiny cell. */}
            {staleInputSourceCode && (
              <span
                aria-hidden="true"
                data-testid="heatmap-stale-input-marker"
                data-source-code={staleInputSourceCode}
                data-stale-status={staleInputStatus}
                title={t('heatMap.staleInputTitle', {
                  source: staleInputSourceCode,
                  status: staleStatusLabel,
                })}
                className="absolute pointer-events-none select-none rounded-full"
                style={{
                  top: 1,
                  right: 1,
                  width: compactMode ? 6 : 8,
                  height: compactMode ? 6 : 8,
                  background:
                    staleInputStatus === 'critical_stale'
                      ? '#FF6B6B'
                      : '#FFB800',
                  boxShadow:
                    '0 0 0 1.5px rgba(15, 21, 53, 0.95), 0 0 3px rgba(0,0,0,0.5)',
                }}
              />
            )}
            {/* 2026-05-27 Drift bridge — drifted-cell ring overlay.
                Highlights cells whose value swung dramatically between
                recompute runs (audit-log drift event). Orange outline,
                non-interactive — invites click → Indicator Detail. */}
            {driftedRecently && (
              <span
                aria-hidden="true"
                data-testid="heatmap-drifted-ring"
                className="absolute inset-0 rounded-sm pointer-events-none"
                style={{
                  boxShadow: 'inset 0 0 0 1.5px #FFB800',
                  opacity: 0.75,
                }}
              />
            )}
            {/* N/A is deliberately visible after Show all, but stays neutral
                and non-actionable. The localized short label distinguishes it
                from an applicable cell whose observation is missing. */}
            {status === 'na' && (
              <span
                aria-hidden="true"
                className="absolute inset-0 flex items-center justify-center font-mono font-medium leading-none text-gray-400 select-none pointer-events-none"
                style={{ fontSize: 11 }}
              >
                {compactMode ? '—' : t('heatMap.notApplicableShort')}
              </span>
            )}
            {/* Missing cell label — no IndicatorValue row exists yet. The
                localized short label prevents an empty cell from looking like
                a zero. Compact mode keeps the tiny dot for matrix density. */}
            {!cell && status !== 'na' && (
              compactMode ? (
                <span
                  className="absolute inset-0 flex items-center justify-center font-mono leading-none select-none pointer-events-none"
                  style={{ fontSize: 11, color: 'rgba(156,163,175,0.5)' }}
                  aria-hidden="true"
                >
                  ·
                </span>
              ) : (
                <span
                  className="absolute inset-0 flex items-center justify-center font-mono leading-none select-none pointer-events-none"
                  style={{ fontSize: 11, color: 'rgba(156,163,175,0.45)' }}
                  aria-hidden="true"
                >
                  {t('heatMap.noDataShort')}
                </span>
              )
            )}
            {/* Compact mode still needs a numeric readout. The cell is too
                small for sparkline + unit labels, so render a tiny centered
                value while keeping the status color as the primary signal. */}
            {compactMode && cell ? (
              <span
                className="absolute inset-y-0 left-0.5 right-1.5 flex items-center justify-center font-mono leading-none text-white/95 truncate pointer-events-none"
                style={{
                  fontSize: 7,
                  mixBlendMode: status === 'unknown' ? 'normal' : 'difference',
                  textShadow: status === 'unknown' ? '0 0 2px rgba(0,0,0,0.7)' : undefined,
                }}
                title={hasEvidencedValue(status, cell.value) ? formatValueCompact(cell.value, ind.unit) : '—'}
              >
                {hasEvidencedValue(status, cell.value) ? formatValueTiny(cell.value, ind.unit) : '—'}
              </span>
            ) : null}
            {/* CLI Bloomberg-sweep: inline sparkline + value in normal mode.
                Bloomberg-class analyst gets trend AT A GLANCE without
                hovering. Empty-sparkline cells get an identical-height
                placeholder so the grid doesn't shift row-by-row. */}
            {!compactMode && cell ? (
              <div className="absolute inset-x-0.5 bottom-0.5 flex items-end gap-0.5 pointer-events-none">
                <div
                  className="flex items-end shrink-0"
                  style={{ width: 28, height: 10 }}
                >
                  {cell.sparkline && cell.sparkline.length > 0 ? (
                    <Sparkline
                      data={cell.sparkline}
                      status={status as SparklineStatus}
                      width={28}
                      height={10}
                      ariaLabel=""
                    />
                  ) : null}
                </div>
                <span
                  className="font-mono text-[8px] leading-none text-white/95 truncate"
                  style={{
                    mixBlendMode: status === 'unknown' ? 'normal' : 'difference',
                    textShadow: status === 'unknown' ? '0 0 2px rgba(0,0,0,0.7)' : undefined,
                  }}
                >
                  {/* Phase A.3 — `unknown` status hides the numeric value
                      (which could read as a real measurement). Show "—"
                      so the empty-state is unambiguous. */}
                  {hasEvidencedValue(status, cell.value) ? formatValueCompact(cell.value, ind.unit) : '—'}
                </span>
              </div>
            ) : null}
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          className="bg-popover text-popover-foreground border border-border shadow-lg max-w-[280px] text-xs"
        >
          <div className="font-mono font-semibold">
            {co.code} · {ind.code}
          </div>
          {/* Sub-33 i18n closure — was hardcoded `ind.nameEn`; switched to
              shared `resolveIndicatorLabel` helper so the cell tooltip
              shows the locale-matched indicator name (Russian / Azeri /
              English fallback chain) consistent with the column header
              tooltip + IndicatorDetail header. */}
          <div className="text-muted-foreground">
            {resolveIndicatorLabel(ind, locale)}
          </div>
          {cell ? (
            <>
              <div className="text-[11px] mt-1">
                {/* Round-16 closure — shape glyph next to status word
                    inside cell tooltip detail. aria-hidden because the
                    status word itself conveys the same meaning to AT.
                    Inside this branch `cell` is truthy ⇒ status is one of
                    the IndicatorStatus values, never 'na' / 'missing'.
                    Phase A.3 — for `unknown` show explicit "no data
                    ingested" copy instead of the raw 0 value, which would
                    misread as a real measurement. */}
                <span className={statusColorClass}>
                  <span aria-hidden="true" className="mr-0.5 opacity-80">
                    {statusShape(cell.status)}
                  </span>
                  {t(`status.${cell.status}` as never)}
                </span>
                {cell.status === 'unknown' ? (
                  <span className="ml-1 text-muted-foreground/80 italic">
                    {t('heatMap.tooltipNoData')}
                  </span>
                ) : (
                  <>
                    {' @ '}
                    <span className="font-mono">{formatValue(cell.value, ind.unit)}</span>
                  </>
                )}
              </div>
              {cell.sparkline && cell.sparkline.length > 0 && (
                <div className="mt-1.5 flex items-center gap-1.5">
                  <Sparkline
                    data={cell.sparkline}
                    status={status as SparklineStatus}
                    ariaLabel={t('heatMap.sparklineTrendAriaLabel', {
                      indCode: ind.code,
                      coCode: co.code,
                    })}
                  />
                  <span className="text-[9px] text-muted-foreground/70">
                    {t('heatMap.tooltipSparkline12mo')}
                  </span>
                </div>
              )}
              {cell.error && (
                <div
                  className="text-[11px] text-[#FF4757] mt-1"
                  // The title used to carry the raw English engine reason —
                  // the only untranslated string left in this tooltip. Mirror
                  // the localized text the user already reads below it.
                  title={localizeFormulaError(
                    cell.error.code,
                    cell.error.reason,
                    ind.code,
                    t,
                  )}
                >
                  ⚠ {localizeFormulaError(cell.error.code, cell.error.reason, ind.code, t)}
                </div>
              )}
              {/* Phase 7.H F4.v2.1 — provenance footnote in the cell
                  tooltip. Mirrors the badge in Panel 3 so a hover-only
                  glance already tells the analyst this is a modelled
                  estimate, not a measured fact. Only renders for the
                  non-`computed` variants — adding it on every cell
                  would defeat the visual signal. */}
              {cell.valueSource && cell.valueSource !== 'computed' && (
                // Phase 8 A2 (2026-05-28) — provenance pill, not a faint
                // italic line. Color-codes the source ladder so a hover
                // tells the analyst whether this red KPI is a measured
                // disclosure (emerald) or a modelled estimate (rose) at a
                // glance. Mirrors the IndicatorDetail ProvenanceBadge so
                // the visual contract is identical across surfaces.
                <div
                  className={`mt-1 inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium ${
                    cell.valueSource === 'disclosed'
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                      : cell.valueSource === 'macro'
                        ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                        : cell.valueSource === 'modeled_industry'
                          ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                          : 'border-rose-500/40 bg-rose-500/10 text-rose-200'
                  }`}
                  data-testid="heatmap-provenance-line"
                  data-source={cell.valueSource}
                >
                  {t(
                    `indicatorDetail.provenance.${cell.valueSource}` as never,
                  )}
                </div>
              )}
              <div className="text-[10px] text-muted-foreground/70 mt-1">
                {t('heatMap.cellClickHint')}
              </div>
            </>
          ) : status === 'na' ? (
            <div className="mt-1 space-y-1 text-[11px] text-muted-foreground">
              <div>{notApplicableReasonText}</div>
              <div className="text-[11px] text-muted-foreground/70">
                {t('heatMap.notApplicableNoActionHint')}
              </div>
            </div>
          ) : (
            <div className="text-[11px] text-muted-foreground mt-1">
              {t('heatMap.tooltipNoData')}
            </div>
          )}
        </TooltipContent>
      </Tooltip>
    </td>
  );
}

/**
 * 2026-05-27 A4 — relative-time data-freshness chip for the HeatMap
 * header. Reads matrix.lastComputedAt (max(computedAt) across all
 * rendered cells, set server-side) and renders «Updated 2h ago».
 *
 * Self-ticking: re-renders every 30s so a long-open Risk Terminal
 * tab doesn't show stale "1 min ago" text three hours later. No
 * matrix re-fetch happens here — the SSE channel handles that.
 *
 * Locale-agnostic (uses Intl.RelativeTimeFormat). Tooltip carries
 * the full ISO timestamp for power users.
 */
