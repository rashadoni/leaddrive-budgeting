/**
 * Phase 7.G Turn XXXI — PanelGrid drag-resize Playwright spec.
 *
 * Closes CARRYOVER L430 (Phase 7.D test extension residual from Turn XXX —
 * 5/6 components had vitest coverage, drag-resize is the 6th and the only
 * one that requires Playwright because `react-resizable-panels` v4 listens
 * to native pointer events that JSDOM/happy-dom do not faithfully simulate).
 *
 * Why drag-resize is worth a dedicated spec:
 *   - The user-facing "remember last session" contract is implemented as
 *     a localStorage autosave on every drag (`PanelGrid.tsx:94-103,307,
 *     315,348`). Regressions here silently break the layout-restore path
 *     for every returning user.
 *   - The 3-Group nested layout is structurally fragile — any future swap
 *     of `react-resizable-panels` for an alternative lib OR an upgrade to
 *     v5 with breaking pointer-event semantics would land green in vitest
 *     and red here.
 *
 * Coverage shape (2 tests):
 *   1. Horizontal drag of the col-resize handle between Panel 1 (CompanyTree)
 *      and Panel 2 (HeatMap) → assert `terminal-layout-v1-top` localStorage
 *      autosave reflects the new split, panel `p1` grew, sum ≈ 100.
 *   2. Vertical drag of the row-resize handle between outerTop and
 *      outerBottom → assert `terminal-layout-v1-outer` autosave, `row-top`
 *      grew, sum ≈ 100.
 *
 * Why localStorage and not bounding-rect deltas:
 *   - Bounding rects depend on viewport, which varies across machines + CI.
 *   - localStorage autosave is the load-bearing contract; pinning it covers
 *     `makeOnLayoutChanged` end-to-end and is viewport-independent.
 *
 * Pre-conditions (mirror existing specs in this dir):
 *   - Dev server on http://localhost:3000 (LaunchAgent / Docker)
 *   - Admin user seeded; loginAs() succeeds
 *   - Postgres has ≥1 operational company (HeatMap renders ≥1 cell so the
 *     panels mount with their full grid — pre-mount the grid is a placeholder
 *     div with no separators)
 */

import { expect, test } from '@playwright/test';
import { loginAs } from '../fixtures/auth';

const STORAGE_KEY_TOP = 'terminal-layout-v1-top';
const STORAGE_KEY_OUTER = 'terminal-layout-v1-outer';
const STORAGE_KEY_WELCOME = 'terminal-welcome-hint-v1';

type LayoutBlob = Record<string, number>;

/**
 * Walk the cursor across N intermediate steps. Single big `mouse.move()`
 * jumps are silently dropped by some pointermove handlers (including
 * `react-resizable-panels`'s drag-tracking) because the lib reads the
 * delta from the pointermove event, not the absolute cursor position
 * before/after. Stepped moves emit N events with monotonic deltas — the
 * contract every well-behaved drag-aware lib expects.
 */
async function steppedDrag(
  page: import('@playwright/test').Page,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): Promise<void> {
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  const steps = 6;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await page.mouse.move(
      startX + (endX - startX) * t,
      startY + (endY - startY) * t,
    );
  }
  await page.mouse.up();
}

