"use client";
/**
 * Risk Terminal HeatMap (Panel 2). Phase 8 D1 (2026-05-29) — the data layer
 * (state / fetches / effects / memos) moved to ./use-heat-map-model; this file
 * is now presentation: the matrix table + toolbar JSX + the CompositeBadge /
 * FreshnessLabel leaf subcomponents. No JSX changed → visual baseline stable.
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Lock, Search, X } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  cellKey,
  statusColor,
  statusShape,
} from '@/lib/risk/heatmap-matrix';
import { isPartialYear } from '@/lib/risk/periods';
import { resolveIndicatorLabel } from '../lib/resolve-indicator-label';
import { formatFreshness } from '../lib/relative-time';
import { inputToSourceCode } from '../hooks/use-drift-health';
import { PeriodChips } from './PeriodChips';
import { TimeMachineSlider } from './TimeMachineSlider';
import { type CompositeScore } from '@/lib/risk/composite-score';
import { clearAISummaryCache } from './heat-map/ai-summary';
// Re-export for the existing import path (consumers + tests import it here).
export { clearAISummaryCache };
import { HeatMapCellTd } from './heat-map/HeatMapCellTd';
import { useHeatMapModel } from './use-heat-map-model';

type Props = {
  period?: string;
};

const PANEL_ID = 2;

export function HeatMap({ period }: Props) {
  const {
    t, locale, selectedPeriod, setSelectedPeriod, driftHealth, setCompany,
    activeCompanyCode, setActiveIv, setPendingMissingCell, setPendingRollupCell,
    setActivePanel, search, setSearch, clearSearch, setAlertsCount,
    setAlertedCompanyCodes, setAlertMatches, compactMode, scenarioDelta,
    activeScenarioLabel, clearScenarioDelta, lockedPeriods, setLockedPeriods,
    showAllIndicators, setShowAllIndicators, data,
    loading, error, refetchMatrix, companyTree, searchInputRef, mounted,
    setMounted, dbSummary, setDbSummary, activePeriod, alertThresholds,
    setAlertThresholds, refetchTimerRef, cellMap, compositeByCompany,
    provisionalSummary,
    filteredCompanies, summary, indicators, displayIndicators,
    applicabilityDecisionForPair,
    hiddenIndicatorCount, indicatorQuery, setIndicatorQuery,
    indicatorSearchInputRef,
  } = useHeatMapModel(period);

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
  const renderedPeriod = data?.period ?? selectedPeriod ?? period ?? '';
  // Partial / in-progress fiscal year (e.g. the current calendar year): its
  // figures are year-to-date and its green/red bands provisional. The terminal
  // DEFAULTS to the last complete year (headlinePeriod), so this banner only
  // appears when the user explicitly navigates to the in-progress year.
  const isPartialPeriod = renderedPeriod !== '' && isPartialYear(renderedPeriod);
  // Phase E.4 — flag whether the currently-rendered period is signed off.
  // Match against the renderedPeriod string (exact match — locking "2026"
  // doesn't tag "2026-Q1" per period-lock.ts semantics).
  const activeLock = lockedPeriods.find((l) => l.period === renderedPeriod);

  // Phase 7.M Step 5 (2026-05-19) — readiness for the active company.
  // When a user drills into a single entity (CompanyTree click → only
  // that row renders), we surface a banner above the grid if readiness
  // is partial/thin/empty. The intent is to tell the finance reviewer
  // "the cells you're about to read are based on incomplete data —
  // don't anchor on these numbers as authoritative". Hides when:
  //   - readiness data unavailable
  //   - tier is good/complete (no warning needed)
  //   - no active company drill-down (full-holding view doesn't carry
  //     a single readiness signal)
  const activeReadiness = data && activeCompanyCode
    ? data.companies.find((c) => c.code === activeCompanyCode)?.readiness ?? null
    : null;
  const showReadinessBanner =
    activeReadiness !== null &&
    activeReadiness !== undefined &&
    (activeReadiness.tier === 'partial' ||
      activeReadiness.tier === 'thin' ||
      activeReadiness.tier === 'empty');

  return (
    <div className="font-mono text-[10px] text-gray-300 w-full h-full flex flex-col">
      {/* Phase 10 A5 — `flex-wrap` added with the Legacy/Provisional badge.
          Every child here is `shrink-0`, so without wrapping the badge was
          clipped at the panel's right edge (verified in the visual diff: it
          rendered "⚠ LEGACY · NOT" with "DECISION-GRADE" cut off). A truncated
          trust warning is worse than none. RU and AZ strings are longer than
          EN, so wrapping — not a shorter label — is the fix that holds in
          every locale. */}
      <div className="flex flex-wrap items-center justify-between mb-2 text-[10px] text-gray-500 shrink-0 gap-2">
        <span className="shrink-0 flex items-center gap-1" title={t('hints.heatMap')}>
          {t('panels.heatMapShort')} · <span className="text-gray-300">{renderedPeriod}</span>
          {activeLock && (
            <span
              data-testid="period-lock-badge"
              title={t('heatMap.lockedTitle', {
                reason: activeLock.reason || '—',
                date: new Date(activeLock.lockedAt).toLocaleDateString(locale),
              })}
              className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-500 text-[9px] uppercase tracking-wider font-semibold"
            >
              <Lock size={9} aria-hidden="true" /> {t('heatMap.lockedLabel')}
            </span>
          )}
        </span>
        <div className="flex items-center gap-1 flex-1 max-w-[230px]">
          <span className="text-[#00D4AA]/80 font-semibold">/</span>
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
            className="bg-white/[0.06] border border-white/20 rounded px-2 py-1 text-[11px] text-gray-100 placeholder-gray-400 focus:border-[#00D4AA] focus:ring-1 focus:ring-[#00D4AA]/30 focus:outline-none w-full"
            spellCheck={false}
            aria-label={t('heatMap.filterAriaLabel')}
          />
        </div>
        {/* Client-feedback #5 (2026-06-01) — intuitive indicator (column)
            search. Multilingual fuzzy matcher (indicator-search.ts) filters
            the matrix columns so the user finds an indicator by approximate
            name in EN/RU/AZ instead of hovering over each header. Separate
            from the `/` company-row filter to its left. */}
        <div className="flex items-center gap-1 flex-1 max-w-[250px]">
          <Search size={13} className="text-[#00D4AA]/80 shrink-0" aria-hidden="true" />
          <div className="relative flex-1">
            <input
              ref={indicatorSearchInputRef}
              type="text"
              value={indicatorQuery}
              onChange={(e) => setIndicatorQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setIndicatorQuery('');
                  indicatorSearchInputRef.current?.blur();
                  e.stopPropagation();
                }
              }}
              placeholder={t('heatMap.findIndicatorPlaceholder')}
              className="bg-white/[0.06] border border-white/20 rounded px-2 py-1 pr-5 text-[11px] text-gray-100 placeholder-gray-400 focus:border-[#00D4AA] focus:ring-1 focus:ring-[#00D4AA]/30 focus:outline-none w-full"
              spellCheck={false}
              aria-label={t('heatMap.findIndicatorAria')}
            />
            {indicatorQuery && (
              <button
                type="button"
                onClick={() => {
                  setIndicatorQuery('');
                  indicatorSearchInputRef.current?.focus();
                }}
                className="absolute right-0.5 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-300"
                title={t('heatMap.findIndicatorClear')}
                aria-label={t('heatMap.findIndicatorClear')}
              >
                <X size={11} aria-hidden="true" />
              </button>
            )}
          </div>
          {indicatorQuery.trim() && (
            <span
              className={`shrink-0 tabular-nums text-[9px] ${
                displayIndicators.length === 0 ? 'text-[#FF4757]' : 'text-[#00D4AA]'
              }`}
              title={t('heatMap.findIndicatorCountTitle')}
            >
              {t('heatMap.findIndicatorCount', {
                count: displayIndicators.length,
                total: indicators.length,
              })}
            </span>
          )}
        </div>
        {/* Applicability filter — an always-visible on/off toggle. ON (green)
            hides indicators that don't apply to the current activity profile;
            the suffix shows how many are hidden right now. OFF (gray) shows the
            full catalogue. */}
        <button
          type="button"
          onClick={() => setShowAllIndicators((visible) => !visible)}
          className={`shrink-0 min-h-8 px-2.5 py-1 border rounded text-[11px] uppercase tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00D4AA] focus-visible:ring-offset-1 focus-visible:ring-offset-[#0A0E27] ${
            !showAllIndicators
              ? 'border-[#00D4AA] text-[#00D4AA]'
              : 'border-gray-700 text-gray-500 hover:border-gray-500'
          }`}
          title={t(
            showAllIndicators
              ? 'heatMap.showAllIndicatorsExpandedHint'
              : 'heatMap.showAllIndicatorsCollapsedHint',
          )}
          aria-label={
            !showAllIndicators
              ? hiddenIndicatorCount > 0
                ? t('heatMap.showAllIndicatorsAriaCount', {
                    count: hiddenIndicatorCount,
                  })
                : t('heatMap.showAllIndicators')
              : t('heatMap.hideIrrelevantIndicators')
          }
          aria-pressed={!showAllIndicators}
          aria-controls="risk-heatmap-table"
          data-testid="show-all-indicators-toggle"
        >
          {!showAllIndicators
            ? t('heatMap.showAllIndicators')
            : t('heatMap.hideIrrelevantIndicators')}
          {!showAllIndicators && hiddenIndicatorCount > 0
            ? ` · ${hiddenIndicatorCount}`
            : ''}
        </button>
        {(dbSummary || summary) && (
          <span
            className="tabular-nums shrink-0"
            title={t('heatMap.statusSummaryTitle')}
          >
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
        {/* 2026-05-27 A4 — data-freshness badge. Reads matrix.lastComputedAt
            from server (max(IndicatorValue.computedAt) across rendered cells)
            and turns it into «Updated 2h ago» via FreshnessLabel below.
            Re-renders every 30s without re-fetching the matrix. */}
        {data?.lastComputedAt && (
          <FreshnessLabel iso={data.lastComputedAt} />
        )}
        {/* Phase 10 A5 — Legacy/Provisional posture, stated once for the
            surface instead of on 498 individual cells. Renders whenever a
            coloured cell on this matrix is not decision-grade; today that is
            every one of them, because nothing is reconciled to source.
            Colour-blind safe: the meaning is carried by the text, not the
            amber. Cell values and cell colours are unchanged — this badge
            withdraws a claim, it does not restate a number. */}
        {/* Native `title` rather than a Radix Tooltip: this badge row sits
            outside the TooltipProvider that wraps the matrix below, and the
            neighbouring scenario badge already uses `title` for the same
            reason. */}
        {provisionalSummary.hasProvisional && (
          <span
            data-testid="heatmap-provisional-badge"
            title={t('heatMap.provisionalBadgeTooltip')}
            className="inline-flex items-center gap-1 shrink-0 px-2 py-0.5 rounded border border-[#FFB800]/50 bg-[#FFB800]/10 text-[#FFB800] text-[9px] uppercase tracking-wider font-semibold cursor-help"
          >
            <span aria-hidden="true">⚠</span>
            <span>
              {provisionalSummary.allProvisional
                ? t('heatMap.provisionalBadgeAll')
                : t('heatMap.provisionalBadgeSome', {
                    count: provisionalSummary.provisional,
                    total: provisionalSummary.coloured,
                  })}
            </span>
          </span>
        )}
        {/* Phase 7.N — scenario mode badge */}
        {activeScenarioLabel && (
          <span className="inline-flex items-center gap-1 shrink-0 px-2 py-0.5 rounded border border-[#FFB800]/50 bg-[#FFB800]/10 text-[#FFB800] text-[9px] uppercase tracking-wider font-semibold">
            <span>{t('heatMap.scenarioBanner', { label: activeScenarioLabel })}</span>
            <button
              type="button"
              onClick={() => clearScenarioDelta()}
              className="ml-1 opacity-70 hover:opacity-100"
              title={t('heatMap.revertToBase')}
            >
              ×
            </button>
          </span>
        )}
      </div>

      {/* CLI Bloomberg-sweep: period chip row — annual / quarters / months.
          Active chip wired to setSelectedPeriod, which drives useMatrix(). */}
      <div className="mb-1 shrink-0">
        <PeriodChips
          current={renderedPeriod}
          onChange={(p) => setSelectedPeriod(p)}
          compact={compactMode}
          availableYears={data?.availableYears}
        />
      </div>
      {/* Tier 3 time-machine — scrub through months with play/pause.
          Same setSelectedPeriod → useMatrix() refetch path as the chips. */}
      <div className="mb-2 shrink-0">
        <TimeMachineSlider
          current={renderedPeriod}
          onChange={(p) => setSelectedPeriod(p)}
        />
      </div>
      {showReadinessBanner && activeReadiness && (
        <div
          data-testid="heatmap-readiness-banner"
          data-readiness-tier={activeReadiness.tier}
          className={`mb-2 shrink-0 px-2 py-1.5 rounded border text-[11px] leading-relaxed ${
            activeReadiness.tier === 'empty'
              ? 'border-red-500/40 bg-red-500/10 text-red-300'
              : activeReadiness.tier === 'thin'
                ? 'border-orange-500/40 bg-orange-500/10 text-orange-300'
                : 'border-amber-500/40 bg-amber-500/10 text-amber-300'
          }`}
          role="status"
          aria-live="polite"
        >
          <span className="font-semibold">
            {t('heatMap.readinessScore', { score: activeReadiness.score })}
          </span>{' '}
          {activeReadiness.tier === 'empty'
            ? t('heatMap.readinessEmpty')
            : activeReadiness.tier === 'thin'
              ? t('heatMap.readinessThin')
              : t('heatMap.readinessPartial')}
          {' '}
          <span className="text-[10px] opacity-80">
            {t('heatMap.readinessMissing', {
              areas: activeReadiness.areas
                .filter((a) => a.missing)
                .slice(0, 3)
                .map((a) =>
                  t(`heatMap.readinessArea.${a.id}` as never).toLowerCase(),
                )
                .join(', ') || '—',
            })}
          </span>
        </div>
      )}
      {isPartialPeriod && (
        <div
          data-testid="heatmap-partial-year-banner"
          className="mb-2 shrink-0 px-2 py-1.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-300 text-[11px] leading-relaxed"
          role="status"
          aria-live="polite"
        >
          <span className="font-semibold">
            {t('heatMap.partialYearTitle', { period: renderedPeriod })}
          </span>{' '}
          {t('heatMap.partialYearBody')}
        </div>
      )}
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
        <table
          id="risk-heatmap-table"
          className="border-collapse"
          aria-label={t('heatMap.tableAriaLabel')}
        >
          <thead>
            <tr>
              <th
                className="sticky left-0 top-0 z-20 bg-[#0A0E27] text-left px-1.5 py-1 border-b border-gray-800/60 text-gray-500 uppercase tracking-wider"
                style={{ minWidth: 90 }}
              >
                {t('heatMap.companyColumn')}
              </th>
              {displayIndicators.map((ind) => (
                <th
                  key={ind.id}
                  // data-indicator-code lets tests + ARIA tools read the
                  // canonical column code without parsing the ticker text
                  // (which carries a leading direction marker glyph).
                  data-indicator-code={ind.code}
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
                        <div className="truncate font-sans text-gray-500 text-[8px] mt-px normal-case">
                          {resolveIndicatorLabel(ind, locale)}
                        </div>
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
            {indicatorQuery.trim() && displayIndicators.length === 0 ? (
              <tr>
                <td
                  colSpan={displayIndicators.length + 1}
                  className="text-gray-600 px-2 py-3 text-center"
                >
                  {t('heatMap.noIndicatorsMatch')} "{indicatorQuery}"
                </td>
              </tr>
            ) : filteredCompanies.length === 0 ? (
              <tr>
                <td
                  colSpan={displayIndicators.length + 1}
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
                    {displayIndicators.map((ind) => {
                      const applicabilityDecision =
                        applicabilityDecisionForPair(co.id, ind);
                      const pairApplicable = applicabilityDecision.applicable;
                      const c = pairApplicable
                        ? cellMap.get(cellKey(co.id, ind.id))
                        : undefined;
                      const scenarioStatus = pairApplicable
                        ? scenarioDelta?.get(`${co.id}:${ind.code}`) ?? undefined
                        : undefined;
                      // 2026-05-27 — drift bridge: derive per-cell flags
                      // from the global drift-health snapshot.
                      let staleInputSourceCode: string | undefined;
                      let staleInputStatus: 'stale' | 'critical_stale' | undefined;
                      for (const input of ind.requiredInputs ?? []) {
                        const code = inputToSourceCode(input);
                        if (!code) continue;
                        const f = driftHealth.byCode.get(code);
                        if (f && (f.status === 'stale' || f.status === 'critical_stale')) {
                          staleInputSourceCode = code;
                          staleInputStatus = f.status;
                          if (f.status === 'critical_stale') break; // worst wins
                        }
                      }
                      const driftedRecently = driftHealth.driftedCells.has(`${co.code}::${ind.code}`);
                      return (
                        <HeatMapCellTd
                          key={ind.id}
                          co={co}
                          ind={ind}
                          cell={c}
                          isApplicable={pairApplicable}
                          applicabilityReason={applicabilityDecision.reason}
                          compactMode={compactMode}
                          scenarioStatus={scenarioStatus}
                          staleInputSourceCode={staleInputSourceCode}
                          staleInputStatus={staleInputStatus}
                          driftedRecently={driftedRecently}
                          onCellClick={pairApplicable ? () => {
                            // Every APPLICABLE cell selects its company. Two
                            // Panel-3 paths split on whether the cell
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
                            // contract guarantees Panel 3 opens for every
                            // applicable cell — the cell either drives a
                            // drill-down or a self-explanatory missing-data
                            // hint. A known N/A pair is informational only and
                            // never routes to the missing/recompute flow.
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
                          } : undefined}
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

/** Translate a formula-engine error to user-friendly text per locale.
 *  Special-cases _VS_<YEAR> indicators (where missing baseline data
 *  is the typical NaN cause) with an actionable hint. Raw code+reason
 *  remain in the title attribute for technical debugging. */
function FreshnessLabel({ iso }: { iso: string }) {
  const t = useTranslations('terminal');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(tick);
  }, []);
  // Phase 8 A4 — shared formatter (also drives the per-company CompanyTree
  // chip). Stale-after-24h flips the dot teal→amber (trust-badge convention).
  const parts = formatFreshness(iso, now);
  if (!parts) return null;
  const { short, isStale } = parts;
  const match = /^(\d+)([mhd])$/.exec(short);
  const age =
    short === 'now'
      ? t('heatMap.freshnessNow')
      : match?.[2] === 'm'
        ? t('heatMap.freshnessMinutes', { count: match[1] })
        : match?.[2] === 'h'
          ? t('heatMap.freshnessHours', { count: match[1] })
          : t('heatMap.freshnessDays', { count: match?.[1] ?? '0' });
  return (
    <span
      className="inline-flex items-center gap-1 shrink-0 text-gray-500 text-[9px] tabular-nums"
      title={t('heatMap.lastRecompute', {
        date: new Date(iso).toLocaleString(),
      })}
      data-testid="heatmap-freshness"
      // 2026-05-27 — opt out of visual diff (label text rotates every
      // 30s, would cause spurious baseline drift on long test runs).
      data-volatile="true"
    >
      <span
        aria-hidden="true"
        className={`inline-block h-1 w-1 rounded-full ${isStale ? 'bg-amber-500' : 'bg-emerald-500'}`}
      />
      <span>{t('heatMap.updatedFreshness', { age })}</span>
    </span>
  );
}
