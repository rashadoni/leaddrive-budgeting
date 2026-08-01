// @vitest-environment happy-dom
/**
 * The gate, rendered. The most important assertion in this file is the first
 * one: the red button is dead on an empty preview. Today's check is
 * `preview.rowsAffected >= 0`, which is true of every number a count can
 * return.
 */
import { describe, it, expect, afterEach, vi } from "vitest"
import { render, screen, cleanup, fireEvent } from "@testing-library/react"

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) => {
    if (!vars) return key
    return `${key}(${Object.entries(vars).map(([k, v]) => `${k}=${v}`).join(",")})`
  },
}))

import { ConfirmStrip } from "./ConfirmStrip"
import { gateFor } from "@/features/admin/lib/delete-data/tier"

afterEach(cleanup)

const REASON = "Replacing the draft file with the signed accounts"

function setup(
  overrides: Partial<React.ComponentProps<typeof ConfirmStrip>> = {},
) {
  const onSubmit = vi.fn()
  const props: React.ComponentProps<typeof ConfirmStrip> = {
    gate: gateFor({
      task: "clearYears",
      companyCodes: ["AZSEKER-CPC"],
      allYears: false,
      hasPermanent: false,
    }),
    breakdown: { budgetLine: 1284 },
    reason: REASON,
    onReason: () => {},
    token: "AZSEKER-CPC",
    onToken: () => {},
    armedAt: 0,
    running: false,
    hardStop: false,
    stale: false,
    submitLabel: "submit",
    onSubmit,
    ...overrides,
  }
  render(<ConfirmStrip {...props} />)
  return { onSubmit, button: screen.getByTestId("confirm-submit") as HTMLButtonElement }
}

describe("ConfirmStrip", () => {
  it("is enabled only when everything the tier asks for is present", () => {
    const { button } = setup()
    expect(button.disabled).toBe(false)
  })

  it("is DISABLED when the preview found nothing to delete", () => {
    const { button } = setup({ breakdown: {} })
    expect(button.disabled).toBe(true)
  })

  it("is disabled while the preview is stale", () => {
    const { button } = setup({ stale: true })
    expect(button.disabled).toBe(true)
  })

  it("is disabled until the token matches exactly", () => {
    expect(setup({ token: "azseker-cpc" }).button.disabled).toBe(true)
    cleanup()
    // "ALL" is the token this operator's hands already know from the old
    // panel. At tier 1 it means nothing.
    expect(setup({ token: "ALL" }).button.disabled).toBe(true)
  })

  it("asks for the company code at tier 1 and for ALL at tier 2", () => {
    cleanup()
    setup()
    expect(screen.getByText("confirm.tokenLabel(code=AZSEKER-CPC)")).toBeTruthy()
    expect(screen.getByText("confirm.tokenHintCompany")).toBeTruthy()
    cleanup()
    setup({
      gate: gateFor({
        task: "clearYears",
        companyCodes: ["A", "B", "C", "D"],
        allYears: true,
        hasPermanent: false,
      }),
      token: "ALL",
    })
    expect(screen.getByText("confirm.tokenLabel(code=ALL)")).toBeTruthy()
    expect(screen.getByText("confirm.tokenHintAll")).toBeTruthy()
  })

  it("requires a separate tick for each unrecoverable category", () => {
    const { button } = setup({
      breakdown: { budgetLine: 100, budgetActualManual: 12, orphanBudgetLine: 5 },
      // One company, but something unrecoverable is in scope — Tier 2. The
      // token stays the company's own code, because that is what the body
      // this scope produces makes the route demand.
      gate: gateFor({
        task: "clearYears",
        companyCodes: ["AZSEKER-CPC"],
        allYears: false,
        hasPermanent: true,
      }),
      token: "AZSEKER-CPC",
    })
    const ticks = screen.getAllByRole("checkbox") as HTMLInputElement[]
    expect(ticks).toHaveLength(2)
    expect(button.disabled).toBe(true)
    fireEvent.click(ticks[0])
    expect(button.disabled).toBe(true)
    fireEvent.click(ticks[1])
    expect(button.disabled).toBe(false)
  })

  it("holds Task D behind a countdown, and shows it", () => {
    const { button } = setup({
      gate: gateFor({
        task: "deleteAll",
        companyCodes: ["A", "B", "C"],
        allYears: true,
        hasPermanent: true,
      }),
      token: "ALL",
      reason: "Fresh start before the 2027 budget cycle",
      armedAt: Date.now(),
    })
    expect(button.disabled).toBe(true)
    expect(screen.getByText(/confirm.arming/)).toBeTruthy()
  })

  it("refuses a reason too short for the tier", () => {
    expect(setup({ reason: "oops" }).button.disabled).toBe(true)
  })

  it("never fires submit while the hard stop is up", () => {
    const { button, onSubmit } = setup({ hardStop: true })
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(onSubmit).not.toHaveBeenCalled()
  })
})

describe("ConfirmStrip — why the button is dead", () => {
  it("says what is missing when the reason and the token are empty", () => {
    // Empty reason + empty token used to be a dead red button and silence:
    // `reason.tooShort` only appears once you have typed something.
    setup({ reason: "", token: "" })
    expect(
      screen.getByText("confirm.blocked(code=AZSEKER-CPC)"),
    ).toBeTruthy()
  })

  it("stays quiet once the form is complete", () => {
    setup()
    expect(screen.queryByText(/confirm\.blocked/)).toBeNull()
  })

  it("stays quiet when the blocker is the stale preview, which says so itself", () => {
    setup({ stale: true, reason: "", token: "" })
    expect(screen.queryByText(/confirm\.blocked/)).toBeNull()
  })

  it("asks for the COMPANY CODE at tier 2 when the body names one company", () => {
    // The gate and the route agree; the hint must agree with both. Telling the
    // operator "this covers more than one company" while the box wants "ACME"
    // is the same class of lie as the token itself was.
    setup({
      gate: gateFor({
        task: "removeCompany",
        companyCodes: ["AZSEKER-CPC"],
        allYears: true,
        hasPermanent: true,
      }),
    })
    expect(screen.getByText("confirm.tokenLabel(code=AZSEKER-CPC)")).toBeTruthy()
    expect(screen.getByText("confirm.tokenHintCompany")).toBeTruthy()
  })
})
