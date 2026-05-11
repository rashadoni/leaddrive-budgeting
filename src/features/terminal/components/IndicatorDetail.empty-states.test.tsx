// @vitest-environment happy-dom
/**
 * Sub-44 cont'd architectural-debt closure (Round-33 architect ⚠️) —
 * DOM-assertion lock for the centered-empty-state Tailwind classes
 * across IndicatorDetail.tsx's 4 empty-state branches:
 *
 *   - `pendingMissing` (missing-cell hint) — flex flex-col items-center
 *     justify-center (already covered by IndicatorDetail.no-data.test.tsx;
 *     re-asserted here for symmetry across the empty-state surface)
 *   - empty/welcome (no ivId, no pending) — flex flex-col items-center
 *     justify-center
 *   - loading — flex items-center justify-center
 *   - error — flex items-center justify-center
 *
 * Why this file matters: Round-32 + Round-33 architect noted the same
 * complaint TWICE — the empty-state placeholders top-anchored leaving
 * dead space below. Once fixed (Sub-36 cont'd), no DOM-assertion test
 * locked the fix in place. A future Tailwind purge or refactor that
 * accidentally strips `items-center justify-center` would silently
 * regress the UX with no failing test. This file is the regression
 * lock for that class of bug.
 *
 * Each test mocks the store to drive ONE specific branch + asserts both:
 *   (a) the testid is present (proves the right branch fired)
 *   (b) the centered-class atoms (`items-center`, `justify-center`) are
 *       on the rendered container's className
 *
 * Mocking is per-test via vi.doMock() — each branch needs a different
 * store-state shape (active IV vs pending vs neither) which can't share
 * a single module-level mock the way the existing test files do.
 */

import React from "react";
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import {
  render,
  screen,
  cleanup,
} from "@testing-library/react";

beforeEach(() => {
  // Default: no fetch — empty/pending/no-data branches must NOT fetch.
  // Branches that DO fetch (loading + error) override this in their test.
  global.fetch = vi.fn(async () => {
    throw new Error(
      "default fetch should not fire — branch under test must not hit network",
    );
  }) as never;
  vi.resetModules();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.resetModules();
});

// ─── Helper: assert centered-class atoms on a container ─────────────────
// Locks the EXACT class atoms, not the full className string — Tailwind
// rebuilds may reorder classes; we don't care about order, only presence.
function expectCenteredClasses(el: HTMLElement, requireFlexCol = false): void {
  const className = el.className;
  expect(className, `expected items-center on ${el.dataset.testid}`).toMatch(
    /\bitems-center\b/,
  );
  expect(className, `expected justify-center on ${el.dataset.testid}`).toMatch(
    /\bjustify-center\b/,
  );
  expect(className, `expected flex on ${el.dataset.testid}`).toMatch(/\bflex\b/);
  if (requireFlexCol) {
    expect(
      className,
      `expected flex-col on ${el.dataset.testid}`,
    ).toMatch(/\bflex-col\b/);
  }
  // Height + width must reach 100% so centering operates against the
  // full panel slot, not just the content box.
  expect(className, `expected h-full on ${el.dataset.testid}`).toMatch(
    /\bh-full\b/,
  );
  expect(className, `expected w-full on ${el.dataset.testid}`).toMatch(
    /\bw-full\b/,
  );
}

describe("IndicatorDetail empty-state DOM-class invariants (Round-33 ⚠️ closure)", () => {
  it("pendingMissing branch — testid + centered + flex-col", async () => {
    vi.doMock("../store/terminalStore", () => ({
      useTerminalStore: <T,>(
        selector: (s: {
          activeIndicatorValueId: string | null;
          pendingMissingCell: {
            companyId: string;
            companyCode: string;
            indicatorId: string;
            indicatorCode: string;
            indicatorName: string;
          } | null;
          setActivePanel: (id: number) => void;
        }) => T,
      ) =>
        selector({
          activeIndicatorValueId: null,
          pendingMissingCell: {
            companyId: "co_x",
            companyCode: "X-CO",
            indicatorId: "ind_y",
            indicatorCode: "IND_Y",
            indicatorName: "Y",
          },
          setActivePanel: () => {},
        }),
    }));
    const { IndicatorDetail } = await import("./IndicatorDetail");
    render(<IndicatorDetail />);
    const el = screen.getByTestId("indicator-detail-no-data");
    expectCenteredClasses(el, /* requireFlexCol */ true);
  });

  it("empty/welcome branch (no IV + no pending) — renders Today's Brief", async () => {
    // CLI Tier 2 #5 — empty-state placeholder replaced with TodayBrief
    // (top-3 worst / movers / alerts). Test no longer checks centering
    // since TodayBrief manages its own layout (top-aligned scroll list,
    // not centered placeholder text).
    vi.doMock("../store/terminalStore", () => ({
      useTerminalStore: <T,>(
        selector: (s: {
          activeIndicatorValueId: string | null;
          pendingMissingCell: null;
          setActivePanel: (id: number) => void;
          alertMatches: null;
          selectCompany: (c: string) => void;
          setActiveIndicatorValue: (id: string | null) => void;
        }) => T,
      ) =>
        selector({
          activeIndicatorValueId: null,
          pendingMissingCell: null,
          setActivePanel: () => {},
          alertMatches: null,
          selectCompany: () => {},
          setActiveIndicatorValue: () => {},
        }),
    }));
    const { IndicatorDetail } = await import("./IndicatorDetail");
    render(<IndicatorDetail />);
    const el = screen.getByTestId("indicator-detail-empty");
    expect(el).toBeTruthy();
    // TodayBrief is mounted inside; its data-testid should be present.
    const brief = el.querySelector('[data-testid="today-brief"]');
    expect(brief).toBeTruthy();
  });

  it("loading branch — testid + centered (flex row, no flex-col required)", async () => {
    // Drive the loading branch by mocking the store with active IV +
    // returning a never-resolving fetch so the component stays in
    // `setLoading(true)` state.
    vi.doMock("../store/terminalStore", () => ({
      useTerminalStore: <T,>(
        selector: (s: {
          activeIndicatorValueId: string | null;
          pendingMissingCell: null;
          setActivePanel: (id: number) => void;
        }) => T,
      ) =>
        selector({
          activeIndicatorValueId: "iv_test",
          pendingMissingCell: null,
          setActivePanel: () => {},
        }),
    }));
    // Never-resolving fetch → component stays in loading state.
    global.fetch = vi.fn(() => new Promise(() => {})) as never;
    const { IndicatorDetail } = await import("./IndicatorDetail");
    render(<IndicatorDetail />);
    const el = screen.getByTestId("indicator-detail-loading");
    expectCenteredClasses(el, /* requireFlexCol */ false);
  });

  it("error branch — testid + centered (flex row, no flex-col required)", async () => {
    vi.doMock("../store/terminalStore", () => ({
      useTerminalStore: <T,>(
        selector: (s: {
          activeIndicatorValueId: string | null;
          pendingMissingCell: null;
          setActivePanel: (id: number) => void;
        }) => T,
      ) =>
        selector({
          activeIndicatorValueId: "iv_test",
          pendingMissingCell: null,
          setActivePanel: () => {},
        }),
    }));
    // Reject fetch with an error → component flips to error state.
    global.fetch = vi.fn(async () => {
      throw new Error("simulated network failure");
    }) as never;
    const { IndicatorDetail } = await import("./IndicatorDetail");
    render(<IndicatorDetail />);
    // Error branch is async — wait for the testid to appear.
    const el = await screen.findByTestId("indicator-detail-error");
    expectCenteredClasses(el, /* requireFlexCol */ false);
  });
});
