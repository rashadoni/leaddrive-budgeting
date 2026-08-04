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

import React, { useEffect, useRef, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { Sparkline, type SparklineStatus } from "./Sparkline";
import { TodayBrief } from "./TodayBrief";
import { useTerminalStore } from "../store/terminalStore";
import { hasEvidencedValue, statusShape } from "@/lib/risk/heatmap-matrix";
import { resolveIndicatorLabel } from "../lib/resolve-indicator-label";
import { localizeFormulaError } from "../lib/localize-formula-error";
import { PeerBenchmarkModal } from "./PeerBenchmarkModal";
import { Button } from "@/components/ui/button";
import { getDataSourcesForIndicator } from "@/lib/intel/sources-catalog";
// Phase 8 D1 (2026-05-29) — Panel-3 drill-down subsystem extracted to a sibling.
import { DrillDownSection } from "./indicator-detail/DrillDownSection";


// Phase 8 D1 (2026-05-29) — shared Panel-3 model types extracted to a sibling.
import type {
  IndicatorValueDetail,
  RecomputeState,
} from "./indicator-detail/types";
import { STATUS_HEX } from "./indicator-detail/types";
// Phase 8 D1 (2026-05-29) — shared value formatters (also used by ForecastSection).
import { formatValue, formatHeadlineValue } from "./indicator-detail/format";
// Phase 8 D1 (2026-05-29) — Panel-3 forecast subsystem extracted to a sibling.
import { ForecastSection } from "./indicator-detail/ForecastSection";
// Phase 8 D1 (2026-05-29) — Panel-3 badges + aggregate renderer extracted to siblings.
import {
  ProvenanceBadge,
  MaterialityBadge,
  TrustAuditStrip,
  StatementCheckStrip,
} from "./indicator-detail/badges";
import { AggregateBlock, formatAggValue, hintForKey, unitToHint } from "./indicator-detail/AggregateBlock";
import { BenchmarkBand } from "./indicator-detail/BenchmarkBand";
import { explainMissingCell, remedyKey } from "@/lib/risk/missing-input-remedy";

export function IndicatorDetail({
  onExplain,
}: {
  onExplain?: (indicatorValueId: string) => void;
} = {}) {
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

  // Track the auto-clear timeout so we can cancel it on unmount and avoid
  // state-on-unmounted-component noise during teardown (test gate flake).
  const recomputePillTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (recomputePillTimeoutRef.current !== null) {
        clearTimeout(recomputePillTimeoutRef.current);
        recomputePillTimeoutRef.current = null;
      }
    };
  }, []);

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
        if (!cancelled) setError(err.message || t('indicatorDetail.loadFailed'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ivId, refetchTick, t]);

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
      if (recomputePillTimeoutRef.current !== null) {
        clearTimeout(recomputePillTimeoutRef.current);
      }
      recomputePillTimeoutRef.current = setTimeout(() => {
        setRecomputeState((s) => (s.kind === 'done' ? { kind: 'idle' } : s));
        recomputePillTimeoutRef.current = null;
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
          ? 'text-red-600 dark:text-red-400'
          : pendingRollup.status === 'amber'
            ? 'text-[#FFB800]'
            : pendingRollup.status === 'green'
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-muted-foreground';
      const formattedValue = Number.isFinite(pendingRollup.value)
        ? pendingRollup.value.toFixed(1)
        : '—';
      return (
        <div
          data-testid="indicator-detail-rollup"
          className="font-mono text-xs leading-relaxed h-full w-full flex flex-col items-center justify-center text-center px-4 gap-3"
        >
          <div className="text-muted-foreground">
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
          <div className="text-muted-foreground max-w-md">
            {t('indicatorDetail.rollupHint', {
              indicator: pendingRollup.indicatorName,
              company: pendingRollup.companyCode,
              count: pendingRollup.contributingChildCount,
            })}
          </div>
          <div className="text-muted-foreground text-[10px]">
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
          <div className="text-muted-foreground">
            <span className="text-[#FFB800] font-semibold">
              {pendingMissing.companyCode}
            </span>{' '}
            ×{' '}
            <span className="text-[#FFB800] font-semibold">
              {pendingMissing.indicatorCode}
            </span>
          </div>
          <div className="text-muted-foreground max-w-md">
            {t('indicatorDetail.missingCellHint', {
              indicator: pendingMissing.indicatorName,
              company: pendingMissing.companyCode,
            })}
          </div>
          {/* 14.6 — the specific remedy, not the generic one.
              The old line told everybody "upload a workbook or run a
              recompute". Measured on production, that is right for 276 of the
              580 empty cells and wrong for the rest: 172 want a figure typed
              into a panel that already exists, 161 want a feed run, 28 want a
              setting picked. Worse, "run a recompute" on a cell whose input
              does not exist sends someone to do something that cannot help and
              then wonder what they did wrong. */}
          {(() => {
            const explained = explainMissingCell(pendingMissing.requiredInputs)
            if (!explained.primary) {
              return (
                <div className="text-muted-foreground text-[10px]">
                  {t('indicatorDetail.missingCellAction')}
                </div>
              )
            }
            return (
              <div
                data-testid="missing-cell-remedy"
                data-remedy={explained.primary.kind}
                className="text-muted-foreground text-[10px] max-w-md space-y-1"
              >
                <p>{t(remedyKey(explained.primary.kind) as never)}</p>
                <p className="font-mono opacity-60">{explained.primary.input}</p>
                {explained.alsoNeeds.length > 0 && (
                  <p className="opacity-70">
                    {t('indicatorDetail.remedy.alsoNeeds', {
                      list: explained.alsoNeeds
                        .map((r) => t(remedyKey(r.kind) as never))
                        .join(' · '),
                    })}
                  </p>
                )}
              </div>
            )
          })()}
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
        className="text-muted-foreground font-mono text-xs h-full w-full flex items-center justify-center"
      >
        {t('indicatorDetail.loading')}
      </div>
    );
  }
  if (error) {
    return (
      <div
        data-testid="indicator-detail-error"
        className="text-red-600 dark:text-red-400 font-mono text-xs h-full w-full flex items-center justify-center"
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
  // 2026-08-04 audit — the hint templates are written as assertions about a
  // number ("Customer HHI is {value}. Above 0.25 = ..."). With no evidence
  // behind the cell there is no number to assert, and filling {value} with the
  // stored 0 turned "we know nothing" into "concentration is perfect".
  const evidenced = hasEvidencedValue(status as never, value);
  const hint = hintTemplate && evidenced
    ? hintTemplate
        .replace("{value}", formatValue(value))
        .replace("{status}", localizedStatusWord)
    : null;

  return (
    <div
      data-testid="indicator-detail-result"
      className="font-mono text-[11px] text-muted-foreground w-full h-full flex flex-col gap-2 overflow-auto"
    >
      <header className="shrink-0 flex items-start justify-between gap-2 pb-1.5 border-b border-border/60">
        <div>
          <div className="text-muted-foreground uppercase tracking-wider text-[9px]">
            {co.code} · {co.name}
            {co.industry && (
              <span className="ml-2 text-muted-foreground">
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
            <span className="text-muted-foreground font-normal text-[10px]" title={ind.code}>
              {ind.code}
            </span>{' '}
            <span className="text-[#E8EDF5]">
              {/* Round-24 Stage 3 — shared resolver. */}
              {resolveIndicatorLabel(ind, locale)}
            </span>
          </div>
          <div className="text-muted-foreground text-[10px] mt-0.5">
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
            {evidenced ? formatHeadlineValue(value, ind.unit) : "—"}
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
            note={
              (locale === 'ru'
                ? detail.materialityNoteRu
                : locale === 'az'
                  ? detail.materialityNoteAz
                  : detail.materialityNote) ??
              detail.materialityNote ??
              null
            }
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
              className="flex items-center gap-1 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border border-border hover:border-emerald-500/60 hover:text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/5 transition-colors text-muted-foreground"
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
            className="flex items-center gap-1 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border border-border hover:border-emerald-500/60 hover:text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/5 disabled:opacity-40 disabled:hover:border-border disabled:hover:text-muted-foreground disabled:hover:bg-transparent transition-colors text-muted-foreground"
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
              className="text-[9px] text-red-600 dark:text-red-400 max-w-[180px] text-right leading-tight"
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

      {/* 11.91 — ABOVE the trust strip, and above the hint. A reader who gets
          three lines into this panel has already decided how to feel about the
          number; if it disagrees with their own paperwork, that has to arrive
          before the interpretation does. */}
      <StatementCheckStrip
        reconStatus={detail.reconStatus}
        reconExpected={detail.reconExpected}
        reconCheckedAt={detail.reconCheckedAt}
        reconAcceptedBy={detail.reconAcceptedBy}
        reconAcceptedReason={detail.reconAcceptedReason}
        value={detail.value}
        unit={detail.indicator.unit ?? ''}
        t={t}
      />

      {hint && (
        <p className="text-muted-foreground leading-snug">{hint}</p>
      )}

      {/* Client feedback #1 — benchmark band: floor → target from the
          indicator's real thresholds, with the current value marked. Renders
          only for higher/lower_better indicators with numeric green+red
          thresholds (per-ha + most ratios); auto-omits otherwise. */}
      <BenchmarkBand
        thresholds={ind.thresholds as never}
        direction={ind.direction}
        value={evidenced ? value : Number.NaN}
        unit={ind.unit}
      />

      {/* Phase B3 — trailing 12-month sparkline. Renders empty baseline
          when sparkline is null/empty (IV pre-dates B2 batch run); user
          sees the column slot reserved without misleading "0" data. */}
      {detail.sparkline && detail.sparkline.length > 0 && (
        <div className="flex items-center gap-2 rounded border border-border/60 bg-[#0A0E27]/40 px-2 py-1.5">
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground shrink-0">
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
              <span className="text-[10px] text-muted-foreground ml-auto tabular-nums">
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
          unit={ind.unit}
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
          <div className="text-amber-600 dark:text-amber-400 text-[10px] uppercase tracking-wider mb-0.5">
            {t('indicatorDetail.pipelineNote')}
          </div>
          <div className="text-muted-foreground text-[11px]">
            {/* The engine's `reason` is English-only developer text. Route it
                through the same localizer HeatMapCellTd uses so Panel 3 and
                the matrix tooltip say the same thing in the same language. */}
            {localizeFormulaError(
              errPayload.code,
              errPayload.reason,
              ind.code,
              t,
            )}
          </div>
        </div>
      )}

      <section>
        <div className="text-muted-foreground uppercase tracking-wider text-[9px] mb-0.5">
          {t('indicatorDetail.formula')}
        </div>
        <code className="block bg-foreground/95 dark:bg-background rounded border border-border px-2 py-1 text-emerald-600 dark:text-emerald-400 text-[11px] whitespace-pre-wrap break-all">
          {ind.formula}
        </code>
      </section>

      {/* Phase 7.K 2026-05-18 — external-source provenance. Surfaces
       *  the API + vendor + cadence behind every commodityPrice-fed
       *  indicator so client demos can answer "where does this number
       *  come from?" without leaving Risk Terminal. Falls through
       *  silently for indicators that don't depend on external feeds
       *  (pure financial / ESG / operational). */}
      {(() => {
        const sources = getDataSourcesForIndicator(ind.code);
        if (sources.length === 0) return null;
        return (
          <section>
            <div className="text-muted-foreground uppercase tracking-wider text-[9px] mb-0.5">
              {t('indicatorDetail.source')}
            </div>
            <div className="space-y-1.5">
              {sources.map((src) => (
                <div
                  key={src.sourceCode}
                  className="rounded border border-border/50 bg-foreground/5 px-2 py-1.5 text-[11px]"
                >
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <span className="font-medium text-gray-200">
                      {src.displayNameRu}
                    </span>
                    <a
                      href={src.vendorUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-cyan-400 hover:text-cyan-300 text-[10px] underline-offset-2 hover:underline"
                    >
                      {new URL(src.vendorUrl).hostname.replace("www.", "")} ↗
                    </a>
                  </div>
                  <div className="text-gray-400 text-[10px] leading-snug">
                    {src.vendor} · {src.cadenceRu}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[10px]">
                    <a
                      href="/budgeting/admin/data-sources"
                      className="text-blue-400 hover:text-blue-300 underline-offset-2 hover:underline"
                    >
                      {t('indicatorDetail.whatIsThis')}
                    </a>
                    <span className="text-gray-600">·</span>
                    <code className="font-mono text-gray-500">
                      {src.sourceCode}
                    </code>
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })()}

      <section>
        <div className="text-muted-foreground uppercase tracking-wider text-[9px] mb-0.5">
          {t('indicatorDetail.resolvedVariables')}
        </div>
        {Object.keys(resolved).length === 0 ? (
          <p className="text-muted-foreground text-[11px]">
            {t('indicatorDetail.noneMissingData')}
          </p>
        ) : (
          <table className="text-[11px] tabular-nums w-full">
            <tbody>
              {Object.entries(resolved).map(([k, v]) => {
                // Phase 8 fix: a resolved variable that IS this indicator
                // (passthrough, e.g. LEGAL_CASES_ACTIVE / AUDIT_CLOSED_PCT)
                // uses the indicator's REAL unit. For other inputs we keep the
                // name heuristic — BUT never render ₼ for a NON-currency
                // indicator: the heuristic defaults unknown keys to money, so a
                // %-indicator like TOP_CUSTOMER_SHARE showed its input
                // `top_counterparty_share_customer = 42 ₼`. Coerce that money
                // default to a plain number when the indicator isn't currency.
                const indHint = unitToHint(ind.unit);
                let hint = k === ind.code ? indHint : hintForKey(k);
                if (indHint !== "money" && hint === "money") hint = "ratio";
                return (
                  <tr key={k} className="border-b border-border/30 last:border-b-0">
                    <td className="py-0.5 pr-3 text-muted-foreground font-mono">{k}</td>
                    <td
                      className="py-0.5 text-gray-200 text-right"
                      title={Number.isFinite(v) ? v.toLocaleString("ru-RU") : undefined}
                    >
                      {formatAggValue(v, hint)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <div className="text-muted-foreground uppercase tracking-wider text-[9px] mb-0.5">
          {t('indicatorDetail.aggregates')}
        </div>
        {Object.keys(aggregates).length === 0 ? (
          <p className="text-muted-foreground text-[11px]">{t('indicatorDetail.none')}</p>
        ) : (
          <ul className="space-y-2">
            {Object.entries(aggregates).map(([ns, data]) => (
              <li key={ns} className="text-[10px]">
                <div className="text-muted-foreground uppercase mb-0.5">{ns}</div>
                <AggregateBlock data={data} t={t} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <DrillDownSection ivId={detail.id} t={t} />

      <section className="shrink-0 pt-1.5 border-t border-border/60 flex justify-end gap-2 flex-wrap">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            // Opens the per-cell Comments overlay. The store already
            // knows the active cell from `setActiveIv`, so the modal
            // auto-selects this thread on open — no extra args needed.
            window.dispatchEvent(new CustomEvent("terminal:open-comments"));
          }}
          className="h-7 text-[11px]"
          title={t('indicatorDetail.commentsButtonTitle')}
          data-testid="indicator-detail-comments"
        >
          {t('indicatorDetail.commentsButton')}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setBenchmarkOpen(true)}
          className="h-7 text-[11px]"
          title={t('indicatorDetail.benchmarkTitle')}
        >
          {t('indicatorDetail.benchmarkButton')}
        </Button>
        <Button
          type="button"
          variant="default"
          size="sm"
          onClick={() => {
            // The paid request stays on a direct React click-owned callback.
            // There is no forgeable global event bridge.
            setActivePanel(4);
            onExplain?.(detail.id);
          }}
          disabled={status === "green"}
          className="h-7 text-[11px]"
          title={
            status === "green"
              ? t('indicatorDetail.explainGreenDisabled')
              : t('indicatorDetail.explainTitle')
          }
        >
          {t('indicatorDetail.explainButton')}
        </Button>
      </section>
      {benchmarkOpen && (
        <PeerBenchmarkModal ivId={detail.id} onClose={() => setBenchmarkOpen(false)} />
      )}
    </div>
  );
}
