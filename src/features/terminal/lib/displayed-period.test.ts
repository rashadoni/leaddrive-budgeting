/**
 * Defect C — the displayed-period rule.
 *
 * Runs in the default `node` environment: no happy-dom, no React, no fetch.
 * That is the point — the rule ScenarioPanel acts on is assertable without
 * mounting the panel at all.
 */

import { describe, it, expect } from 'vitest';
import { planDisplayedPeriod, type PeekedMatrix } from './displayed-period';
import type { HeatMapCell } from '@/lib/risk/heatmap-matrix';

function cell(status: HeatMapCell['status'], value: number): HeatMapCell {
  return { companyId: 'co', indicatorId: 'ind', status, value };
}

function payload(period: string, cells: HeatMapCell[]): PeekedMatrix {
  return { period, cells };
}

/**
 * The grid's rule, transcribed from `HeatMap.tsx:78`. `period` (the prop) is
 * always undefined — `PanelGrid.tsx:302` renders `<HeatMap />` bare.
 */
function gridRenderedPeriod(
  data: { period: string } | null,
  selectedPeriod: string | undefined,
): string {
  return data?.period ?? selectedPeriod ?? '';
}

describe('planDisplayedPeriod — period', () => {
  it('takes the store period when one is picked', () => {
    expect(
      planDisplayedPeriod('2026-Q1', payload('2026-Q1', []), '2026').period,
    ).toBe('2026-Q1');
  });

  it('takes the store period even before that period\'s payload lands', () => {
    // The switch-and-wait window. The grid falls back to selectedPeriod on the
    // same tick, so the panel must too — this is defect A's window, and the
    // panel is not allowed to disagree with the grid inside it.
    expect(planDisplayedPeriod('2026-Q1', null, '2026').period).toBe('2026-Q1');
  });

  it('falls back to the payload period when nothing is picked', () => {
    // Production default: the matrix endpoint resolves a DATA-AWARE default
    // (latest complete year WITH values, `route.ts:69-110`), which is NOT the
    // current Baku year. This is the case the old `currentBakuYear()` got wrong
    // every single page load.
    expect(planDisplayedPeriod(undefined, payload('2025', []), '2026').period).toBe(
      '2025',
    );
  });

  it('falls back to the supplied fallback only when both are absent', () => {
    expect(planDisplayedPeriod(undefined, null, '2026').period).toBe('2026');
  });

  it('agrees with the grid wherever the grid renders a period at all', () => {
    // `/api/indicators/matrix` echoes an explicit ?period= verbatim
    // (`route.ts:432`; `parsePeriod` validates, never normalises), so a landed
    // payload for a picked period always carries that same string.
    const cases: Array<[string | undefined, { period: string } | null]> = [
      ['2026-Q1', { period: '2026-Q1' }],
      ['2026-Q1', null],
      ['2025', { period: '2025' }],
      [undefined, { period: '2025' }],
    ];
    for (const [selected, data] of cases) {
      const grid = gridRenderedPeriod(data, selected);
      const panel = planDisplayedPeriod(
        selected,
        data ? payload(data.period, []) : null,
        '2026',
      ).period;
      expect(panel).toBe(grid);
    }
    // The single divergence, stated rather than hidden: cold with no pick. The
    // grid renders '' (it is showing a spinner, not a period); the panel cannot
    // put '' in a URL, so it uses the fallback.
    expect(gridRenderedPeriod(null, undefined)).toBe('');
    expect(planDisplayedPeriod(undefined, null, '2026').period).toBe('2026');
  });
});

describe('planDisplayedPeriod — blockedReason fails OPEN', () => {
  it('is null when there is no payload at all', () => {
    // THE regression test. The previous attempt disabled Simulate on
    // `matrix === null`; ScenarioPanel.test.tsx never mocks the matrix
    // endpoint, so the button went permanently dead and the 5 simulate tests
    // burned 30s x 3 retries each — a 1.2s file became ~450s.
    expect(planDisplayedPeriod('2026', null, '2026').blockedReason).toBeNull();
    expect(planDisplayedPeriod(undefined, null, '2026').blockedReason).toBeNull();
  });

  it('is null when the payload we hold is for a different period', () => {
    // Picked 2026-Q1, still holding the 2025 default payload. We know nothing
    // about 2026-Q1, so we must not speak about it.
    expect(
      planDisplayedPeriod('2026-Q1', payload('2025', [cell('green', 1)]), '2026')
        .blockedReason,
    ).toBeNull();
  });

  it('is null when the payload for this period has at least one evidenced cell', () => {
    expect(
      planDisplayedPeriod(
        '2026',
        payload('2026', [cell('unknown', 0), cell('red', 12.5)]),
        '2026',
      ).blockedReason,
    ).toBeNull();
  });

  it('fires only on a payload for THIS period with zero evidenced cells', () => {
    expect(
      planDisplayedPeriod('2026-Q1', payload('2026-Q1', []), '2026').blockedReason,
    ).toBe('no-computed-values');
    // Defect D's shape: the quarter expands into rows, but every one of them is
    // an unevidenced placeholder. `hasEvidencedValue` is the shared rule that
    // already stopped a fabricated 0.00 being read as a measurement.
    expect(
      planDisplayedPeriod(
        '2026-Q1',
        payload('2026-Q1', [cell('unknown', 0), cell('unknown', 0)]),
        '2026',
      ).blockedReason,
    ).toBe('no-computed-values');
  });

  it('an evidenced zero is still evidence', () => {
    expect(
      planDisplayedPeriod('2026', payload('2026', [cell('green', 0)]), '2026')
        .blockedReason,
    ).toBeNull();
  });
});
