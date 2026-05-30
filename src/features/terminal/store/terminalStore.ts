import { useState, useEffect } from 'react';
import type { AlertMatch } from '@/lib/risk/alert-rules';

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
   * a HeatMap cell that HAS a computed IndicatorValue row. null = "no
   * cell selected" OR "clicked a missing cell" — the latter case is
   * disambiguated by `pendingMissingCell` below.
   */
  activeIndicatorValueId: string | null;
  /**
   * Phase 7.D regression closure (architect Round-1 on cell-click test) —
   * when user clicks a HeatMap cell with NO computed IndicatorValue
   * (status='missing', often happens on never-onboarded indicators), the
   * old contract silently no-op'd Panel 3. User reported this twice as
   * "клики не работают". New contract: Panel 3 still opens, but renders
   * a "no data — onboard or recompute" hint with the company + indicator
   * codes the user clicked, so the click is never silently swallowed.
   * `null` when activeIndicatorValueId is set OR no cell clicked yet.
   * Set + activeIndicatorValueId are mutually exclusive — clicking a
   * computed cell clears pendingMissingCell, clicking a missing cell
   * clears activeIndicatorValueId.
   */
  pendingMissingCell: {
    companyId: string;
    companyCode: string;
    indicatorId: string;
    indicatorCode: string;
    indicatorName: string;
  } | null;
  /**
   * Phase 7.G Turn VI — Panel 3 sub-group rollup hint. Set when the user
   * clicks a synthetic-rollup HeatMap cell (parent sub-group row × indicator,
   * `kind === 'synthetic-rollup'`, `indicatorValueId === null`). Without this
   * branch, the click previously routed to `pendingMissingCell` → the panel
   * said "no computed value yet" even though the cell was clearly lit.
   * Mutually exclusive with `activeIndicatorValueId` and `pendingMissingCell`
   * — setters MUST clear the other two on assignment.
   *
   * `value` + `status` are the synthetic aggregate emitted by the matrix
   * endpoint (avg + worst-of-children). `contributingChildCount` flows from
   * the same payload — drives the "averaged from N children" copy.
   * `unit` from the indicator definition is required so the rendered value
   * carries its unit ("%", "days", etc.) without a redundant fetch.
   */
  pendingRollupCell: {
    companyId: string;
    companyCode: string;
    indicatorId: string;
    indicatorCode: string;
    indicatorName: string;
    indicatorUnit: string | null;
    value: number;
    status: 'green' | 'amber' | 'red' | 'unknown';
    contributingChildCount: number;
  } | null;
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
  /**
   * Phase C6 v2 — full alert matches list (ordered critical→warning→info,
   * priority within severity, alphabetic tiebreak). Published by HeatMap
   * after running `evaluateAlertRules(DEFAULT_ALERT_RULES, ctx)` on the
   * matrix; consumed by `<AlertsPanel/>` modal that opens on
   * `terminal:open-alerts` event (CommandBar `[alerts]` strip click).
   * `null` until first matrix lands; empty array = no alerts triggered.
   */
  alertMatches: readonly AlertMatch[] | null;
  /**
   * Phase 7.N — active scenario simulation overlay.
   * `scenarioDelta` maps `"${companyId}:${indicatorCode}"` → scenario status.
   * Only changed cells are in the map. HeatMap renders delta color when key present.
   * `null` = no scenario active (baseline mode).
   */
  scenarioDelta: ReadonlyMap<string, string> | null;
  /** Name shown in HeatMap scenario badge. */
  activeScenarioLabel: string | null;
  /**
   * Phase 1 "Crisis Brief" (B2 drivers mode) — the rich payload behind a
   * driver-re-derivation run: the holding score swing, per-company composite
   * swings, the grounded AI narrative + mitigations, and the worst-first
   * cascade order. `null` outside drivers mode. Cleared with `scenarioDelta`
   * on revert.
   */
  scenarioBrief: ScenarioBriefState | null;
}

