"use client";

import React, { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useCompanies } from '../hooks/use-companies';
import { getLogger } from '@/lib/log';

// Phase 8 D4 continuation (2026-05-28) — structured logger.
const panelLog = getLogger('terminal:panel-grid');
import {
  Group,
  Panel,
  Separator,
  useGroupRef,
  type Layout,
  type GroupImperativeHandle,
} from 'react-resizable-panels';
import {
  getTerminalSnapshot,
  hydrateCompactModeFromStorage,
  hydrateWatchlistFromStorage,
  useTerminalStore,
} from '../store/terminalStore';
import { CompanyTree, type CompanyNode } from './CompanyTree';
import { HeatMap } from './HeatMap';
import { IndicatorDetail } from './IndicatorDetail';
import {
  VarianceExplainerPanel,
  type VarianceExplainerHandle,
} from './VarianceExplainerPanel';
import { LayoutMenu } from './LayoutMenu';
import { AuditTicker } from './AuditTicker';
import { MarketTicker } from './MarketTicker';
import { WelcomeHint } from './WelcomeHint';
import {
  DEFAULT_LAYOUT_SIZES,
  PANEL_IDS,
  type LayoutSizes,
} from '../lib/layout-sizes';
import { focusTerminalSearch } from '../lib/focus-terminal-search';

type PanelId = 1 | 2 | 3 | 4;
// Sub-27 cont'd Round-5 architect closure: prior `PANEL_TITLES` const
// (English-only) was made dead-code by the i18n wave-2 wiring of
// `PANEL_TITLES_T` inside PanelGrid which reads `t('panels.<id>')`. Removed.

/** localStorage key for `useDefaultLayout` autosave. Bumping this on a
 *  panel-structure change forces every user back to defaults rather
 *  than rendering a half-broken saved layout. */
const STORAGE_KEY_OUTER = 'terminal-layout-v1-outer';
const STORAGE_KEY_TOP = 'terminal-layout-v1-top';
const STORAGE_KEY_BOTTOM = 'terminal-layout-v1-bottom';

/**
 * True if the event target is some sort of text-entry surface where
 * typing-style keystrokes should NOT be hijacked. Module-scope so the
 * keyboard effect doesn't redefine it on every render.
 */
function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

/**
 * Switch active panel via F-key / Cmd+number. If the focused element is
 * the **command bar input specifically** (marked with `data-cmd-bar`),
 * blur it first so a subsequent `/` keystroke doesn't get captured by
 * the still-focused command bar.
 *
 * Scope is intentionally narrow: panel-internal inputs (search boxes,
 * LayoutMenu name field) keep their focus on F-key panel jumps, so a
 * user mid-typing doesn't lose their place when peeking at another pane.
 * Only the top-level command bar — which is global and keyboard-shortcut-
 * driven — gets blurred.
 */
function switchPanel(id: number, setActive: (id: number) => void): void {
  const active = document.activeElement;
  if (
    active instanceof HTMLElement &&
    active.matches('[data-cmd-bar]')
  ) {
    active.blur();
  }
  setActive(id);
}

/**
 * Persist last-used layout to localStorage on resize. The named-layout
 * UI (LayoutMenu) layers explicit save/load on top of this — autosave
 * is the "remember last session" baseline.
 */
function makeOnLayoutChanged(storageKey: string) {
  return (layout: Layout) => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(layout));
    } catch {
      // localStorage can throw in private mode / quota — non-fatal.
    }
  };
}

function readSavedLayout(storageKey: string): Layout | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as Layout;
    return undefined;
  } catch {
    return undefined;
  }
}

