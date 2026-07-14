// @vitest-environment happy-dom
/**
 * 2026-07-15 — guard tests for the PeriodChips year row.
 *
 * The terminal previously rendered ONE annual chip (the active year) with no
 * way to navigate across fiscal years: the matrix API's data-aware default
 * (last complete year) became a trap — data imported for the in-progress
 * year was unreachable. These tests lock the `availableYears` contract.
 */
import { describe, it, expect, afterEach } from "vitest"
import { render, screen, cleanup, fireEvent } from "@testing-library/react"
import { PeriodChips } from "./PeriodChips"

afterEach(cleanup)

describe("PeriodChips year row", () => {
  it("renders one annual chip per availableYear", () => {
    render(
      <PeriodChips
        current="2025"
        onChange={() => {}}
        availableYears={[2024, 2025, 2026]}
      />,
    )
    expect(screen.getByRole("button", { name: "2024" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "2025" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "2026" })).toBeTruthy()
  })

  it("clicking another year dispatches that year's annual period", () => {
    let dispatched: string | null = null
    render(
      <PeriodChips
        current="2025"
        onChange={(p) => {
          dispatched = p
        }}
        availableYears={[2025, 2026]}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "2026" }))
    expect(dispatched).toBe("2026")
  })

  it("always includes the active year even when absent from availableYears", () => {
    render(
      <PeriodChips current="2023" onChange={() => {}} availableYears={[2026]} />,
    )
    expect(screen.getByRole("button", { name: "2023" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "2026" })).toBeTruthy()
  })

  it("without availableYears falls back to the single active-year chip", () => {
    render(<PeriodChips current="2025" onChange={() => {}} />)
    expect(screen.getByRole("button", { name: "2025" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "2026" })).toBeNull()
  })

  it("marks only the selected annual chip as pressed", () => {
    render(
      <PeriodChips
        current="2025"
        onChange={() => {}}
        availableYears={[2025, 2026]}
      />,
    )
    expect(
      screen.getByRole("button", { name: "2025" }).getAttribute("aria-pressed"),
    ).toBe("true")
    expect(
      screen.getByRole("button", { name: "2026" }).getAttribute("aria-pressed"),
    ).toBe("false")
  })

  it("quarter selection keeps the year chips and quarter targets the active year", () => {
    let dispatched: string | null = null
    render(
      <PeriodChips
        current="2026-Q2"
        onChange={(p) => {
          dispatched = p
        }}
        availableYears={[2025, 2026]}
      />,
    )
    // Q3 of the active (2026) year
    fireEvent.click(screen.getByRole("button", { name: "Q3" }))
    expect(dispatched).toBe("2026-Q3")
    // Year chips still present for cross-year jumps
    expect(screen.getByRole("button", { name: "2025" })).toBeTruthy()
  })
})