/** Phase 1 "Crisis Brief" — driver-mode scenario result for the panel. */
export interface ScenarioBriefState {
  scenarioCode: string;
  holdingBaselineScore: number | null;
  holdingScenarioScore: number | null;
  /** Financial-stress sub-composite swing (P&L indicators only) — moves harder
   *  than the full composite under a financial shock. */
  financialHoldingBaselineScore: number | null;
  financialHoldingScenarioScore: number | null;
  byCompany: Array<{
    companyId: string;
    companyCode: string;
    baselineScore: number | null;
    scenarioScore: number | null;
  }>;
  narrative: string | null;
  mitigations: string[];
  /** Ordered "companyId:code" keys, worst-first, for the staggered cascade. */
  cascadeOrder: string[];
  /** Phase 2 — live-feed "current → scenario" anchors (FX/commodity levels). */
  feedAnchors: Array<{
    label: string;
    currentValue: number;
    scenarioValue: number;
    unit: string;
    asOf: string;
    stale: boolean;
  }>;
}

export type WatchlistTab = 'all' | 'starred' | 'alerted' | 'recent' | 'sector';
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
  /**
   * Phase 7.I — clear the active company → HeatMap renders ALL companies
   * again. Bound to the "ALL" synthetic row at the top of CompanyTree.
   * Does NOT touch the LRU recent stack (only user-driven row clicks do).
   */
  clearCompany: () => void;
  setActiveIndicatorValue: (id: string | null) => void;
  /**
   * Phase 7.D regression closure — set the Panel 3 no-data hint when user
   * clicks a missing HeatMap cell. Implementation MUST clear
   * activeIndicatorValueId (mutual-exclusion invariant). Pass null to
   * clear the pending state (e.g. when user clicks a computed cell).
   */
  setPendingMissingCell: (
    pending: TerminalState['pendingMissingCell'],
  ) => void;
  /**
   * Phase 7.G Turn VI — set the Panel 3 sub-group rollup hint. MUST clear
   * activeIndicatorValueId AND pendingMissingCell to preserve the mutual-
   * exclusion invariant. Pass null to clear (e.g. when user clicks a
   * computed cell on a level=2 op-co).
   */
  setPendingRollupCell: (
    pending: TerminalState['pendingRollupCell'],
  ) => void;
  /**
   * Phase C4 v1 — pin the user's chosen scenario for the runner. Set by
   * `SCN <code> GO` dispatch in CommandBar; consumed by `<ScenarioPanel/>`
   * to pre-select the matching row when the modal opens.
   */
  setActiveScenarioCode: (code: string | null) => void;
  setSearchForPanel: (panelId: number, query: string) => void;
  clearSearchForPanel: (panelId: number) => void;
  setAlertsCount: (count: number | null) => void;
  setCompactMode: (mode: boolean) => void;
  toggleCompactMode: () => void;
  setWatchlistTab: (tab: WatchlistTab) => void;
  toggleStarredCompany: (code: string) => void;
  setAlertedCompanyCodes: (codes: ReadonlySet<string> | null) => void;
  setAlertMatches: (matches: readonly AlertMatch[] | null) => void;
  /** Phase 7.N — apply scenario delta overlay to HeatMap. */
  setScenarioDelta: (delta: ReadonlyMap<string, string> | null, label: string | null) => void;
  /** Phase 7.N — clear scenario overlay (return to baseline). Also clears the
   *  Phase-1 driver-mode `scenarioBrief` — revert is one gesture. */
  clearScenarioDelta: () => void;
  /** Phase 1 "Crisis Brief" — set the driver-mode result payload. */
  setScenarioBrief: (brief: ScenarioBriefState | null) => void;
  /** Phase 1 "Crisis Brief" — clear just the brief (keeps any overlay). */
  clearScenarioBrief: () => void;
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
  return (
    v === 'all' ||
    v === 'starred' ||
    v === 'alerted' ||
    v === 'recent' ||
    v === 'sector'
  );
}