export function ExpertWorkspace() {
  const t = useTranslations('terminal');
  const activePanelId = useTerminalStore((s) => s.activePanelId);
  const setActivePanel = useTerminalStore((s) => s.setActivePanel);
  const PANEL_LABEL = t('panelGrid.panel');
  const PANEL_TITLES_T: Record<PanelId, string> = {
    1: t('panels.companyTree'),
    2: t('panels.heatMap'),
    3: t('panels.indicatorDetail'),
    4: t('panels.snapshot'),
  };

  // Sub-19: shared `useCompanies()` hook replaces inline fetch +
  // useState. Module-level cache means PanelGrid + RelatedFunctionsMenu
  // + AlertsPanel all subscribe to ONE in-flight request on session
  // start instead of N races. CompanyNode type is now an alias for the
  // hook's CompanyTreeNode (canonical), so no cast needed — null fallback
  // converts via `?? []` to a typed empty array.
  const { companies: companiesFromHook, loading } = useCompanies();
  // Hook returns ReadonlyArray; CompanyTree's prop is mutable array
  // (legacy). Spread to a fresh mutable array — cheap O(N) copy at v1
  // (13 cos), still trivial at Phase F.
  const companies: CompanyNode[] = companiesFromHook ? [...companiesFromHook] : [];

  // Imperative refs to each Group — LayoutMenu uses these to read
  // current sizes (Save) + push restored sizes (Load) without forcing a
  // remount of the panel tree.
  const outerRef = useGroupRef();
  const topRef = useGroupRef();
  const bottomRef = useGroupRef();
  const explainerRef = React.useRef<VarianceExplainerHandle>(null);

  // Phase 7.D hydration fix (Turn 12 follow-up): `react-resizable-panels`
  // v4 Panel+Group components inject `minHeight: 0; maxHeight: 100%`
  // computed styles ONLY on the client (after the container is measured),
  // while SSR renders just `height: auto`. The mismatch produced the
  // hydration error visible in the user's browser. Earlier "fix" via
  // `launchctl kickstart` masked the symptom (kickstart cleared module
  // cache so SSR + CSR happened to match for a window); structural fix
  // is to gate the entire grid on `mounted`. Pre-mount we render an
  // empty container of identical dimensions so the page reserves space
  // without producing a mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    // Hydrate compactMode + watchlist (tab/starred/recent) from
    // localStorage on first client paint — SSR renders with defaults
    // and we flip post-mount to avoid hydration mismatch (same pattern
    // as the saved-layout `defaults` lazy-init).
    hydrateCompactModeFromStorage();
    hydrateWatchlistFromStorage();
  }, []);
  const toggleCompactMode = useTerminalStore((s) => s.toggleCompactMode);

  // Snapshot saved layout once on mount so SSR/CSR pass the same value.
  // Subsequent resizes flow through `onLayoutChanged` → localStorage.
  // The lazy-init reads localStorage on first client render only — fine
  // because the entire grid is gated on `mounted` (post-effect, so
  // localStorage is available).
  const [defaults] = useState(() => ({
    outer:
      readSavedLayout(STORAGE_KEY_OUTER) ?? DEFAULT_LAYOUT_SIZES.outer,
    top: readSavedLayout(STORAGE_KEY_TOP) ?? DEFAULT_LAYOUT_SIZES.top,
    bottom:
      readSavedLayout(STORAGE_KEY_BOTTOM) ?? DEFAULT_LAYOUT_SIZES.bottom,
  }));

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && ['1', '2', '3', '4'].includes(e.key)) {
        e.preventDefault();
        switchPanel(parseInt(e.key, 10), setActivePanel);
        return;
      }
      // Phase A5: Ctrl+/ (or Cmd+/) toggles compact mode globally.
      // `/` alone focuses panel search — we hijack only when modifier is
      // held and the target is NOT a text-entry surface (so users typing
      // a `/` in CompanyTree/HeatMap search inputs aren't disturbed).
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key === '/' &&
        !isTypingTarget(e.target)
      ) {
        e.preventDefault();
        toggleCompactMode();
        return;
      }
      if (!e.ctrlKey && !e.metaKey && !e.altKey && /^F[1-4]$/.test(e.key)) {
        e.preventDefault();
        switchPanel(parseInt(e.key.slice(1), 10), setActivePanel);
        return;
      }
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (isTypingTarget(e.target)) return;
        e.preventDefault();
        focusTerminalSearch(getTerminalSnapshot().activePanelId);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setActivePanel, toggleCompactMode]);

  const readSizesFromGroups = (): LayoutSizes => ({
    outer: outerRef.current?.getLayout() ?? DEFAULT_LAYOUT_SIZES.outer,
    top: topRef.current?.getLayout() ?? DEFAULT_LAYOUT_SIZES.top,
    bottom: bottomRef.current?.getLayout() ?? DEFAULT_LAYOUT_SIZES.bottom,
  });

  const applySizesToGroups = (sizes: LayoutSizes) => {
    // `setLayout` clamps to per-Panel `minSize`. The Group's
    // `onLayoutChanged` fires AFTER the clamp with the actual rendered
    // values — letting it own localStorage avoids a race where the
    // pre-clamp values would otherwise overwrite the post-clamp ones.
    applyLayoutSafe(outerRef.current, sizes.outer);
    applyLayoutSafe(topRef.current, sizes.top);
    applyLayoutSafe(bottomRef.current, sizes.bottom);
  };

  // Pre-mount placeholder — same wrapper dimensions, no resizable-panels
  // children. SSR renders this; first client paint also renders this;
  // the mounted-effect flips us into the real grid on the next paint.
  if (!mounted) {
    return <div className="flex-1 bg-gray-800 relative" aria-hidden="true" />;
  }

  return (
    <div
      data-testid="terminal-expert-workspace"
      className="flex-1 bg-gray-800 relative flex flex-col"
    >
      {/* Round-7 M2 — first-run welcome hint. Renders only on first
          terminal visit (localStorage-flagged). Locale-aware copy via
          next-intl. Auto-dismiss 12s OR explicit close. */}
      <WelcomeHint />
      {/* Phase A3 (Bloomberg uplift plan) — Group wrapped in flex-1 + min-h-0
          so AuditTicker can claim a fixed bottom strip without breaking the
          resizable-panels height calculation. */}
      <div className="flex-1 min-h-0">
      <Group
        groupRef={outerRef}
        orientation="vertical"
        defaultLayout={defaults.outer}
        onLayoutChanged={makeOnLayoutChanged(STORAGE_KEY_OUTER)}
        className="h-full"
      >
        <Panel id={PANEL_IDS.outerTop} defaultSize={55} minSize={20}>
          <Group
            groupRef={topRef}
            orientation="horizontal"
            defaultLayout={defaults.top}
            onLayoutChanged={makeOnLayoutChanged(STORAGE_KEY_TOP)}
          >
            <Panel id={PANEL_IDS.panel1} defaultSize={35} minSize={15}>
              <PanelShell
                id={1}
                isActive={activePanelId === 1}
                onActivate={setActivePanel}
                panelLabel={`${PANEL_LABEL} 1`}
                panelTitle={PANEL_TITLES_T[1]}
                panelKind="tree"
              >
                <CompanyTree companies={companies} loading={loading} />
              </PanelShell>
            </Panel>
            <Separator className="w-[6px] bg-gray-800 hover:bg-[#00D4AA]/50 active:bg-[#00D4AA]/70 transition-colors cursor-col-resize" />
            <Panel id={PANEL_IDS.panel2} defaultSize={65} minSize={20}>
              <PanelShell
                id={2}
                isActive={activePanelId === 2}
                onActivate={setActivePanel}
                panelLabel={`${PANEL_LABEL} 2`}
                panelTitle={PANEL_TITLES_T[2]}
                panelKind="matrix"
                headerExtra={
                  <>
                    <CompactModeToggle inline />
                    <LayoutMenu
                      readCurrent={readSizesFromGroups}
                      applyLayout={applySizesToGroups}
                      inline
                    />
                  </>
                }
              >
                <HeatMap />
              </PanelShell>
            </Panel>
          </Group>
        </Panel>
        <Separator className="h-[6px] bg-gray-800 hover:bg-[#00D4AA]/50 active:bg-[#00D4AA]/70 transition-colors cursor-row-resize" />
        <Panel id={PANEL_IDS.outerBottom} defaultSize={45} minSize={20}>
          <Group
            groupRef={bottomRef}
            orientation="horizontal"
            defaultLayout={defaults.bottom}
            onLayoutChanged={makeOnLayoutChanged(STORAGE_KEY_BOTTOM)}
          >
            <Panel id={PANEL_IDS.panel3} defaultSize={50} minSize={15}>
              <PanelShell
                id={3}
                isActive={activePanelId === 3}
                onActivate={setActivePanel}
                panelLabel={`${PANEL_LABEL} 3`}
                panelTitle={PANEL_TITLES_T[3]}
                panelKind="detail"
              >
                <IndicatorDetail
                  onExplain={(id) =>
                    explainerRef.current?.runFromExplicitAction(id)
                  }
                />
              </PanelShell>
            </Panel>
            <Separator className="w-[6px] bg-gray-800 hover:bg-[#00D4AA]/50 active:bg-[#00D4AA]/70 transition-colors cursor-col-resize" />
            <Panel id={PANEL_IDS.panel4} defaultSize={50} minSize={15}>
              <PanelShell
                id={4}
                isActive={activePanelId === 4}
                onActivate={setActivePanel}
                panelLabel={`${PANEL_LABEL} 4`}
                panelTitle={PANEL_TITLES_T[4]}
                panelKind="variance"
              >
                <VarianceExplainerPanel ref={explainerRef} />
              </PanelShell>
            </Panel>
          </Group>
        </Panel>
      </Group>
      </div>
      <MarketTicker />
      <AuditTicker />
    </div>
  );
}

