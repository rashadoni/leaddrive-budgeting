// @vitest-environment happy-dom
/**
 * Phase 7.G Turn CXIV (Phase 7.B v2 Day 4 — slice 3 page wiring) — tests
 * for `OnboardingWizardSwitcher`. Locks the default-mode + toggle behavior.
 *
 * Children (`ImportWizard` and `ImportWizardMulti`) are mocked to
 * sentinel divs — this test exercises ONLY the switcher's mode state +
 * conditional render. The children's own behavior is covered exhaustively
 * by their dedicated test files (CXII + CXIII).
 */

import React from "react"
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { render, screen, cleanup, fireEvent } from "@testing-library/react"

vi.mock("./ImportWizard", () => ({
  ImportWizard: () => <div data-testid="single-wizard-stub">single-stub</div>,
}))
vi.mock("./ImportWizardMulti", () => ({
  ImportWizardMulti: () => <div data-testid="multi-wizard-stub">multi-stub</div>,
}))

import { OnboardingWizardSwitcher } from "./OnboardingWizardSwitcher"

beforeEach(() => {
  // No fetch mocks needed — children are stubbed.
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("OnboardingWizardSwitcher — initial render", () => {
  it("mounts in default 'multi' mode → ImportWizardMulti rendered, ImportWizard NOT rendered", () => {
    render(<OnboardingWizardSwitcher />)
    expect(screen.getByTestId("onboarding-wizard-switcher")).toBeTruthy()
    expect(screen.getByTestId("multi-wizard-stub")).toBeTruthy()
    expect(screen.queryByTestId("single-wizard-stub")).toBeNull()
  })

  it("multi button is initially pressed (aria-pressed=true)", () => {
    render(<OnboardingWizardSwitcher />)
    const multiBtn = screen.getByTestId("mode-multi-button")
    const singleBtn = screen.getByTestId("mode-single-button")
    expect(multiBtn.getAttribute("aria-pressed")).toBe("true")
    expect(singleBtn.getAttribute("aria-pressed")).toBe("false")
  })

  it("multi button label includes 'default' marker", () => {
    render(<OnboardingWizardSwitcher />)
    const multiBtn = screen.getByTestId("mode-multi-button")
    expect(multiBtn.textContent?.toLowerCase()).toContain("default")
  })
})

describe("OnboardingWizardSwitcher — toggle behavior", () => {
  it("clicking 'Single sheet' switches to single wizard", () => {
    render(<OnboardingWizardSwitcher />)
    fireEvent.click(screen.getByTestId("mode-single-button"))
    expect(screen.getByTestId("single-wizard-stub")).toBeTruthy()
    expect(screen.queryByTestId("multi-wizard-stub")).toBeNull()
    // aria-pressed flips
    expect(screen.getByTestId("mode-single-button").getAttribute("aria-pressed")).toBe("true")
    expect(screen.getByTestId("mode-multi-button").getAttribute("aria-pressed")).toBe("false")
  })

  it("toggle back: single → multi → single returns to multi-wizard mounted", () => {
    render(<OnboardingWizardSwitcher />)
    // Start: multi
    fireEvent.click(screen.getByTestId("mode-single-button"))
    expect(screen.getByTestId("single-wizard-stub")).toBeTruthy()
    fireEvent.click(screen.getByTestId("mode-multi-button"))
    expect(screen.getByTestId("multi-wizard-stub")).toBeTruthy()
    expect(screen.queryByTestId("single-wizard-stub")).toBeNull()
  })

  it("conditional render: only ONE wizard is mounted at a time (state isolation)", () => {
    render(<OnboardingWizardSwitcher />)
    // multi mode → single stub absent
    expect(screen.queryByTestId("single-wizard-stub")).toBeNull()
    // switch → multi stub absent
    fireEvent.click(screen.getByTestId("mode-single-button"))
    expect(screen.queryByTestId("multi-wizard-stub")).toBeNull()
  })
})
