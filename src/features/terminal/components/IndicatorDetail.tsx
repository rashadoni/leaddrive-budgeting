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
import { ExternalLink, RefreshCw } from "lucide-react";
import { Sparkline, type SparklineStatus } from "./Sparkline";
import { TodayBrief } from "./TodayBrief";
import { useTerminalStore } from "../store/terminalStore";
import {
  forecastNextPeriod,
  type ForecastConfidence,
} from "@/lib/risk/forecast";
import { statusShape } from "@/lib/risk/heatmap-matrix";
import { resolveIndicatorLabel } from "../lib/resolve-indicator-label";
import { PeerBenchmarkModal } from "./PeerBenchmarkModal";

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

/** Phase 7.H F4.v2.1 — provenance ladder rendered as a Panel-3 badge.
 *  Mirrors `IndicatorValueSource` from prisma/schema.prisma. */
type ValueSource =
  | "disclosed"
  | "modeled_industry"
  | "modeled_generic"
  | "macro"
  | "computed";

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
  /** Phase 7.H F4.v2.1 — provenance stamp from `IndicatorValue.valueSource`. */
  valueSource?: ValueSource;
  /** Phase 7.H F4.v2.1 — reserved (`A`|`B`|`C`|`D`) for the v2.2 industry-
   *  factor confidence tier; null until that phase ships. */
  confidence?: string | null;
  /** Phase 7.H F4.v2.4 — SASB-style materiality rating for the
   *  (company.industry × indicator) pair. Null on non-ESG indicators. */
  materiality?: 'material' | 'low_materiality' | 'not_material' | null;
  /** Phase 7.H F4.v2.4 — calibration note explaining why this pair was
   *  rated low/not-material. Null on `material` (default) cells + non-ESG. */
  materialityNote?: string | null;
  /** Financial-truth-infra Phase B.2 — provenance + reconciliation
   *  metadata. `sourceDocument` is the file/sheet/row pointer the value
   *  was ingested from (e.g. `Consolidated budget 2026.xlsx#PL_EDEN!R3`).
   *  `lastReconciledAt` is the ISO timestamp of the most-recent
   *  audit-company.cjs pass. `reconciledBy` is the user id (or 'cli'
   *  for unattended runs). `sanityBand` is the verdict from the
   *  industry sanity-band classifier. All optional — pre-Phase-A IVs
   *  have null values and render the "not yet reconciled" copy. */
  sourceDocument?: string | null;
  lastReconciledAt?: string | null;
  reconciledBy?: string | null;
  sanityBand?: 'normal' | 'low_extreme' | 'high_extreme' | 'missing_input' | 'no_band' | null;
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
  const tStatus = useTranslations('terminal.status');
  const tIndustries = useTranslations('industries');
  const locale = useLocale();
  const ivId = useTerminalStore((s) => s.activeIndicatorValueId);
  const pendingMissing = useTerminalStore((s) => s.pendingMissingCell);
  const pendingRollup = useTerminalStore((s) => s.pendingRollupCell);
  const setActivePanel = useTerminalStore((s) => s.setActivePanel);
  // Phase 7.I — forward to commodity-ticker pop-out so it hydrates with
  // this company instead of landing on "Select a company".
  const activeCompanyCodeForPopout = useTerminalStore((s) => s.activeCompanyCode);

  const [detail, setDetail] = useState<IndicatorValueDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recomputeState, setRecomputeState] = useState<RecomputeState>({ kind: 'idle' });
  // Phase 7.H Feature 3 — peer benchmark modal toggle.
  const [benchmarkOpen, setBenchmarkOpen] = useState(false);
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
    // Phase 7.G Turn VI — sub-group rollup cell click. Synthetic-rollup
    // cells have lit value+status (avg + worst-of-children) but no
    // persisted IV. Pre-Turn-VI the user got the "no computed value
    // yet" hint — wrong message: the cell IS computed, just not as a
    // single canonical IV. Render the aggregate + child count instead
    // so the user understands they clicked an averaged value.
    if (pendingRollup) {
      const statusTone =
        pendingRollup.status === 'red'
          ? 'text-[#FF4757]'
          : pendingRollup.status === 'amber'
            ? 'text-[#FFB800]'
            : pendingRollup.status === 'green'
              ? 'text-[#00D4AA]'
              : 'text-gray-500';
      const formattedValue = Number.isFinite(pendingRollup.value)
        ? pendingRollup.value.toFixed(1)
        : '—';
      return (
        <div
          data-testid="indicator-detail-rollup"
          className="font-mono text-xs leading-relaxed h-full w-full flex flex-col items-center justify-center text-center px-4 gap-3"
        >
          <div className="text-gray-400">
            <span className="text-[#FFB800] font-semibold">
              {pendingRollup.companyCode}
            </span>{' '}
            ×{' '}
            <span className="text-[#FFB800] font-semibold">
              {pendingRollup.indicatorCode}
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className={`text-2xl font-semibold ${statusTone}`}>
              {formattedValue}
              {pendingRollup.indicatorUnit ? (
                <span className="ml-1 text-sm">
                  {pendingRollup.indicatorUnit}
                </span>
              ) : null}
            </span>
            <span
              className={`uppercase tracking-wider text-[10px] ${statusTone}`}
            >
              {pendingRollup.status}
            </span>
          </div>
          <div className="text-gray-500 max-w-md">
            {t('indicatorDetail.rollupHint', {
              indicator: pendingRollup.indicatorName,
              company: pendingRollup.companyCode,
              count: pendingRollup.contributingChildCount,
            })}
          </div>
          <div className="text-gray-700 text-[10px]">
            {t('indicatorDetail.rollupAction')}
          </div>
        </div>
      );
    }
    // Phase 7.D regression-architect closure — when user clicked a
    // MISSING HeatMap cell (no IV row yet), HeatMap routed via
    // `setPendingMissingCell` instead of `setActiveIv`. Render a self-
    // explanatory hint so the click is never silently swallowed —
    // user reported "клики не работают" twice; the bug was actually
    // "clicked a cell that has no computed value, panel stayed empty
    // showing the welcome state". New contract: missing cells get a
    // dedicated no-data hint with company + indicator codes.
    if (pendingMissing) {
      return (
        <div
          data-testid="indicator-detail-no-data"
          className="font-mono text-xs leading-relaxed h-full w-full flex flex-col items-center justify-center text-center px-4 gap-3"
        >
          <div className="text-gray-400">
            <span className="text-[#FFB800] font-semibold">
              {pendingMissing.companyCode}
            </span>{' '}
            ×{' '}
            <span className="text-[#FFB800] font-semibold">
              {pendingMissing.indicatorCode}
            </span>
          </div>
          <div className="text-gray-500 max-w-md">
            {t('indicatorDetail.missingCellHint', {
              indicator: pendingMissing.indicatorName,
              company: pendingMissing.companyCode,
            })}
          </div>
          <div className="text-gray-700 text-[10px]">
            {t('indicatorDetail.missingCellAction')}
          </div>
        </div>
      );
    }
    // Sub-36 cont'd Round-33 — empty-state centered both axes so the
    // placeholder visibly fills the panel slot rather than top-anchoring
    // and leaving dead space below. User feedback "тяни нижнию часть
    // не тянется" was about the visual filling, not the underlying
    // height resolution (which already worked via items-stretch).
    // CLI Tier 2 #5 — replace static empty placeholder with Today's
    // Brief: top-3 worst red, top-3 movers (sparkline delta), top-3
    // alerts. Bloomberg launchpad equivalent — gives the CFO immediate
    // signal without a single click.
    return (
      <div data-testid="indicator-detail-empty" className="h-full w-full">
        <TodayBrief />
      </div>
    );
  }
  if (loading) {
    return (
      <div
        data-testid="indicator-detail-loading"
        className="text-gray-700 font-mono text-xs h-full w-full flex items-center justify-center"
      >
        {t('indicatorDetail.loading')}
      </div>
    );
  }
  if (error) {
    return (
      <div
        data-testid="indicator-detail-error"
        className="text-[#FF4757] font-mono text-xs h-full w-full flex items-center justify-center"
      >
        {t('indicatorDetail.error')} {error}
      </div>
    );
  }
  if (!detail) return null;

  const { indicator: ind, company: co, status, value, period, inputs } = detail;
  const statusColor = STATUS_HEX[status];

  const resolved = inputs?.resolved ?? {};
  const aggregates = inputs?.aggregates ?? {};
  const errPayload = inputs?.error;

  // Phase 7.G Turn VIII — locale-aware hint resolution + status-token i18n
  // (architect Turn-VII Round-1 sub-task closure). Pre-Turn-VIII the hint
  // paragraph rendered hintTemplateEn regardless of locale and substituted
  // raw status word ("RED"/"AMBER"/"GREEN"/"UNKNOWN"); both leaked English
  // into RU/AZ panels even after the surrounding labels were localized.
  // New contract: pick locale-matching field with EN fallback (idiomatic
  // when a translation is missing rather than awkward auto-translate);
  // localize the {status} substitution via tStatus() so the inline word
  // matches the badge above.
  const hintTemplate =
    locale === 'ru'
      ? ind.hintTemplateRu || ind.hintTemplateEn
      : locale === 'az'
        ? ind.hintTemplateAz || ind.hintTemplateEn
        : ind.hintTemplateEn;
  const localizedStatusWord = (() => {
    try {
      return tStatus(status as never);
    } catch {
      return status.toUpperCase();
    }
  })();
  const hint = hintTemplate
    ? hintTemplate
        .replace("{value}", formatValue(value))
        .replace("{status}", localizedStatusWord)
    : null;

  return (
    <div className="font-mono text-[11px] text-gray-300 w-full h-full flex flex-col gap-2 overflow-auto">
      <header className="shrink-0 flex items-start justify-between gap-2 pb-1.5 border-b border-gray-800/60">
        <div>
          <div className="text-gray-500 uppercase tracking-wider text-[9px]">
            {co.code} · {co.name}
            {co.industry && (
              <span className="ml-2 text-gray-700">
                ({(() => {
                  // Phase 7.G Turn VII — localize industry code via the
                  // `industries.*` namespace shipped Turn G. Defensive
                  // try/catch falls back to raw code when key is missing
                  // (mirrors the alert-message-i18n.ts helper pattern).
                  try {
                    return tIndustries(co.industry as never);
                  } catch {
                    return co.industry;
                  }
                })()})
              </span>
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
            {/* Phase 7.G Turn VII — meta-line labels + direction value
                localized. Pre-Turn-VII rendered raw "period 2026 · direction
                higher_better · unit %" — labels and the direction enum
                value all stayed English regardless of locale. */}
            {t('indicatorDetail.metaPeriod')} {period} · {t('indicatorDetail.metaDirection')}{' '}
            {ind.direction === 'higher_better'
              ? t('indicatorDetail.directionHigherBetter')
              : ind.direction === 'lower_better'
                ? t('indicatorDetail.directionLowerBetter')
                : t('indicatorDetail.directionBand')}
            {' '}· {t('indicatorDetail.metaUnit')} {ind.unit}
          </div>
        </div>
        <div className="text-right shrink-0 flex flex-col items-end gap-1">
          <div
            className="text-2xl tabular-nums font-semibold"
            style={{ color: statusColor }}
            title={Number.isFinite(value) ? value.toLocaleString("ru-RU") : undefined}
          >
            {formatHeadlineValue(value, ind.unit)}
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
            {/* Phase 7.G Turn VII — localize status word via the existing
                terminal.status.{green,amber,red,unknown} namespace
                ("Healthy"/"Watch"/"Critical"/"No data" in EN; idiomatic
                in RU/AZ). Defensive try/catch keeps the raw code as
                fallback if a future status enum value lands without a
                matching key. */}
            {(() => {
              try {
                return tStatus(status as never);
              } catch {
                return status;
              }
            })()}
          </div>
          {/* Phase 7.H F4.v2.1 — Bloomberg-style provenance badge. The
              red KPIs that the client sees aren't always real measurements
              (carbon Scope 1/2/3 + ESG composite are revenue × generic
              factor, IND_GOV_CLIMATE_SCORE is a single macro literal).
              The badge surfaces THIS source distinction so a client can
              tell a disclosed/measured number from a modelled estimate
              at a glance. `computed` (financial/operational majority)
              renders no badge — adding one would be visual noise on the
              92% of cells that are real derived values. */}
          <ProvenanceBadge
            source={detail.valueSource}
            confidence={detail.confidence ?? null}
            t={t}
          />
          {/* Phase 7.H F4.v2.4 — SASB materiality badge. Renders next to
              provenance for ESG cells where the (industry × indicator)
              pair isn't fully material. `material` cells (the default)
              show no badge — adding "MATERIAL" on every cell would be
              visual noise. */}
          <MaterialityBadge
            rating={detail.materiality ?? null}
            note={detail.materialityNote ?? null}
            t={t}
          />
          {/* Phase 7.I — "Open source" jump for indicators that read from
              external feeds (commodityPriceResolver or weatherResolver).
              For non-macro/computed cells the source IS the formula's
              budget lines — drill-down is already in the variables list
              below; a button here would be redundant. Detection by
              indicator-code prefix lets us route to the right pop-out
              (sugar price + weather both live in the CommodityTicker
              panel, so AGRO_SUGAR_PRICE_TREND and AGRO_WEATHER_RAINFALL
              both open it). */}
          {(detail.indicator.code === "AGRO_SUGAR_PRICE_TREND" ||
            detail.indicator.code === "AGRO_WEATHER_RAINFALL") && (
            <button
              type="button"
              onClick={() => {
                const qs = activeCompanyCodeForPopout
                  ? `?company=${encodeURIComponent(activeCompanyCodeForPopout)}`
                  : "";
                window.open(
                  `/terminal-panel/commodity-ticker${qs}`,
                  "terminal-panel-commodity-ticker",
                );
              }}
              className="flex items-center gap-1 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border border-gray-800 hover:border-[#00D4AA]/60 hover:text-[#00D4AA] hover:bg-[#00D4AA]/5 transition-colors text-gray-500"
              title={t('indicatorDetail.openSourceTitle')}
            >
              <ExternalLink size={10} aria-hidden="true" />
              <span>{t('indicatorDetail.openSourceButton')}</span>
            </button>
          )}
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

      {/* Financial-truth-infra Phase B.2 — audit/provenance strip. Shows
          where this number came from + when (and by whom) it was last
          reconciled against the source document. Renders even on
          unreconciled IVs so users know the status is "never audited",
          rather than the panel silently omitting trust info. */}
      <TrustAuditStrip
        sourceDocument={detail.sourceDocument}
        lastReconciledAt={detail.lastReconciledAt}
        reconciledBy={detail.reconciledBy}
        sanityBand={detail.sanityBand}
        t={t}
      />

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
                {/* Phase 7.G Turn VII — reuse forecastPts key for the
                    trend "pts" label so it tracks RU "точек" / AZ "xal"
                    instead of staying raw EN. */}
                {numeric.length}/12 {t('indicatorDetail.forecastPts')} · Δ {sign}{formatValue(delta)}
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
                  <td
                    className="py-0.5 text-gray-200 text-right"
                    title={Number.isFinite(v) ? v.toLocaleString("ru-RU") : undefined}
                  >
                    {formatAggValue(v, hintForKey(k))}
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
          <ul className="space-y-2">
            {Object.entries(aggregates).map(([ns, data]) => (
              <li key={ns} className="text-[10px]">
                <div className="text-gray-500 uppercase mb-0.5">{ns}</div>
                <AggregateBlock data={data} t={t} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <DrillDownSection ivId={detail.id} t={t} />

      <section className="shrink-0 pt-1.5 border-t border-gray-800/60 flex justify-end gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => {
            // Opens the per-cell Comments overlay. The store already
            // knows the active cell from `setActiveIv`, so the modal
            // auto-selects this thread on open — no extra args needed.
            window.dispatchEvent(new CustomEvent("terminal:open-comments"));
          }}
          className="bg-transparent border border-[#00D4AA]/60 text-[#00D4AA] px-3 py-1 rounded font-semibold text-[11px] uppercase tracking-wider hover:bg-[#00D4AA]/10"
          title={t('indicatorDetail.commentsButtonTitle')}
          data-testid="indicator-detail-comments"
        >
          {t('indicatorDetail.commentsButton')}
        </button>
        <button
          type="button"
          onClick={() => setBenchmarkOpen(true)}
          className="bg-transparent border border-[#00D4AA] text-[#00D4AA] px-3 py-1 rounded font-semibold text-[11px] uppercase tracking-wider hover:bg-[#00D4AA]/10"
          title={t('indicatorDetail.benchmarkTitle')}
        >
          {t('indicatorDetail.benchmarkButton')}
        </button>
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
      {benchmarkOpen && (
        <PeerBenchmarkModal ivId={detail.id} onClose={() => setBenchmarkOpen(false)} />
      )}
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

/**
 * Phase 7.H F4.v2.1 — provenance badge rendered next to the headline
 * value in Panel 3. Five variants with distinct tones:
 *   - `disclosed`        : teal contour ("РАСКРЫТО")
 *   - `modeled_industry` : amber ("ОТРАСЛЕВАЯ ОЦЕНКА")
 *   - `modeled_generic`  : gray-striped ("ОБЩАЯ ОЦЕНКА")
 *   - `macro`            : blue ("МАКРО-ПОКАЗАТЕЛЬ")
 *   - `computed` / null  : no badge (real derived value — adding one
 *                          would be visual noise on every cell)
 *
 * Tailwind utility classes only — no module.css. The Risk Terminal
 * palette uses these hex values across the app, so we hard-code them
 * inline to avoid spreading new design-tokens for a single badge.
 *
 * Sized to match the existing status badge (`text-[10px]`, same
 * padding) so the two stack cleanly without disturbing the panel
 * layout. Visual gate isn't expected to fire — the badge slot is
 * additive in an existing flex column.
 *
 * Phase 7.H F4.v2.2.1 — `confidence` tier appended to the tooltip
 * (e.g. "Confidence: B"). For `modeled_industry` cells this is the
 * worst tier across the scopes the formula used (A best → D worst).
 * `disclosed` cells have no tier (the value IS the truth).
 */
function ProvenanceBadge({
  source,
  confidence,
  t,
}: {
  source: IndicatorValueDetail["valueSource"];
  confidence: IndicatorValueDetail["confidence"];
  t: ReturnType<typeof useTranslations>;
}) {
  // `computed` is the financial / operational default — no badge.
  // Treat absence (legacy rows) the same: assume real until proven
  // otherwise. Phase 7.A through 7.G IVs predate the v2.1 stamp and
  // are all `computed` semantically.
  if (!source || source === "computed") return null;
  const labelKey = `indicatorDetail.provenance.${source}` as const;
  const titleKey = `indicatorDetail.provenance.${source}Title` as const;
  let label: string;
  let title: string;
  try {
    label = t(labelKey);
    title = t(titleKey);
  } catch {
    // Defensive fallback when a new variant lands without a matching
    // i18n key — render the raw enum value rather than throw.
    label = source.toUpperCase();
    title = source;
  }
  // Phase 7.H F4.v2.2.1 — append "Confidence: X" to the title tooltip
  // when the IV carries a tier (industry-modeled cells). Disclosed cells
  // skip the tier — the value is the truth, not a model output. Plain
  // string concat keeps the tooltip readable in all 3 locales.
  if (confidence) {
    let confidenceLabel: string;
    try {
      confidenceLabel = t("indicatorDetail.provenance.confidenceLabel", {
        tier: confidence,
      });
    } catch {
      confidenceLabel = `Confidence: ${confidence}`;
    }
    title = `${title} ${confidenceLabel}`;
  }
  const palette: Record<NonNullable<IndicatorValueDetail["valueSource"]>, string> = {
    disclosed:
      "border-[#00D4AA]/60 text-[#00D4AA] bg-[#00D4AA]/5",
    modeled_industry:
      "border-[#FFB020]/60 text-[#FFB020] bg-[#FFB020]/5",
    modeled_generic:
      "border-gray-500/60 text-gray-300 bg-gray-500/10",
    macro:
      "border-[#5B9DFF]/60 text-[#5B9DFF] bg-[#5B9DFF]/5",
    // `computed` never renders (guarded above) but keep the entry
    // so the map is exhaustive for future maintainers.
    computed: "",
  };
  return (
    <span
      data-testid="provenance-badge"
      data-source={source}
      data-confidence={confidence ?? undefined}
      title={title}
      className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border font-mono ${palette[source]}`}
    >
      {label}
      {confidence && (
        <span
          aria-hidden="true"
          data-testid="provenance-confidence-tier"
          className="ml-1.5 opacity-70 font-bold"
        >
          {confidence}
        </span>
      )}
    </span>
  );
}

/**
 * Phase 7.H F4.v2.4 — SASB materiality badge. Two non-default variants:
 *   - `low_materiality` : amber-soft contour, "НИЗКАЯ МАТЕРИАЛЬНОСТЬ"
 *   - `not_material`    : neutral gray, "НЕ МАТЕРИАЛЬНО"
 *   - `material` / null : no badge (default state)
 *
 * Calibration note (per-pair) surfaces in the tooltip — e.g.
 * "Campus operations dominated by purchased electricity (Scope 2),
 *  not direct combustion."
 */
function MaterialityBadge({
  rating,
  note,
  t,
}: {
  rating: "material" | "low_materiality" | "not_material" | null;
  note: string | null;
  t: ReturnType<typeof useTranslations>;
}) {
  if (!rating || rating === "material") return null;
  const labelKey =
    rating === "not_material"
      ? "indicatorDetail.materiality.notMaterial"
      : "indicatorDetail.materiality.lowMateriality";
  let label: string;
  try {
    label = t(labelKey);
  } catch {
    label = rating.toUpperCase();
  }
  let titleSuffix = "";
  try {
    titleSuffix = t("indicatorDetail.materiality.tooltipSuffix");
  } catch {
    titleSuffix = "Materiality (SASB).";
  }
  const tone =
    rating === "not_material"
      ? "border-gray-600/60 text-gray-400 bg-gray-700/15"
      : "border-[#FFB020]/40 text-[#FFB020]/80 bg-[#FFB020]/5";
  return (
    <span
      data-testid="materiality-badge"
      data-rating={rating}
      title={`${titleSuffix}${note ? ` ${note}` : ""}`}
      className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border font-mono ${tone}`}
    >
      {label}
    </span>
  );
}

/**
 * Financial-truth-infra Phase B.2 — Trust/Audit strip rendered between
 * the panel header and the hint paragraph. Shows where the value came
 * from (sourceDocument) + when it was last audited (lastReconciledAt
 * + reconciledBy) + sanity-band verdict.
 *
 * Renders even on pre-Phase-A IVs (all fields null) so the user gets a
 * clear "not yet reconciled" signal instead of the strip being silently
 * hidden — that absence-as-info was the original failure mode.
 */
function TrustAuditStrip(props: {
  sourceDocument?: string | null;
  lastReconciledAt?: string | null;
  reconciledBy?: string | null;
  sanityBand?: 'normal' | 'low_extreme' | 'high_extreme' | 'missing_input' | 'no_band' | null;
  t: ReturnType<typeof useTranslations>;
}) {
  const { sourceDocument, lastReconciledAt, reconciledBy, sanityBand } = props;
  // Soft-fail i18n lookups so the strip works even before keys are added.
  const lookup = (key: string, fallback: string): string => {
    try {
      return props.t(key as never);
    } catch {
      return fallback;
    }
  };
  const sourceLabel = lookup('indicatorDetail.trust.source', 'Источник / Source');
  const lastAuditedLabel = lookup('indicatorDetail.trust.lastAudited', 'Сверено / Audited');
  const notReconciledLabel = lookup('indicatorDetail.trust.notReconciled', 'Ещё не сверено · Not yet reconciled');
  const sourceNotRecorded = lookup('indicatorDetail.trust.sourceNotRecorded', 'Источник не зафиксирован · Source not recorded');

  const sanityLabel: Record<NonNullable<typeof sanityBand>, string> = {
    normal: 'normal',
    low_extreme: 'low extreme',
    high_extreme: 'high extreme',
    missing_input: 'missing input',
    no_band: 'no band',
  };
  const sanityTone: Record<NonNullable<typeof sanityBand>, string> = {
    normal: 'border-[#00D4AA]/40 text-[#00D4AA]/80 bg-[#00D4AA]/5',
    low_extreme: 'border-[#FF4757]/40 text-[#FF4757]/90 bg-[#FF4757]/5',
    high_extreme: 'border-[#FF4757]/40 text-[#FF4757]/90 bg-[#FF4757]/5',
    missing_input: 'border-gray-600/60 text-gray-400 bg-gray-700/15',
    no_band: 'border-gray-700/60 text-gray-500 bg-gray-800/15',
  };

  const auditDate = lastReconciledAt
    ? new Date(lastReconciledAt).toLocaleDateString(undefined, {
        year: 'numeric', month: 'short', day: '2-digit',
      })
    : null;

  return (
    <div
      data-testid="trust-audit-strip"
      className="flex items-start gap-3 rounded border border-gray-800/60 bg-[#0A0E27]/40 px-2 py-1.5 text-[10px] text-gray-500 leading-snug flex-wrap"
    >
      <div className="flex items-start gap-1 min-w-0 flex-1">
        <span className="text-gray-600 uppercase tracking-wider shrink-0">
          {sourceLabel}:
        </span>
        <span
          className={sourceDocument ? 'text-gray-300 font-mono truncate' : 'italic text-gray-600'}
          title={sourceDocument ?? sourceNotRecorded}
        >
          {sourceDocument ?? sourceNotRecorded}
        </span>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <span className="text-gray-600 uppercase tracking-wider">
          {lastAuditedLabel}:
        </span>
        {auditDate ? (
          <span className="text-gray-300">
            {auditDate}
            {reconciledBy ? <span className="text-gray-600"> · {reconciledBy}</span> : null}
          </span>
        ) : (
          <span className="italic text-gray-600">{notReconciledLabel}</span>
        )}
      </div>
      {sanityBand && sanityBand !== 'no_band' && (
        <span
          data-testid="sanity-band-badge"
          data-sanity-band={sanityBand}
          className={`uppercase tracking-wider text-[9px] px-1.5 py-0.5 rounded border shrink-0 ${sanityTone[sanityBand]}`}
        >
          {sanityLabel[sanityBand]}
        </span>
      )}
    </div>
  );
}

/** Headline-value formatter that respects the indicator's unit.
 *  Mirrors HeatMap.formatValueCompact: AZN/money → K/M/B + ₼,
 *  % → fixed-precision percent, else compact decimals. Used for the
 *  big number at the top of Panel 3 — the "42682305" eyesore was raw
 *  formatValue() not knowing the unit (Phase 7.H follow-up fix). */
function formatHeadlineValue(v: number, unit: string): string {
  if (!Number.isFinite(v)) return "—";
  const u = (unit ?? "").trim();
  if (u === "%" || /percent/i.test(u)) {
    return `${v.toFixed(Math.abs(v) >= 100 ? 0 : 1)}%`;
  }
  const abs = Math.abs(v);
  if (u === "AZN" || u === "₼" || u === "USD" || u === "EUR" || /^[A-Z]{3}$/.test(u)) {
    const suffix = u === "AZN" ? "₼" : u;
    if (abs >= 1e9) return `${(v / 1e9).toFixed(1)}B ${suffix}`;
    if (abs >= 1e6) return `${(v / 1e6).toFixed(1)}M ${suffix}`;
    if (abs >= 1e3) return `${(v / 1e3).toFixed(1)}K ${suffix}`;
    return `${v.toFixed(0)} ${suffix}`;
  }
  // tCO2e / score / count / unitless — compact decimals.
  if (abs >= 1e9) return `${(v / 1e9).toFixed(1)}B${u ? " " + u : ""}`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(1)}M${u ? " " + u : ""}`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(1)}K${u ? " " + u : ""}`;
  return `${v.toFixed(abs >= 10 ? 1 : 2)}${u ? " " + u : ""}`;
}

/** Pretty-renderer for the rollup-resolver aggregate shape:
 *  { sums: { INDICATOR_CODE: { sum, matched_count } }, children_count }.
 *  Returns null if shape doesn't match → caller falls back to JSON. */
function renderRollupAggregate(
  data: Record<string, unknown>,
): React.ReactElement | null {
  const sums = data.sums;
  const childrenCount = typeof data.children_count === "number" ? data.children_count : null;
  if (!sums || typeof sums !== "object" || Array.isArray(sums)) return null;
  const sumEntries = Object.entries(sums as Record<string, unknown>);
  // Validate every sum entry has the expected shape.
  type SumEntry = { code: string; sum: number; matchedCount: number };
  const parsed: SumEntry[] = [];
  for (const [code, raw] of sumEntries) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const r = raw as Record<string, unknown>;
    if (typeof r.sum !== "number") return null;
    parsed.push({
      code,
      sum: r.sum,
      matchedCount:
        typeof r.matched_count === "number" ? r.matched_count : 0,
    });
  }
  if (parsed.length === 0) return null;
  return (
    <div className="space-y-1 bg-[#050814] rounded border border-gray-800 px-2 py-1.5">
      <table className="text-[10px] tabular-nums w-full">
        <tbody>
          {parsed.map((p) => (
            <tr key={p.code}>
              <td className="text-gray-400 pr-2 font-mono">{p.code}</td>
              <td
                className="text-gray-200 text-right pr-2"
                title={p.sum.toLocaleString("ru-RU")}
              >
                {formatAggValue(p.sum, "money")}
              </td>
              <td className="text-gray-600 text-right text-[9px] w-12">
                ({p.matchedCount})
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {childrenCount != null && (
        <div className="text-gray-600 text-[9px] pt-1 border-t border-gray-800/40">
          children_count: <span className="text-gray-400">{childrenCount}</span>
        </div>
      )}
    </div>
  );
}

/** Compact magnitude formatter (K/M/B) + unit-aware suffix.
 *  Mirrors HeatMap.formatValueCompact so a finance reader sees the same
 *  "1.2M ₼" / "34.1%" / "0.62" representation across drill-down + matrix. */
function formatAggValue(v: number, hint: "money" | "count" | "ratio" | "percent"): string {
  if (!Number.isFinite(v)) return "—";
  if (hint === "count") return String(Math.round(v));
  if (hint === "percent") return `${v.toFixed(Math.abs(v) >= 100 ? 0 : 1)}%`;
  if (hint === "ratio") return v.toFixed(2);
  // money
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(1)}B ₼`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(1)}M ₼`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(1)}K ₼`;
  return `${v.toFixed(0)} ₼`;
}

/** Heuristic — derive a presentation hint from the key name. Used to
 *  disambiguate "line_count: 900" (integer count) vs "revenue: 28713024"
 *  (money) vs "fx_revenue_share: 0.42" (ratio). */
function hintForKey(key: string): "money" | "count" | "ratio" | "percent" {
  if (/_count$|_n$|^count$/.test(key)) return "count";
  if (/_share$|_ratio$|_pct$|^ratio$/.test(key)) return "ratio";
  if (/_pct$|^pct/.test(key)) return "percent";
  // FX rates — small ratio-like numbers (1, 1.7, 1.85)
  if (/^fx_/.test(key)) return "ratio";
  // Default: money (revenue/cogs/opex/total_cost/imported_input_cost/etc.)
  return "money";
}

/** Render one aggregate namespace as a clean key-value table. Falls back to
 *  raw JSON for non-flat (nested) shapes — most production aggregates today
 *  are flat numeric records (budget_line / currency_rate / operational_fact
 *  / booking) so the table path covers ~95% of cases. */
function AggregateBlock({
  data,
  t,
}: {
  data: unknown;
  t: (k: string) => string;
}) {
  // Non-record fallback — show raw JSON for nested / non-flat payloads.
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return (
      <pre className="text-gray-400 text-[10px] whitespace-pre-wrap break-words bg-[#050814] rounded border border-gray-800 px-1.5 py-1">
        {JSON.stringify(data, null, 2)}
      </pre>
    );
  }
  const entries = Object.entries(data as Record<string, unknown>);
  // If any value is non-primitive, attempt structured rollup rendering
  // before falling back to raw JSON (Phase 7.H follow-up: rollup
  // aggregates were unreadable JSON dumps).
  const allPrimitive = entries.every(
    ([, v]) => v === null || ["number", "string", "boolean"].includes(typeof v),
  );
  if (!allPrimitive) {
    const rollupView = renderRollupAggregate(data as Record<string, unknown>);
    if (rollupView) return rollupView;
    return (
      <pre className="text-gray-400 text-[10px] whitespace-pre-wrap break-words bg-[#050814] rounded border border-gray-800 px-1.5 py-1">
        {JSON.stringify(data, null, 2)}
      </pre>
    );
  }
  return (
    <table className="text-[10px] tabular-nums w-full bg-[#050814] rounded border border-gray-800">
      <tbody>
        {entries.map(([k, v]) => {
          const hint = typeof v === "number" ? hintForKey(k) : "money";
          const display =
            typeof v === "number"
              ? formatAggValue(v, hint)
              : v === null
                ? "—"
                : String(v);
          return (
            <tr key={k} className="border-b border-gray-900 last:border-b-0">
              <td className="px-2 py-0.5 text-gray-400 font-mono">{k}</td>
              <td className="px-2 py-0.5 text-gray-200 text-right">{display}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
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

interface DrillDownLine {
  id: string;
  accountCode: string | null;
  accountName: string | null;
  accountType: string;
  category: string;
  department: string | null;
  plannedAmount: number;
  amountBase: number;
  currencyCode: string;
  exchangeRate: number | null;
  monthIndex: number | null;
  notes: string | null;
}
interface DrillDownData {
  companyId: string;
  year: number;
  lines: DrillDownLine[];
  summary: Record<string, { count: number; total: number }>;
  truncated: boolean;
}
interface MonthlySeries {
  months: { monthIndex: number; amountBase: number; lineCount: number }[];
}
type DrillState =
  | { kind: "collapsed" }
  | { kind: "loading" }
  | { kind: "loaded"; data: DrillDownData }
  | { kind: "error"; message: string };

function DrillDownSection({
  ivId,
  t,
}: {
  ivId: string;
  t: ReturnType<typeof useTranslations>;
}) {
  const [state, setState] = useState<DrillState>({ kind: "collapsed" });

  // Reset to collapsed whenever the active cell changes — otherwise a
  // previous cell's lines briefly flash when navigating between rows.
  useEffect(() => {
    setState({ kind: "collapsed" });
  }, [ivId]);

  const expand = async () => {
    setState({ kind: "loading" });
    try {
      const res = await fetch(
        `/api/indicators/values/${encodeURIComponent(ivId)}/drilldown`,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setState({
          kind: "error",
          message: body.error || `HTTP ${res.status}`,
        });
        return;
      }
      const data = (await res.json()) as DrillDownData;
      setState({ kind: "loaded", data });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-0.5">
        <div className="text-gray-500 uppercase tracking-wider text-[9px]">
          {t("indicatorDetail.drilldown.title")}
        </div>
        {state.kind === "collapsed" && (
          <button
            type="button"
            onClick={expand}
            className="text-[10px] text-[#00D4AA] hover:text-[#00E5BB] uppercase tracking-wider"
            data-testid="drilldown-expand"
          >
            {t("indicatorDetail.drilldown.show")}
          </button>
        )}
        {state.kind === "loaded" && (
          <button
            type="button"
            onClick={() => setState({ kind: "collapsed" })}
            className="text-[10px] text-gray-500 hover:text-gray-300 uppercase tracking-wider"
          >
            {t("indicatorDetail.drilldown.hide")}
          </button>
        )}
      </div>
      {state.kind === "loading" && (
        <p className="text-gray-700 text-[11px]">
          {t("indicatorDetail.drilldown.loading")}
        </p>
      )}
      {state.kind === "error" && (
        <p className="text-[#FF4757] text-[11px]" role="alert">
          {state.message}
        </p>
      )}
      {state.kind === "loaded" && (
        <DrillDownTable data={state.data} t={t} />
      )}
    </section>
  );
}

function DrillDownTable({
  data,
  t,
}: {
  data: DrillDownData;
  t: ReturnType<typeof useTranslations>;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [seriesState, setSeriesState] = useState<
    | { kind: "idle" }
    | { kind: "loading"; id: string }
    | { kind: "loaded"; id: string; data: MonthlySeries }
    | { kind: "error"; id: string; message: string }
  >({ kind: "idle" });

  if (data.lines.length === 0) {
    return (
      <p className="text-gray-700 text-[11px]">
        {t("indicatorDetail.drilldown.empty")}
      </p>
    );
  }

  const toggle = async (line: DrillDownLine) => {
    if (expandedId === line.id) {
      setExpandedId(null);
      setSeriesState({ kind: "idle" });
      return;
    }
    setExpandedId(line.id);
    setSeriesState({ kind: "loading", id: line.id });
    const params = new URLSearchParams({
      companyId: data.companyId,
      year: String(data.year),
    });
    if (line.accountCode) params.set("accountCode", line.accountCode);
    else if (line.category) params.set("category", line.category);
    try {
      const res = await fetch(
        `/api/budget-lines/monthly-series?${params.toString()}`,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setSeriesState({
          kind: "error",
          id: line.id,
          message: body.error || `HTTP ${res.status}`,
        });
        return;
      }
      const body = (await res.json()) as MonthlySeries;
      setSeriesState({ kind: "loaded", id: line.id, data: body });
    } catch (err) {
      setSeriesState({
        kind: "error",
        id: line.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <div className="space-y-1.5">
      {Object.keys(data.summary).length > 0 && (
        <div className="flex items-center gap-3 text-[10px] text-gray-400 border-b border-gray-800/40 pb-1">
          {Object.entries(data.summary).map(([type, info]) => (
            <span key={type}>
              <span className="text-gray-600 uppercase">{type}</span>{" "}
              <span className="text-gray-300 tabular-nums">
                {formatThousands(info.total)}
              </span>{" "}
              <span className="text-gray-700">({info.count})</span>
            </span>
          ))}
        </div>
      )}
      <table className="w-full text-[10px] tabular-nums">
        <thead>
          <tr className="text-gray-600 uppercase text-[9px]">
            <th className="text-left font-normal py-0.5 w-3"></th>
            <th className="text-left font-normal py-0.5">
              {t("indicatorDetail.drilldown.code")}
            </th>
            <th className="text-left font-normal py-0.5">
              {t("indicatorDetail.drilldown.name")}
            </th>
            <th className="text-right font-normal py-0.5">
              {t("indicatorDetail.drilldown.amount")}
            </th>
          </tr>
        </thead>
        <tbody>
          {data.lines.map((l) => {
            const isExpanded = expandedId === l.id;
            return (
              <React.Fragment key={l.id}>
                <tr
                  className="border-t border-gray-800/30 hover:bg-gray-800/20 cursor-pointer"
                  onClick={() => toggle(l)}
                  data-testid={isExpanded ? "drilldown-row-expanded" : undefined}
                >
                  <td className="text-gray-500 py-0.5 pr-0.5 text-center w-3">
                    {isExpanded ? "▾" : "▸"}
                  </td>
                  <td className="text-gray-500 py-0.5 pr-1 max-w-[60px] truncate">
                    {l.accountCode ?? "—"}
                  </td>
                  <td className="text-gray-300 py-0.5 pr-1 truncate">
                    {l.accountName ?? l.category ?? "—"}
                    {l.currencyCode !== "AZN" && (
                      <span className="ml-1 text-[#FFB800]">
                        {l.currencyCode}
                      </span>
                    )}
                  </td>
                  <td className="text-gray-200 text-right py-0.5">
                    {formatThousands(l.amountBase)}
                  </td>
                </tr>
                {isExpanded && (
                  <tr className="border-t border-gray-800/20 bg-gray-800/10">
                    <td colSpan={4} className="py-1.5 px-2">
                      {seriesState.kind === "loading" &&
                        seriesState.id === l.id && (
                          <span className="text-gray-700 text-[10px]">
                            {t("indicatorDetail.drilldown.loading")}
                          </span>
                        )}
                      {seriesState.kind === "error" &&
                        seriesState.id === l.id && (
                          <span
                            className="text-[#FF4757] text-[10px]"
                            role="alert"
                          >
                            {seriesState.message}
                          </span>
                        )}
                      {seriesState.kind === "loaded" &&
                        seriesState.id === l.id && (
                          <MonthlyBars
                            data={seriesState.data}
                            t={t}
                          />
                        )}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
      {data.truncated && (
        <p className="text-[#FFB800] text-[10px]">
          {t("indicatorDetail.drilldown.truncated")}
        </p>
      )}
    </div>
  );
}

function MonthlyBars({
  data,
  t,
}: {
  data: MonthlySeries;
  t: ReturnType<typeof useTranslations>;
}) {
  const amounts = data.months.map((m) => m.amountBase);
  const maxAbs = Math.max(1, ...amounts.map((a) => Math.abs(a)));
  return (
    <div className="space-y-1">
      <div className="text-gray-600 uppercase tracking-wider text-[8px]">
        {t("indicatorDetail.drilldown.monthlySeries")}
      </div>
      <div className="flex items-end gap-1 h-10">
        {data.months.map((m) => {
          const heightPct = (Math.abs(m.amountBase) / maxAbs) * 100;
          const isPositive = m.amountBase >= 0;
          return (
            <div
              key={m.monthIndex}
              className="flex-1 flex flex-col items-center gap-0.5"
              title={`M${m.monthIndex + 1}: ${formatThousands(m.amountBase)} (${m.lineCount} ${t("indicatorDetail.drilldown.lines")})`}
            >
              <div className="w-full h-8 flex items-end justify-center">
                <div
                  className={`w-full ${isPositive ? "bg-[#00D4AA]/60" : "bg-[#FF4757]/60"} rounded-sm`}
                  style={{ height: `${Math.max(2, heightPct)}%` }}
                />
              </div>
              <span className="text-gray-600 text-[8px]">
                M{m.monthIndex + 1}
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-2 text-[9px] text-gray-500 pt-1 border-t border-gray-800/40">
        {data.months.map((m) => (
          <span key={m.monthIndex} className="flex-1 text-center">
            {formatThousands(m.amountBase)}
          </span>
        ))}
      </div>
    </div>
  );
}

function formatThousands(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (Math.abs(v) >= 1_000_000) return (v / 1_000_000).toFixed(1) + "M";
  if (Math.abs(v) >= 1_000) return (v / 1_000).toFixed(1) + "K";
  return v.toFixed(0);
}