/**
 * Backward-compatible export for callers and tests that still use the legacy
 * component name. The route uses ExpertWorkspace explicitly.
 */
export const PanelGrid = ExpertWorkspace;

/**
 * Phase A5 — top-right toggle button for compact mode. Sits to the LEFT
 * of the Layouts button (LayoutMenu owns top-2 right-2; we sit at right-24
 * so the two never overlap). Keyboard shortcut Ctrl+/ does the same thing
 * via PanelGrid's keydown effect — this button just makes the affordance
 * discoverable to users who didn't read the help.
 */
function CompactModeToggle({ inline = false }: { inline?: boolean }) {
  const t = useTranslations('terminal');
  const compactMode = useTerminalStore((s) => s.compactMode);
  const toggle = useTerminalStore((s) => s.toggleCompactMode);
  const button = (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        toggle();
      }}
      className={`px-2 py-0.5 rounded border bg-[#0A0E27] hover:text-white hover:border-[#00D4AA]/60 ${
        compactMode
          ? 'border-[#00D4AA]/60 text-[#00D4AA]'
          : 'border-gray-800 text-gray-400'
      }`}
      title={
        compactMode
          ? t('panelGrid.compactOnTitle')
          : t('panelGrid.compactOffTitle')
      }
      aria-pressed={compactMode}
      data-testid="terminal-toolbar-compact-toggle"
    >
      ▦ {compactMode ? t('panelGrid.compactOnLabel') : t('panelGrid.compactOffLabel')}
    </button>
  );
  if (inline) return <span className="font-mono text-[10px]">{button}</span>;
  // Legacy floating-absolute mode — left for callers outside the
  // Panel 2 toolbar refactor (Phase 7.K 2026-05-18). Not used today.
  return (
    <div className="absolute top-2 right-24 z-30 font-mono text-[10px]">
      {button}
    </div>
  );
}

