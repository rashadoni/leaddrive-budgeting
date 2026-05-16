// @vitest-environment happy-dom
/**
 * Phase 3.3 — P&L drill-down side panel tests.
 *
 * Locks the visible contract: header shows account, summary card shows
 * plan/actual/Δ, 12 monthly rows render, ESC + backdrop + × button all
 * close, variance sign is reflected in the color tone.
 */
import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { BudgetPnlDrillPanel, type DrillRow } from "./budget-pnl-drill-panel"

afterEach(() => cleanup())

const ROW: DrillRow = {
  accountCode: "701-01",
  accountName: "Net Sales — Domestic",
  accountType: "revenue",
  monthly: {
    1: 100_000, 2: 120_000, 3: 110_000, 4: 130_000, 5: 140_000, 6: 135_000,
    7: 150_000, 8: 145_000, 9: 160_000, 10: 155_000, 11: 165_000, 12: 170_000,
  },
  total: 1_680_000,
}

const ACTUAL_MONTHLY = {
  1: 95_000, 2: 130_000, 3: 105_000, 4: 0, 5: 0, 6: 0,
  7: 0, 8: 0, 9: 0, 10: 0, 11: 0, 12: 0,
}

describe("BudgetPnlDrillPanel", () => {
  it("renders account header with name + code + type", () => {
    render(<BudgetPnlDrillPanel row={ROW} onClose={() => {}} />)
    expect(screen.getByText("Net Sales — Domestic")).toBeTruthy()
    expect(screen.getByText("701-01")).toBeTruthy()
    expect(screen.getByText(/revenue/i)).toBeTruthy()
  })

  it("renders 12 monthly rows in the breakdown table", () => {
    render(<BudgetPnlDrillPanel row={ROW} onClose={() => {}} />)
    const tbody = screen.getByTestId("pnl-drill-monthly-tbody")
    const rows = within(tbody).getAllByRole("row")
    expect(rows).toHaveLength(12)
  })

  it("summary card shows plan / actual / Δ totals", () => {
    render(
      <BudgetPnlDrillPanel
        row={ROW}
        actualMonthly={ACTUAL_MONTHLY}
        onClose={() => {}}
      />,
    )
    // Plan total = 1,680,000. Appears in summary card AND tfoot, so
    // we assert occurrence count via getAllByText.
    expect(screen.getAllByText("1,680,000")).toHaveLength(2)
    // Actual = 95k + 130k + 105k = 330,000 (also in summary + tfoot)
    expect(screen.getAllByText("330,000")).toHaveLength(2)
    // Variance = actual(330k) - plan(1680k) = -1,350,000
    expect(screen.getAllByText("-1,350,000")).toHaveLength(2)
  })

  it("× button triggers onClose", () => {
    const onClose = vi.fn()
    render(<BudgetPnlDrillPanel row={ROW} onClose={onClose} />)
    const closeBtn = screen.getByRole("button", { name: /close/i })
    fireEvent.click(closeBtn)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("backdrop click triggers onClose", () => {
    const onClose = vi.fn()
    render(<BudgetPnlDrillPanel row={ROW} onClose={onClose} />)
    fireEvent.click(screen.getByTestId("pnl-drill-backdrop"))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("Escape key triggers onClose", () => {
    const onClose = vi.fn()
    render(<BudgetPnlDrillPanel row={ROW} onClose={onClose} />)
    fireEvent.keyDown(window, { key: "Escape" })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("variance positive (actual > plan) renders in green tone class", () => {
    // Override actual to exceed plan in Jan only — easier to assert
    const positiveActual = { 1: 500_000 }
    render(
      <BudgetPnlDrillPanel
        row={{ ...ROW, monthly: { 1: 100_000 }, total: 100_000 }}
        actualMonthly={positiveActual}
        onClose={() => {}}
      />,
    )
    const tbody = screen.getByTestId("pnl-drill-monthly-tbody")
    const janRow = tbody.querySelector('[data-month="1"]')
    expect(janRow).toBeTruthy()
    // Variance cell is the 4th td (idx 3).
    const cells = janRow!.querySelectorAll("td")
    expect(cells[3].className).toMatch(/emerald/)
  })

  it("variance negative (actual < plan) renders in red tone class", () => {
    const negativeActual = { 1: 50_000 }
    render(
      <BudgetPnlDrillPanel
        row={{ ...ROW, monthly: { 1: 100_000 }, total: 100_000 }}
        actualMonthly={negativeActual}
        onClose={() => {}}
      />,
    )
    const tbody = screen.getByTestId("pnl-drill-monthly-tbody")
    const janRow = tbody.querySelector('[data-month="1"]')
    const cells = janRow!.querySelectorAll("td")
    expect(cells[3].className).toMatch(/red/)
  })

  it("aria-label includes account name (dialog role)", () => {
    render(<BudgetPnlDrillPanel row={ROW} onClose={() => {}} />)
    const dialog = screen.getByRole("dialog")
    expect(dialog.getAttribute("aria-label")).toContain("Net Sales — Domestic")
  })
})
