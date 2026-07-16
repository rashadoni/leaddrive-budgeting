// @vitest-environment happy-dom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetCompaniesCacheForTests } from '../hooks/use-companies';
import { __resetMatrixCacheForTests } from '../hooks/use-matrix';
import { HeatMap } from './HeatMap';

const { terminalStoreState } = vi.hoisted(() => ({
  terminalStoreState: { activeCompanyCode: null as string | null },
}));

vi.mock('@/lib/events/use-event-stream', () => ({ useEventStream: () => {} }));

vi.mock('../store/terminalStore', () => ({
  useTerminalStore: <T,>(selector: (state: Record<string, unknown>) => T) =>
    selector({
      activeCompanyCode: terminalStoreState.activeCompanyCode,
      activeIndicatorValueId: null,
      searchByPanel: {},
      compactMode: false,
      selectCompany: () => {},
      setActiveIndicatorValue: () => {},
      setPendingMissingCell: () => {},
      setPendingRollupCell: () => {},
      setActivePanel: () => {},
      setSearchForPanel: () => {},
      clearSearchForPanel: () => {},
      setAlertsCount: () => {},
      setAlertedCompanyCodes: () => {},
      setAlertMatches: () => {},
      selectedPeriod: undefined,
      setSelectedPeriod: () => {},
      scenarioDelta: null,
      activeScenarioLabel: null,
      clearScenarioDelta: () => {},
    }),
}));

function headerCodes(): string[] {
  return Array.from(
    document.querySelectorAll<HTMLTableCellElement>('th[data-indicator-code]'),
  ).map((header) => header.getAttribute('data-indicator-code') ?? '');
}

