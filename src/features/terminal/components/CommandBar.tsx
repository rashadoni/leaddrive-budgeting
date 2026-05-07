"use client";

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { resolveIndicatorLabel } from '../lib/resolve-indicator-label';
import { useTerminalStore } from '../store/terminalStore';
import {
  parseCommand,
  panelForCommand,
  type ParsedCommand,
} from '../lib/command-parser';
import { Bell } from 'lucide-react';
import { RelatedFunctionsMenu } from './RelatedFunctionsMenu';
import { ensureMatrix, useMatrix } from '../hooks/use-matrix';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

// Round-8 M4 — verbs the parser recognises. Matched fuzzily against
// the user's current word; suggestions append " GO" implicitly when
// the verb expects a terminator.
const VERBS = [
  'HOLD',
  'GRP',
  'CO',
  'IND',
  'CMP',
  'SCN',
  'BRF',
  'AUD',
  'ALT',
  'SEC',
  'ACT',
  'CMT',
  'CHT',
  'SUB',
  'INT',
  'GO',
] as const;

interface Suggestion {
  kind: 'verb' | 'company' | 'indicator';
  value: string;
  label: string;
  hint?: string;
}

/** Score = how well `query` fuzzy-matches `target`. 0 = no match,
 *  higher is better. Prefers prefix matches over substring. */
function fuzzyScore(query: string, target: string): number {
  if (!query) return 1; // empty query matches everything (lowest priority)
  const q = query.toUpperCase();
  const t = target.toUpperCase();
  if (t === q) return 1000;
  if (t.startsWith(q)) return 100 + q.length;
  if (t.includes(q)) return 50 + q.length;
  // Char-by-char drift fallback (typing IDx → matches "INDEX").
  // Round-9 architect closure: require ≥2 chars to engage drift, otherwise
  // typing "I" matches every "i"-containing word in the suggestion pool
  // and the dropdown becomes noise. Exact / prefix / substring tiers above
  // still match single chars; the noisy tier is the only one we mute.
  if (q.length < 2) return 0;
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length ? 10 + q.length : 0;
}

