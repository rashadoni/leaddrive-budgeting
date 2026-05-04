// @vitest-environment happy-dom
/**
 * Phase 7.D regression-architect closure (post-HeatMap missing-cell UX fix) —
 * locks the mutual-exclusion invariant between `activeIndicatorValueId`
 * and `pendingMissingCell` at `terminalStore.ts:295-309`.
 *
 * Why a separate file: the existing `terminalStore.compactMode.test.ts`
 * + `terminalStore.watchlist.test.ts` cover orthogonal slices; this
 * concern is the IV/pending pair only. Keeps the test surface
 * topical + lets a future grep on the invariant land here directly.
 *
 * The PRIMARY case (architect re-review ⚠️ from HeatMap missing-cell turn):
 *   `setPendingMissingCell(null)` while `activeIndicatorValueId` is set
 *   MUST PRESERVE activeIv. The expression
 *
 *     activeIndicatorValueId: pending ? null : globalState.activeIndicatorValueId
 *
 *   at line 308 has both branches. The "pending=truthy → clears activeIv"
 *   branch is exercised by `HeatMap.cell-click.test.tsx` (missing-cell
 *   click). The "pending=null → preserves activeIv" branch is the
 *   dismiss path (e.g. user closes a no-data hint or a future Reset
 *   button calls `setPendingMissingCell(null)`) — without this test, a
 *   regression to `activeIndicatorValueId: null` (always-clear) would
 *   silently nuke Panel 3 drill-down on dismiss with no failing test.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  getTerminalSnapshot,
  useTerminalStore,
} from './terminalStore';

const SAMPLE_PENDING = {
  companyId: 'co_aac',
  companyCode: 'AAC-MAIN',
  indicatorId: 'ind_fx',
  indicatorCode: 'IND_FX_EXPOSURE',
  indicatorName: 'FX Exposure',
} as const;

function useActions() {
  return useTerminalStore((s) => ({
    setActiveIndicatorValue: s.setActiveIndicatorValue,
    setPendingMissingCell: s.setPendingMissingCell,
    setPendingRollupCell: s.setPendingRollupCell,
    clearState: s.clearState,
  }));
}

// Phase 7.G Turn VI added a 3rd mutex axis: pendingRollupCell. Sample
// payload mirrors the rollup-cell click handler in HeatMap.tsx — sub-
// group cell with averaged value + worst-of-children status.
const SAMPLE_ROLLUP = {
  companyId: 'co_aac_sg',
  companyCode: 'AAC',
  indicatorId: 'ind_nm',
  indicatorCode: 'IND_NET_MARGIN',
  indicatorName: 'Net Margin',
  indicatorUnit: '%',
  value: -9.46,
  status: 'red' as const,
  contributingChildCount: 1,
} as const;

beforeEach(() => {
  // Hard-reset the IV/pending slice via clearState so every test starts
  // from {activeIndicatorValueId: null, pendingMissingCell: null}.
  // clearState resets both fields (terminalStore.ts:356-357) — verified
  // by the sanity test below.
  const { result } = renderHook(() => useActions());
  act(() => {
    result.current.clearState();
  });
});

describe('terminalStore — pending/activeIv mutual-exclusion invariant', () => {
  it('PRIMARY: setPendingMissingCell(null) PRESERVES activeIndicatorValueId (dismiss-pending branch at line 308)', () => {
    // Architect ⚠️ from HeatMap missing-cell UX fix turn — locks the
    // `pending ? null : globalState.activeIndicatorValueId` ELSE branch.
    // A regression to always-clear would silently break Panel 3 on
    // dismiss with no failing test elsewhere in the suite.
    const { result } = renderHook(() => useActions());
    act(() => {
      result.current.setActiveIndicatorValue('iv_drilled_down');
    });
    expect(getTerminalSnapshot().activeIndicatorValueId).toBe('iv_drilled_down');
    expect(getTerminalSnapshot().pendingMissingCell).toBeNull();

    act(() => {
      result.current.setPendingMissingCell(null);
    });
    // KEY ASSERTION — activeIv survives the null-pending dismiss.
    expect(getTerminalSnapshot().activeIndicatorValueId).toBe('iv_drilled_down');
    expect(getTerminalSnapshot().pendingMissingCell).toBeNull();
  });

  it('setPendingMissingCell({...}) CLEARS activeIndicatorValueId (set-pending branch at line 308)', () => {
    // Sister branch of the PRIMARY case — locks the truthy-pending leg.
    // Already implicitly covered by HeatMap.cell-click.test.tsx, but
    // explicit here keeps the two branches symmetric within one file.
    const { result } = renderHook(() => useActions());
    act(() => {
      result.current.setActiveIndicatorValue('iv_drilled_down');
    });
    expect(getTerminalSnapshot().activeIndicatorValueId).toBe('iv_drilled_down');

    act(() => {
      result.current.setPendingMissingCell({ ...SAMPLE_PENDING });
    });
    expect(getTerminalSnapshot().activeIndicatorValueId).toBeNull();
    expect(getTerminalSnapshot().pendingMissingCell).toEqual(SAMPLE_PENDING);
  });

  it('setActiveIndicatorValue(id) CLEARS pendingMissingCell (symmetric setter at line 301)', () => {
    // Mirror of the truthy-pending case — proves the invariant holds
    // when the user clicks a computed cell after first clicking a
    // missing one (the most likely real-world transition).
    const { result } = renderHook(() => useActions());
    act(() => {
      result.current.setPendingMissingCell({ ...SAMPLE_PENDING });
    });
    expect(getTerminalSnapshot().pendingMissingCell).toEqual(SAMPLE_PENDING);
    expect(getTerminalSnapshot().activeIndicatorValueId).toBeNull();

    act(() => {
      result.current.setActiveIndicatorValue('iv_now_drilled_down');
    });
    expect(getTerminalSnapshot().activeIndicatorValueId).toBe('iv_now_drilled_down');
    expect(getTerminalSnapshot().pendingMissingCell).toBeNull();
  });

  // Phase 7.G Turn VI added pendingRollupCell as a 3rd mutex axis.
  // Architect Turn-V Round-1 💡: cover all 6 transitions explicitly so a
  // future setter regression doesn't slip through (4 cases below).

  it('Turn VI: setPendingRollupCell({...}) CLEARS activeIv AND pendingMissingCell', () => {
    // Setting the rollup hint must clear BOTH other axes — this is the
    // load-bearing case when user clicks a synthetic-rollup cell after
    // a missing-cell click had populated pendingMissingCell.
    const { result } = renderHook(() => useActions());
    act(() => {
      result.current.setActiveIndicatorValue('iv_drilled_down');
      result.current.setPendingMissingCell({ ...SAMPLE_PENDING });
    });
    // Pre-state: activeIv null (cleared by setPendingMissingCell),
    // pendingMissing populated.
    expect(getTerminalSnapshot().pendingMissingCell).toEqual(SAMPLE_PENDING);

    act(() => {
      result.current.setPendingRollupCell({ ...SAMPLE_ROLLUP });
    });
    expect(getTerminalSnapshot().pendingRollupCell).toEqual(SAMPLE_ROLLUP);
    expect(getTerminalSnapshot().pendingMissingCell).toBeNull();
    expect(getTerminalSnapshot().activeIndicatorValueId).toBeNull();
  });

  it('Turn VI: setActiveIndicatorValue(id) CLEARS pendingRollupCell', () => {
    const { result } = renderHook(() => useActions());
    act(() => {
      result.current.setPendingRollupCell({ ...SAMPLE_ROLLUP });
    });
    expect(getTerminalSnapshot().pendingRollupCell).toEqual(SAMPLE_ROLLUP);

    act(() => {
      result.current.setActiveIndicatorValue('iv_drilled_down');
    });
    expect(getTerminalSnapshot().activeIndicatorValueId).toBe('iv_drilled_down');
    expect(getTerminalSnapshot().pendingRollupCell).toBeNull();
  });

  it('Turn VI: setPendingMissingCell({...}) CLEARS pendingRollupCell', () => {
    const { result } = renderHook(() => useActions());
    act(() => {
      result.current.setPendingRollupCell({ ...SAMPLE_ROLLUP });
    });
    expect(getTerminalSnapshot().pendingRollupCell).toEqual(SAMPLE_ROLLUP);

    act(() => {
      result.current.setPendingMissingCell({ ...SAMPLE_PENDING });
    });
    expect(getTerminalSnapshot().pendingMissingCell).toEqual(SAMPLE_PENDING);
    expect(getTerminalSnapshot().pendingRollupCell).toBeNull();
  });

  it('Turn VI: setPendingRollupCell(null) PRESERVES activeIv (dismiss path symmetric to PRIMARY)', () => {
    // Mirror of the PRIMARY case for the rollup axis. Dismiss button
    // future-call would pass null; activeIv must survive.
    const { result } = renderHook(() => useActions());
    act(() => {
      result.current.setActiveIndicatorValue('iv_drilled_down');
    });
    expect(getTerminalSnapshot().activeIndicatorValueId).toBe('iv_drilled_down');

    act(() => {
      result.current.setPendingRollupCell(null);
    });
    expect(getTerminalSnapshot().activeIndicatorValueId).toBe('iv_drilled_down');
    expect(getTerminalSnapshot().pendingRollupCell).toBeNull();
  });

  it('clearState() resets BOTH fields regardless of which one was set first (sanity)', () => {
    // Defensive — if a future refactor extracts the pair into its own
    // sub-reducer, clearState must keep clearing both. Cheap to lock.
    const { result } = renderHook(() => useActions());
    act(() => {
      result.current.setActiveIndicatorValue('iv_x');
    });
    expect(getTerminalSnapshot().activeIndicatorValueId).toBe('iv_x');

    act(() => {
      result.current.clearState();
    });
    expect(getTerminalSnapshot().activeIndicatorValueId).toBeNull();
    expect(getTerminalSnapshot().pendingMissingCell).toBeNull();

    act(() => {
      result.current.setPendingMissingCell({ ...SAMPLE_PENDING });
    });
    expect(getTerminalSnapshot().pendingMissingCell).toEqual(SAMPLE_PENDING);

    act(() => {
      result.current.clearState();
    });
    expect(getTerminalSnapshot().activeIndicatorValueId).toBeNull();
    expect(getTerminalSnapshot().pendingMissingCell).toBeNull();
  });
});
