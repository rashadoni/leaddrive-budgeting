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
}

export interface TerminalActions {
  setActivePanel: (id: number) => void;
  setCompany: (code: string) => void;
  setActiveIndicatorValue: (id: string | null) => void;
  setSearchForPanel: (panelId: number, query: string) => void;
  clearSearchForPanel: (panelId: number) => void;
  setAlertsCount: (count: number | null) => void;
  clearState: () => void;
}

export type TerminalStore = TerminalState & TerminalActions;

let globalState: TerminalState = {
  activeCompanyCode: null,
  activeScenarioCode: null,
  activePanelId: 1,
  activeIndicatorValueId: null,
  searchByPanel: {},
  alertsCount: null,
};

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
