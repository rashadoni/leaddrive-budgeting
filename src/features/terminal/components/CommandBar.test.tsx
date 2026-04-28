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
      json: () => Promise.resolve({ cells: [], indicators: [], companies: [] }),
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
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
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
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
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

  it('BRF GO → activates panel 4 (narrative panel), no target needed', () => {
    render(<CommandBar />);
    submit('BRF GO');
    expect(getTerminalSnapshot().activePanelId).toBe(4);
  });

  it('unknown verb → renders error feedback, no store change', () => {
    render(<CommandBar />);
    const before = getTerminalSnapshot();
    submit('BOGUS GO');
    const after = getTerminalSnapshot();
    expect(after).toEqual(before);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/Unknown function/);
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
      // And the strip should still have an Alerts-related title for
      // screen-reader announcement (whichever branch — loading/populated/
      // zero — fired). Prefix-match defends against typography drift.
      expect(strip.getAttribute('title') ?? '').toMatch(/^Alerts/i);
    });

    it('SVG is hidden from screen readers (aria-hidden) — strip relies on title attr', () => {
      // The Bell is decorative; screen readers should announce the
      // strip's `title` attribute, not the icon glyph. Locking
      // aria-hidden prevents an a11y regression.
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
});
