// @vitest-environment happy-dom
/**
 * Phase B4 — store-side tests for watchlist tabs/starred/recent.
 *
 * Locks in:
 *   - `setWatchlistTab` writes the LS key.
 *   - `toggleStarredCompany` flips set + LS array in lockstep.
 *   - `setCompany` pushes to LRU recent stack (most-recent-first, dedupe, capped).
 *   - `setAlertedCompanyCodes` updates state without touching LS (it's
 *     published per-fetch by HeatMap, not user-preference).
 *   - `hydrateWatchlistFromStorage` reads all 3 keys + falls back to
 *     defaults when invalid/missing.
 *   - `clearState` preserves user-prefs (tab + starred) but resets
 *     session state (recent + alerted).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  getTerminalSnapshot,
  hydrateWatchlistFromStorage,
  RECENT_LIMIT,
  useTerminalStore,
} from './terminalStore';

const TAB_KEY = 'terminal-watchlist-tab-v1';
const STARRED_KEY = 'terminal-starred-companies-v1';
const RECENT_KEY = 'terminal-recent-companies-v1';

function useActions() {
  return useTerminalStore((s) => ({
    setWatchlistTab: s.setWatchlistTab,
    toggleStarredCompany: s.toggleStarredCompany,
    setCompany: s.setCompany,
    setAlertedCompanyCodes: s.setAlertedCompanyCodes,
    clearState: s.clearState,
  }));
}

beforeEach(() => {
  window.localStorage.removeItem(TAB_KEY);
  window.localStorage.removeItem(STARRED_KEY);
  window.localStorage.removeItem(RECENT_KEY);
  // Reset state via clearState (preserves user-prefs) + manual prefs reset
  const { result } = renderHook(() => useActions());
  act(() => {
    result.current.setWatchlistTab('all');
    result.current.clearState();
  });
  // Clear starred set by toggling each currently-starred code off
  const starred = Array.from(getTerminalSnapshot().starredCompanyCodes);
  if (starred.length > 0) {
    act(() => {
      starred.forEach((c) => result.current.toggleStarredCompany(c));
    });
  }
  // Final: clear LS again since toggle wrote it back
  window.localStorage.removeItem(STARRED_KEY);
});

describe('terminalStore watchlist (Phase B4)', () => {
  it('setWatchlistTab persists tab to LS + updates state', () => {
    const { result } = renderHook(() => useActions());
    act(() => {
      result.current.setWatchlistTab('starred');
    });
    expect(getTerminalSnapshot().watchlistTab).toBe('starred');
    expect(window.localStorage.getItem(TAB_KEY)).toBe('"starred"');
  });

  it('toggleStarredCompany adds + removes in lockstep with LS array', () => {
    const { result } = renderHook(() => useActions());
    act(() => {
      result.current.toggleStarredCompany('AAC-MAIN');
    });
    expect(getTerminalSnapshot().starredCompanyCodes.has('AAC-MAIN')).toBe(true);
    expect(window.localStorage.getItem(STARRED_KEY)).toBe('["AAC-MAIN"]');
    act(() => {
      result.current.toggleStarredCompany('ATL-DBZ');
    });
    expect(window.localStorage.getItem(STARRED_KEY)).toBe(
      '["AAC-MAIN","ATL-DBZ"]',
    );
    act(() => {
      result.current.toggleStarredCompany('AAC-MAIN');
    });
    expect(getTerminalSnapshot().starredCompanyCodes.has('AAC-MAIN')).toBe(false);
    expect(window.localStorage.getItem(STARRED_KEY)).toBe('["ATL-DBZ"]');
  });

  it('setCompany pushes to LRU recent (most-recent-first, dedupe, capped)', () => {
    const { result } = renderHook(() => useActions());
    act(() => {
      result.current.setCompany('A');
      result.current.setCompany('B');
      result.current.setCompany('C');
      result.current.setCompany('A'); // dedupe: A moves to front
    });
    expect(getTerminalSnapshot().recentCompanyCodes).toEqual(['A', 'C', 'B']);
    expect(window.localStorage.getItem(RECENT_KEY)).toBe('["A","C","B"]');
  });

  it(`recent stack capped at RECENT_LIMIT (${RECENT_LIMIT})`, () => {
    const { result } = renderHook(() => useActions());
    act(() => {
      for (let i = 0; i < RECENT_LIMIT + 5; i++) {
        result.current.setCompany(`C${i}`);
      }
    });
    const recent = getTerminalSnapshot().recentCompanyCodes;
    expect(recent.length).toBe(RECENT_LIMIT);
    // Most recent at front (C{LIMIT+4}); oldest dropped (C0..C4)
    expect(recent[0]).toBe(`C${RECENT_LIMIT + 4}`);
    expect(recent.includes('C0')).toBe(false);
  });

  it('setAlertedCompanyCodes updates state without touching LS (per-fetch, not user-pref)', () => {
    const { result } = renderHook(() => useActions());
    act(() => {
      result.current.setAlertedCompanyCodes(new Set(['AAC-MAIN', 'ATL-DBZ']));
    });
    expect(getTerminalSnapshot().alertedCompanyCodes?.size).toBe(2);
    // No LS write expected for alertedCompanyCodes
    expect(window.localStorage.getItem('terminal-alerted-companies-v1')).toBeNull();
  });

  it('hydrateWatchlistFromStorage reads tab + starred + recent', () => {
    window.localStorage.setItem(TAB_KEY, '"starred"');
    window.localStorage.setItem(STARRED_KEY, '["AAC-MAIN","ZTP-MAIN"]');
    window.localStorage.setItem(RECENT_KEY, '["X","Y","Z"]');
    act(() => {
      hydrateWatchlistFromStorage();
    });
    const snap = getTerminalSnapshot();
    expect(snap.watchlistTab).toBe('starred');
    expect(snap.starredCompanyCodes.has('AAC-MAIN')).toBe(true);
    expect(snap.starredCompanyCodes.has('ZTP-MAIN')).toBe(true);
    expect(snap.recentCompanyCodes).toEqual(['X', 'Y', 'Z']);
  });

  it('hydrate falls back to defaults when LS contains invalid JSON', () => {
    window.localStorage.setItem(TAB_KEY, 'not-json');
    window.localStorage.setItem(STARRED_KEY, '{"not":"array"}');
    window.localStorage.setItem(RECENT_KEY, 'broken');
    act(() => {
      hydrateWatchlistFromStorage();
    });
    const snap = getTerminalSnapshot();
    expect(snap.watchlistTab).toBe('all');
    expect(snap.starredCompanyCodes.size).toBe(0);
    expect(snap.recentCompanyCodes).toEqual([]);
  });

  it('hydrate caps recent at RECENT_LIMIT even if LS has more', () => {
    const tooMany = Array.from({ length: 25 }, (_, i) => `C${i}`);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(tooMany));
    act(() => {
      hydrateWatchlistFromStorage();
    });
    expect(getTerminalSnapshot().recentCompanyCodes.length).toBe(RECENT_LIMIT);
  });

  it('clearState preserves tab + starred (user-prefs); resets recent + alerted', () => {
    const { result } = renderHook(() => useActions());
    act(() => {
      result.current.setWatchlistTab('starred');
      result.current.toggleStarredCompany('AAC-MAIN');
      result.current.setCompany('R1');
      result.current.setAlertedCompanyCodes(new Set(['X']));
      result.current.clearState();
    });
    const snap = getTerminalSnapshot();
    // Preserved
    expect(snap.watchlistTab).toBe('starred');
    expect(snap.starredCompanyCodes.has('AAC-MAIN')).toBe(true);
    // Reset
    expect(snap.recentCompanyCodes).toEqual([]);
    expect(snap.alertedCompanyCodes).toBeNull();
  });
});
