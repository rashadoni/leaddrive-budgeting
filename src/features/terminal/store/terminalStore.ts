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
  /**
   * Phase B4 — CompanyTree watchlist filter. Drives which companies the
   * tree shows: 'all' (every operational), 'starred' (user pin-list),
   * 'alerted' (any red/amber cell on HeatMap), 'recent' (last 10 viewed).
   * Default 'all' on first session. Persisted to localStorage so the
   * tab choice survives reload — same UX contract as compactMode.
   */
  watchlistTab: WatchlistTab;
  /**
   * User-starred company codes (set semantics, JSON-serialized as array
   * to localStorage). Toggle via `toggleStarredCompany(code)`. Cross-
   * device sync via `UserCompanyPreferences` table is deferred (🔄 row).
   */
  starredCompanyCodes: ReadonlySet<string>;
  /**
   * LRU stack of recently-selected company codes, most recent first.
   * Capped at RECENT_LIMIT (10). Updated automatically by `selectCompany`
   * (user-driven path). `setCompany` (programmatic path) does NOT touch
   * recent — see action jsdoc for the split rationale. Survives reload
   * via localStorage; cleared by `clearState` on logout/org-switch.
   */
  recentCompanyCodes: readonly string[];
  /**
   * Set of company codes that have at least one non-green HeatMap cell
   * — published by HeatMap after matrix fetch resolves. Consumed by the
   * CompanyTree 'alerted' tab filter. `null` until first matrix lands.
   */
  alertedCompanyCodes: ReadonlySet<string> | null;
}

export type WatchlistTab = 'all' | 'starred' | 'alerted' | 'recent';
export const RECENT_LIMIT = 10;

export interface TerminalActions {
  setActivePanel: (id: number) => void;
  /**
   * Set the active company WITHOUT tracking it in the LRU recent stack.
   * Use for programmatic dispatch (e.g. URL hydration, scenario auto-
   * switch, future Compare-panel `lhs/rhs` toggling that shouldn't
   * pollute the user's recent list with every flip).
   */
  setCompany: (code: string) => void;
  /**
   * User-driven company selection — sets active AND pushes to recent.
   * Use from row clicks, CMP/CO command-bar verbs, RelatedFunctionsMenu,
   * any "user explicitly chose this company" path. Phase B4 split from
   * setCompany so programmatic callers don't pollute recent.
   */
  selectCompany: (code: string) => void;
  setActiveIndicatorValue: (id: string | null) => void;
  setSearchForPanel: (panelId: number, query: string) => void;
  clearSearchForPanel: (panelId: number) => void;
  setAlertsCount: (count: number | null) => void;
  setCompactMode: (mode: boolean) => void;
  toggleCompactMode: () => void;
  setWatchlistTab: (tab: WatchlistTab) => void;
  toggleStarredCompany: (code: string) => void;
  setAlertedCompanyCodes: (codes: ReadonlySet<string> | null) => void;
  clearState: () => void;
}

export type TerminalStore = TerminalState & TerminalActions;

const COMPACT_MODE_LS_KEY = 'terminal-compact-mode-v1';
const WATCHLIST_TAB_LS_KEY = 'terminal-watchlist-tab-v1';
const STARRED_LS_KEY = 'terminal-starred-companies-v1';
const RECENT_LS_KEY = 'terminal-recent-companies-v1';

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

function readJsonFromStorage<T>(key: string, fallback: T, validate: (v: unknown) => v is T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed = JSON.parse(raw);
    return validate(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function writeJsonToStorage(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // private-mode / quota — non-fatal.
  }
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function isWatchlistTab(v: unknown): v is WatchlistTab {
  return v === 'all' || v === 'starred' || v === 'alerted' || v === 'recent';
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
  // Phase B4 — watchlist defaults; same SSR-then-hydrate pattern as
  // compactMode. PanelGrid's mounted-effect calls hydrateWatchlistFromStorage().
  watchlistTab: 'all',
  starredCompanyCodes: new Set(),
  recentCompanyCodes: [],
  alertedCompanyCodes: null,
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

/**
 * Hydrate watchlist state (tab + starred + recent) from localStorage on
 * first client mount. Called alongside hydrateCompactModeFromStorage by
 * PanelGrid's mounted-effect. Idempotent.
 */
export function hydrateWatchlistFromStorage(): void {
  const tab = readJsonFromStorage<WatchlistTab>(
    WATCHLIST_TAB_LS_KEY,
    'all',
    isWatchlistTab,
  );
  const starredArr = readJsonFromStorage<string[]>(
    STARRED_LS_KEY,
    [],
    isStringArray,
  );
  const recentArr = readJsonFromStorage<string[]>(
    RECENT_LS_KEY,
    [],
    isStringArray,
  );
  setGlobalState({
    watchlistTab: tab,
    starredCompanyCodes: new Set(starredArr),
    recentCompanyCodes: recentArr.slice(0, RECENT_LIMIT),
  });
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
  setCompany: (code) => {
    // No-track variant — sets active without LRU side-effect. Use for
    // programmatic dispatch (URL hydration, panel-switch hooks, future
    // Compare-panel lhs/rhs toggling).
    setGlobalState({ activeCompanyCode: code });
  },
  selectCompany: (code) => {
    // User-driven variant — sets active AND pushes to LRU recent stack
    // (most-recent-first, dedupe, capped at RECENT_LIMIT).
    const prev = globalState.recentCompanyCodes;
    const filtered = prev.filter((c) => c !== code);
    const next = [code, ...filtered].slice(0, RECENT_LIMIT);
    setGlobalState({ activeCompanyCode: code, recentCompanyCodes: next });
    writeJsonToStorage(RECENT_LS_KEY, next);
  },
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
  setWatchlistTab: (tab) => {
    setGlobalState({ watchlistTab: tab });
    writeJsonToStorage(WATCHLIST_TAB_LS_KEY, tab);
  },
  toggleStarredCompany: (code) => {
    const next = new Set(globalState.starredCompanyCodes);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    setGlobalState({ starredCompanyCodes: next });
    writeJsonToStorage(STARRED_LS_KEY, Array.from(next));
  },
  setAlertedCompanyCodes: (codes) =>
    setGlobalState({ alertedCompanyCodes: codes }),
  setCompactMode: (mode) => {
    setGlobalState({ compactMode: mode });
    writeCompactModeToStorage(mode);
  },
  toggleCompactMode: () => {
    const next = !globalState.compactMode;
    setGlobalState({ compactMode: next });
    writeCompactModeToStorage(next);
  },
  // `compactMode` + watchlist preferences (tab/starred) deliberately NOT
  // reset by clearState — they're user-preferences, not session state;
  // survive logout / org-switch. `recentCompanyCodes` IS reset because
  // the LRU is per-org (a code from azmade is meaningless in a new org)
  // — we ALSO clear the LS key (architect Round-1 ⚠️ closure: prior
  // implementation reset memory but left LS, so reload re-hydrated the
  // stale recent list). `alertedCompanyCodes` IS reset (per-fetch).
  clearState: () => {
    setGlobalState({
      activeCompanyCode: null,
      activeScenarioCode: null,
      activePanelId: 1,
      activeIndicatorValueId: null,
      searchByPanel: {},
      alertsCount: null,
      recentCompanyCodes: [],
      alertedCompanyCodes: null,
    });
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(RECENT_LS_KEY);
      } catch {
        // private-mode / quota — non-fatal.
      }
    }
  },
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
