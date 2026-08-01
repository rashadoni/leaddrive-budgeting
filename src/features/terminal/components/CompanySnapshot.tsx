"use client";

/**
 * Phase B7 (Bloomberg uplift plan) — multi-chart company snapshot.
 *
 * Augments VarianceExplainerPanel's empty state (no IV selected). When
 * an `activeCompanyCode` IS set but no IV is drilled down, render 3
 * mini-sparkline cards stacked horizontally — the margin trio:
 *   - Gross Margin (*_GROSS_MARGIN — FP_/SVC_/… per industry)
 *   - Net Margin   (*_NET_MARGIN)
 *   - OpEx Ratio   (*_OPEX_RATIO)
 *
 * Indicators are resolved by SUFFIX + the company's own cell set (see
 * SNAPSHOT_MARGIN_SUFFIXES) so the panel works across every industry
 * template, NOT by hardcoded generic codes (which went dead post-7.M and
 * silently emptied this panel for every real company). If the active
 * company has none of the three margins, the panel falls back to the
 * original "Pick a HeatMap cell" instruction.
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
import {
  localizeAlertMessageParams,
  type IndustryTranslator,
} from "@/lib/risk/alert-message-i18n";
import { useMatrix } from "../hooks/use-matrix";
import { useCompanies, buildRiskTagsByCompanyId } from "../hooks/use-companies";
import { Sparkline, type SparklineStatus } from "./Sparkline";
import { useEventStream } from "@/lib/events/use-event-stream";
import { useTerminalStore } from "../store/terminalStore";
import { CompanyImpactForecastsCard } from "./CompanyImpactForecastsCard";
import { CompanyStrategicContextCard } from "./CompanyStrategicContextCard";
import { computeCompositeByCompany, deriveParentComposites } from "@/lib/risk/composite-score";
import { DEFAULT_ALERT_RULE_IDS } from "@/lib/risk/alert-rules";
import { resolveIndicatorLabel } from "../lib/resolve-indicator-label";

// Sub-20: local MatrixCell/Company/Indicator types removed in favor of
// the canonical shapes exported by `useMatrix` hook (HeatMapCell from
// composite-score.ts + MatrixCompanyRow/MatrixIndicatorCol from the
// hook). Local `'missing'` literal was a UI fiction — endpoint emits
// only 4 IndicatorStatus values (green/amber/red/unknown).
import { isAggregateRollup, statusShape, type HeatMapCell } from "@/lib/risk/heatmap-matrix";
import type {
  MatrixCompanyRow as MatrixCompany,
  MatrixIndicatorCol as MatrixIndicator,
} from "../hooks/use-matrix";
type MatrixCell = HeatMapCell;

// The margin trio the snapshot features, matched by SUFFIX (not exact
// code). Phase 7.M moved from generic `IND_*` codes to industry-templated
// ones — Food Processing carries `FP_GROSS_MARGIN`, Services
// `SVC_GROSS_MARGIN`, etc. The old hardcoded `IND_GROSS_MARGIN` exact-match
// went dead for every real company (the AAC/demo era was the last time the
// `IND_*` margins existed), silently emptying Panel 4. Suffix match
// subsumes the legacy `IND_*` codes (they end with these suffixes too); the
// per-company cell filter below selects the company's own industry variant.
// Order = display order (Gross → Net → OpEx).
const SNAPSHOT_MARGIN_SUFFIXES = [
  "_GROSS_MARGIN",
  "_NET_MARGIN",
  "_OPEX_RATIO",
] as const;

interface Props {
  companyCode: string;
}

export function CompanySnapshot({ companyCode }: Props) {
  const t = useTranslations("terminal");
  // Phase 7.G Turn G — see AlertsPanel.tsx for the same pattern.
  const tIndustries = useTranslations(
    "industries",
  ) as unknown as IndustryTranslator;
  const locale = useLocale();
  // Sub-20: shared `useMatrix()` hook. Module cache means CompanySnapshot
  // mounts (one per active company drilldown) reuse HeatMap's already-
  // fetched matrix instead of N round-trips. SSE-driven refetch goes
  // through `refresh()` so the cache invalidates and HeatMap +
  // ComparePanel + this snapshot all see fresh data.
  const { matrix: data, loading, error, refresh } = useMatrix();
  // Phase 7.N — qualitative riskTags from the SAME module-cached
  // `/api/companies` source CompanyTree (Panel 1) + HeatMap (Panel 2) read,
  // so Panel 4's composite badge applies the identical per-tag penalty.
  // The matrix endpoint's `companies` payload carries no riskTags. Without
  // this the snapshot showed an UNPENALIZED score that disagreed with the
  // company's tree badge on the same /budgeting/terminal screen.
  const { companies: companyTree } = useCompanies();
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
    // Phase 7.N — per-company riskTag penalty (subsidy_dependency -5,
    // non_transparent_structure -8, data_absence -12; clamped to ≥0).
    // `companyTree` is null while companies load → undefined → no penalty
    // (pre-7.N parity, no flash of a wrong score). Map keys are
    // Company.id === HeatMapCell.companyId.
    const riskTagsByCompanyId = companyTree
      ? buildRiskTagsByCompanyId(companyTree)
      : undefined;
    // 2026-05-30 — parent/holding rows get the SAME revenue-weighted roll-up
    // as Panel 1/2 (deriveParentComposites) so the composite badge is
    // identical across all three panels for a selected sub-group.
    //
    // 11.71 — no scoring filter here on purpose: `data.cells` arrive from the
    // matrix API already stamped with `scoring: false` on the cells that must
    // not move a composite (constants; the informational legal/compliance
    // indicators the owner directed out of the financial number), and
    // `computeCompositeScore` enforces the flag. Before the flag existed the
    // "identical across all three panels" claim above was FALSE — Panels 1 and
    // 2 called the 11.66 caller-side filter and this one did not, so a company
    // with a constant cell showed two numbers on one screen. Do not re-add a
    // local filter; the rule lives on the cell.
    const leafById = computeCompositeByCompany(data.cells, undefined, riskTagsByCompanyId);
    return deriveParentComposites(data.companies, leafById);
  }, [data, companyTree]);
  const composite = company ? compositeByCo.get(company.id) : null;
  const statusCounts = useMemo(() => {
    if (!data || !company) return null;
    const cells = data.cells.filter(
      // Sub-44 cont'd architect closure — gate via shared helper.
      (c) => c.companyId === company.id && !isAggregateRollup(c),
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
      <div className="text-gray-700 font-mono text-xs leading-relaxed h-full w-full">
        {t("snapshot.loading")}
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="text-[#FF4757] font-mono text-xs h-full w-full">
        {t("snapshot.error")}: {error ?? t("snapshot.noData")}
      </div>
    );
  }

  if (!company) {
    return (
      <div className="text-gray-700 font-mono text-xs h-full w-full">
        {t("snapshot.companyNotInMatrix")} <code>{companyCode}</code>.
      </div>
    );
  }

  // Indicators THIS company is tracked for. Cells link company↔indicator,
  // and a company carries only its own industry's margin indicators — so
  // this set disambiguates which `*_GROSS_MARGIN` (FP_/SVC_/IND_/…) belongs
  // to the active company.
  const companyIndicatorIds = new Set(
    data.cells
      .filter((c) => c.companyId === company.id)
      .map((c) => c.indicatorId),
  );

  const cards = SNAPSHOT_MARGIN_SUFFIXES.map((suffix) => {
    // Among matrix indicators whose code ends with this margin suffix, pick
    // the one the company actually has (its industry variant — e.g. Food
    // Processing → FP_GROSS_MARGIN). Subsumes the legacy IND_* exact codes.
    const ind = data.indicators.find(
      (i) => i.code.endsWith(suffix) && companyIndicatorIds.has(i.id),
    );
    if (!ind) return null;
    const cell = data.cells.find(
      (c) => c.companyId === company.id && c.indicatorId === ind.id,
    );
    return { indicator: ind, cell };
  }).filter((x): x is { indicator: MatrixIndicator; cell: MatrixCell | undefined } => x !== null);

  // No matching indicators at all (sector mismatch) → fall back gracefully.
  const noPLIndicators = cards.length === 0;

  return (
    // Phase 7.L 2026-05-18 — root made scrollable + min-h-0 so the
    // impact-forecasts section (which can grow to 3 sizable cards
    // per forecast × N forecasts) doesn't overflow out of Panel 4's
    // slot and overlap with the adjacent Panel 3 / Panel 2 panels.
    // Prior layout was `flex flex-col gap-2 h-full w-full` — fine
    // for fixed-height snapshot content but breaks once we append
    // variable-length forecast cards. Vertical scroll keeps the
    // existing layout AND surfaces the new section gracefully.
    <div className="font-mono text-xs flex flex-col gap-2 h-full w-full overflow-y-auto min-h-0">
      <div className="text-[10px] uppercase tracking-wider text-gray-500 flex items-center justify-between shrink-0">
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
                  // Turn G: localize industry code before substitution.
                  const localizedParams = localizeAlertMessageParams(
                    m.messageParams,
                    tIndustries,
                  );
                  alertBody = t(
                    m.messageKey as never,
                    localizedParams as never,
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

      {/* Margin trio cards. Sub-36 cont'd — `flex-1 min-h-0` on the
          row container absorbs all remaining vertical space inside the
          flex-col panel body; `align-items:stretch` (flex-row default)
          + `h-full` on each card propagates that height to every card
          so the sparkline pins to the bottom and there's no dead space.
          Switched away from `flex flex-wrap` (per-row stretch only,
          breaks at narrow widths) AND from `grid grid-cols-3` (auto-
          rows defaults to content-sized, so `h-full` on items resolved
          against a short track instead of the absorbed slot). Plain
          flex-row with `flex-1` cards is the simplest robust shape.
          Equivalent alternative: `grid grid-cols-3 auto-rows-fr` —
          forces implicit rows to 1fr of absorbed flex height. Either
          works for current Panel 4 width (≥ ⅓ screen, no wrap risk);
          flex-row chosen for simplicity. Don't reintroduce `flex-wrap`
          thinking it's safer — wrap+stretch only stretches per-row. */}
      {/* Phase 7.L 2026-05-18 — was `flex-1 min-h-0` which made cards
       *  grab ALL remaining vertical space + crowded out the new
       *  impact-forecasts section below. Switched to `shrink-0` with
       *  explicit min-height so cards keep their natural sparkline
       *  footprint and the scrollable root handles overflow. */}
      {!noPLIndicators ? (
        <div className="flex gap-2 shrink-0 min-h-[140px]">
          {cards.map(({ indicator, cell }) => (
            <div key={indicator.id} className="flex-1 min-w-0 h-full">
              <SnapshotCard indicator={indicator} cell={cell} locale={locale} />
            </div>
          ))}
        </div>
      ) : (
        <div className="text-gray-700 text-[11px] leading-relaxed shrink-0">
          {t("snapshot.noPlIndicators")}{" "}
          <span className="text-[#FFB020]">{companyCode}</span>.
        </div>
      )}

      <p className="text-[10px] text-gray-600 mt-1 shrink-0">
        {t("snapshot.footerHint")}
      </p>

      {/* Phase 7.L — feed-crossing impact forecasts. Renders nothing
       *  when no forecasts exist for this company (empty state handled
       *  inside the component). Lives below the indicator-card row
       *  so the existing layout stays unchanged when no events fire.
       *
       *  No `shrink-0` here — let the section grow naturally; the
       *  parent's `overflow-y-auto` (added 2026-05-18) absorbs the
       *  extra height via scroll instead of crashing into adjacent
       *  panels. */}
      <div className="mt-2 pt-2 border-t border-gray-800/40">
        <CompanyImpactForecastsCard companyCode={companyCode} />
      </div>

      {/* Phase 7.M Tier 4 (2026-05-19) — Strategic context (Təsvir
       *  description, Land Registry, CAPEX 2026, Forward Forecast).
       *  Renders nothing when entity has no settings populated. */}
      <div className="mt-2 pt-2 border-t border-gray-800/40">
        <CompanyStrategicContextCard companyCode={companyCode} />
      </div>
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
    <div
      data-testid="snapshot-card"
      className="rounded border border-gray-800/60 bg-[#0A0E27]/60 px-2 py-1.5 flex flex-col gap-1 h-full"
    >
      <div className="text-[9px] uppercase tracking-wider text-gray-600 truncate shrink-0">
        {resolveIndicatorLabel(indicator, locale)}
      </div>
      <div
        data-testid="snapshot-card-value"
        className="flex items-baseline gap-1 shrink-0"
      >
        {/* Tier-3 sub-29 Round-16 closure — shape glyph alongside
            colored value text. Same status→shape mapping as HeatMap
            cells; aria-hidden because the surrounding context already
            conveys status semantically.
            NOTE: the visual-baseline-snapshotcard gate masks THIS row
            (status glyph + value + status color are all data-driven —
            they recompute on every IndicatorValue change). The row's
            full-width band still locks vertical rhythm; the value/color
            rendering is asserted in CompanySnapshot.test.tsx instead. */}
        <span aria-hidden="true" className={`text-[10px] opacity-70 ${statusColor}`}>
          {statusShape(status)}
        </span>
        <span className={`tabular-nums font-semibold text-sm ${statusColor}`}>
          {cell ? formatValue(cell.value, indicator.unit) : "—"}
        </span>
      </div>
      {/* L133 closure (sub-36 architect 💡 from Round-32) — Sparkline now
          opts into `responsive` mode and lives inside a `flex-1` wrapper.
          The wrapper grows to fill remaining card height and the SVG
          scales uniformly via viewBox. `min-h-[24px]` preserves the
          original 24px floor on short cards. Title + value stay anchored
          at the top (no spacer needed — the wrapper IS the spacer now,
          and the sparkline visibly fills it instead of sitting dwarfed
          at the bottom). */}
      <div className="flex-1 min-h-[24px] flex items-stretch">
        <Sparkline
          responsive
          data={sparkline ?? Array(12).fill(null)}
          status={status}
          ariaLabel={t('heatMap.sparklineTrendAriaLabelSelf', {
            indCode: indicator.code,
          })}
        />
      </div>
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