test.describe('Phase 7.G Turn XXXI — PanelGrid drag-resize', () => {
  test('horizontal drag (col-resize between p1/p2) updates top localStorage', async ({
    page,
  }) => {
    // Pre-dismiss WelcomeHint so the modal does not overlay the separator.
    // Same pattern as visual-baseline.spec.ts:60-69.
    await page.context().addInitScript((key) => {
      try {
        window.localStorage.setItem(key, '1');
      } catch {
        // Private mode etc. — drag will still work, the modal just covers
        // part of HeatMap; the col-resize handle is to the LEFT of HeatMap
        // so the click target itself is not occluded.
      }
    }, STORAGE_KEY_WELCOME);

    await loginAs(page);
    await page.goto('/budgeting/terminal');

    // Wait for the matrix table to mount — same proxy used in
    // login-and-terminal.spec.ts:67-73 to know the panels are present
    // (PanelGrid is gated on a `mounted` state hook; pre-mount it returns
    // an empty placeholder div with no separators inside).
    const matrixTable = page.getByRole('table').first();
    await expect(matrixTable).toBeVisible({ timeout: 15_000 });

    // The first separator with aria-orientation="vertical" is the
    // col-resize handle between Panel 1 and Panel 2 (the top Group's
    // orientation="horizontal" → its Separator runs vertically between
    // the two horizontal-direction panels). The bottom Group's separator
    // (between p3/p4) is the second one in document order.
    const colHandle = page
      .locator('[role="separator"][aria-orientation="vertical"]')
      .first();
    await expect(colHandle).toBeVisible();

    // Read the initial top-row layout from localStorage. First mount
    // typically has no autosave entry yet; in that case the assertion
    // baseline is `DEFAULT_LAYOUT_SIZES.top` = {p1:35, p2:65}.
    const initialTop = await page.evaluate<LayoutBlob, string>((key) => {
      try {
        const raw = window.localStorage.getItem(key);
        return raw ? (JSON.parse(raw) as LayoutBlob) : { p1: 35, p2: 65 };
      } catch {
        return { p1: 35, p2: 65 };
      }
    }, STORAGE_KEY_TOP);
    const initialP1 = initialTop.p1 ?? 35;

    // Drag the handle ~150px to the right — Panel 1 grows, Panel 2 shrinks.
    const box = await colHandle.boundingBox();
    expect(box, 'col-resize handle must have a bounding box').not.toBeNull();
    if (!box) return;
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;
    await steppedDrag(page, startX, startY, startX + 150, startY);

    // Wait for the autosave to land AND p1 to have grown. Using a
    // condition predicate (not a fixed sleep) keeps the spec stable
    // against slow CI environments where the next-animation-frame
    // commit can be later than a hardcoded settle window. Predicate
    // also acts as the first-line failure detector — if the drag
    // didn't actually move the panel, this times out fast with a
    // clear "waitForFunction timeout" signal.
    await page.waitForFunction(
      ({ key, baseline }) => {
        try {
          const raw = window.localStorage.getItem(key);
          if (!raw) return false;
          const parsed = JSON.parse(raw) as Record<string, number>;
          return typeof parsed.p1 === 'number' && parsed.p1 > baseline;
        } catch {
          return false;
        }
      },
      { key: STORAGE_KEY_TOP, baseline: initialP1 },
      { timeout: 5_000 },
    );

    const finalTop = await page.evaluate<LayoutBlob | null, string>(
      (key) => {
        try {
          const raw = window.localStorage.getItem(key);
          return raw ? (JSON.parse(raw) as LayoutBlob) : null;
        } catch {
          return null;
        }
      },
      STORAGE_KEY_TOP,
    );

    expect(finalTop, 'autosave must have written the top-group layout').not.toBeNull();
    if (!finalTop) return;
    expect(typeof finalTop.p1).toBe('number');
    expect(typeof finalTop.p2).toBe('number');
    expect(finalTop.p1).toBeGreaterThan(initialP1);
    expect(finalTop.p1 + finalTop.p2).toBeGreaterThan(99);
    expect(finalTop.p1 + finalTop.p2).toBeLessThan(101);
  });

  test('vertical drag (row-resize between outerTop/outerBottom) updates outer localStorage', async ({
    page,
  }) => {
    await page.context().addInitScript((key) => {
      try {
        window.localStorage.setItem(key, '1');
      } catch {
        // see horizontal test rationale.
      }
    }, STORAGE_KEY_WELCOME);

    await loginAs(page);
    await page.goto('/budgeting/terminal');

    const matrixTable = page.getByRole('table').first();
    await expect(matrixTable).toBeVisible({ timeout: 15_000 });

    // The single separator with aria-orientation="horizontal" is the
    // row-resize handle between outerTop and outerBottom (the outer
    // Group's orientation="vertical" → its Separator runs horizontally
    // between the two vertical-direction panels). There is exactly one
    // in the rendered tree — the inner Groups are horizontal, so all
    // their separators are aria-orientation="vertical" and don't
    // collide with this selector.
    const rowHandle = page
      .locator('[role="separator"][aria-orientation="horizontal"]')
      .first();
    await expect(rowHandle).toBeVisible();

    const initialOuter = await page.evaluate<LayoutBlob, string>((key) => {
      try {
        const raw = window.localStorage.getItem(key);
        return raw
          ? (JSON.parse(raw) as LayoutBlob)
          : { 'row-top': 55, 'row-bottom': 45 };
      } catch {
        return { 'row-top': 55, 'row-bottom': 45 };
      }
    }, STORAGE_KEY_OUTER);
    const initialRowTop = initialOuter['row-top'] ?? 55;

    const box = await rowHandle.boundingBox();
    expect(box, 'row-resize handle must have a bounding box').not.toBeNull();
    if (!box) return;
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;
    // Smaller delta — outerTop has minSize:20, and the bottom inner Group
    // also has minSize constraints, so a 150px drag could clip. 80px
    // keeps us comfortably inside the valid range.
    await steppedDrag(page, startX, startY, startX, startY + 80);

    // Predicate-based wait (CI-stable) — see horizontal test rationale.
    await page.waitForFunction(
      ({ key, baseline }) => {
        try {
          const raw = window.localStorage.getItem(key);
          if (!raw) return false;
          const parsed = JSON.parse(raw) as Record<string, number>;
          return typeof parsed['row-top'] === 'number' && parsed['row-top'] > baseline;
        } catch {
          return false;
        }
      },
      { key: STORAGE_KEY_OUTER, baseline: initialRowTop },
      { timeout: 5_000 },
    );

    const finalOuter = await page.evaluate<LayoutBlob | null, string>(
      (key) => {
        try {
          const raw = window.localStorage.getItem(key);
          return raw ? (JSON.parse(raw) as LayoutBlob) : null;
        } catch {
          return null;
        }
      },
      STORAGE_KEY_OUTER,
    );

    expect(finalOuter, 'autosave must have written the outer layout').not.toBeNull();
    if (!finalOuter) return;
    const top = finalOuter['row-top'];
    const bottom = finalOuter['row-bottom'];
    expect(typeof top).toBe('number');
    expect(typeof bottom).toBe('number');
    expect(top).toBeGreaterThan(initialRowTop);
    expect(top + bottom).toBeGreaterThan(99);
    expect(top + bottom).toBeLessThan(101);
  });
});
