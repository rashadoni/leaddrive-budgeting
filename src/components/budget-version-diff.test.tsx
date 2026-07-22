// @vitest-environment happy-dom
import React from "react"
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next-intl", () => ({
  useLocale: () => "en-GB",
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    key === "plansDiffChangeCount" ? `${vars?.count} changes` : key,
}))

import { BudgetVersionDiff } from "./budget-version-diff"

afterEach(cleanup)

describe("BudgetVersionDiff evidence rendering", () => {
  it("keeps an absent side as a dash, preserves evidenced zero, and shows confirmed currency", () => {
    render(<BudgetVersionDiff
      currencyCode="USD"
      versionLabelA="v1"
      versionLabelB="v2"
      data={{
        planA: "p1",
        planB: "p2",
        totalChanges: 2,
        diff: [
          { category: "4100", department: null, lineType: "revenue", planA: 0, planB: 0, delta: 0, status: "added" },
          { category: "5200", department: "Ops", lineType: "expense", planA: 1200, planB: 0, delta: -1200, status: "removed" },
        ],
      }}
    />)

    const rows = screen.getByTestId("plans-version-diff").querySelectorAll("tbody tr")
    const added = within(rows[0] as HTMLElement).getAllByRole("cell")
    const removed = within(rows[1] as HTMLElement).getAllByRole("cell")
    expect(added[3].textContent).toBe("—")
    expect(added[4].textContent).toBe("0 USD")
    expect(removed[3].textContent).toBe("1,200 USD")
    expect(removed[4].textContent).toBe("—")
    expect(removed[5].className).toContain("text-foreground")
    expect(removed[5].className).not.toMatch(/text-(?:green|red)-/)
  })
})
