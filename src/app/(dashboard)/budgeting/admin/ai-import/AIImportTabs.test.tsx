// @vitest-environment happy-dom
/**
 * 2026-07-30 — you must land on a tab that can actually import.
 *
 * The default used to be "1 file", the one surface that CANNOT write: after
 * analysing it shows an amber "writing from this screen is disabled" banner
 * and offers only Cancel. During a live rehearsal the product owner opened it
 * twice before finding the tab that imports.
 *
 * All four surfaces stay — each answers a real need. What is pinned here is
 * the landing order and the default, because that is what decides whether the
 * first click leads somewhere.
 */
import React from "react"
import { describe, it, expect, afterEach, vi } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"

vi.mock("./AIImportForm", () => ({
  AIImportForm: () => <div data-testid="panel-single" />,
}))
vi.mock("./MultiFileForm", () => ({
  MultiFileForm: () => <div data-testid="panel-multi" />,
}))
vi.mock("./UniversalImportForm", () => ({
  UniversalImportForm: () => <div data-testid="panel-universal" />,
}))
vi.mock("./MultiSheetImportForm", () => ({
  MultiSheetImportForm: () => <div data-testid="panel-multisheet" />,
}))

import { AIImportTabs } from "./AIImportTabs"

afterEach(cleanup)

describe("AIImportTabs", () => {
  it("opens on the tab that can write, not the classify-only one", () => {
    render(<AIImportTabs />)
    expect(screen.getByTestId("panel-multi")).toBeTruthy()
    expect(screen.queryByTestId("panel-single")).toBeNull()
    expect(screen.getByTestId("tab-multi").getAttribute("aria-selected")).toBe("true")
  })

  it("keeps ALL four surfaces — none was removed", () => {
    // Every one answers a real need: classification-only inspection, the full
    // batch import, single-sheet column-mapping review, and the staging
    // apply-multi path.
    render(<AIImportTabs />)
    for (const id of ["tab-multi", "tab-single", "tab-universal", "tab-multisheet"]) {
      expect(screen.getByTestId(id)).toBeTruthy()
    }
  })

  it("lists the importing tab FIRST", () => {
    render(<AIImportTabs />)
    const order = Array.from(
      screen.getByTestId("ai-import-guide-tabs").querySelectorAll("[data-testid^='tab-']"),
    ).map((el) => el.getAttribute("data-testid"))
    expect(order[0]).toBe("tab-multi")
    // The dead-end sits right after it, not in front of it.
    expect(order[1]).toBe("tab-single")
  })
})
