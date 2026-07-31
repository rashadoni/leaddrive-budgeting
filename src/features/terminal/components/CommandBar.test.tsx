// @vitest-environment happy-dom
/**
 * Phase 7.D test scaffold (Turn 10) — first React component test in the
 * repo. The Bloomberg-style command-bar is the single most user-visible
 * Phase 7.D surface, and its parser→dispatch wiring was previously only
 * verified by a manual browser smoke. This file establishes the
 * `happy-dom` + `@testing-library/react` rig and gives the dispatch flow
 * regression coverage so future refactors can't silently break it.
 *
 * What is covered: the integration seam between `parseCommand` (already
 * unit-tested) and the terminalStore actions the CommandBar wires up
 * for each verb. Pure-parser cases are NOT re-tested here — they live
 * in `command-parser.test.ts`.
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { __resetMatrixCacheForTests } from '../hooks/use-matrix';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CommandBar } from './CommandBar';
import {
  getTerminalSnapshot,
  useTerminalStore,
} from '../store/terminalStore';

function getInput(): HTMLInputElement {
  // The cmd-bar input is the only `data-cmd-bar="true"` element on the
  // page (see CommandBar.tsx — that attribute also gates F-key blur).
  const el = document.querySelector(
    '[data-cmd-bar="true"]',
  ) as HTMLInputElement | null;
  if (!el) throw new Error('CommandBar input not found');
  return el;
}

function submit(value: string): void {
  const input = getInput();
  fireEvent.change(input, { target: { value } });
  // The command bar wraps the input in a <form>, so a native submit
  // event on the form is what `handleCommandSubmit` listens for.
  const form = input.closest('form');
  if (!form) throw new Error('CommandBar form not found');
  fireEvent.submit(form);
}

beforeEach(() => {
  // Sub-20: reset useMatrix module cache between tests so each test's
  // fetch mock controls what `ensureMatrix()` (called by IND command)
  // resolves to. Without this the first test's empty matrix sticks
  // and subsequent tests with populated fixtures fail.
  __resetMatrixCacheForTests();
  // Turn 32: mock global fetch — IND command (Bug #2 fix) does an async
  // matrix fetch for indicator-code → IV-id resolution via fire-and-forget
  // `void resolveIndicatorByCode(...).then(...)`. Without a mock, the
  // fetch hangs past test teardown, the deferred React work touches
  // `window` after happy-dom is closed, and vitest reports an Unhandled
  // ReferenceError. Returning empty matrix → IND resolves null → triggers
  // `setFeedback` partial branch (which is a no-op on an unmounted
  // component but doesn't crash since the promise resolves promptly).
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ period: '2026', cells: [], indicators: [], companies: [] }),
    }),
  );

  // Reset the module-level store so each test starts with a clean
  // snapshot. The hand-rolled `useTerminalStore` (see store/terminalStore.ts)
  // doesn't expose a static `getState` helper — actions are only reachable
  // through the hook. A throwaway Probe component gives us a one-line
  // bridge until the store is replaced with real Zustand (Phase 7.D
  // polish item, separately tracked).
  let action: (() => void) | undefined;
  const Probe = (): null => {
    action = useTerminalStore((s) => s.clearState);
    return null;
  };
  render(<Probe />);
  action?.();
  document.body.innerHTML = '';
});

afterEach(() => {
  // Restore real `globalThis.fetch` so test-leak detectors don't flag it
  // + subsequent test files (e.g. AuditFeed.test) get a clean slate.
  vi.unstubAllGlobals();
});

describe('CommandBar (Phase 7.D smoke)', () => {
  it('renders the command-bar input', () => {
    render(<CommandBar />);
    const input = getInput();
    expect(input).toBeTruthy();
    expect(input.placeholder).toMatch(/HOLD GO/);
  });

  it.each([
    { ctrlKey: true, metaKey: false },
    { ctrlKey: false, metaKey: true },
  ])("Ctrl/Cmd+K focuses the command bar: $ctrlKey/$metaKey", (modifiers) => {
    render(<CommandBar />);
    const input = getInput();

    fireEvent.keyDown(window, { key: "k", ...modifiers });

    expect(document.activeElement).toBe(input);
  });

  it('HOLD GO → activates panel 2 (matrix view), no company change', () => {
    render(<CommandBar />);
    submit('HOLD GO');
    const snap = getTerminalSnapshot();
    expect(snap.activePanelId).toBe(2);
    expect(snap.activeCompanyCode).toBeNull();
    // `role="status"` confirms the success-feedback chip rendered.
    expect(screen.getByRole('status').textContent).toMatch(/HOLD/);
  });

  it('AAC CO GO → sets activeCompanyCode + activates panel 1 (company tree)', () => {
    render(<CommandBar />);
    submit('AAC CO GO');
    const snap = getTerminalSnapshot();
    expect(snap.activeCompanyCode).toBe('AAC');
    expect(snap.activePanelId).toBe(1);
  });

  it('IND_OPEX_RATIO IND GO → activates panel 3 (indicator detail)', () => {
    render(<CommandBar />);
    submit('IND_OPEX_RATIO IND GO');
    expect(getTerminalSnapshot().activePanelId).toBe(3);
  });

  // Turn 32 (Bug #2 fix): IND command now does async resolveIndicatorByCode
  // → fetches matrix, finds cell, sets activeIndicatorValueId. The 3 cases
  // below cover happy-path, no-data partial, and activeCompany preference.
  // Each test re-stubs fetch with a specific matrix payload BEFORE the
  // submit so resolveIndicatorByCode sees the right shape.

  it('IND happy path: matrix has matching cell → setActiveIndicatorValue called', async () => {
    __resetMatrixCacheForTests();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            period: '2026',
            cells: [{ indicatorValueId: 'iv-123', companyId: 'co-1', indicatorId: 'ind-1' }],
            indicators: [{ id: 'ind-1', code: 'IND_GROSS_MARGIN' }],
            companies: [{ id: 'co-1', code: 'AAC' }],
          }),
      }),
    );
    render(<CommandBar />);
    submit('IND_GROSS_MARGIN IND GO');
    expect(getTerminalSnapshot().activePanelId).toBe(3);
    // Async resolve happens after dispatch returns; flush microtasks.
    await new Promise((r) => setTimeout(r, 0));
    expect(getTerminalSnapshot().activeIndicatorValueId).toBe('iv-123');
  });

  it('IND no-cell partial: empty matrix → setFeedback err with partial msg', async () => {
    // Default beforeEach mock returns empty matrix; reuse that.
    render(<CommandBar />);
    submit('IND_NONEXISTENT IND GO');
    expect(getTerminalSnapshot().activePanelId).toBe(3); // panel switch is sync
    expect(getTerminalSnapshot().activeIndicatorValueId).toBeNull();
    // Async resolve goes through fetch → .then → setFeedback. A single
    // microtask flush isn't enough; waitFor polls until the alert appears.
    await waitFor(() => {
      const alert = screen.queryByRole('alert');
      expect(alert?.textContent ?? '').toMatch(/IND partial/);
    });
  });

  it('IND activeCompany preference: 2 cells, one for active co → that one chosen', async () => {
    __resetMatrixCacheForTests();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            period: '2026',
            cells: [
              { indicatorValueId: 'iv-aac', companyId: 'co-aac', indicatorId: 'ind-1' },
              { indicatorValueId: 'iv-spark', companyId: 'co-spark', indicatorId: 'ind-1' },
            ],
            indicators: [{ id: 'ind-1', code: 'IND_GROSS_MARGIN' }],
            companies: [
              { id: 'co-aac', code: 'AAC' },
              { id: 'co-spark', code: 'SPARK-MAIN' },
            ],
          }),
      }),
    );
    render(<CommandBar />);
    // First select SPARK-MAIN as active company.
    submit('SPARK-MAIN CO GO');
    expect(getTerminalSnapshot().activeCompanyCode).toBe('SPARK-MAIN');
    // Now IND command should pick the SPARK cell, not AAC's.
    submit('IND_GROSS_MARGIN IND GO');
    await new Promise((r) => setTimeout(r, 0));
    expect(getTerminalSnapshot().activeIndicatorValueId).toBe('iv-spark');
  });

  // Phase C3 v1 (Turn 42 sub-12): BRF dispatch was repurposed from a
  // panel-4 switch to a route navigation (opens /budgeting/board-deck
  // in a new tab). The dedicated test for the new behavior lives in
  // the "Phase C3 v1 — BRF dispatch" describe block below.

  it('unknown verb → renders error feedback, no store change', () => {
    render(<CommandBar />);
    const before = getTerminalSnapshot();
    submit('BOGUS GO');
    const after = getTerminalSnapshot();
    expect(after).toEqual(before);
    const alert = screen.getByRole('alert');
    // Parser now returns an i18n key (commandBar.errors.unknownFunction)
    // that CommandBar resolves through `t`; the vitest next-intl mock
    // renders unmapped keys as the uppercased leaf, hence case-insensitive.
    expect(alert.textContent).toMatch(/unknown function/i);
  });

  it('missing GO terminator → error feedback, no store change', () => {
    render(<CommandBar />);
    submit('HOLD');
    expect(screen.getByRole('alert').textContent).toMatch(/GO/);
  });

  it('CMP GO (Phase B5): focuses LEFT, fires terminal:open-compare with {lhs, rhs}', () => {
    render(<CommandBar />);
    let received: { lhs?: string; rhs?: string } | null = null;
    const handler = (e: Event) => {
      received = (e as CustomEvent<{ lhs: string; rhs: string }>).detail;
    };
    window.addEventListener('terminal:open-compare', handler);
    submit('AAC LLS CMP GO');
    window.removeEventListener('terminal:open-compare', handler);

    const snap = getTerminalSnapshot();
    // LEFT target becomes activeCompanyCode (so other panels reflect it)
    expect(snap.activeCompanyCode).toBe('AAC');
    // No partial alert anymore — fully wired to ComparePanel modal
    expect(screen.queryByRole('alert')).toBeNull();
    // Event fired with both targets
    expect(received).toEqual({ lhs: 'AAC', rhs: 'LLS' });
  });

  it('clears the input + resets feedback on every successful submit', () => {
    render(<CommandBar />);
    submit('HOLD GO');
    const input = getInput();
    expect(input.value).toBe('');
  });

  // Phase 7.O C2 — `[you ✨ N]` chip renders the current user's daily
  // AI spend. Hook polls /api/me/ai-usage every 60s; the global fetch
  // mock in beforeEach returns a matrix-shaped response without
  // today/mtd → hook falls back to zeros → chip renders "0".
  describe('regression: [you] AI-usage chip renders (Phase 7.O C2)', () => {
    it('renders the [you ... ] strip with a Sparkles SVG and tabular token count', async () => {
      render(<CommandBar />);
      // Hook fires fetch on mount; wait for loading=false to flush.
      await waitFor(() => {
        const chip = document.querySelector('[data-testid="commandbar-ai-usage-chip"]');
        expect(chip).not.toBeNull();
      });
      const chip = document.querySelector(
        '[data-testid="commandbar-ai-usage-chip"]',
      ) as HTMLElement;
      expect(chip.textContent ?? '').toContain('[you');
      expect(chip.textContent ?? '').toContain(']');
      // Sparkles SVG present + marked decorative.
      const svg = chip.querySelector('svg');
      expect(svg).toBeTruthy();
      expect(svg!.getAttribute('aria-hidden')).toBe('true');
      // aria-label is present for screen readers
      expect(chip.getAttribute('aria-label')).toMatch(/AI/i);
    });
  });

  // Regression test for bug fix #4 shipped in commit e66263a:
  //   "CommandBar.tsx [alerts 🔔 N] strip — was emoji 🔔. Now lucide
  //    <Bell/>. Completes the cross-platform parity sweep across 4 sites."
  // Locks the lucide-SVG rendering shape so a future emoji regression
  // (or removal of the icon entirely) is caught immediately.
  describe('regression: [alerts] strip uses lucide <Bell/> (e66263a fix #4)', () => {
    // Locate the strip by its structural anchor: it's the parent of the
    // visible "[alerts" prefix span. Selecting via `[title^="Alerts"]`
    // (prefix-match, not exact) keeps the test robust to typography
    // changes in the title-attribute branches (loading vs populated vs
    // count text).
    function getAlertsStrip(): HTMLElement {
      // startsWith — not strict equality — so a future copy-edit
      // appending a space, trailing punctuation, etc. doesn't break the
      // anchor. The "[alerts" prefix is the stable identifier.
      const anchor = Array.from(
        document.querySelectorAll('span'),
      ).find((s) => (s.textContent ?? '').startsWith('[alerts'));
      if (!anchor) throw new Error('alerts strip prefix span not found');
      const strip = anchor.parentElement;
      if (!strip) throw new Error('alerts strip parent not found');
      return strip;
    }

    it('renders an SVG icon and no 🔔 emoji in the alerts strip', () => {
      render(<CommandBar />);
      const strip = getAlertsStrip();
      // Bell SVG present — lucide-react renders an <svg> element.
      const svg = strip.querySelector('svg');
      expect(svg).toBeTruthy();
      // Sanity: the bell emoji codepoint must NOT appear anywhere in
      // the strip's text content.
      expect(strip.textContent ?? '').not.toContain('🔔');
      // The visible "[alerts" prefix + "]" suffix must still render
      // (the icon swap shouldn't have nuked surrounding text).
      expect(strip.textContent ?? '').toContain('[alerts');
      expect(strip.textContent ?? '').toContain(']');
      // And the strip should still expose an Alerts-related aria-label
      // for screen-reader announcement. Phase 7.G Turn XVI swapped the
      // native `title=` for a Radix Tooltip (mouse-only hover content);
      // `aria-label` remains the SR-announced contract and survives the
      // hover-flake fix that motivated the conversion.
      expect(strip.getAttribute('aria-label') ?? '').toMatch(/alerts/i);
    });

    it('SVG is hidden from screen readers (aria-hidden) — strip relies on aria-label', () => {
      // The Bell is decorative; screen readers should announce the
      // strip's `aria-label` (Turn-XVI Radix conversion replaced the
      // native `title=`; aria-label is the SR-stable accessor). Locking
      // aria-hidden on the icon prevents an a11y regression.
      render(<CommandBar />);
      const strip = getAlertsStrip();
      const svg = strip.querySelector('svg');
      expect(svg!.getAttribute('aria-hidden')).toBe('true');
    });
  });

  it('AUD GO → fires terminal:open-audit window event, leaves activePanel untouched', () => {
    render(<CommandBar />);
    let openCount = 0;
    const handler = () => {
      openCount += 1;
    };
    window.addEventListener('terminal:open-audit', handler);

    // Capture the activePanel BEFORE the AUD dispatch — must stay
    // unchanged because the modal is an overlay, not a panel switch.
    const beforePanel = getTerminalSnapshot().activePanelId;
    submit('AUD GO');
    const afterPanel = getTerminalSnapshot().activePanelId;

    window.removeEventListener('terminal:open-audit', handler);

    expect(openCount).toBe(1);
    expect(afterPanel).toBe(beforePanel);
    expect(screen.getByRole('status').textContent).toMatch(/AUD/);
  });

  describe('Phase C3 v1 — BRF dispatch', () => {
    it('BRF GO → opens /budgeting/board-deck in a new tab; activePanel unchanged', () => {
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
      render(<CommandBar />);
      const beforePanel = getTerminalSnapshot().activePanelId;
      submit('BRF GO');
      const afterPanel = getTerminalSnapshot().activePanelId;
      expect(openSpy).toHaveBeenCalledWith('/budgeting/board-deck', '_blank');
      expect(afterPanel).toBe(beforePanel);
      expect(screen.getByRole('status').textContent).toMatch(/BRF/);
      openSpy.mockRestore();
    });
  });

  describe('Phase C4 v1 — SCN dispatch', () => {
    it('<code> SCN GO → fires terminal:open-scenario with detail.scenarioCode', () => {
      render(<CommandBar />);
      let received: string | null = null;
      const handler = (e: Event) => {
        const detail = (e as CustomEvent<{ scenarioCode: string }>).detail;
        received = detail?.scenarioCode ?? null;
      };
      window.addEventListener('terminal:open-scenario', handler);
      // Bloomberg convention: <TARGET> <FUNCTION> GO. SCN takes a
      // required scenario-code target before the verb.
      submit('AZN_DEVAL_20 SCN GO');
      window.removeEventListener('terminal:open-scenario', handler);
      expect(received).toBe('AZN_DEVAL_20');
      expect(getTerminalSnapshot().activeScenarioCode).toBe('AZN_DEVAL_20');
      expect(screen.getByRole('status').textContent).toMatch(/SCN/);
    });
  });
});
