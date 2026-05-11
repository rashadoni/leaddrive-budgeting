// @vitest-environment happy-dom
/**
 * Phase 7.G Turn CXV (Phase 3.2 — unified loading/error component) —
 * tests for `<DataBoundary>`.
 *
 * Locks the 3-branch render contract + custom-fallback overrides + the
 * loading-wins-over-error semantic.
 */

import React from "react"
import { describe, it, expect, afterEach, vi } from "vitest"
import { render, screen, cleanup, fireEvent } from "@testing-library/react"
import { DataBoundary } from "./data-boundary"

afterEach(() => {
  cleanup()
})

describe("DataBoundary — loading branch", () => {
  it("loading=true → renders default skeleton with role=status + aria-busy", () => {
    render(
      <DataBoundary loading>
        <div data-testid="children">should-not-render</div>
      </DataBoundary>,
    )
    const skel = screen.getByTestId("data-boundary-skeleton")
    expect(skel).toBeTruthy()
    expect(skel.getAttribute("role")).toBe("status")
    expect(skel.getAttribute("aria-busy")).toBe("true")
    expect(screen.queryByTestId("children")).toBeNull()
  })

  it("loading=true with custom loadingFallback → renders custom node", () => {
    render(
      <DataBoundary
        loading
        loadingFallback={<div data-testid="custom-loader">⏳ wait</div>}
      >
        <div>kid</div>
      </DataBoundary>,
    )
    expect(screen.getByTestId("custom-loader")).toBeTruthy()
    expect(screen.queryByTestId("data-boundary-skeleton")).toBeNull()
  })
})

describe("DataBoundary — error branch", () => {
  it("error=string → renders default alert with role=alert + the message", () => {
    render(
      <DataBoundary error="Failed to fetch data">
        <div data-testid="children">should-not-render</div>
      </DataBoundary>,
    )
    const alert = screen.getByTestId("data-boundary-error")
    expect(alert.getAttribute("role")).toBe("alert")
    expect(alert.textContent).toContain("Failed to fetch data")
    expect(screen.queryByTestId("children")).toBeNull()
  })

  it("error=Error object → uses .message property", () => {
    render(<DataBoundary error={new Error("network down")}>kid</DataBoundary>)
    expect(screen.getByTestId("data-boundary-error").textContent).toContain(
      "network down",
    )
  })

  it("error + onRetry → renders Retry button; click fires callback", () => {
    const retry = vi.fn()
    render(
      <DataBoundary error="boom" onRetry={retry}>
        kid
      </DataBoundary>,
    )
    const button = screen.getByTestId("data-boundary-retry")
    expect(button).toBeTruthy()
    fireEvent.click(button)
    expect(retry).toHaveBeenCalledOnce()
  })

  it("error WITHOUT onRetry → no Retry button rendered", () => {
    render(<DataBoundary error="boom">kid</DataBoundary>)
    expect(screen.queryByTestId("data-boundary-retry")).toBeNull()
  })

  it("error + custom errorFallback → renders custom node with message + retry", () => {
    const retry = vi.fn()
    render(
      <DataBoundary
        error="x"
        onRetry={retry}
        errorFallback={(msg, onRetry) => (
          <div data-testid="custom-error">
            <span>err:{msg}</span>
            {onRetry && (
              <button data-testid="custom-retry" onClick={onRetry}>
                R
              </button>
            )}
          </div>
        )}
      >
        kid
      </DataBoundary>,
    )
    expect(screen.getByTestId("custom-error").textContent).toContain("err:x")
    fireEvent.click(screen.getByTestId("custom-retry"))
    expect(retry).toHaveBeenCalledOnce()
    // Default alert NOT rendered when custom override supplied
    expect(screen.queryByTestId("data-boundary-error")).toBeNull()
  })
})

describe("DataBoundary — loaded branch + precedence", () => {
  it("loading=false + error=null → renders children", () => {
    render(
      <DataBoundary>
        <div data-testid="children">loaded content</div>
      </DataBoundary>,
    )
    expect(screen.getByTestId("children").textContent).toBe("loaded content")
    expect(screen.queryByTestId("data-boundary-skeleton")).toBeNull()
    expect(screen.queryByTestId("data-boundary-error")).toBeNull()
  })

  it("loading=true AND error set → loading wins (no flicker on retry cycle)", () => {
    render(
      <DataBoundary loading error="stale error">
        <div data-testid="children">x</div>
      </DataBoundary>,
    )
    expect(screen.getByTestId("data-boundary-skeleton")).toBeTruthy()
    expect(screen.queryByTestId("data-boundary-error")).toBeNull()
    expect(screen.queryByTestId("children")).toBeNull()
  })
})