export function CommandBar() {
  const t = useTranslations('terminal');
  // Phase 7.G Turn H — locale-aware autocomplete hint (closes 23-turn
  // sub-35 follow-up at CARRYOVER L139). Last `nameEn` straggler in
  // terminal/components/. The fuzzy-score input + the hint string both
  // need the localized name so RU/AZ users (a) can match against typed
  // text in their native script, (b) see the localized hint in the
  // suggestion drop-down. resolveIndicatorLabel falls back to nameEn
  // → code when locale-specific name is missing.
  const locale = useLocale();
  const [command, setCommand] = useState('');
  const [feedback, setFeedback] = useState<
    | { kind: 'idle' }
    | { kind: 'ok'; message: string }
    | { kind: 'err'; message: string }
  >({ kind: 'idle' });
  const inputRef = useRef<HTMLInputElement>(null);
  // Round-8 M4 — fuzzy autocomplete state.
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const { matrix } = useMatrix();

  const activeCompany = useTerminalStore((s) => s.activeCompanyCode);
  const alertsCount = useTerminalStore((s) => s.alertsCount);
  // User-typed CO/CMP verbs are user-driven → selectCompany (tracks LRU recent).
  const setCompany = useTerminalStore((s) => s.selectCompany);
  const setActivePanel = useTerminalStore((s) => s.setActivePanel);
  const setActiveIndicatorValue = useTerminalStore((s) => s.setActiveIndicatorValue);
  const setActiveScenario = useTerminalStore((s) => s.setActiveScenarioCode);

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
      // Sub-20: shared `ensureMatrix()` accessor reads the cached
      // matrix HeatMap already fetched (or kicks off the shared fetch
      // if no consumer has populated cache yet). One-shot read; no
      // subscription needed for this fire-and-forget IND-resolve path.
      const matrix = await ensureMatrix();
      const cells: Array<{ indicatorValueId?: string; companyId: string; indicatorId: string }> =
        matrix.cells ?? [];
      const indicators = matrix.indicators ?? [];
      const companies = matrix.companies ?? [];
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
      case 'act':
        // Tier-3 sub-28 (v1 cells) + sub-31 (v2 alerts wiring) —
        // ActionCenterPanel opens on `terminal:open-action-center`. Same
        // overlay-modal pattern as AUD/ALT/CMP/SCN; modal floats above the
        // 4-panel grid. v2 surfaces TWO sections: (a) rule-engine alert
        // matches from `terminalStore.alertMatches` (de-duped by rule,
        // chips for affected companies), and (b) red+amber leaf cells from
        // the live `useMatrix()` snapshot, grouped by severity for granular
        // drill-in.
        window.dispatchEvent(new CustomEvent('terminal:open-action-center'));
        return { message: 'ACT →' };
      case 'cmt':
        // Tier-3 sub-30 — CommentsLayer overlay (Bloomberg IB Internal Chat
        // equivalent). Per-cell @mention threads. v1 in-memory + localStorage;
        // v2 backend persistence tracked as 🔄.
        window.dispatchEvent(new CustomEvent('terminal:open-comments'));
        return { message: 'CMT →' };
      case 'cht':
        // Tier-3 sub-30 — SubCoFinanceChat (Bloomberg counterparty chat
        // equivalent). Holding-CFO ↔ sub-co finance manager threads. v1
        // in-memory + localStorage; v2 backend persistence tracked as 🔄.
        window.dispatchEvent(new CustomEvent('terminal:open-subco-chat'));
        return { message: 'CHT →' };
      case 'sub':
        // Tier-3 sub-30 — AISubscriptions ("notify me when X" manager).
        // User defines composite/indicator threshold conditions; v1 in-app
        // notifications only + localStorage; v2 email + DB tracked as 🔄.
        window.dispatchEvent(new CustomEvent('terminal:open-subscriptions'));
        return { message: 'SUB →' };
      case 'int':
        // Phase 7.G D.4 — IntelFeedPanel opens on `terminal:open-intel`.
        // Same overlay-modal pattern as ALT/AUD/ACT. Renders the AI Web
        // Crawler feed (per-org news scored by relevance to the holding's
        // industries + active company codes). Admin-only Refresh button
        // inside the panel triggers POST /api/intel/refresh for an
        // on-demand crawl.
        window.dispatchEvent(new CustomEvent('terminal:open-intel'));
        return { message: 'INT →' };
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
      case 'scn':
        // Phase C4 v1 — `SCN <code> GO` opens the ScenarioPanel modal
        // with the scenario pre-selected. Sets `activeScenarioCode`
        // store slice (so other surfaces can react), then fires the
        // event the modal listens for. Same dispatch pattern as
        // `CMP`/`AUD` — no panel-switch needed since the modal floats
        // above the panel grid.
        setActiveScenario(cmd.scenarioCode);
        window.dispatchEvent(
          new CustomEvent('terminal:open-scenario', {
            detail: { scenarioCode: cmd.scenarioCode },
          }),
        );
        return { message: `SCN ${cmd.scenarioCode} →` };
      case 'brf':
        // Phase C3 v1 — `BRF GO` opens the Board Deck Generator in a
        // new browser tab so the user can keep the live terminal open
        // while inspecting / printing the snapshot. File is `'use client'`
        // so `window` is always defined here — no SSR guard needed.
        window.open('/budgeting/board-deck', '_blank');
        return { message: 'BRF →' };
      case 'hold':
      case 'grp':
      case 'sec':
      case 'alt':
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

  // Round-8 M4 — derive suggestions from current command's last word.
  const suggestions = useMemo<Suggestion[]>(() => {
    const tokens = command.trim().split(/\s+/);
    const lastWord = tokens.length > 0 ? tokens[tokens.length - 1] : '';
    if (!lastWord) return [];
    const out: Array<Suggestion & { score: number }> = [];
    // Verbs
    for (const v of VERBS) {
      const score = fuzzyScore(lastWord, v);
      if (score > 0) {
        out.push({
          kind: 'verb',
          value: v,
          label: v,
          hint: 'verb',
          score,
        });
      }
    }
    // Companies (from matrix)
    const companies = matrix?.companies ?? [];
    for (const c of companies) {
      const codeScore = fuzzyScore(lastWord, c.code);
      const nameScore = fuzzyScore(lastWord, c.name) * 0.8;
      const score = Math.max(codeScore, nameScore);
      if (score > 0) {
        out.push({
          kind: 'company',
          value: c.code,
          label: c.code,
          hint: c.name,
          score,
        });
      }
    }
    // Indicators
    const indicators = matrix?.indicators ?? [];
    for (const ind of indicators) {
      const localizedName = resolveIndicatorLabel(ind, locale);
      const codeScore = fuzzyScore(lastWord, ind.code);
      const nameScore = fuzzyScore(lastWord, localizedName) * 0.8;
      const score = Math.max(codeScore, nameScore);
      if (score > 0) {
        out.push({
          kind: 'indicator',
          value: ind.code,
          label: ind.code,
          hint: localizedName,
          score,
        });
      }
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, 7).map(({ score: _, ...rest }) => rest);
  }, [command, matrix]);

  // Reset highlight when suggestions change.
  useEffect(() => {
    setHighlightIdx(0);
  }, [suggestions.length, command]);

  const applySuggestion = (s: Suggestion) => {
    const tokens = command.trim().split(/\s+/);
    if (tokens.length > 0) {
      tokens[tokens.length - 1] = s.value;
    } else {
      tokens.push(s.value);
    }
    // For verbs that complete a phrase, append a space so the user
    // can keep typing (e.g. "AAC CO" → user adds " GO" themselves).
    const next = tokens.join(' ') + ' ';
    setCommand(next.toUpperCase());
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  return (
    <TooltipProvider delayDuration={300}>
    <div className="flex items-center justify-between px-4 py-2 bg-[#050814] border-b border-gray-800 text-[#00D4AA] font-mono text-sm">
      <div className="flex items-center flex-1 gap-2">
        <span className="text-gray-500 shrink-0">[cmd]</span>
        <div className="flex-1 max-w-xl relative">
        <form
          onSubmit={handleCommandSubmit}
          className="flex items-center bg-[#0A0E27] px-2 py-1 rounded border border-gray-700 focus-within:border-[#00D4AA] transition-colors"
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
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => {
              // Defer to next tick so click on suggestion fires before blur.
              setTimeout(() => setShowSuggestions(false), 150);
            }}
            onKeyDown={(e) => {
              if (!showSuggestions || suggestions.length === 0) return;
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setHighlightIdx((i) => (i + 1) % suggestions.length);
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setHighlightIdx((i) => (i - 1 + suggestions.length) % suggestions.length);
              } else if (e.key === 'Tab') {
                e.preventDefault();
                applySuggestion(suggestions[highlightIdx] ?? suggestions[0]);
              } else if (e.key === 'Escape') {
                setShowSuggestions(false);
              }
            }}
            placeholder={t('commandBar.placeholder')}
            className="bg-transparent border-none outline-none text-[#E8EDF5] w-full placeholder-gray-600 uppercase"
            autoComplete="off"
            spellCheck={false}
            aria-autocomplete="list"
            aria-expanded={showSuggestions && suggestions.length > 0}
            aria-controls="cmdbar-suggestions"
          />
        </form>
        {/* Round-8 M4 — fuzzy suggestions dropdown.
            Shows only when input focused + has matches. ↑↓ to navigate,
            Enter/Tab to apply, Esc to close. Click also applies. */}
        {showSuggestions && suggestions.length > 0 && (
          <ul
            id="cmdbar-suggestions"
            role="listbox"
            className="absolute top-full left-0 right-0 mt-1 z-30 bg-[#050814] border border-gray-700 rounded shadow-2xl overflow-hidden text-[11px]"
          >
            {suggestions.map((s, i) => {
              const active = i === highlightIdx;
              const kindColor =
                s.kind === 'verb'
                  ? 'text-[#FFB020]'
                  : s.kind === 'company'
                    ? 'text-[#00D4AA]'
                    : 'text-[#FFB800]';
              return (
                <li
                  key={`${s.kind}:${s.value}`}
                  role="option"
                  aria-selected={active}
                  onMouseDown={(e) => {
                    // mousedown fires before blur — preserves click-to-select.
                    e.preventDefault();
                    applySuggestion(s);
                  }}
                  onMouseEnter={() => setHighlightIdx(i)}
                  className={`flex items-baseline gap-2 px-2 py-1 cursor-pointer ${
                    active ? 'bg-[#00D4AA]/15' : 'hover:bg-gray-800/40'
                  }`}
                >
                  <span className={`shrink-0 w-16 text-[9px] uppercase tracking-wider ${kindColor}`}>
                    {s.kind}
                  </span>
                  <span className={`shrink-0 font-semibold ${active ? 'text-white' : 'text-gray-200'}`}>
                    {s.label}
                  </span>
                  {s.hint && (
                    <span className="text-gray-500 truncate flex-1">
                      {s.hint}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        </div>
        {feedback.kind === 'ok' && (
          <span className="text-[#00D4AA] text-xs shrink-0" role="status">
            {feedback.message}
          </span>
        )}
        {feedback.kind === 'err' && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="text-[#FF4757] text-xs shrink-0 truncate max-w-[280px]"
                role="alert"
              >
                ⚠ {feedback.message}
              </span>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              className="bg-popover text-popover-foreground border border-border shadow-lg max-w-[280px] text-xs"
            >
              {feedback.message}
            </TooltipContent>
          </Tooltip>
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
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="flex items-center cursor-pointer hover:text-[#FFB800] transition-colors"
              aria-label={t('commandBar.alertsAriaLabel')}
              onClick={() => {
                window.dispatchEvent(new Event('terminal:open-alerts'));
              }}
            >
              <span className="mr-1">[alerts</span>
              <Bell size={11} className="mx-1 text-[#FFB800]" aria-hidden="true" />
              <span className="text-[#FFB800]">{alertsCount === null ? '—' : alertsCount}]</span>
            </button>
          </TooltipTrigger>
          <TooltipContent
            side="bottom"
            className="bg-popover text-popover-foreground border border-border shadow-lg max-w-[280px] text-xs"
          >
            {alertsCount === null
              ? t('commandBar.alertsLoading')
              : t('commandBar.alertsTitle', { count: alertsCount })}
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
    </TooltipProvider>
  );
}
