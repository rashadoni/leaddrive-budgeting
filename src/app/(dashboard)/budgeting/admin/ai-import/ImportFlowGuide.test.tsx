// @vitest-environment happy-dom
/**
 * 11.54 — the screen has to say where you are and that it is still working.
 *
 * Two failures this pins:
 *
 *  (a) 11.42a — Step 1 showed NOTHING while it ran. The old banner rendered
 *      on `isProcessing && previewResult`, and submitting Step 1 nulls
 *      `previewResult` first, so 30-90 seconds of AI classification looked
 *      like a frozen page. Measured on the live run: 46 s of silence.
 *
 *  (b) The operator had no map of the flow at all — the first thing on the
 *      page was an entity-alias admin panel.
 *
 * Assertions hang off testids and data-attributes, not translated strings:
 * the suite's global next-intl mock returns stub labels, so asserting on text
 * would pin the mock rather than the behaviour.
 */
import React from "react"
import { describe, it, expect, afterEach, vi } from "vitest"
import { render, screen, cleanup, act } from "@testing-library/react"
import { ImportFlowStrip, ImportRunningBanner } from "./ImportFlowGuide"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("ImportFlowStrip", () => {
  it("shows all four steps", () => {
    render(<ImportFlowStrip current="file" />)
    for (const step of ["file", "analyze", "verify", "write"]) {
      expect(screen.getByTestId(`flow-step-${step}`)).toBeTruthy()
    }
  })

  it("marks the current step active, earlier ones done, later ones todo", () => {
    render(<ImportFlowStrip current="verify" />)
    const state = (s: string) =>
      screen.getByTestId(`flow-step-${s}`).getAttribute("data-state")
    expect(state("file")).toBe("done")
    expect(state("analyze")).toBe("done")
    expect(state("verify")).toBe("active")
    expect(state("write")).toBe("todo")
  })

  it("exposes the active step to assistive tech", () => {
    render(<ImportFlowStrip current="analyze" />)
    expect(
      screen.getByTestId("flow-step-analyze").getAttribute("aria-current"),
    ).toBe("step")
    expect(
      screen.getByTestId("flow-step-write").getAttribute("aria-current"),
    ).toBeNull()
  })
})

describe("ImportRunningBanner", () => {
  it("renders during ANALYSE — the step that used to show nothing at all", () => {
    // (a) above. This is the regression: before 11.54 no banner existed for
    // this phase, because the only one keyed off a preview that does not
    // exist yet.
    render(<ImportRunningBanner phase="analyze" />)
    expect(screen.getByTestId("import-running-analyze")).toBeTruthy()
  })

  it("renders during APPLY", () => {
    render(<ImportRunningBanner phase="apply" />)
    expect(screen.getByTestId("import-running-apply")).toBeTruthy()
  })

  it("announces itself politely rather than stealing focus", () => {
    render(<ImportRunningBanner phase="analyze" />)
    const el = screen.getByTestId("import-running-analyze")
    expect(el.getAttribute("role")).toBe("status")
    expect(el.getAttribute("aria-live")).toBe("polite")
  })

  it("counts the seconds so a long run is visibly alive, not hung", () => {
    vi.useFakeTimers()
    render(<ImportRunningBanner phase="analyze" />)
    const elapsed = () =>
      screen.getByTestId("import-running-elapsed").getAttribute("data-elapsed")

    expect(elapsed()).toBe("0")
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(elapsed()).toBe("3")
  })

  it("says so out loud once the run is unusually long", () => {
    vi.useFakeTimers()
    render(<ImportRunningBanner phase="apply" />)
    expect(screen.queryByTestId("import-running-slow")).toBeNull()
    act(() => {
      vi.advanceTimersByTime(100_000)
    })
    // The apply banner promises 30-90 s (11.42b); past that, silence would
    // read as a stall again. Live multi-year apply took 123 s.
    expect(screen.getByTestId("import-running-slow")).toBeTruthy()
  })

  it("stops its timer on unmount", () => {
    vi.useFakeTimers()
    const { unmount } = render(<ImportRunningBanner phase="analyze" />)
    unmount()
    // A leaked interval would setState on an unmounted tree every second for
    // the rest of the session.
    expect(vi.getTimerCount()).toBe(0)
  })
})
