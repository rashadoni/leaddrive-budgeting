"use client";

import React, { useState, useEffect, useRef } from 'react';
import { useTerminalStore } from '../store/terminalStore';
import {
  parseCommand,
  panelForCommand,
  type ParsedCommand,
} from '../lib/command-parser';

export function CommandBar() {
  const [command, setCommand] = useState('');
  const [feedback, setFeedback] = useState<
    | { kind: 'idle' }
    | { kind: 'ok'; message: string }
    | { kind: 'err'; message: string }
  >({ kind: 'idle' });
  const inputRef = useRef<HTMLInputElement>(null);

  const activeCompany = useTerminalStore((s) => s.activeCompanyCode);
  const setCompany = useTerminalStore((s) => s.setCompany);
  const setActivePanel = useTerminalStore((s) => s.setActivePanel);

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
   * Dispatch a parsed command. Returns either the success message OR a
   * "partial" notice describing what the user typed but the dispatch
   * couldn't yet honour (e.g. CMP's right target lands in the parser but
   * the side-by-side panel doesn't exist yet — surfacing that explicitly
   * beats silent capability gaps).
   */
  const dispatch = (
    cmd: ParsedCommand,
  ): { message: string; partial?: string } => {
    switch (cmd.kind) {
      case 'co':
        setCompany(cmd.companyCode);
        break;
      case 'cmp':
        // CMP parses both targets but the side-by-side panel is a
        // separate item in CARRYOVER. Today we focus the LEFT and tell
        // the user explicitly that the RIGHT was parsed but is pending.
        setCompany(cmd.left);
        setActivePanel(panelForCommand(cmd) ?? 2);
        return {
          message: `CO ${cmd.left} →`,
          partial: `CMP partial — right=${cmd.right} parsed, side-by-side panel pending`,
        };
      case 'aud':
        // Phase 7.F (Turn 13) — audit log opens as a modal overlay.
        // The destination is NOT a panel; we fire a custom event the
        // AuditModal listens for, leaving the user's active pane intact.
        // Escape-to-close + backdrop-click-to-close are wired in the
        // modal itself (see `AuditModal.tsx`).
        window.dispatchEvent(new CustomEvent('terminal:open-audit'));
        return { message: 'AUD →' };
      case 'hold':
      case 'grp':
      case 'sec':
      case 'ind':
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
        <div className="flex items-center">
          <span className="text-gray-500 mr-1">CO:</span>
          <span className={activeCompany ? 'text-[#FFB800]' : ''}>{activeCompany || 'NONE'}</span>
        </div>
        <div className="flex items-center cursor-pointer hover:text-white transition-colors">
          <span className="mr-1">[user]</span>
        </div>
        <div className="flex items-center cursor-pointer hover:text-[#FFB800] transition-colors">
          <span className="mr-1">[alerts</span>
          <span className="mx-1 text-[#FFB800]">🔔</span>
          <span className="text-[#FFB800]">3]</span>
        </div>
      </div>
    </div>
  );
}
