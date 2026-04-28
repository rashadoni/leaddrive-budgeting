"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTerminalStore } from '../store/terminalStore';
import {
  buildCellMap,
  cellKey,
  statusColor,
  summarizeMatrix,
  type HeatMapCell,
} from '@/lib/risk/heatmap-matrix';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useEventStream } from '@/lib/events/use-event-stream';
import { Sparkline, type SparklineStatus } from './Sparkline';
import {
  computeCompositeByCompany,
  type CompositeScore,
} from '@/lib/risk/composite-score';
import {
  evaluateAlertRules,
  DEFAULT_ALERT_RULES,
} from '@/lib/risk/alert-rules';

type CompanyRow = {
  id: string;
  code: string;
  name: string;
  industry: string;
  /** Set true on sub-group rollup rows (Turn 33.5); leaf ops cos omit. */
  isSubgroup?: boolean;
};
type IndicatorCol = {
  id: string;
  code: string;
  nameEn: string;
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
  // User-driven HeatMap row/cell clicks → selectCompany (tracks LRU recent).
  const setCompany = useTerminalStore((s) => s.selectCompany);
  const activeCompanyCode = useTerminalStore((s) => s.activeCompanyCode);
  const setActiveIv = useTerminalStore((s) => s.setActiveIndicatorValue);
  const setActivePanel = useTerminalStore((s) => s.setActivePanel);
  const search = useTerminalStore((s) => s.searchByPanel[PANEL_ID] ?? '');
  const setSearch = useTerminalStore((s) => s.setSearchForPanel);
  const clearSearch = useTerminalStore((s) => s.clearSearchForPanel);
  const setAlertsCount = useTerminalStore((s) => s.setAlertsCount);
  const setAlertedCompanyCodes = useTerminalStore((s) => s.setAlertedCompanyCodes);
  const setAlertMatches = useTerminalStore((s) => s.setAlertMatches);
  const compactMode = useTerminalStore((s) => s.compactMode);

  const [data, setData] = useState<MatrixResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // SSR/CSR hydration guard — see CompanyTree for rationale.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const refetchMatrix = useCallback(() => {
    setLoading(true);
    setError(null);
    const qs = period ? `?period=${encodeURIComponent(period)}` : '';
    return fetch(`/api/indicators/matrix${qs}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((json) => {
        setData(json);
      })
      .catch((err) => {
        setError(err.message || 'Failed to load');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [period]);

  useEffect(() => {
    let cancelled = false;
    refetchMatrix().then(() => {
      if (cancelled) return;
    });
    return () => {
      cancelled = true;
    };
  }, [refetchMatrix]);

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
    // shapes match AlertCompany/AlertIndicator structurally.
    const matches = evaluateAlertRules(DEFAULT_ALERT_RULES, {
      companies: data.companies,
      indicators: data.indicators,
      cells: data.cells,
    });
    setAlertMatches(matches);
  }, [data, setAlertsCount, setAlertedCompanyCodes, setAlertMatches]);

  if (!mounted) {
    return (
      <span className="text-gray-700 font-mono text-[10px]">Loading…</span>
    );
  }

  if (error) {
    return (
      <span className="text-[#FF4757] font-mono text-xs">Error: {error}</span>
    );
  }

  // Even when data is empty / loading, render the search input so the
  // `/`-search shortcut always lands on a visible target. The body
  // toggles between "no rows yet" and the matrix table.
  const isEmpty =
    !loading &&
    (!data || data.companies.length === 0 || data.indicators.length === 0);
  const indicators = data?.indicators ?? [];
  const renderedPeriod = data?.period ?? period ?? '';

  return (
    <div className="font-mono text-[10px] text-gray-300 w-full h-full flex flex-col">
      <div className="flex items-center justify-between mb-2 text-[10px] text-gray-500 shrink-0 gap-2">
        <span className="shrink-0">
          HEATMAP · <span className="text-gray-300">{renderedPeriod}</span>
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
            placeholder="filter rows…"
            className="bg-[#0A0E27] border border-gray-800 rounded px-1.5 py-0.5 text-[10px] text-gray-200 placeholder-gray-700 focus:border-[#00D4AA] focus:outline-none w-full"
            spellCheck={false}
            aria-label="Filter heatmap rows"
          />
        </div>
        {summary && (
          <span className="tabular-nums shrink-0">
            <span style={{ color: statusColor('green') }}>{summary.green}G</span>
            {' / '}
            <span style={{ color: statusColor('amber') }}>{summary.amber}A</span>
            {' / '}
            <span style={{ color: statusColor('red') }}>{summary.red}R</span>
            {' / '}
            <span className="text-gray-500">{summary.unknown}?</span>
            {' / '}
            <span className="text-gray-600">{summary.missing}·</span>
          </span>
        )}
      </div>

      {loading && (
        <span className="text-gray-700 text-[11px] py-2">Loading heatmap…</span>
      )}
      {isEmpty && (
        <span className="text-gray-700 text-[11px] py-2">
          No companies or indicators yet. Import via /budgeting/onboarding and seed
          indicators (scripts/seed-indicators.ts).
        </span>
      )}

      <div className={`flex-1 overflow-auto ${isEmpty || loading ? 'hidden' : ''}`}>
        <TooltipProvider delayDuration={300}>
        <table className="border-collapse" aria-label="Risk heatmap">
          <thead>
            <tr>
              <th
                className="sticky left-0 top-0 z-20 bg-[#0A0E27] text-left px-1.5 py-1 border-b border-gray-800/60 text-gray-500 uppercase tracking-wider"
                style={{ minWidth: 90 }}
              >
                Company
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
                  {/* Turn-38-sub14 — Radix Tooltip replaces native `title=` (slow + browser-flaky on Mac).
                      Shows full indicator name + unit + direction on hover (~150ms delay). */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="truncate cursor-help">{ind.code}</div>
                    </TooltipTrigger>
                    <TooltipContent
                      side="bottom"
                      className="bg-popover text-popover-foreground border border-border shadow-lg max-w-[280px] text-xs"
                    >
                      <div className="font-mono font-semibold">{ind.code}</div>
                      <div className="text-muted-foreground">{ind.nameEn}</div>
                      <div className="text-[10px] text-muted-foreground/70 mt-0.5">
                        unit: {ind.unit} · {ind.direction === 'higher_better' ? 'higher = better' : ind.direction === 'lower_better' ? 'lower = better' : 'in band'}
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
                  No companies match "{search}"
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
                            return (
                              <div className="text-[11px] mt-1">
                                <span className="text-muted-foreground">
                                  Composite score:{' '}
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
                                  {cs.score === null ? '— no data' : `${cs.score} / 100`}
                                </span>
                                <span className="text-muted-foreground">
                                  {' · '}
                                  {cs.contributingCount}/{cs.totalCount} indicators
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
                            // Cell click selects company AND opens drill-down.
                            setCompany(co.code);
                            if (c?.indicatorValueId) {
                              setActiveIv(c.indicatorValueId);
                              setActivePanel(3);
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
 */
function CompositeBadge({ score }: { score: CompositeScore | null }) {
  if (!score || score.score === null) {
    return (
      <span
        className="text-[9px] tabular-nums text-gray-500 shrink-0"
        title="No scoreable indicators"
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
  return (
    <span
      className={`text-[9px] tabular-nums font-semibold shrink-0 ${colorClass}`}
      title={`Composite ${score.score}/100 · ${score.contributingCount}/${score.totalCount} indicators`}
    >
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

type HeatMapCellTdProps = {
  co: CompanyRow;
  ind: IndicatorCol;
  cell: HeatMapCell | undefined;
  compactMode: boolean;
  onCellClick: () => void;
};

// Eager Radix Tooltip per cell — at idle, no DOM portals exist (Radix only
// renders the floating content via Presence + Portal when the trigger is
// hovered, after provider's 300ms `delayDuration`). 676 wrappers therefore
// cost only React component instances + context subscriptions, not DOM
// nodes. Earlier `defaultOpen` lazy-mount caused tooltip pile-up on cursor
// sweep (each cell's Tooltip initialized to open=true and Radix did not
// transition to closed on pointerleave from the forced-open initial state).
function HeatMapCellTd({ co, ind, cell, compactMode, onCellClick }: HeatMapCellTdProps) {
  const status = cell?.status ?? 'missing';
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
      className={`cursor-pointer border-b border-gray-800/40 p-0 transition-shadow ${
        flashing ? 'shadow-[inset_0_0_0_2px_#00D4AA]' : ''
      }`}
      style={{
        backgroundColor: color,
        opacity: status === 'missing' ? 0.25 : 0.85,
      }}
      aria-label={`${co.code} ${ind.code} ${status}`}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            style={{
              width: compactMode ? 40 : 54,
              height: compactMode ? 12 : 18,
            }}
          />
        </TooltipTrigger>
        <TooltipContent
          side="top"
          className="bg-popover text-popover-foreground border border-border shadow-lg max-w-[280px] text-xs"
        >
          <div className="font-mono font-semibold">
            {co.code} · {ind.code}
          </div>
          <div className="text-muted-foreground">{ind.nameEn}</div>
          {cell ? (
            <>
              <div className="text-[11px] mt-1">
                <span className={statusColorClass}>{status.toUpperCase()}</span>
                {' @ '}
                <span className="font-mono">{formatValue(cell.value, ind.unit)}</span>
              </div>
              {cell.sparkline && cell.sparkline.length > 0 && (
                <div className="mt-1.5 flex items-center gap-1.5">
                  <Sparkline
                    data={cell.sparkline}
                    status={status as SparklineStatus}
                    ariaLabel={`${ind.code} 12-month trend for ${co.code}`}
                  />
                  <span className="text-[9px] text-muted-foreground/70">
                    12mo
                  </span>
                </div>
              )}
              {cell.error && (
                <div className="text-[11px] text-[#FF4757] mt-1">
                  ⚠ {cell.error.code}: {cell.error.reason}
                </div>
              )}
              <div className="text-[10px] text-muted-foreground/70 mt-1">
                Click → drill-down (Panel 3)
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
