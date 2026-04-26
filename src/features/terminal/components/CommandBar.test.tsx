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
import { render, screen, fireEvent } from '@testing-library/react';
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

  it('CMP partial: focuses LEFT target + shows partial warning chip', () => {
    render(<CommandBar />);
    submit('AAC LLS CMP GO');
    const snap = getTerminalSnapshot();
    // CommandBar.tsx sets the LEFT target via setCompany and routes to
    // panelForCommand which is panel 2 for cmp.
    expect(snap.activeCompanyCode).toBe('AAC');
    expect(snap.activePanelId).toBe(2);
    // The partial-dispatch contract surfaces a warning, not a green chip,
    // so the user sees that RIGHT was parsed but the side-by-side panel
    // is pending.
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/CMP partial/);
    expect(alert.textContent).toMatch(/LLS/);
  });

  it('clears the input + resets feedback on every successful submit', () => {
    render(<CommandBar />);
    submit('HOLD GO');
    const input = getInput();
    expect(input.value).toBe('');
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
