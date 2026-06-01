// @vitest-environment happy-dom
/**
 * Client-feedback #5 (2026-06-01) — intuitive indicator (column) search.
 *
 * Locks the UI wire-up: typing a free-text query into the Panel-2 indicator
 * search box filters the matrix COLUMNS via the multilingual fuzzy matcher
 * (indicator-search.ts, unit-tested separately), preserving column order and
 * surfacing a "no indicators match" state when nothing hits. The row (company)
 * `/`-filter is untouched.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { HeatMap } from './HeatMap';

vi.mock('@/lib/events/use-event-stream', () => ({ useEventStream: () => {} }));

vi.mock('../store/terminalStore', () => ({
  useTerminalStore: <T,>(
    selector: (s: {
      activeCompanyCode: string | null;
      activeIndicatorValueId: string | null;
      searchByPanel: Record<number, string>;
      compactMode: boolean;
      selectCompany: () => void;
      setActiveIndicatorValue: () => void;
      setActivePanel: () => void;
      setSearchForPanel: () => void;
      clearSearchForPanel: () => void;
      setAlertsCount: () => void;
      setAlertedCompanyCodes: () => void;
      setAlertMatches: () => void;
    }) => T,
  ) =>
    selector({
      activeCompanyCode: 'AZSEKER-EDEN',
      activeIndicatorValueId: null,
      searchByPanel: {},
      compactMode: false,
      selectCompany: () => {},
      setActiveIndicatorValue: () => {},
      setActivePanel: () => {},
      setSearchForPanel: () => {},
      clearSearchForPanel: () => {},
      setAlertsCount: () => {},
      setAlertedCompanyCodes: () => {},
      setAlertMatches: () => {},
    }),
}));

beforeEach(() => {
  global.fetch = vi.fn(async (url: RequestInfo | URL) => {
    if (String(url).includes('/api/indicators/matrix')) {
      return new Response(
        JSON.stringify({
          period: '2026',
          companies: [
            { id: 'co_eden', code: 'AZSEKER-EDEN', name: 'Eden', industry: 'agro_crops' },
          ],
          indicators: [
            { id: 'ind_dso', code: 'IND_DSO', nameEn: 'DSO', nameRu: 'DSO', direction: 'lower_better', unit: 'days', industries: [] },
            { id: 'ind_gm', code: 'IND_GROSS_MARGIN', nameEn: 'Gross Margin', nameRu: 'Валовая маржа', direction: 'higher_better', unit: '%', industries: [] },
            { id: 'ind_rph', code: 'AGRO_REVENUE_PER_HA', nameEn: 'Revenue per Hectare', nameRu: 'Выручка на гектар', direction: 'higher_better', unit: 'AZN/ha', industries: ['agro_crops'] },
            { id: 'ind_cph', code: 'AGRO_COST_PER_HA', nameEn: 'Input Cost per Hectare', nameRu: 'Себестоимость на гектар', direction: 'lower_better', unit: 'AZN/ha', industries: ['agro_crops'] },
          ],
          cells: [
            { companyId: 'co_eden', indicatorId: 'ind_dso', value: 35, status: 'green' as const },
            { companyId: 'co_eden', indicatorId: 'ind_gm', value: 25, status: 'green' as const },
            { companyId: 'co_eden', indicatorId: 'ind_rph', value: 65, status: 'green' as const },
            { companyId: 'co_eden', indicatorId: 'ind_cph', value: 40, status: 'green' as const },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response('not found', { status: 404 });
  }) as never;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function headerCodes(): string[] {
  return Array.from(
    document.querySelectorAll<HTMLTableCellElement>('th[data-indicator-code]'),
  ).map((th) => th.getAttribute('data-indicator-code') ?? '');
}

describe('HeatMap indicator search (client-feedback #5)', () => {
  it('filters columns to the EN-name match and hides the rest', async () => {
    render(<HeatMap />);
    await waitFor(() => expect(screen.getByText('AZSEKER-EDEN')).toBeTruthy());
    expect(headerCodes().length).toBe(4); // all columns before search

    const box = screen.getByLabelText('Search indicators by name or code');
    fireEvent.change(box, { target: { value: 'margin' } });

    await waitFor(() => expect(headerCodes()).toEqual(['IND_GROSS_MARGIN']));
  });

  it("matches the per-hectare columns by the client's Russian query «гектар»", async () => {
    render(<HeatMap />);
    await waitFor(() => expect(screen.getByText('AZSEKER-EDEN')).toBeTruthy());

    const box = screen.getByLabelText('Search indicators by name or code');
    fireEvent.change(box, { target: { value: 'гектар' } });

    await waitFor(() =>
      expect(headerCodes()).toEqual(['AGRO_REVENUE_PER_HA', 'AGRO_COST_PER_HA']),
    );
  });

  it('finds both per-ha columns by the code token «per ha» typed in latin', async () => {
    render(<HeatMap />);
    await waitFor(() => expect(screen.getByText('AZSEKER-EDEN')).toBeTruthy());

    const box = screen.getByLabelText('Search indicators by name or code');
    fireEvent.change(box, { target: { value: 'per ha' } });

    await waitFor(() =>
      expect(headerCodes()).toEqual(['AGRO_REVENUE_PER_HA', 'AGRO_COST_PER_HA']),
    );
  });

  it('shows the empty-state message when nothing matches', async () => {
    render(<HeatMap />);
    await waitFor(() => expect(screen.getByText('AZSEKER-EDEN')).toBeTruthy());

    const box = screen.getByLabelText('Search indicators by name or code');
    fireEvent.change(box, { target: { value: 'zzzzz' } });

    await waitFor(() => {
      expect(headerCodes().length).toBe(0);
      expect(screen.getByText(/No indicators match/)).toBeTruthy();
    });
  });

  it('restores all columns when the query is cleared', async () => {
    render(<HeatMap />);
    await waitFor(() => expect(screen.getByText('AZSEKER-EDEN')).toBeTruthy());

    const box = screen.getByLabelText('Search indicators by name or code');
    fireEvent.change(box, { target: { value: 'margin' } });
    await waitFor(() => expect(headerCodes()).toEqual(['IND_GROSS_MARGIN']));

    fireEvent.change(box, { target: { value: '' } });
    await waitFor(() => expect(headerCodes().length).toBe(4));
  });
});
