"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';
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

type CompanyRow = {
  id: string;
  code: string;
  name: string;
  industry: string;
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
  const setCompany = useTerminalStore((s) => s.setCompany);
  const activeCompanyCode = useTerminalStore((s) => s.activeCompanyCode);
  const setActiveIv = useTerminalStore((s) => s.setActiveIndicatorValue);
  const setActivePanel = useTerminalStore((s) => s.setActivePanel);
  const search = useTerminalStore((s) => s.searchByPanel[PANEL_ID] ?? '');
  const setSearch = useTerminalStore((s) => s.setSearchForPanel);
  const clearSearch = useTerminalStore((s) => s.clearSearchForPanel);

  const [data, setData] = useState<MatrixResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // SSR/CSR hydration guard — see CompanyTree for rationale.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const qs = period ? `?period=${encodeURIComponent(period)}` : '';
    fetch(`/api/indicators/matrix${qs}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Failed to load');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [period]);

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
        <TooltipProvider delayDuration={150}>
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
                  style={{ minWidth: 54, maxWidth: 54 }}
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
                        unit: {ind.unit} · direction: {ind.direction}
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
                            className="cursor-pointer hover:bg-gray-800/40 px-1 py-0.5 rounded text-left w-full"
                          >
                            {co.code}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent
                          side="right"
                          className="bg-popover text-popover-foreground border border-border shadow-lg text-xs"
                        >
                          {co.name}{co.industry ? ` · ${co.industry}` : ''}
                        </TooltipContent>
                      </Tooltip>
                    </th>
                    {indicators.map((ind) => {
                      const c = cellMap.get(cellKey(co.id, ind.id));
                      const status = c?.status ?? 'missing';
                      const color = statusColor(status);
                      const titleParts: string[] = [
                        `${co.code} · ${ind.code} — ${ind.nameEn}`,
                      ];
                      if (c) {
                        titleParts.push(
                          `${c.status.toUpperCase()} @ ${formatValue(c.value, ind.unit)}`,
                        );
                        if (c.error) {
                          titleParts.push('');
                          titleParts.push(`⚠ ${c.error.code}: ${c.error.reason}`);
                        }
                        titleParts.push('');
                        titleParts.push('Click → drill-down (Panel 3)');
                      } else {
                        titleParts.push('no value computed');
                      }
                      return (
                        <td
                          key={ind.id}
                          onClick={() => {
                            // Cell click selects company AND opens drill-down.
                            // Pre-Phase-7.D this only set company; the new
                            // contract is "click a coloured cell, see why".
                            setCompany(co.code);
                            if (c?.indicatorValueId) {
                              setActiveIv(c.indicatorValueId);
                              setActivePanel(3);
                            }
                          }}
                          title={titleParts.join('\n')}
                          className="cursor-pointer border-b border-gray-800/40 p-0"
                          style={{
                            backgroundColor: color,
                            opacity: status === 'missing' ? 0.25 : 0.85,
                          }}
                          aria-label={`${co.code} ${ind.code} ${status}`}
                        >
                          <div style={{ width: 54, height: 18 }} />
                        </td>
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
