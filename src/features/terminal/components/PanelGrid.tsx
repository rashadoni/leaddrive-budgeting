"use client";

import React, { useEffect, useState } from 'react';
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
import { VarianceExplainerPanel } from './VarianceExplainerPanel';
import { LayoutMenu } from './LayoutMenu';
import { AuditModal } from './AuditModal';
import { AuditTicker } from './AuditTicker';
import { ComparePanel } from './ComparePanel';
import { AlertsPanel } from './AlertsPanel';
import { ScenarioPanel } from './ScenarioPanel';
import {
  DEFAULT_LAYOUT_SIZES,
  PANEL_IDS,
  type LayoutSizes,
} from '../lib/layout-sizes';

type PanelId = 1 | 2 | 3 | 4;

const PANEL_TITLES: Record<PanelId, string> = {
  1: 'Companies',
  2: 'Heatmap',
  3: 'Indicator Detail',
  4: 'Variance Explainer',
};

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

export function PanelGrid() {
  const activePanelId = useTerminalStore((s) => s.activePanelId);
  const setActivePanel = useTerminalStore((s) => s.setActivePanel);

  const [companies, setCompanies] = useState<CompanyNode[]>([]);
  const [loading, setLoading] = useState(true);

  // Imperative refs to each Group — LayoutMenu uses these to read
  // current sizes (Save) + push restored sizes (Load) without forcing a
  // remount of the panel tree.
  const outerRef = useGroupRef();
  const topRef = useGroupRef();
  const bottomRef = useGroupRef();

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
    let cancelled = false;
    setLoading(true);
    fetch('/api/companies')
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setCompanies(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) setCompanies([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
        window.dispatchEvent(
          new CustomEvent('terminal:focus-search', {
            detail: { panelId: getTerminalSnapshot().activePanelId },
          }),
        );
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
    <div className="flex-1 bg-gray-800 relative flex flex-col">
      <CompactModeToggle />
      <LayoutMenu
        readCurrent={readSizesFromGroups}
        applyLayout={applySizesToGroups}
      />
      {/* Phase 7.F (Turn 13) — opens on `terminal:open-audit` event
          fired by CommandBar's `AUD GO` dispatch + AuditTicker click.
          Renders nothing when closed; Escape / backdrop / Close all dismiss. */}
      <AuditModal />
      {/* Phase B5 — opens on `terminal:open-compare` event fired by
          CommandBar's `CMP <LHS> <RHS> GO` dispatch. Side-by-side
          indicator view + Δ column. Same dismiss pattern as AuditModal. */}
      <ComparePanel />
      {/* Phase C6 v2 — opens on `terminal:open-alerts` event fired by
          CommandBar's `[alerts]` strip click. Lists rule-engine matches
          grouped by severity. Same dismiss pattern as AuditModal. */}
      <AlertsPanel />
      {/* Phase C4 v1 — opens on `terminal:open-scenario` event fired by
          CommandBar's `SCN <code> GO` dispatch. What-if scenario inspector
          + queue-apply. Same dismiss pattern as AuditModal. */}
      <ScenarioPanel />
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
              >
                <CompanyTree companies={companies} loading={loading} />
              </PanelShell>
            </Panel>
            <Separator className="w-[3px] bg-gray-800 hover:bg-[#00D4AA]/40 active:bg-[#00D4AA]/60 transition-colors" />
            <Panel id={PANEL_IDS.panel2} defaultSize={65} minSize={20}>
              <PanelShell
                id={2}
                isActive={activePanelId === 2}
                onActivate={setActivePanel}
              >
                <HeatMap />
              </PanelShell>
            </Panel>
          </Group>
        </Panel>
        <Separator className="h-[3px] bg-gray-800 hover:bg-[#00D4AA]/40 active:bg-[#00D4AA]/60 transition-colors" />
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
              >
                <IndicatorDetail />
              </PanelShell>
            </Panel>
            <Separator className="w-[3px] bg-gray-800 hover:bg-[#00D4AA]/40 active:bg-[#00D4AA]/60 transition-colors" />
            <Panel id={PANEL_IDS.panel4} defaultSize={50} minSize={15}>
              <PanelShell
                id={4}
                isActive={activePanelId === 4}
                onActivate={setActivePanel}
              >
                <VarianceExplainerPanel />
              </PanelShell>
            </Panel>
          </Group>
        </Panel>
      </Group>
      </div>
      <AuditTicker />
    </div>
  );
}

/**
 * Phase A5 — top-right toggle button for compact mode. Sits to the LEFT
 * of the Layouts button (LayoutMenu owns top-2 right-2; we sit at right-24
 * so the two never overlap). Keyboard shortcut Ctrl+/ does the same thing
 * via PanelGrid's keydown effect — this button just makes the affordance
 * discoverable to users who didn't read the help.
 */
function CompactModeToggle() {
  const compactMode = useTerminalStore((s) => s.compactMode);
  const toggle = useTerminalStore((s) => s.toggleCompactMode);
  return (
    <div className="absolute top-2 right-24 z-30 font-mono text-[10px]">
      <button
        type="button"
        onClick={toggle}
        className={`px-2 py-0.5 rounded border bg-[#0A0E27] hover:text-white hover:border-[#00D4AA]/60 ${
          compactMode
            ? 'border-[#00D4AA]/60 text-[#00D4AA]'
            : 'border-gray-800 text-gray-400'
        }`}
        title={
          compactMode
            ? 'Compact mode ON — Ctrl+/ to expand'
            : 'Compact mode OFF — Ctrl+/ to densify'
        }
        aria-pressed={compactMode}
      >
        ▦ {compactMode ? 'Compact' : 'Normal'}
      </button>
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
    console.warn('[PanelGrid] setLayout rejected:', err);
  }
}

function PanelShell(props: {
  id: PanelId;
  isActive: boolean;
  onActivate: (id: number) => void;
  children: React.ReactNode;
}) {
  const { id, isActive, onActivate, children } = props;
  return (
    <div
      onClick={() => onActivate(id)}
      className={`bg-[#0A0E27] p-3 flex flex-col h-full overflow-hidden transition-all duration-200 ${
        isActive ? 'ring-1 ring-inset ring-[#00D4AA]' : ''
      }`}
    >
      <div className="flex justify-between items-center mb-2 pb-1.5 border-b border-gray-800/50 shrink-0">
        <h3 className="text-gray-400 font-mono text-[10px] uppercase tracking-wider flex items-center gap-2">
          <span className="text-gray-600">F{id}</span>
          <span>Panel {id}</span>
          <span className="text-gray-700">·</span>
          <span>{PANEL_TITLES[id]}</span>
        </h3>
        {isActive && <span className="w-2 h-2 rounded-full bg-[#00D4AA]" />}
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
