import { useState, useEffect } from 'react';

// Typed reactive global state — a hand-rolled Zustand stand-in while
// `zustand` stays out of the bundle. Selectors pick a slice; components
// re-render on state change. Replace with real zustand in Phase 7.D
// polish pass.

export interface TerminalState {
  /** Selected company across panels (HeatMap row highlight, CompanyTree active row). */
  activeCompanyCode: string | null;
  /** Selected scenario for SCN runner (Panel 4). */
  activeScenarioCode: string | null;
  /** Active panel — drives the cyan ring + which panel `/`-search focuses. */
  activePanelId: number;
  /**
   * Indicator-value id for Panel 3 (drill-down). Set when the user clicks
   * a HeatMap cell; null = "no cell selected, show empty-state instructions".
   */
  activeIndicatorValueId: string | null;
  /**
   * Filter strings per panel. Panel 1 filters CompanyTree by code/name;
   * Panel 2 filters HeatMap rows by company code. Driven by `/`-search
   * focus + per-panel input.
   */
  searchByPanel: Partial<Record<number, string>>;
  /**
   * Live count of red+amber HeatMap cells — published by HeatMap after
   * matrix fetch resolves; consumed by CommandBar's `[alerts 🔔 N]` strip.
   * `null` until first matrix fetch lands (CommandBar shows `—`).
   */
  alertsCount: number | null;
  /**
   * Compact-mode toggle (Phase A5) — when true, dense surfaces (HeatMap
   * cells, AuditTicker font) shrink ~30-40% so power users can fit more
   * data on screen without resizing panels. Persisted to localStorage so
   * the choice survives reload. Toggle via `Ctrl+/` (or `Cmd+/` on Mac)
   * or `setCompactMode(true|false)` programmatically.
   */
  compactMode: boolean;
}

export interface TerminalActions {
  setActivePanel: (id: number) => void;
  setCompany: (code: string) => void;
  setActiveIndicatorValue: (id: string | null) => void;
  setSearchForPanel: (panelId: number, query: string) => void;
  clearSearchForPanel: (panelId: number) => void;
  setAlertsCount: (count: number | null) => void;
  setCompactMode: (mode: boolean) => void;
  toggleCompactMode: () => void;
  clearState: () => void;
}

export type TerminalStore = TerminalState & TerminalActions;

const COMPACT_MODE_LS_KEY = 'terminal-compact-mode-v1';

function readCompactModeFromStorage(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(COMPACT_MODE_LS_KEY) === '1';
  } catch {
    return false;
  }
}

function writeCompactModeToStorage(mode: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(COMPACT_MODE_LS_KEY, mode ? '1' : '0');
  } catch {
    // localStorage can throw in private mode / quota — non-fatal.
  }
}

let globalState: TerminalState = {
  activeCompanyCode: null,
  activeScenarioCode: null,
  activePanelId: 1,
  activeIndicatorValueId: null,
  searchByPanel: {},
  alertsCount: null,
  // SSR renders with `false`; mounted-effect hook in PanelGrid hydrates
  // from localStorage on first client paint to avoid mismatch.
  compactMode: false,
};

/**
 * Hydrate `compactMode` from localStorage on first client mount. Called
 * by PanelGrid's mounted-effect; safe to call repeatedly (idempotent).
 */
export function hydrateCompactModeFromStorage(): void {
  const stored = readCompactModeFromStorage();
  if (stored !== globalState.compactMode) {
    setGlobalState({ compactMode: stored });
  }
}

let listeners: Array<React.Dispatch<React.SetStateAction<TerminalState>>> = [];

const setGlobalState = (patch: Partial<TerminalState>): void => {
  globalState = { ...globalState, ...patch };
  listeners.forEach((l) => l(globalState));
};

// Module-level singleton actions — stable references across renders so
// consumers can safely use these in `useEffect` / `useCallback` dep arrays
// without triggering loops.
const actions: TerminalActions = {
  setActivePanel: (id) => setGlobalState({ activePanelId: id }),
  setCompany: (code) => setGlobalState({ activeCompanyCode: code }),
  setActiveIndicatorValue: (id) => setGlobalState({ activeIndicatorValueId: id }),
  setSearchForPanel: (panelId, query) =>
    setGlobalState({
      searchByPanel: { ...globalState.searchByPanel, [panelId]: query },
    }),
  clearSearchForPanel: (panelId) => {
    const next = { ...globalState.searchByPanel };
    delete next[panelId];
    setGlobalState({ searchByPanel: next });
  },
  setAlertsCount: (count) => setGlobalState({ alertsCount: count }),
  setCompactMode: (mode) => {
    setGlobalState({ compactMode: mode });
    writeCompactModeToStorage(mode);
  },
  toggleCompactMode: () => {
    const next = !globalState.compactMode;
    setGlobalState({ compactMode: next });
    writeCompactModeToStorage(next);
  },
  // `compactMode` deliberately NOT reset by clearState — user-preference,
  // not session state; should survive logout / org-switch.
  clearState: () =>
    setGlobalState({
      activeCompanyCode: null,
      activeScenarioCode: null,
      activePanelId: 1,
      activeIndicatorValueId: null,
      searchByPanel: {},
      alertsCount: null,
    }),
};

/**
 * Synchronous snapshot getter — for non-React code (event handlers,
 * keyboard shortcuts) that needs the live state without subscribing.
 * Returns a frozen view; mutate via the action functions on the store.
 */
export function getTerminalSnapshot(): TerminalState {
  return globalState;
}

export function useTerminalStore<T>(selector: (store: TerminalStore) => T): T {
  const [state, setState] = useState<TerminalState>(globalState);

  useEffect(() => {
    listeners.push(setState);
    return () => {
      listeners = listeners.filter((l) => l !== setState);
    };
  }, []);

  // `state` is the only value that changes between renders; actions come
  // from the module-level singleton so their references are stable.
  return selector({ ...state, ...actions });
}
