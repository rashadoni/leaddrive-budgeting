// @vitest-environment node
/**
 * Phase 7.D Turn 12 sub-turn — SSR regression guard for `PanelGrid`.
 *
 * The user surfaced a hydration error on `/budgeting/terminal` even
 * though the Turn 9 CLOSED row claimed the page was "fully verified".
 * Root cause: `react-resizable-panels` v4 injects client-only computed
 * styles (`minHeight: 0; maxHeight: 100%; height: auto`) into Panel /
 * Group elements that aren't present in the server-rendered HTML — the
 * exact diff React's hydration error message printed.
 *
 * This test renders `PanelGrid` via `react-dom/server.renderToString`
 * (the same pipeline Next.js uses for SSR) and asserts the output
 * contains the placeholder `aria-hidden="true"` div, NOT the library's
 * `data-panel-group` / `data-panel` markup. If a future library
 * upgrade or accidental refactor regresses the `mounted` gate,
 * SSR-rendered `Group` elements will be visible in the snapshot and
 * this test fails — catching the regression in CI BEFORE a user has
 * to screenshot the hydration error.
 *
 * The `// @vitest-environment node` pragma is critical: `happy-dom`
 * pretends to be a browser, so `useEffect` would still not run during
 * SSR but the runtime would already have `document` / `window`. Using
 * the `node` env mirrors the Next.js SSR runtime exactly.
 */

import { describe, it, expect, vi } from "vitest"
import { renderToString } from "react-dom/server"
import React from "react"

// Mock the terminal store so `useTerminalStore(s => s.activePanelId)`
// returns a stable value during SSR. The hand-rolled store reads from
// module-level state, which is safe to invoke server-side, but mocking
// keeps the test isolated from store state from previous renders.
vi.mock("../store/terminalStore", () => ({
  useTerminalStore: <T,>(selector: (s: {
    activePanelId: number
    setActivePanel: (n: number) => void
  }) => T): T =>
    selector({
      activePanelId: 1,
      setActivePanel: () => {},
    }),
  getTerminalSnapshot: () => ({
    activeCompanyCode: null,
    activeScenarioCode: null,
    activePanelId: 1,
    activeIndicatorValueId: null,
    searchByPanel: {},
  }),
}))

import { PanelGrid } from "./PanelGrid"

describe("PanelGrid SSR (Phase 7.D regression guard)", () => {
  it("server-rendered output is the empty placeholder, NOT the resizable-panels grid", () => {
    const html = renderToString(<PanelGrid />)

    // Placeholder must be present — that's what React hydrates against.
    expect(html).toContain('aria-hidden="true"')

    // NONE of the library's data-attributes should appear in SSR output.
    // `react-resizable-panels` injects these client-side after the
    // container is measured; if they leak into SSR, the next time the
    // library bumps a version we get the original hydration regression.
    expect(html).not.toContain('data-panel-group')
    expect(html).not.toContain('data-group="true"')
    expect(html).not.toContain('data-panel="true"')
    // The library's auto-generated test-id pattern (`_R_...`) was the
    // exact attribute the user's hydration-error diff highlighted.
    expect(html).not.toMatch(/data-testid="_R_/)
  })

  it("placeholder preserves layout dimensions (flex-1 + bg-gray-800)", () => {
    const html = renderToString(<PanelGrid />)
    // Same wrapper className the real grid uses — keeps surrounding
    // layout calculations stable across the placeholder→grid swap.
    expect(html).toContain('class="flex-1 bg-gray-800 relative"')
  })
})