beforeEach(() => {
  terminalStoreState.activeCompanyCode = null;
  __resetMatrixCacheForTests();
  __resetCompaniesCacheForTests();
  window.localStorage.clear();
  global.fetch = vi.fn(async (url: RequestInfo | URL) => {
    if (String(url).includes('/api/indicators/matrix')) {
      return new Response(
        JSON.stringify({
          period: '2026',
          companies: [
            {
              id: 'agro-company',
              code: 'AGRO-CO',
              name: 'Agro Company',
              industry: 'agro_crops',
            },
            {
              id: 'food-company',
              code: 'FOOD-CO',
              name: 'Food Company',
              industry: 'food_processing',
            },
          ],
          indicators: [
            {
              id: 'universal',
              code: 'IND_UNIVERSAL',
              nameEn: 'Universal KPI',
              direction: 'higher_better',
              unit: '%',
              industries: [],
            },
            {
              id: 'agro-missing',
              code: 'AGRO_MISSING',
              nameEn: 'Applicable without data',
              direction: 'higher_better',
              unit: 't/ha',
              industries: ['agro_crops'],
            },
            {
              id: 'food',
              code: 'FP_MARGIN',
              nameEn: 'Food margin',
              direction: 'higher_better',
              unit: '%',
              industries: ['food_processing'],
            },
            {
              id: 'hospitality',
              code: 'HOSP_OCC',
              nameEn: 'Occupancy',
              direction: 'higher_better',
              unit: '%',
              industries: ['hospitality'],
            },
            {
              id: 'legacy-observed',
              code: 'PHARMA_LEGACY',
              nameEn: 'Legacy override',
              direction: 'higher_better',
              unit: '%',
              industries: ['pharma'],
            },
            {
              id: 'legacy-empty',
              code: 'PHARMA_EMPTY',
              nameEn: 'Empty legacy placeholder',
              direction: 'higher_better',
              unit: '%',
              industries: ['pharma'],
            },
          ],
          cells: [
            {
              companyId: 'agro-company',
              indicatorId: 'legacy-observed',
              value: 12,
              status: 'green',
            },
            {
              companyId: 'agro-company',
              indicatorId: 'legacy-empty',
              value: 0,
              status: 'unknown',
            },
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

describe('HeatMap activity-aware indicator disclosure', () => {
  it('hides only non-applicable columns by default and reveals the full catalogue', async () => {
    render(<HeatMap />);

    await waitFor(() => expect(screen.getByText('AGRO-CO')).toBeTruthy());
    expect(headerCodes()).toEqual([
      'AGRO_MISSING',
      'FP_MARGIN',
      'IND_UNIVERSAL',
      'PHARMA_LEGACY',
    ]);
    // AGRO_MISSING has no observation, but it is applicable and therefore
    // remains visible. PHARMA_LEGACY is retained by the calculated-cell guard.
    expect(headerCodes()).not.toContain('HOSP_OCC');
    expect(headerCodes()).not.toContain('PHARMA_EMPTY');

    // The control is an always-visible on/off toggle, so its accessible name
    // is stable and its state is carried by
    // aria-pressed: pressed = non-applicable columns are being hidden.
    const toggle = screen.getByRole('button', { name: 'Hide non-applicable' });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.getAttribute('aria-controls')).toBe('risk-heatmap-table');
    // The count of what it is hiding right now rides in the visible label.
    expect(toggle.textContent).toContain('2');

    fireEvent.click(toggle);
    await waitFor(() => expect(headerCodes()).toContain('HOSP_OCC'));
    expect(headerCodes()).toContain('PHARMA_EMPTY');
    expect(
      screen
        .getByRole('button', { name: 'Hide non-applicable' })
        .getAttribute('aria-pressed'),
    ).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: 'Hide non-applicable' }));
    await waitFor(() => expect(headerCodes()).not.toContain('HOSP_OCC'));
  });

  it('ignores the removed Hide unknown preference and renders one filter control', async () => {
    window.localStorage.setItem('terminal-hide-unknown-v1', '1');
    render(<HeatMap />);

    await waitFor(() => expect(screen.getByText('AGRO-CO')).toBeTruthy());
    expect(headerCodes()).toEqual([
      'AGRO_MISSING',
      'FP_MARGIN',
      'IND_UNIVERSAL',
      'PHARMA_LEGACY',
    ]);

    expect(
      screen.getAllByRole('button', { name: 'Hide non-applicable' }),
    ).toHaveLength(1);
    expect(screen.queryByTestId('hide-unknown-toggle')).toBeNull();
  });
  it('stays visible when the broad scope leaves nothing to hide', async () => {
    // The reported bug: with every company shown and none selected, the scope
    // industries span the whole holding, so the fail-open rules mark everything
    // relevant and hiddenIndicatorCount is 0. The old disclosure button was
    // conditional on that count and vanished, so the filter looked absent.
    // A control that disappears exactly when it has nothing to report is
    // indistinguishable from a missing feature — it must stay and read "on".
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes('/api/indicators/matrix')) {
        return new Response(
          JSON.stringify({
            period: '2026',
            companies: [
              { id: 'agro-company', code: 'AGRO-CO', name: 'Agro Company', industry: 'agro_crops' },
            ],
            indicators: [
              {
                id: 'universal',
                code: 'IND_UNIVERSAL',
                nameEn: 'Universal KPI',
                direction: 'higher_better',
                unit: '%',
                industries: [],
              },
            ],
            cells: [],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('not found', { status: 404 });
    }) as never;

    render(<HeatMap />);
    await waitFor(() => expect(screen.getByText('AGRO-CO')).toBeTruthy());
    // Nothing is hidden — the universal indicator applies everywhere.
    expect(headerCodes()).toEqual(['IND_UNIVERSAL']);

    const toggle = screen.getByRole('button', { name: 'Hide non-applicable' });
    expect(toggle).toBeTruthy();
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    // No count suffix when there is nothing to count.
    expect(toggle.textContent).not.toContain('·');
  });

  it('keeps a relevant not-material indicator visible and leaves dimming to the cell', async () => {
    terminalStoreState.activeCompanyCode = 'AGRO-CO';
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes('/api/indicators/matrix')) {
        return new Response(
          JSON.stringify({
            period: '2026',
            companies: [
              {
                id: 'agro-company',
                code: 'AGRO-CO',
                name: 'Agro Company',
                industry: 'agro_crops',
              },
            ],
            indicators: [
              {
                id: 'inventory-turns',
                code: 'IND_INVENTORY_TURNS',
                nameEn: 'Inventory Turns',
                direction: 'higher_better',
                unit: 'x',
                industries: ['agro_crops'],
              },
            ],
            cells: [
              {
                companyId: 'agro-company',
                indicatorId: 'inventory-turns',
                value: 0,
                status: 'unknown',
                materiality: 'not_material',
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('not found', { status: 404 });
    }) as never;

    render(<HeatMap />);
    await waitFor(() => expect(screen.getByText('AGRO-CO')).toBeTruthy());

    // agro_crops × IND_INVENTORY_TURNS is `not_material` in the SASB-style
    // map. It remains an applicable column; HeatMapCellTd owns the deliberate
    // low-opacity presentation instead of the disclosure filter hiding it.
    expect(headerCodes()).toEqual(['IND_INVENTORY_TURNS']);
    expect(
      document.querySelector('[data-materiality="not_material"]'),
    ).toBeTruthy();
  });
});
