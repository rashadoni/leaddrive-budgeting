"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useTerminalStore } from '../store/terminalStore';
import {
  buildCellMap,
  cellKey,
  statusColor,
  statusShape,
  summarizeMatrix,
  type HeatMapCell,
} from '@/lib/risk/heatmap-matrix';
import { resolveIndicatorLabel } from '../lib/resolve-indicator-label';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useEventStream } from '@/lib/events/use-event-stream';
import { Sparkline, type SparklineStatus } from './Sparkline';
import { PeriodChips } from './PeriodChips';
import {
  computeCompositeByCompany,
  type CompositeScore,
} from '@/lib/risk/composite-score';
import {
  evaluateAlertRules,
  DEFAULT_ALERT_RULES,
} from '@/lib/risk/alert-rules';
import {
  DEFAULT_ALERT_THRESHOLDS,
  type ResolvedAlertThresholds,
  readAlertThresholdsFromOrgSettings,
} from '@/lib/risk/alert-thresholds-config';
import { useMatrix } from '../hooks/use-matrix';

type CompanyRow = {
  id: string;
  code: string;
  name: string;
  industry: string;
  /** Set true on sub-group rollup rows (Turn 33.5); leaf ops cos omit. */
  isSubgroup?: boolean;
  /** CLI follow-up — surfaces hierarchy so CompanyTree can derive parent
   *  composite from children's averages. Null for root-level entities. */
  parentCompanyId?: string | null;
};
type IndicatorCol = {
  id: string;
  code: string;
  nameEn: string;
  nameAz?: string | null;
  nameRu?: string | null;
  direction: string;
  unit: string;
};
type MatrixResponse = {
  period: string;
  companies: CompanyRow[];
  indicators: IndicatorCol[];
  cells: HeatMapCell[];
};

type Props = {
  period?: string;
};

const PANEL_ID = 2;

