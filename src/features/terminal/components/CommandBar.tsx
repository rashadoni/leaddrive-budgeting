"use client";

import React, { useState, useEffect, useRef } from 'react';
import { useTerminalStore } from '../store/terminalStore';
import {
  parseCommand,
  panelForCommand,
  type ParsedCommand,
} from '../lib/command-parser';
import { Bell } from 'lucide-react';
import { RelatedFunctionsMenu } from './RelatedFunctionsMenu';

export function CommandBar() {
  const [command, setCommand] = useState('');
  const [feedback, setFeedback] = useState<
    | { kind: 'idle' }
    | { kind: 'ok'; message: string }
    | { kind: 'err'; message: string }
  >({ kind: 'idle' });
  const inputRef = useRef<HTMLInputElement>(null);

  const activeCompany = useTerminalStore((s) => s.activeCompanyCode);
  const alertsCount = useTerminalStore((s) => s.alertsCount);
  // User-typed CO/CMP verbs are user-driven → selectCompany (tracks LRU recent).
  const setCompany = useTerminalStore((s) => s.selectCompany);
  const setActivePanel = useTerminalStore((s) => s.setActivePanel);
  const setActiveIndicatorValue = useTerminalStore((s) => s.setActiveIndicatorValue);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === 'Escape' && document.activeElement === inputRef.current) {
        setCommand('');
        setFeedback({ kind: 'idle' });
        inputRef.current?.blur();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  /**
   * Resolve indicator code → IndicatorValue id by fetching the current
   * matrix and finding a cell with the matching indicator.code. Prefers
   * the active company if one is selected (so `IND IND_GROSS_MARGIN GO`
   * after `AAC CO GO` shows AAC's indicator, not a random company's).
   * Returns null if no matching cell exists (no data for that indicator
   * in current org / period).
   *
   * Turn 32 (Bug #2 fix): closes the silent "IND command no-op" gap that
   * was visible in DEMO_SCRIPT Step 4. Original CommandBar.tsx case 'ind'
   * was bare `break` — only switched activePanel to 3 without populating
   * any indicator. Now resolves via fetch + populates `activeIndicatorValueId`
   * so Panel 3 (IndicatorDetail) renders the same drill-down a HeatMap
   * cell click would.
   *
   * Turn 33 (architect Round-1 ⚠️ accepted-low-impact): the calling pattern
   * `void resolveIndicatorByCode(...).then(setActiveIndicatorValue OR
   * setFeedback)` is fire-and-forget. If the user navigates away from
   * /budgeting/terminal between IND keystroke and matrix-fetch resolve,
   * the `.then` callback fires AFTER CommandBar unmounts. Effects:
   *   - `setActiveIndicatorValue(id)` → mutates module-level zustand store
   *     (no React-DOM warning — store doesn't depend on mount); next
   *     /budgeting/terminal mount sees the value pre-populated. Benign.
   *   - `setFeedback({...})` → calls a useState setter on an unmounted
   *     component; React 18 silently no-ops (warning was removed). Benign.
   * No AbortController wired since both effects are inert post-unmount.
   * If future store work makes activeIndicatorValueId a side-effect
   * (e.g. auto-fires API calls), revisit this with proper cleanup.
   */
  const resolveIndicatorByCode = async (code: string): Promise<string | null> => {
    try {
      const res = await fetch('/api/indicators/matrix');
      if (!res.ok) return null;
      const matrix = await res.json();
      const cells: Array<{ indicatorValueId: string; companyId: string; indicatorId: string }> =
        matrix.cells ?? [];
      const indicators: Array<{ id: string; code: string }> = matrix.indicators ?? [];
      const companies: Array<{ id: string; code: string }> = matrix.companies ?? [];
      const targetIndicator = indicators.find((i) => i.code === code);
      if (!targetIndicator) return null;

      // Prefer cell for activeCompany if one is selected; else any cell
      // with the matching indicator (first match by company sort order).
      let matchingCell = cells.find((c) => c.indicatorId === targetIndicator.id);
      if (activeCompany) {
        const activeCo = companies.find((co) => co.code === activeCompany);
        if (activeCo) {
          const cellForActive = cells.find(
            (c) => c.indicatorId === targetIndicator.id && c.companyId === activeCo.id,
          );
          if (cellForActive) matchingCell = cellForActive;
        }
      }
      return matchingCell?.indicatorValueId ?? null;
    } catch {
      return null;
    }
  };

  /**
   * Dispatch a parsed command. Returns synchronously with the success
   * message OR a "partial" notice describing what the user typed but the
   * dispatch couldn't yet honour. IND command kicks off async indicator-
   * code resolution in the background — feedback may be UPDATED later via
   * post-resolve `setFeedback` if no matching IV exists.
   */
  const dispatch = (
    cmd: ParsedCommand,
  ): { message: string; partial?: string } => {
    switch (cmd.kind) {
      case 'co':
        setCompany(cmd.companyCode);
        break;
      case 'cmp':
        // Phase B5 — fully wired: CMP <LHS> <RHS> GO opens the
        // ComparePanel modal which fetches the matrix once and renders
        // a 2-column side-by-side indicator view with row-level deltas.
        // The active CO is set to LHS (so other panels reflect the
        // primary company); RHS is forwarded via the event detail.
        setCompany(cmd.left);
        window.dispatchEvent(
          new CustomEvent('terminal:open-compare', {
            detail: { lhs: cmd.left, rhs: cmd.right },
          }),
        );
        return { message: `CMP ${cmd.left} vs ${cmd.right} →` };
      case 'aud':
        // Phase 7.F (Turn 13) — audit log opens as a modal overlay.
        // The destination is NOT a panel; we fire a custom event the
        // AuditModal listens for, leaving the user's active pane intact.
        // Escape-to-close + backdrop-click-to-close are wired in the
        // modal itself (see `AuditModal.tsx`).
        window.dispatchEvent(new CustomEvent('terminal:open-audit'));
        return { message: 'AUD →' };
      case 'ind': {
        // Turn 32 (Bug #2 fix): switch to Panel 3 immediately + kick off
        // async resolve of indicator code → IV id. Fire-and-forget — when
        // resolve completes, `setActiveIndicatorValue` updates the store
        // and IndicatorDetail re-renders. If no matching IV (no data for
        // current period / indicator not in catalog), show partial feedback
        // post-async so user sees what happened instead of empty Panel 3.
        setActivePanel(panelForCommand(cmd) ?? 3);
        void resolveIndicatorByCode(cmd.indicatorCode).then((ivId) => {
          if (ivId) {
            setActiveIndicatorValue(ivId);
          } else {
            setFeedback({
              kind: 'err',
              message: `IND partial — no IndicatorValue found for "${cmd.indicatorCode}" in current period (cell may be missing or indicator not seeded)`,
            });
          }
        });
        return { message: `IND ${cmd.indicatorCode} →` };
      }
      case 'hold':
      case 'grp':
      case 'sec':
      case 'scn':
      case 'alt':
      case 'brf':
        // Pure panel-switch (no company change). The destination panel
        // reads the relevant store slice and re-renders.
        break;
    }
    // After the switch, every remaining command kind has a concrete
    // panel destination (panelForCommand returns null only for `aud`,
    // which is handled above). The fallback `?? 1` is dead — included
    // to satisfy the `1|2|3|4|null` return-type contract.
    const target = panelForCommand(cmd);
    if (target !== null) setActivePanel(target);
    return { message: `${cmd.kind.toUpperCase()} →` };
  };

  const handleCommandSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const result = parseCommand(command);
    if (!result.ok) {
      setFeedback({ kind: 'err', message: result.error.reason });
      return;
    }
    const out = dispatch(result.command);
    // If the dispatch surfaced a `partial`, render that instead of plain
    // ok — yellow warning styling so the user immediately spots the gap.
    if (out.partial) {
      setFeedback({ kind: 'err', message: out.partial });
    } else {
      setFeedback({ kind: 'ok', message: out.message });
    }
    setCommand('');
  };

  return (
    <div className="flex items-center justify-between px-4 py-2 bg-[#050814] border-b border-gray-800 text-[#00D4AA] font-mono text-sm">
      <div className="flex items-center flex-1 gap-2">
        <span className="text-gray-500 shrink-0">[cmd]</span>
        <form
          onSubmit={handleCommandSubmit}
          className="flex-1 max-w-xl flex items-center bg-[#0A0E27] px-2 py-1 rounded border border-gray-700 focus-within:border-[#00D4AA] transition-colors"
        >
          <span className="text-gray-400 mr-2">›</span>
          <input
            ref={inputRef}
            // `data-cmd-bar` lets PanelGrid's switchPanel scope its
            // blur-on-F-key behavior to ONLY the command bar — without
            // this marker, an F-key press would also blur a Panel-1
            // search input mid-typing. Explicit string value (not bare
            // attribute) so React's SSR/CSR serialization is deterministic.
            data-cmd-bar="true"
            type="text"
            value={command}
            onChange={(e) => {
              setCommand(e.target.value.toUpperCase());
              if (feedback.kind !== 'idle') setFeedback({ kind: 'idle' });
            }}
            placeholder="HOLD GO · AAC CO GO · IND_OPEX_RATIO IND GO (Cmd+K)"
            className="bg-transparent border-none outline-none text-[#E8EDF5] w-full placeholder-gray-600 uppercase"
            autoComplete="off"
            spellCheck={false}
          />
        </form>
        {feedback.kind === 'ok' && (
          <span className="text-[#00D4AA] text-xs shrink-0" role="status">
            {feedback.message}
          </span>
        )}
        {feedback.kind === 'err' && (
          <span
            className="text-[#FF4757] text-xs shrink-0 truncate max-w-[280px]"
            role="alert"
            title={feedback.message}
          >
            ⚠ {feedback.message}
          </span>
        )}
      </div>

      <div className="flex items-center space-x-6 text-gray-400">
        <div className="flex items-center gap-1">
          <span className="text-gray-500">CO:</span>
          <span className={activeCompany ? 'text-[#FFB800]' : ''}>{activeCompany || 'NONE'}</span>
          <RelatedFunctionsMenu />
        </div>
        <div className="flex items-center cursor-pointer hover:text-white transition-colors">
          <span className="mr-1">[user]</span>
        </div>
        <div
          className="flex items-center cursor-pointer hover:text-[#FFB800] transition-colors"
          title={
            alertsCount === null
              ? 'Alerts: loading…'
              : `${alertsCount} red+amber indicator${alertsCount === 1 ? '' : 's'} across the org`
          }
        >
          <span className="mr-1">[alerts</span>
          <Bell size={11} className="mx-1 text-[#FFB800]" aria-hidden="true" />
          <span className="text-[#FFB800]">{alertsCount === null ? '—' : alertsCount}]</span>
        </div>
      </div>
    </div>
  );
}
