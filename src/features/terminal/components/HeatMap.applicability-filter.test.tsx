// @vitest-environment happy-dom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetCompaniesCacheForTests } from '../hooks/use-companies';
import { __resetMatrixCacheForTests } from '../hooks/use-matrix';
import { HeatMap } from './HeatMap';

const { terminalStoreState, terminalActions } = vi.hoisted(() => ({
  terminalStoreState: { activeCompanyCode: null as string | null },
  terminalActions: {
    selectCompany: vi.fn(),
    setActiveIndicatorValue: vi.fn(),
    setPendingMissingCell: vi.fn(),
    setPendingRollupCell: vi.fn(),
    setActivePanel: vi.fn(),
  },
}));

vi.mock('@/lib/events/use-event-stream', () => ({ useEventStream: () => {} }));

vi.mock('../store/terminalStore', () => ({
  useTerminalStore: <T,>(selector: (state: Record<string, unknown>) => T) =>
    selector({
      activeCompanyCode: terminalStoreState.activeCompanyCode,
      activeIndicatorValueId: null,
      searchByPanel: {},
      compactMode: false,
      selectCompany: terminalActions.selectCompany,
      setActiveIndicatorValue: terminalActions.setActiveIndicatorValue,
      setPendingMissingCell: terminalActions.setPendingMissingCell,
      setPendingRollupCell: terminalActions.setPendingRollupCell,
      setActivePanel: terminalActions.setActivePanel,
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
  vi.clearAllMocks();
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
            // IND_UNIVERSAL + FP_MARGIN carry real values → applicable AND
            // non-empty, so they survive the default "hide inapplicable + hide
            // empty" view.
            {
              companyId: 'agro-company',
              indicatorId: 'universal',
              value: 42,
              status: 'green',
            },
            {
              companyId: 'food-company',
              indicatorId: 'food',
              value: 18,
              status: 'green',
            },
            // PHARMA_LEGACY has a stale persisted value, but pharma is out of
            // scope, so it stays hidden — data alone never reveals a
            // sector-inapplicable column.
            {
              companyId: 'agro-company',
              indicatorId: 'legacy-observed',
              value: 12,
              status: 'green',
            },
            // PHARMA_EMPTY only has an `unknown` cell = «нет данных», so it is
            // both empty (by the new rule) and inapplicable.
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
  it('hides non-applicable AND empty columns by default and reveals the full catalogue', async () => {
    render(<HeatMap />);

    await waitFor(() => expect(screen.getByText('AGRO-CO')).toBeTruthy());
    // Only columns that are BOTH applicable to the scope AND carry a real
    // value on a visible company survive the default view.
    expect(headerCodes()).toEqual(['FP_MARGIN', 'IND_UNIVERSAL']);
    // AGRO_MISSING is applicable (agro_crops is in scope) but has no
    // observation on any visible company, so the "hide empty" default now
    // drops it too. A persisted PHARMA_LEGACY value comes from an old
    // calculation on an out-of-scope sector, so it stays hidden; PHARMA_EMPTY
    // is both inapplicable and empty.
    expect(headerCodes()).not.toContain('AGRO_MISSING');
    expect(headerCodes()).not.toContain('HOSP_OCC');
    expect(headerCodes()).not.toContain('PHARMA_LEGACY');
    expect(headerCodes()).not.toContain('PHARMA_EMPTY');

    // The control is an always-visible on/off toggle, so its accessible name
    // is stable and its state is carried by
    // aria-pressed: pressed = non-applicable/empty columns are being hidden.
    const toggle = screen.getByRole('button', {
      name: 'Show all. 4 indicators hidden',
    });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.getAttribute('aria-controls')).toBe('risk-heatmap-table');
    // The count of what it is hiding right now rides in the visible label —
    // and it now includes the applicable-but-empty AGRO_MISSING.
    expect(toggle.textContent).toContain('4');

    fireEvent.click(toggle);
    await waitFor(() => expect(headerCodes()).toContain('HOSP_OCC'));
    expect(headerCodes()).toContain('AGRO_MISSING');
    expect(headerCodes()).toContain('PHARMA_EMPTY');
    expect(
      screen
        .getByRole('button', { name: 'Hide non-applicable' })
        .getAttribute('aria-pressed'),
    ).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: 'Hide non-applicable' }));
    await waitFor(() => expect(headerCodes()).not.toContain('HOSP_OCC'));
  });

  it('uses explicit CompanyIndicator overrides without treating stale cells as overrides', async () => {
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
                id: 'universal',
                code: 'IND_UNIVERSAL',
                nameEn: 'Universal KPI',
                direction: 'higher_better',
                unit: '%',
                industries: [],
              },
              {
                id: 'agro-disabled',
                code: 'AGRO_DISABLED',
                nameEn: 'Explicitly disabled agro KPI',
                direction: 'higher_better',
                unit: '%',
                industries: ['agro_crops'],
              },
              {
                id: 'retail-enabled',
                code: 'RET_OVERRIDE',
                nameEn: 'Explicitly enabled retail KPI',
                direction: 'higher_better',
                unit: '%',
                industries: ['retail'],
              },
              {
                id: 'hospitality-stale',
                code: 'HOSP_STALE',
                nameEn: 'Stale wrong-sector result',
                direction: 'higher_better',
                unit: '%',
                industries: ['hospitality'],
              },
            ],
            applicabilityOverrides: [
              {
                companyId: 'agro-company',
                indicatorId: 'agro-disabled',
                enabled: false,
              },
              {
                companyId: 'agro-company',
                indicatorId: 'retail-enabled',
                enabled: true,
              },
            ],
            cells: [
              {
                companyId: 'agro-company',
                indicatorId: 'retail-enabled',
                value: 10,
                status: 'green',
              },
              {
                companyId: 'agro-company',
                indicatorId: 'hospitality-stale',
                value: 99,
                status: 'green',
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

    // RET_OVERRIDE is explicitly enabled AND has a value → visible.
    // IND_UNIVERSAL is applicable but has no value on the only visible company,
    // so the "hide empty" default drops it (it is still reachable — and its
    // missing cell exercised — under Show all below).
    expect(headerCodes()).toContain('RET_OVERRIDE');
    expect(headerCodes()).not.toContain('IND_UNIVERSAL');
    expect(headerCodes()).not.toContain('AGRO_DISABLED');
    expect(headerCodes()).not.toContain('HOSP_STALE');

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Show all. 3 indicators hidden',
      }),
    );
    await waitFor(() => expect(headerCodes()).toContain('AGRO_DISABLED'));

    const disabledCell = screen.getByRole('button', {
      name: 'AGRO-CO, AGRO_DISABLED: N/A: disabled for this company by configuration.',
    });
    const mismatchCell = screen.getByRole('button', {
      name: "AGRO-CO, HOSP_STALE: N/A: does not match this company's activity profile.",
    });

    // Native buttons provide tab focus and Enter/Space activation. These N/A
    // buttons intentionally stay focusable for their explanatory tooltip, but
    // carry no action and therefore cannot open missing/recompute.
    expect(disabledCell.tagName).toBe('BUTTON');
    expect(disabledCell.tabIndex).toBe(0);
    disabledCell.focus();
    expect(document.activeElement).toBe(disabledCell);
    expect(disabledCell.getAttribute('aria-disabled')).toBe('true');
    expect(disabledCell.getAttribute('data-applicability-reason')).toBe(
      'explicit_disabled',
    );
    expect(disabledCell.textContent).toContain('N/A');
    expect(disabledCell.style.opacity).toBe('1');
    expect(
      disabledCell.querySelector<HTMLSpanElement>('span')?.style.fontSize,
    ).toBe('11px');
    expect(mismatchCell.getAttribute('aria-disabled')).toBe('true');
    expect(mismatchCell.getAttribute('data-applicability-reason')).toBe(
      'taxonomy_mismatch',
    );

    fireEvent.keyDown(disabledCell, { key: 'Enter', code: 'Enter' });
    fireEvent.keyDown(disabledCell, { key: ' ', code: 'Space' });
    fireEvent.click(disabledCell);
    fireEvent.click(mismatchCell);
    expect(terminalActions.selectCompany).not.toHaveBeenCalled();
    expect(terminalActions.setActivePanel).not.toHaveBeenCalled();
    expect(terminalActions.setPendingMissingCell).not.toHaveBeenCalled();
    expect(terminalActions.setPendingRollupCell).not.toHaveBeenCalled();
    expect(terminalActions.setActiveIndicatorValue).not.toHaveBeenCalled();

    const actionableMissingCell = screen.getByRole('button', {
      name: 'AGRO-CO, IND_UNIVERSAL: No data',
    });
    expect(actionableMissingCell.tagName).toBe('BUTTON');
    expect(actionableMissingCell.textContent).toContain('N/D');
    const noDataLabel = Array.from(
      actionableMissingCell.querySelectorAll<HTMLSpanElement>('span'),
    ).find((span) => span.textContent?.trim() === 'N/D');
    expect(
      noDataLabel?.style.fontSize,
    ).toBe('11px');
    actionableMissingCell.focus();
    expect(document.activeElement).toBe(actionableMissingCell);
    fireEvent.click(actionableMissingCell);
    expect(terminalActions.selectCompany).toHaveBeenCalledWith('AGRO-CO');
    expect(terminalActions.setActivePanel).toHaveBeenCalledWith(3);
    expect(terminalActions.setPendingMissingCell).toHaveBeenCalledWith({
      companyId: 'agro-company',
      indicatorId: 'universal',
      companyCode: 'AGRO-CO',
      indicatorCode: 'IND_UNIVERSAL',
      indicatorName: 'Universal KPI',
    });
  });

  it('treats a parent-only rollup as N/A on a leaf and never opens missing/recompute', async () => {
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
                isSubgroup: false,
              },
            ],
            indicators: [
              {
                id: 'holding-revenue',
                code: 'IND_HOLDING_REVENUE',
                nameEn: 'Holding Revenue',
                direction: 'higher_better',
                unit: 'AZN',
                industries: [],
                requiredInputs: ['rollup:IND_REVENUE_TOTAL'],
              },
            ],
            // Structural entity eligibility wins even over an accidental
            // explicit enable on the leaf pair.
            applicabilityOverrides: [
              {
                companyId: 'agro-company',
                indicatorId: 'holding-revenue',
                enabled: true,
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

    expect(headerCodes()).toEqual([]);
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Show all. 1 indicators hidden',
      }),
    );
    await waitFor(() =>
      expect(headerCodes()).toEqual(['IND_HOLDING_REVENUE']),
    );

    const rollupLeafCell = screen.getByRole('button', {
      name: 'AGRO-CO, IND_HOLDING_REVENUE: N/A: this holding-level indicator applies only to subgroup rows.',
    });
    expect(rollupLeafCell.getAttribute('aria-disabled')).toBe('true');
    expect(rollupLeafCell.getAttribute('data-applicability-reason')).toBe(
      'entity_level_mismatch',
    );
    expect(rollupLeafCell.textContent).toContain('N/A');

    fireEvent.keyDown(rollupLeafCell, { key: 'Enter', code: 'Enter' });
    fireEvent.keyDown(rollupLeafCell, { key: ' ', code: 'Space' });
    fireEvent.click(rollupLeafCell);
    expect(terminalActions.selectCompany).not.toHaveBeenCalled();
    expect(terminalActions.setActivePanel).not.toHaveBeenCalled();
    expect(terminalActions.setPendingMissingCell).not.toHaveBeenCalled();
    expect(terminalActions.setPendingRollupCell).not.toHaveBeenCalled();
    expect(terminalActions.setActiveIndicatorValue).not.toHaveBeenCalled();
  });

  it('ignores the removed Hide unknown preference and renders one filter control', async () => {
    window.localStorage.setItem('terminal-hide-unknown-v1', '1');
    render(<HeatMap />);

    await waitFor(() => expect(screen.getByText('AGRO-CO')).toBeTruthy());
    expect(headerCodes()).toEqual(['FP_MARGIN', 'IND_UNIVERSAL']);

    expect(
      screen.getAllByRole('button', {
        name: 'Show all. 4 indicators hidden',
      }),
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
    // The universal indicator also carries a real value here so the "hide
    // empty" gate doesn't hide it: applicable + non-empty ⇒ nothing hidden.
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
            cells: [
              {
                companyId: 'agro-company',
                indicatorId: 'universal',
                value: 42,
                status: 'green',
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
    // Nothing is hidden — the universal indicator applies everywhere.
    expect(headerCodes()).toEqual(['IND_UNIVERSAL']);

    const toggle = screen.getByRole('button', { name: 'Show all' });
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
              // A real (green) value keeps the column non-empty. The
              // not_material rating drives the cell's low-opacity dimming, not
              // column hiding. (An `unknown`-only column would now be hidden as
              // empty — a data-presence decision, separate from materiality.)
              {
                companyId: 'agro-company',
                indicatorId: 'inventory-turns',
                value: 3.5,
                status: 'green',
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

  it('hides an applicable indicator that is empty across every visible company, and reveals it under Show all', async () => {
    // FX_IMPORTED_INPUT is a universal (always-applicable) indicator, but it
    // has no real value on ANY visible company — «нет данных» in every cell
    // (one `unknown`, one absent). The owner's rule: such a column is noise and
    // must disappear while the toggle is ON, and its absence must be reflected
    // in the hidden count. It must reappear when the toggle is OFF (Show all).
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes('/api/indicators/matrix')) {
        return new Response(
          JSON.stringify({
            period: '2026',
            companies: [
              { id: 'agro-company', code: 'AGRO-CO', name: 'Agro Company', industry: 'agro_crops' },
              { id: 'food-company', code: 'FOOD-CO', name: 'Food Company', industry: 'food_processing' },
            ],
            indicators: [
              {
                id: 'revenue',
                code: 'IND_REVENUE',
                nameEn: 'Revenue',
                direction: 'higher_better',
                unit: 'AZN',
                industries: [],
              },
              {
                id: 'fx-imported',
                code: 'FX_IMPORTED_INPUT',
                nameEn: 'FX Imported Input',
                direction: 'lower_better',
                unit: '%',
                industries: [],
              },
            ],
            cells: [
              // IND_REVENUE has real values; FX_IMPORTED_INPUT has only an
              // `unknown` cell on one company and nothing on the other — no
              // real value anywhere in scope.
              { companyId: 'agro-company', indicatorId: 'revenue', value: 100, status: 'green' },
              { companyId: 'food-company', indicatorId: 'revenue', value: 90, status: 'amber' },
              { companyId: 'agro-company', indicatorId: 'fx-imported', value: 0, status: 'unknown' },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('not found', { status: 404 });
    }) as never;

    render(<HeatMap />);
    await waitFor(() => expect(screen.getByText('AGRO-CO')).toBeTruthy());

    // Toggle ON (default): the empty FX column is hidden; only the KPI that
    // actually has values shows. The hidden count is exactly 1 (FX_IMPORTED_INPUT).
    expect(headerCodes()).toEqual(['IND_REVENUE']);
    expect(headerCodes()).not.toContain('FX_IMPORTED_INPUT');
    const toggle = screen.getByRole('button', {
      name: 'Show all. 1 indicators hidden',
    });
    expect(toggle.textContent).toContain('1');

    // Toggle OFF (Show all): the empty column reappears alongside the real one.
    fireEvent.click(toggle);
    await waitFor(() => expect(headerCodes()).toContain('FX_IMPORTED_INPUT'));
    expect(headerCodes()).toContain('IND_REVENUE');
  });
});