export function HeatMap({ period }: Props) {
  const t = useTranslations('terminal');
  const locale = useLocale();
  // CLI Bloomberg-sweep: period chips. Local state so panel switches don't
  // ripple across other consumers of useMatrix(); seeded from `period` prop
  // (URL query or default year). Caller can still override via prop change.
  const [selectedPeriod, setSelectedPeriod] = useState<string | undefined>(period);
  useEffect(() => { setSelectedPeriod(period); }, [period]);
  // User-driven HeatMap row/cell clicks → selectCompany (tracks LRU recent).
  const setCompany = useTerminalStore((s) => s.selectCompany);
  const activeCompanyCode = useTerminalStore((s) => s.activeCompanyCode);
  const setActiveIv = useTerminalStore((s) => s.setActiveIndicatorValue);
  const setPendingMissingCell = useTerminalStore(
    (s) => s.setPendingMissingCell,
  );
  const setPendingRollupCell = useTerminalStore(
    (s) => s.setPendingRollupCell,
  );
  const setActivePanel = useTerminalStore((s) => s.setActivePanel);
  const search = useTerminalStore((s) => s.searchByPanel[PANEL_ID] ?? '');
  const setSearch = useTerminalStore((s) => s.setSearchForPanel);
  const clearSearch = useTerminalStore((s) => s.clearSearchForPanel);
  const setAlertsCount = useTerminalStore((s) => s.setAlertsCount);
  const setAlertedCompanyCodes = useTerminalStore((s) => s.setAlertedCompanyCodes);
  const setAlertMatches = useTerminalStore((s) => s.setAlertMatches);
  const compactMode = useTerminalStore((s) => s.compactMode);

  // Sub-20: shared `useMatrix()` hook. Module-level cache means
  // HeatMap + ComparePanel + CompanySnapshot all subscribe to ONE
  // in-flight matrix fetch when they mount concurrently. SSE-driven
  // refetch goes through `refresh()` so the cache is invalidated and
  // every subscribing panel re-renders with fresh data.
  const { matrix: data, loading, error, refresh: refetchMatrix } =
    useMatrix(selectedPeriod);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // SSR/CSR hydration guard — see CompanyTree for rationale.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // CXLVI — honest status counts from DB (bypasses matrix-API admin/rollup
  // filter so badge `0G/5A/9R` reflects what's actually in IndicatorValue
  // rows). Falls back to matrix-derived `summary` if endpoint is missing.
  // Dependency on `data?.period` not `period` prop: prop may be empty
  // initially while matrix-derived period is the canonical "active" one.
  const [dbSummary, setDbSummary] = useState<{ green: number; amber: number; red: number; unknown: number; total: number } | null>(null);
  const activePeriod = data?.period ?? selectedPeriod ?? period;
  useEffect(() => {
    if (!activePeriod) return;
    let cancelled = false;
    fetch(`/api/indicators/status-summary?period=${encodeURIComponent(activePeriod)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j) return;
        if (typeof j.total === 'number') setDbSummary(j);
      })
      .catch(() => { /* silent — fall back to matrix-derived summary */ });
    return () => { cancelled = true; };
  }, [activePeriod]);

  // Phase 7.E C6 v2 — pull org-tuned alert thresholds. Falls back to
  // DEFAULT_ALERT_THRESHOLDS while the fetch is in-flight or if it fails;
  // either way the engine sees a fully-resolved config so alert output is
  // never blocked by a settings hiccup. Architect Round-1 sub-25 closure:
  // log a one-time console.warn on unexpected response shape so a future
  // API contract change ("returns bare settings, not {settings: ...}")
  // surfaces visibly rather than silently degrading to defaults.
  const [alertThresholds, setAlertThresholds] = useState<ResolvedAlertThresholds>(
    DEFAULT_ALERT_THRESHOLDS,
  );
  useEffect(() => {
    let cancelled = false;
    fetch('/api/organizations/settings')
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled || !body) return;
        if (typeof body !== 'object' || !('settings' in body)) {
          console.warn(
            '[HeatMap] /api/organizations/settings returned unexpected shape; falling back to default alert thresholds',
            body,
          );
          return;
        }
        setAlertThresholds(
          readAlertThresholdsFromOrgSettings(
            (body as { settings?: unknown }).settings,
          ),
        );
      })
      .catch(() => {
        // Non-blocking — defaults remain in effect.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Phase B1 — refetch when SSE stream signals an indicator change.
  // Architect Round-1 sub-1 closure: debounce 150ms so a bulk-import
  // storm (10s of indicator updates fired back-to-back) coalesces to a
  // single refetch instead of N. At Phase F (60×80 = 4800-cell payload)
  // this matters; even at v1 scale (13×17) it prevents UI thrash on
  // RECOMPUTE-all flows. v2 follow-up: server-side `partial:cell`
  // event type that updates only the affected cell, no full refetch.
  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEventStream({
    onIndicatorChanged: () => {
      if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
      refetchTimerRef.current = setTimeout(() => {
        refetchTimerRef.current = null;
        // Round-7 architect closure: clear M3 narrative cache too, so a
        // period switch / data-refresh doesn't leave stale AI summaries
        // attached to ivIds whose underlying values have moved.
        clearAISummaryCache();
        refetchMatrix();
      }, 150);
    },
  });
  // Cleanup pending debounce timer on unmount.
  useEffect(() => {
    return () => {
      if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
    };
  }, []);

  // `/`-search bridge: when CommandBar dispatches focus to the active panel
  // and panel 2 is active, focus our search box. Custom event keeps the
  // store free of DOM refs.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ panelId: number }>).detail;
      if (detail?.panelId === PANEL_ID) {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener('terminal:focus-search', handler as EventListener);
    return () =>
      window.removeEventListener('terminal:focus-search', handler as EventListener);
  }, []);

  const cellMap = useMemo(
    () => (data ? buildCellMap(data.cells) : new Map<string, HeatMapCell>()),
    [data],
  );

  // Phase C5 — composite risk score per company. Pre-computed once per
  // matrix fetch so each row header renders in O(1) (rather than re-
  // filtering cells N times). Keyed by companyId.
  //
  // Sub-group rollup cells (Turn-33.5 synthetic worst-of-children) are
  // EXCLUDED to prevent double-aggregation: the rollup already encodes
  // children's worst status, and averaging worst-of-children would
  // dramatically underestimate sub-group health (4g+1r → all-red rollup
  // → composite ≈ 0, but true signal is 80% green). Sub-groups end up
  // with no scoreable cells → composite null → "—" badge — honest
  // "this is a navigation rollup, not a measurable entity" UX.
  const compositeByCompany = useMemo(() => {
    if (!data) return new Map<string, CompositeScore>();
    // Sparse-map mode (no companyIds arg) — rows without scoreable cells
    // are absent from the result; HeatMap's fallback for missing entries
    // shows "—" via `compositeByCompany.get(co.id) ?? null` consumer.
    return computeCompositeByCompany(data.cells);
  }, [data]);

  const filteredCompanies = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toUpperCase();
    if (q === '') return data.companies;
    return data.companies.filter(
      (c) =>
        c.code.toUpperCase().includes(q) ||
        c.name.toUpperCase().includes(q) ||
        (c.industry ?? '').toUpperCase().includes(q),
    );
  }, [data, search]);

  const summary = useMemo(() => {
    if (!data) return null;
    return summarizeMatrix(
      filteredCompanies.map((c) => c.id),
      data.indicators.map((i) => i.id),
      data.cells.filter((c) =>
        filteredCompanies.some((co) => co.id === c.companyId),
      ),
    );
  }, [data, filteredCompanies]);

  // Publish org-wide alert count (red+amber across the FULL matrix, not
  // the search-filtered view) so the CommandBar `[alerts 🔔 N]` strip
  // reflects total org alerts independent of Panel-2 search input.
  // Phase B4 — also publish the SET of alerted company codes (not just
  // the count) so CompanyTree's 'alerted' watchlist tab can filter rows.
  useEffect(() => {
    if (!data) {
      setAlertsCount(null);
      setAlertedCompanyCodes(null);
      setAlertMatches(null);
      return;
    }
    let count = 0;
    const alertedCompanyIds = new Set<string>();
    for (const c of data.cells) {
      if (c.status === 'amber' || c.status === 'red') {
        count++;
        alertedCompanyIds.add(c.companyId);
      }
    }
    setAlertsCount(count);
    // Map company-id → company-code (CompanyTree filter is code-based).
    const alertedCodes = new Set<string>();
    for (const co of data.companies) {
      if (alertedCompanyIds.has(co.id)) alertedCodes.add(co.code);
    }
    setAlertedCompanyCodes(alertedCodes);
    // Phase C6 v2 — run rule engine against full matrix; publish flat
    // sorted match list for AlertsPanel modal. `companies`/`indicators`
    // shapes match AlertCompany/AlertIndicator structurally. Threshold
    // config flows from `/api/organizations/settings` (sub-9 closure).
    const matches = evaluateAlertRules(
      DEFAULT_ALERT_RULES,
      {
        companies: data.companies,
        indicators: data.indicators,
        cells: data.cells,
      },
      alertThresholds,
    );
    setAlertMatches(matches);
  }, [
    data,
    alertThresholds,
    setAlertsCount,
    setAlertedCompanyCodes,
    setAlertMatches,
  ]);

  if (!mounted) {
    return (
      <span className="text-gray-700 font-mono text-[10px]">{t('heatMap.loading')}</span>
    );
  }

  if (error) {
    return (
      <span className="text-[#FF4757] font-mono text-xs">{t('heatMap.errorPrefix')} {error}</span>
    );
  }

  // Even when data is empty / loading, render the search input so the
  // `/`-search shortcut always lands on a visible target. The body
  // toggles between "no rows yet" and the matrix table.
  const isEmpty =
    !loading &&
    (!data || data.companies.length === 0 || data.indicators.length === 0);
  const indicators = data?.indicators ?? [];
  const renderedPeriod = data?.period ?? selectedPeriod ?? period ?? '';

  return (
    <div className="font-mono text-[10px] text-gray-300 w-full h-full flex flex-col">
      <div className="flex items-center justify-between mb-2 text-[10px] text-gray-500 shrink-0 gap-2">
        <span className="shrink-0" title={t('hints.heatMap')}>
          {t('panels.heatMapShort')} · <span className="text-gray-300">{renderedPeriod}</span>
        </span>
        <div className="flex items-center gap-1 flex-1 max-w-[220px]">
          <span className="text-gray-600">/</span>
          <input
            ref={searchInputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(PANEL_ID, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                clearSearch(PANEL_ID);
                searchInputRef.current?.blur();
                e.stopPropagation();
              }
            }}
            placeholder={t('heatMap.filterRowsPlaceholder')}
            className="bg-[#0A0E27] border border-gray-800 rounded px-1.5 py-0.5 text-[10px] text-gray-200 placeholder-gray-700 focus:border-[#00D4AA] focus:outline-none w-full"
            spellCheck={false}
            aria-label={t('heatMap.filterAriaLabel')}
          />
        </div>
        {(dbSummary || summary) && (
          <span className="tabular-nums shrink-0" title={dbSummary ? 'Counts from DB (all entities incl. admin)' : 'Counts from matrix view (admin filtered)'}>
            <span style={{ color: statusColor('green') }}>
              {statusShape('green')} {(dbSummary ?? summary)!.green}G
            </span>
            {' / '}
            <span style={{ color: statusColor('amber') }}>
              {statusShape('amber')} {(dbSummary ?? summary)!.amber}A
            </span>
            {' / '}
            <span style={{ color: statusColor('red') }}>
              {statusShape('red')} {(dbSummary ?? summary)!.red}R
            </span>
            {' / '}
            <span className="text-gray-500">
              {statusShape('unknown')} {(dbSummary ?? summary)!.unknown}?
            </span>
            {!dbSummary && summary && (
              <>
                {' / '}
                <span className="text-gray-600">{summary.missing}·</span>
              </>
            )}
          </span>
        )}
      </div>

      {/* CLI Bloomberg-sweep: period chip row — annual / quarters / months.
          Active chip wired to setSelectedPeriod, which drives useMatrix(). */}
      <div className="mb-2 shrink-0">
        <PeriodChips
          current={renderedPeriod}
          onChange={(p) => setSelectedPeriod(p)}
          compact={compactMode}
        />
      </div>
      {loading && (
        <span className="text-gray-700 text-[11px] py-2">{t('heatMap.loadingHeatmap')}</span>
      )}
      {isEmpty && (
        <span className="text-gray-700 text-[11px] py-2">
          {t('heatMap.noCompaniesYet')}
        </span>
      )}

      <div className={`flex-1 overflow-auto ${isEmpty || loading ? 'hidden' : ''}`}>
        <TooltipProvider delayDuration={300}>
        <table className="border-collapse" aria-label={t('heatMap.tableAriaLabel')}>
          <thead>
            <tr>
              <th
                className="sticky left-0 top-0 z-20 bg-[#0A0E27] text-left px-1.5 py-1 border-b border-gray-800/60 text-gray-500 uppercase tracking-wider"
                style={{ minWidth: 90 }}
              >
                {t('heatMap.companyColumn')}
              </th>
              {indicators.map((ind) => (
                <th
                  key={ind.id}
                  className="sticky top-0 z-10 bg-[#0A0E27] px-1 py-1 border-b border-gray-800/60 text-gray-500 uppercase tracking-wider text-[9px]"
                  style={{
                    minWidth: compactMode ? 40 : 54,
                    maxWidth: compactMode ? 40 : 54,
                  }}
                >
                  {/* CLI Bloomberg-sweep: primary label is `ind.code` (mono,
                      Bloomberg-ticker style) + direction marker (▲ higher_better
                      / ▼ lower_better / ◆ band). Localized full name moves to
                      hover-tooltip + secondary muted line under code. Codes scan
                      ~3× faster than truncated locale text. */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="cursor-help leading-tight">
                        <div className="truncate font-mono text-gray-200 text-[10px] tracking-tight">
                          <span className="text-gray-500 mr-0.5" aria-hidden="true">
                            {ind.direction === 'higher_better' ? '▲' : ind.direction === 'lower_better' ? '▼' : '◆'}
                          </span>
                          {ind.code}
                        </div>
                        {!compactMode && (
                          <div className="truncate font-sans text-gray-600 text-[8px] mt-px normal-case">
                            {resolveIndicatorLabel(ind, locale)}
                          </div>
                        )}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent
                      side="bottom"
                      className="bg-popover text-popover-foreground border border-border shadow-lg max-w-[280px] text-xs"
                    >
                      <div className="font-sans font-semibold">
                        {resolveIndicatorLabel(ind, locale)}
                      </div>
                      <div className="font-mono text-muted-foreground text-[10px] mt-0.5">
                        {ind.code}
                      </div>
                      <div className="text-[10px] text-muted-foreground/70 mt-0.5">
                        {t('heatMap.tooltipUnit')} {ind.unit} ·{' '}
                        {ind.direction === 'higher_better'
                          ? t('heatMap.tooltipDirHigher')
                          : ind.direction === 'lower_better'
                            ? t('heatMap.tooltipDirLower')
                            : t('heatMap.tooltipDirBand')}
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredCompanies.length === 0 ? (
              <tr>
                <td
                  colSpan={indicators.length + 1}
                  className="text-gray-600 px-2 py-3 text-center"
                >
                  {t('heatMap.noCompaniesMatch')} "{search}"
                </td>
              </tr>
            ) : (
              filteredCompanies.map((co) => {
                const rowActive = co.code === activeCompanyCode;
                return (
                  <tr key={co.id}>
                    <th
                      scope="row"
                      className={`sticky left-0 bg-[#0A0E27] text-left px-1.5 py-0.5 border-b border-gray-800/40 ${
                        rowActive ? 'text-[#00D4AA]' : 'text-gray-400'
                      }`}
                    >
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => setCompany(co.code)}
                            className="cursor-pointer hover:bg-gray-800/40 px-1 py-0.5 rounded text-left w-full flex items-center justify-between gap-1.5"
                          >
                            <span className="truncate">{co.code}</span>
                            <CompositeBadge
                              score={compositeByCompany.get(co.id) ?? null}
                            />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent
                          side="right"
                          className="bg-popover text-popover-foreground border border-border shadow-lg text-xs"
                        >
                          <div className="font-mono font-semibold">
                            {co.code}
                          </div>
                          <div className="text-muted-foreground">
                            {co.name}{co.industry ? ` · ${co.industry}` : ''}
                          </div>
                          {(() => {
                            const cs = compositeByCompany.get(co.id);
                            if (!cs) return null;
                            // Round-16 closure — shape glyph next to the
                            // band-colored composite score in row-header
                            // tooltip. Maps band→IndicatorStatus for the
                            // statusShape() helper.
                            const tooltipBandStatus =
                              cs.band === 'green' ||
                              cs.band === 'amber' ||
                              cs.band === 'red'
                                ? cs.band
                                : 'unknown';
                            return (
                              <div className="text-[11px] mt-1">
                                <span className="text-muted-foreground">
                                  {t('heatMap.tooltipCompositeScore')}{' '}
                                </span>
                                <span
                                  className={
                                    cs.band === 'green'
                                      ? 'text-[#00D4AA]'
                                      : cs.band === 'amber'
                                      ? 'text-[#FFA502]'
                                      : cs.band === 'red'
                                      ? 'text-[#FF4757]'
                                      : 'text-muted-foreground'
                                  }
                                >
                                  {cs.score !== null && (
                                    <span aria-hidden="true" className="mr-0.5 opacity-70">
                                      {statusShape(tooltipBandStatus)}
                                    </span>
                                  )}
                                  {cs.score === null
                                    ? t('heatMap.tooltipNoData')
                                    : `${cs.score} / 100`}
                                </span>
                                <span className="text-muted-foreground">
                                  {' · '}
                                  {cs.contributingCount}/{cs.totalCount}{' '}
                                  {t('heatMap.tooltipIndicators')}
                                </span>
                              </div>
                            );
                          })()}
                        </TooltipContent>
                      </Tooltip>
                    </th>
                    {indicators.map((ind) => {
                      const c = cellMap.get(cellKey(co.id, ind.id));
                      return (
                        <HeatMapCellTd
                          key={ind.id}
                          co={co}
                          ind={ind}
                          cell={c}
                          compactMode={compactMode}
                          onCellClick={() => {
                            // Cell click ALWAYS selects company. Two
                            // panel-3 paths split on whether the cell
                            // has a computed IndicatorValue:
                            //
                            //  • cell with `indicatorValueId` →
                            //      setActiveIv (Panel 3 fetches detail)
                            //  • missing cell (no IV row yet) →
                            //      setPendingMissingCell (Panel 3 shows
                            //      "no data — onboard or recompute" hint
                            //      with the company + indicator codes)
                            //
                            // Phase 7.D regression-architect closure:
                            // user reported clicks "не работают" on
                            // missing cells (silent no-Panel-3). New
                            // contract guarantees Panel 3 ALWAYS opens
                            // on cell click — the cell either drives a
                            // drill-down or a self-explanatory hint.
                            setCompany(co.code);
                            setActivePanel(3);
                            if (c?.indicatorValueId) {
                              setActiveIv(c.indicatorValueId);
                            } else if (c?.kind === 'synthetic-rollup') {
                              // Phase 7.G Turn VI — sub-group rollup cell:
                              // value is averaged + status is worst-of-children
                              // (computed by /api/indicators/matrix). No
                              // persisted IV exists. Pre-Turn-VI this routed
                              // to setPendingMissingCell → "no computed
                              // value yet" copy, which contradicted the
                              // clearly-lit cell. Now the panel renders a
                              // dedicated rollup view with the aggregate
                              // + child count.
                              //
                              // Direct `c.kind === 'synthetic-rollup'` check
                              // here (NOT `isAggregateRollup(c)`) is intentional:
                              // we want ONLY synthetic, not real-rollup. Real-
                              // rollup cells (kind='real-rollup') have a
                              // persisted `indicatorValueId` and the canonical
                              // formula-output-IV path is the right drill-down
                              // — they short-circuit upstream at the
                              // `c?.indicatorValueId` gate above. So
                              // `isAggregateRollup` would semantically over-
                              // match here. Architect Turn-VI Round-1 ⚠️
                              // closure — `heatmap-matrix.ts:60` "never check
                              // kind directly" rule has an exception when
                              // upstream short-circuits eliminate the other
                              // variant.
                              setPendingRollupCell({
                                companyId: co.id,
                                companyCode: co.code,
                                indicatorId: ind.id,
                                indicatorCode: ind.code,
                                indicatorName: resolveIndicatorLabel(ind, locale),
                                indicatorUnit: ind.unit ?? null,
                                value: c.value,
                                status: c.status,
                                contributingChildCount:
                                  c.contributingChildCount ?? 0,
                              });
                            } else {
                              setPendingMissingCell({
                                companyId: co.id,
                                companyCode: co.code,
                                indicatorId: ind.id,
                                indicatorCode: ind.code,
                                // Phase 7.G post-Turn-I (HeatMap audit
                                // 🔄 closure inline) — was `ind.nameEn`;
                                // audit confirmed single consumer at
                                // IndicatorDetail.tsx:192 is pure UI
                                // render (NOT LLM-input), so locale-
                                // aware resolution is correct. Field
                                // also renamed `indicatorNameEn → indicatorName`
                                // since it's no longer EN-canonical.
                                indicatorName: resolveIndicatorLabel(ind, locale),
                              });
                            }
                          }}
                        />
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        </TooltipProvider>
      </div>
    </div>
  );
}

/**
 * Phase C5 — small badge showing composite risk score (0-100) next to
 * the company code in HeatMap row headers. Color-coded by band; null
 * score renders a neutral "—" (no data, NOT a 0/red signal).
 *
 * Sub-27 cont'd Round-9 — locale-aware tooltips via i18n placeholders.
 */
function CompositeBadge({ score }: { score: CompositeScore | null }) {
  const t = useTranslations('terminal');
  if (!score || score.score === null) {
    return (
      <span
        className="text-[9px] tabular-nums text-gray-500 shrink-0"
        title={t('heatMap.noScoreableIndicators')}
      >
        —
      </span>
    );
  }
  const colorClass =
    score.band === 'green'
      ? 'text-[#00D4AA]'
      : score.band === 'amber'
      ? 'text-[#FFA502]'
      : score.band === 'red'
      ? 'text-[#FF4757]'
      : 'text-gray-500';
  // Tier-3 sub-29 M7 — shape glyph alongside score for color-blind parity.
  const bandStatus =
    score.band === 'green' || score.band === 'amber' || score.band === 'red'
      ? score.band
      : 'unknown';
  return (
    <span
      className={`text-[9px] tabular-nums font-semibold shrink-0 ${colorClass}`}
      title={t('heatMap.compositeScoreTitle', {
        score: score.score,
        contributing: score.contributingCount,
        total: score.totalCount,
      })}
    >
      <span aria-hidden="true" className="mr-0.5 opacity-70">
        {statusShape(bandStatus)}
      </span>
      {score.score}
    </span>
  );
}

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

type HeatMapCellTdProps = {
  co: CompanyRow;
  ind: IndicatorCol;
  cell: HeatMapCell | undefined;
  compactMode: boolean;
  onCellClick: () => void;
};

// ─────────────────────────────────────────────────────────────────────────
// Sub-27 cont'd Round-7 M3 — inline AI commentary on red/amber cells.
//
// Module-level cache keyed by IndicatorValue.id × locale so a user who
// sweeps the matrix scanning red cells reuses prior fetches across cell
// remounts (PanelGrid re-renders, locale switches, SSE refetches that
// rebuild rows). Cap at 200 entries — older drops on overflow.
//
// Hover-debounce 500ms ensures we only fire when the user genuinely
// paused on a cell, not during a sweep. Single in-flight per ivId so
// rapid hover→leave→re-hover doesn't double-fire.
// ─────────────────────────────────────────────────────────────────────────
type AISummaryEntry =
  | { kind: 'pending' }
  | { kind: 'ok'; sentence: string }
  | { kind: 'error' };

const AI_SUMMARY_CACHE = new Map<string, AISummaryEntry>();
const AI_SUMMARY_INFLIGHT = new Set<string>();
const AI_SUMMARY_LIMIT = 200;
type AISummaryListener = (key: string, entry: AISummaryEntry) => void;
const AI_SUMMARY_LISTENERS = new Set<AISummaryListener>();

function notifyAiSummary(key: string, entry: AISummaryEntry) {
  AI_SUMMARY_CACHE.set(key, entry);
  if (AI_SUMMARY_CACHE.size > AI_SUMMARY_LIMIT) {
    // FIFO eviction — Map iterates insertion-order; drop oldest.
    const first = AI_SUMMARY_CACHE.keys().next().value;
    if (first !== undefined) AI_SUMMARY_CACHE.delete(first);
  }
  for (const listener of AI_SUMMARY_LISTENERS) listener(key, entry);
}

function extractFirstSentence(narrative: string): string {
  // Split on `.`/`!`/`?` followed by space or end-of-string. Stop at
  // first hit; keep the trailing punctuation. Truncate at 180 chars
  // safety (LLM occasionally emits run-on first sentence).
  const trimmed = narrative.trim();
  const match = trimmed.match(/^[^.!?]+[.!?]/);
  const first = match ? match[0] : trimmed.split('\n')[0];
  return first.length > 180 ? first.slice(0, 177) + '…' : first;
}

async function fetchAISummary(ivId: string, locale: string): Promise<void> {
  const key = `${ivId}:${locale}`;
  if (AI_SUMMARY_CACHE.has(key) || AI_SUMMARY_INFLIGHT.has(key)) return;
  AI_SUMMARY_INFLIGHT.add(key);
  notifyAiSummary(key, { kind: 'pending' });
  try {
    const res = await fetch(`/api/indicators/values/${ivId}/explain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: locale }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    const sentence = extractFirstSentence(body.narrative ?? '');
    notifyAiSummary(key, sentence ? { kind: 'ok', sentence } : { kind: 'error' });
  } catch {
    notifyAiSummary(key, { kind: 'error' });
  } finally {
    AI_SUMMARY_INFLIGHT.delete(key);
  }
}

/**
 * Round-7 architect closure: clear all cached narratives. Called by SSE
 * `onIndicatorChanged` so a period switch / data refresh doesn't leave
 * stale narratives attached to ivIds whose underlying values have moved.
 * IndicatorValue.id is stable across recompute (upserted by composite
 * key), so without this clear, hovering a cell after data change would
 * show the prior period's narrative.
 */
export function clearAISummaryCache(): void {
  AI_SUMMARY_CACHE.clear();
  AI_SUMMARY_INFLIGHT.clear();
  for (const listener of AI_SUMMARY_LISTENERS) {
    // Notify all live cells so they drop their stale entry. Pass empty
    // string as key + a synthetic 'error' to force re-fetch on next hover.
    listener('', { kind: 'error' });
  }
}

function useAISummary(ivId: string | undefined, locale: string): AISummaryEntry | null {
  const key = ivId ? `${ivId}:${locale}` : null;
  const [entry, setEntry] = useState<AISummaryEntry | null>(() =>
    key ? AI_SUMMARY_CACHE.get(key) ?? null : null,
  );
  useEffect(() => {
    if (!key) {
      setEntry(null);
      return;
    }
    setEntry(AI_SUMMARY_CACHE.get(key) ?? null);
    const listener: AISummaryListener = (k, e) => {
      if (k === key) setEntry(e);
    };
    AI_SUMMARY_LISTENERS.add(listener);
    return () => {
      AI_SUMMARY_LISTENERS.delete(listener);
    };
  }, [key]);
  return entry;
}

// Eager Radix Tooltip per cell — at idle, no DOM portals exist (Radix only
// renders the floating content via Presence + Portal when the trigger is
// hovered, after provider's 300ms `delayDuration`). 676 wrappers therefore
// cost only React component instances + context subscriptions, not DOM
// nodes. Earlier `defaultOpen` lazy-mount caused tooltip pile-up on cursor
// sweep (each cell's Tooltip initialized to open=true and Radix did not
// transition to closed on pointerleave from the forced-open initial state).
function HeatMapCellTd({ co, ind, cell, compactMode, onCellClick }: HeatMapCellTdProps) {
  const status = cell?.status ?? 'missing';
  // M3 — only red/amber cells trigger LLM hover-summary. Green/missing
  // are noise; unknown often errors at LLM (no narrative to extract).
  const ivId = cell?.indicatorValueId;
  const eligible = ivId && (status === 'red' || status === 'amber');
  const t = useTranslations('terminal');
  const locale = useLocale();
  const aiSummary = useAISummary(eligible ? ivId : undefined, locale);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handlePointerEnter = useCallback(() => {
    if (!eligible || !ivId) return;
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      void fetchAISummary(ivId, locale);
    }, 500);
  }, [eligible, ivId, locale]);
  const handlePointerLeave = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);
  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    };
  }, []);
  const color = statusColor(status);
  const statusColorClass =
    status === 'red'
      ? 'text-[#FF4757]'
      : status === 'amber'
      ? 'text-[#FFA502]'
      : status === 'green'
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

  return (
    <td
      onClick={onCellClick}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      className={`cursor-pointer border-b border-gray-800/40 p-0 transition-shadow ${
        flashing ? 'shadow-[inset_0_0_0_2px_#00D4AA]' : ''
      }`}
      style={{
        backgroundColor: color,
        opacity: status === 'missing' ? 0.25 : 0.85,
      }}
      aria-label={`${co.code} ${ind.code} ${status} ${statusShape(status)}`}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className="relative"
            style={{
              width: compactMode ? 40 : 54,
              // CLI Bloomberg-sweep: normal cells expand 18 → 30 to host
              // inline sparkline + numeric value below status glyph.
              // Compact mode unchanged to preserve density (sparkline +
              // value only show in tooltip there).
              height: compactMode ? 12 : 30,
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
            <span
              aria-hidden="true"
              className="absolute top-0 right-0.5 leading-none"
              style={{
                fontSize: compactMode ? 7 : 9,
                opacity: status === 'unknown' ? 0.95 : 0.7,
                color: '#FFFFFF',
                mixBlendMode: status === 'unknown' ? 'normal' : 'difference',
                pointerEvents: 'none',
              }}
            >
              {statusShape(status)}
            </span>
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
                  {formatValueCompact(cell.value, ind.unit)}
                </span>
              </div>
            ) : null}
          </div>
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
                    status word itself conveys the same meaning to AT. */}
                <span className={statusColorClass}>
                  <span aria-hidden="true" className="mr-0.5 opacity-80">
                    {statusShape(status)}
                  </span>
                  {status.toUpperCase()}
                </span>
                {' @ '}
                <span className="font-mono">{formatValue(cell.value, ind.unit)}</span>
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
                <div className="text-[11px] text-[#FF4757] mt-1">
                  ⚠ {cell.error.code}: {cell.error.reason}
                </div>
              )}
              {/* M3 inline AI commentary — pending → spinner; ok → first
                  sentence in cyan accent; error → silent (don't pollute
                  tooltip with infrastructure noise). Only renders for
                  red/amber per `eligible` gate. */}
              {eligible && aiSummary && aiSummary.kind === 'pending' && (
                <div className="text-[10px] text-[#00D4AA]/70 mt-1.5 italic">
                  {t('heatMap.aiSummaryGenerating')}
                </div>
              )}
              {eligible && aiSummary && aiSummary.kind === 'ok' && (
                <div className="text-[11px] text-[#00D4AA] mt-1.5 leading-snug border-l-2 border-[#00D4AA]/40 pl-1.5">
                  {aiSummary.sentence}
                </div>
              )}
              <div className="text-[10px] text-muted-foreground/70 mt-1">
                {t('heatMap.cellClickHint')}
              </div>
            </>
          ) : (
            <div className="text-[11px] text-muted-foreground mt-1">
              no value computed
            </div>
          )}
        </TooltipContent>
      </Tooltip>
    </td>
  );
}
