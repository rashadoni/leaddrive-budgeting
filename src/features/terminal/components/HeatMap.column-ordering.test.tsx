// @vitest-environment happy-dom
/**
 * Phase 7.I Track C.1 (2026-05-16) — HeatMap sector-aware column ordering.
 *
 * Locks the secondary sort key: within the same materiality rating,
 * industry-tagged indicators that match the active company's industry
 * MUST come before universal indicators (empty `industries` array).
 * Without this, an AZSEKER (agro_crops) entity sees IND_DSO /
 * IND_GROSS_MARGIN / IND_NET_MARGIN first (cluttering the operator's
 * eye with generic financial ratios) and AGRO_YIELD_PER_HA /
 * AGRO_WEATHER_RAINFALL deep on the right past horizontal scroll.
 *
 * Test strategy: render HeatMap with an active AZSEKER-EDEN company,
 * mock the matrix endpoint with a deliberate mix of:
 *   - AGRO_YIELD_PER_HA  industries=['agro_crops']        → priority 0
 *   - AGRO_SUGAR_CONTENT industries=['agro_crops']        → priority 0
 *   - IND_GROSS_MARGIN   industries=[]                    → priority 1
 *   - IND_DSO            industries=[]                    → priority 1
 *   - HOSP_OCC           industries=['hospitality']       → priority 2
 *     (only visible when "Material only" toggle is off; lands at the
 *     right edge as low-relevance noise — we don't pin its position)
 *
 * The matrix endpoint conventionally returns indicators in sortOrder
 * (financial-first, AGRO-last). The HeatMap re-sort must override that
 * for the active-agro-company case.
 */

import React from 'react';
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { HeatMap } from './HeatMap';

vi.mock('@/lib/events/use-event-stream', () => ({
  useEventStream: () => {},
}));

// Store mock — declare the active AZSEKER company.
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
            {
              id: 'co_eden',
              code: 'AZSEKER-EDEN',
              name: 'Eden',
              industry: 'agro_crops',
            },
          ],
          // Deliberately financial-first so the HeatMap re-sort has work
          // to do. If the sort were a no-op the assertion would catch it.
          indicators: [
            { id: 'ind_dso', code: 'IND_DSO', nameEn: 'DSO', direction: 'lower_better', unit: 'days', industries: [] },
            { id: 'ind_gm', code: 'IND_GROSS_MARGIN', nameEn: 'Gross Margin', direction: 'higher_better', unit: '%', industries: [] },
            { id: 'ind_yph', code: 'AGRO_YIELD_PER_HA', nameEn: 'Yield/ha', direction: 'higher_better', unit: 't/ha', industries: ['agro_crops'] },
            { id: 'ind_sc', code: 'AGRO_SUGAR_CONTENT', nameEn: 'Sugar Content', direction: 'higher_better', unit: '%', industries: ['agro_crops'] },
            { id: 'ind_occ', code: 'HOSP_OCC', nameEn: 'Occupancy', direction: 'higher_better', unit: '%', industries: ['hospitality'] },
          ],
          cells: [
            { companyId: 'co_eden', indicatorId: 'ind_dso', value: 35, status: 'green' as const },
            { companyId: 'co_eden', indicatorId: 'ind_gm', value: 25, status: 'green' as const },
            { companyId: 'co_eden', indicatorId: 'ind_yph', value: 65, status: 'green' as const },
            { companyId: 'co_eden', indicatorId: 'ind_sc', value: 14, status: 'green' as const },
            { companyId: 'co_eden', indicatorId: 'ind_occ', value: 0, status: 'unknown' as const },
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

describe('HeatMap column ordering — agro pilot active company (Phase 7.I Track C.1)', () => {
  it('lifts AGRO_* indicators above universal financial ratios for active AZSEKER-EDEN', async () => {
    render(<HeatMap />);
    await waitFor(() => {
      expect(screen.getByText('AZSEKER-EDEN')).toBeTruthy();
    });
    // Column-header cells carry the indicator's code via
    // `data-indicator-code` (mirrored ARIA attribute on every th).
    // Collect them in DOM order — that IS the rendered order after the sort.
    const headers = Array.from(
      document.querySelectorAll<HTMLTableCellElement>('th[data-indicator-code]'),
    );
    const headerCodes = headers.map((th) => th.getAttribute('data-indicator-code') ?? '');
    // Sanity — we should see at least the financial + agro columns.
    expect(headerCodes.length).toBeGreaterThanOrEqual(4);
    const idxAgroYield = headerCodes.indexOf('AGRO_YIELD_PER_HA');
    const idxAgroSugar = headerCodes.indexOf('AGRO_SUGAR_CONTENT');
    const idxDso = headerCodes.indexOf('IND_DSO');
    const idxGm = headerCodes.indexOf('IND_GROSS_MARGIN');
    // Both AGRO_* should be present + come BEFORE universal financial indicators.
    expect(idxAgroYield).toBeGreaterThanOrEqual(0);
    expect(idxAgroSugar).toBeGreaterThanOrEqual(0);
    expect(idxDso).toBeGreaterThanOrEqual(0);
    expect(idxGm).toBeGreaterThanOrEqual(0);
    expect(idxAgroYield).toBeLessThan(idxDso);
    expect(idxAgroYield).toBeLessThan(idxGm);
    expect(idxAgroSugar).toBeLessThan(idxDso);
    expect(idxAgroSugar).toBeLessThan(idxGm);
  });

  it('leaves non-intersecting industry-tagged indicators (HOSP_OCC) at the right edge', async () => {
    render(<HeatMap />);
    await waitFor(() => {
      expect(screen.getByText('AZSEKER-EDEN')).toBeTruthy();
    });
    const headers = Array.from(
      document.querySelectorAll<HTMLTableCellElement>('th[data-indicator-code]'),
    );
    const headerCodes = headers.map((th) => th.getAttribute('data-indicator-code') ?? '');
    const idxHosp = headerCodes.indexOf('HOSP_OCC');
    const idxAgroYield = headerCodes.indexOf('AGRO_YIELD_PER_HA');
    const idxDso = headerCodes.indexOf('IND_DSO');
    // HOSP_OCC (industry-tagged for a different sector) is priority 2 →
    // lands AFTER both AGRO indicators AND universal financials.
    if (idxHosp >= 0) {
      expect(idxHosp).toBeGreaterThan(idxAgroYield);
      expect(idxHosp).toBeGreaterThan(idxDso);
    }
  });
});
