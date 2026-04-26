// @vitest-environment node
/**
 * Phase 7.D / Turn 15 — SSR hydration-safety regression guard for
 * `WallpaperProvider` + `DashboardWallpaper`.
 *
 * Architect's Turn 12 carryover flagged a potential SSR/CSR mismatch
 * because `WallpaperProvider` reads localStorage. The Turn 15 audit
 * verified the implementation is actually safe: it uses
 * `useState(null)` (not a lazy initializer that would read localStorage
 * eagerly) + `useEffect` to read localStorage post-mount. Initial SSR
 * + first client paint both produce `wallpaper=null`, so React's
 * hydration phase sees identical trees.
 *
 * This test renders the consumer chain via `react-dom/server` and
 * asserts the SSR output is empty (no `<video>` tag, no
 * `data-wallpaper` attribute) — locking the safety in. If a future
 * refactor moves localStorage reading into render or into a lazy
 * `useState` initializer, this test fails before users see hydration
 * warnings in console.
 */

import { describe, it, expect } from "vitest"
import { renderToString } from "react-dom/server"
import React from "react"
import { WallpaperProvider } from "./wallpaper-context"
import { DashboardWallpaper } from "@/components/dashboard-wallpaper"

describe("WallpaperProvider SSR (Phase 7.D regression guard)", () => {
  it("server-rendered DashboardWallpaper produces NO output (no wallpaper active)", () => {
    const html = renderToString(
      <WallpaperProvider>
        <DashboardWallpaper />
      </WallpaperProvider>,
    )
    // Initial state is `wallpaper=null` → `isWallpaperActive=false` →
    // DashboardWallpaper returns null. Server output should be empty.
    expect(html).toBe("")
  })

  it("server-rendered HTML contains no `<video>` tag", () => {
    const html = renderToString(
      <WallpaperProvider>
        <DashboardWallpaper />
      </WallpaperProvider>,
    )
    expect(html).not.toContain("<video")
    expect(html).not.toContain("data-wallpaper")
  })

  it("provider does NOT eagerly read localStorage at render time (would crash SSR)", () => {
    // Sentinel: localStorage is undefined in node env. If provider's
    // initial state used a lazy `useState(() => localStorage.getItem(...))`,
    // this render would throw `ReferenceError: localStorage is not defined`.
    // The fact that this test runs at all proves the localStorage read
    // is gated behind `useEffect` (post-hydration only).
    expect(() => {
      renderToString(
        <WallpaperProvider>
          <div>probe</div>
        </WallpaperProvider>,
      )
    }).not.toThrow()
  })
})