function applyLayoutSafe(
  ref: GroupImperativeHandle | null,
  layout: Layout,
): void {
  if (!ref) return;
  try {
    ref.setLayout(layout);
  } catch (err) {
    panelLog.warn('setLayout rejected', {
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

function PanelShell(props: {
  id: PanelId;
  isActive: boolean;
  onActivate: (id: number) => void;
  panelLabel: string;
  panelTitle: string;
  /** Phase 7.H Bloomberg-multi-window — kind id used to construct
   *  the pop-out URL `/budgeting/terminal/panel/<kind>`. */
  panelKind: string;
  /** Optional inline header content rendered between the title and
   *  the popout button. Used by Panel 2 (matrix) to host the
   *  CompactModeToggle + LayoutMenu so they don't overlay the
   *  panel's own popout button as floating absolute-positioned
   *  siblings (UX issue caught 2026-05-18: user couldn't see the
   *  Panel 2 popout icon because the floating buttons sat on top). */
  headerExtra?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { id, isActive, onActivate, panelLabel, panelTitle, panelKind, headerExtra, children } = props;
  const tPanels = useTranslations('terminal.panels');
  const tPopOutTitle = tPanels('popOutTitle');
  const tPopOutAria = tPanels('popOutAria');
  // Phase 7.K 2026-05-18 — popped windows are a separate JS process and
  // share NO state with the main terminal. Without these params the
  // popout opens "cold" and IndicatorDetail falls back to the morning-
  // brief summary instead of showing the cell the user just clicked.
  // We read the relevant slices here so the popout URL carries enough
  // context for /terminal-panel/[id]/page.tsx to re-hydrate.
  const popoutActiveCompany = useTerminalStore((s) => s.activeCompanyCode);
  const popoutActiveIv = useTerminalStore((s) => s.activeIndicatorValueId);
  const handlePopOut = (e: React.MouseEvent) => {
    e.stopPropagation();
    const period =
      typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('period')
        : null;
    const usp = new URLSearchParams();
    if (period) usp.set('period', period);
    // Carry active selection to the popped window so it renders the
    // SAME indicator the user was looking at, not a generic summary.
    if (popoutActiveCompany) usp.set('company', popoutActiveCompany);
    if (popoutActiveIv) usp.set('iv', popoutActiveIv);
    const params = usp.toString() ? `?${usp.toString()}` : '';
    window.open(
      `/terminal-panel/${panelKind}${params}`,
      `terminal-panel-${panelKind}`,
      'width=900,height=700,resizable=yes,scrollbars=yes',
    );
  };
  return (
    <div
      data-testid={`terminal-panel-${id}`}
      data-panel-kind={panelKind}
      onClick={() => onActivate(id)}
      className={`bg-[#0A0E27] p-3 flex flex-col h-full overflow-hidden transition-all duration-200 ${
        isActive ? 'ring-1 ring-inset ring-[#00D4AA]' : ''
      }`}
    >
      <div className="flex justify-between items-center mb-2 pb-1.5 border-b border-gray-800/50 shrink-0">
        <h3 className="text-gray-400 font-mono text-[10px] uppercase tracking-wider flex items-center gap-2">
          {/* Round-7 M6 — Linear-style kbd badge for the F-key shortcut.
              Visible affordance vs the prior bare `F1`/`F2` text — CFO
              learns "the keyboard works here" without reading docs. */}
          <kbd
            className={`font-sans inline-flex items-center justify-center min-w-[18px] h-[16px] px-1 rounded border text-[9px] font-semibold ${
              isActive
                ? 'border-[#00D4AA]/60 bg-[#00D4AA]/10 text-[#00D4AA]'
                : 'border-gray-700 bg-gray-800/40 text-gray-500'
            }`}
            title={tPanels('shortcutTitle', { id })}
          >
            F{id}
          </kbd>
          <span>{panelLabel}</span>
          <span className="text-gray-700">·</span>
          <span>{panelTitle}</span>
        </h3>
        <div className="flex items-center gap-2">
          {headerExtra}
          {isActive && <span className="w-2 h-2 rounded-full bg-[#00D4AA]" />}
          <button
            type="button"
            onClick={handlePopOut}
            className="text-gray-600 hover:text-cyan-300 transition-colors"
            title={tPopOutTitle}
            aria-label={tPopOutAria}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M15 3h6v6" />
              <path d="M10 14L21 3" />
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            </svg>
          </button>
        </div>
      </div>
      <div
        className={`flex-1 overflow-auto ${
          id === 1 || id === 2 ? 'flex flex-col items-stretch' : 'flex items-stretch'
        }`}
      >
        {children}
      </div>
    </div>
  );
}