let globalState: TerminalState = {
  activeCompanyCode: null,
  activeScenarioCode: null,
  activePanelId: 1,
  activeIndicatorValueId: null,
  pendingMissingCell: null,
  pendingRollupCell: null,
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
  alertMatches: null,
  scenarioDelta: null,
  activeScenarioLabel: null,
  scenarioBrief: null,
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
    //
    // Phase 7.L 2026-05-18 — when switching companies, also clear any
    // stale `activeIndicatorValueId` so Panel 3 doesn't keep showing
    // the previous company's IV detail. Pending hints cleared too
    // (mirror setActiveIndicatorValue mutual-exclusion invariant).
    setGlobalState({
      activeCompanyCode: code,
      activeIndicatorValueId: null,
      pendingMissingCell: null,
      pendingRollupCell: null,
    });
  },
  selectCompany: (code) => {
    // User-driven variant — sets active AND pushes to LRU recent stack
    // (most-recent-first, dedupe, capped at RECENT_LIMIT).
    //
    // Phase 7.L 2026-05-18 — same Panel-3-reset invariant as setCompany
    // (user clicked a different row in CompanyTree; current IV detail
    // is stale by definition).
    const prev = globalState.recentCompanyCodes;
    const filtered = prev.filter((c) => c !== code);
    const next = [code, ...filtered].slice(0, RECENT_LIMIT);
    setGlobalState({
      activeCompanyCode: code,
      recentCompanyCodes: next,
      activeIndicatorValueId: null,
      pendingMissingCell: null,
      pendingRollupCell: null,
    });
    writeJsonToStorage(RECENT_LS_KEY, next);
  },
  clearCompany: () => {
    // Phase 7.I — clear active company (ALL mode). No LRU side-effect.
    // Phase 7.L 2026-05-18 — also clears Panel 3 state for the same
    // reason as setCompany / selectCompany above.
    setGlobalState({
      activeCompanyCode: null,
      activeIndicatorValueId: null,
      pendingMissingCell: null,
      pendingRollupCell: null,
    });
  },
  setActiveIndicatorValue: (id) =>
    // Mutual-exclusion invariant (Turn VI extends): setting an active IV
    // clears BOTH pending hints (missing + rollup). Panel 3 reads the
    // three states in priority order; keeping any pending hint alive
    // while activeIv is set would leak stale copy across panel paths.
    setGlobalState({
      activeIndicatorValueId: id,
      pendingMissingCell: null,
      pendingRollupCell: null,
    }),
  setPendingMissingCell: (pending) =>
    // Symmetric to setActiveIndicatorValue — setting a pending hint
    // clears any active IV. Use null to clear pending without touching
    // activeIv (e.g. dismiss button on the no-data hint).
    setGlobalState({
      pendingMissingCell: pending,
      activeIndicatorValueId: pending ? null : globalState.activeIndicatorValueId,
      pendingRollupCell: pending ? null : globalState.pendingRollupCell,
    }),
  setPendingRollupCell: (pending) =>
    // Phase 7.G Turn VI — symmetric to the missing-cell hint. Setting
    // a rollup hint clears the active IV + any missing-cell hint;
    // passing null clears the rollup hint alone.
    setGlobalState({
      pendingRollupCell: pending,
      activeIndicatorValueId: pending ? null : globalState.activeIndicatorValueId,
      pendingMissingCell: pending ? null : globalState.pendingMissingCell,
    }),
  setActiveScenarioCode: (code) => setGlobalState({ activeScenarioCode: code }),
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
  setAlertMatches: (matches) => setGlobalState({ alertMatches: matches }),
  setScenarioDelta: (delta, label) =>
    setGlobalState({ scenarioDelta: delta, activeScenarioLabel: label }),
  clearScenarioDelta: () =>
    setGlobalState({ scenarioDelta: null, activeScenarioLabel: null, scenarioBrief: null }),
  setScenarioBrief: (brief) => setGlobalState({ scenarioBrief: brief }),
  clearScenarioBrief: () => setGlobalState({ scenarioBrief: null }),
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
      pendingMissingCell: null,
      pendingRollupCell: null,
      searchByPanel: {},
      alertsCount: null,
      recentCompanyCodes: [],
      alertedCompanyCodes: null,
      alertMatches: null,
      scenarioDelta: null,
      activeScenarioLabel: null,
      scenarioBrief: null,
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
