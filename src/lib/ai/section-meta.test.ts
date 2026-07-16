import { describe, expect, it } from "vitest"

import { SECTION_LABELS, type Section } from "./section-meta"

describe("AI analytics section metadata", () => {
  it("keeps every supported section mapped to a non-empty label", () => {
    const sections: Section[] = [
      "pnl-report",
      "pl",
      "balance-sheet",
      "cogs",
      "cash-flow",
      "assumptions",
      "workspace",
      "forecast",
    ]

    expect(Object.keys(SECTION_LABELS)).toEqual(sections)
    for (const section of sections) {
      expect(SECTION_LABELS[section].trim()).not.toBe("")
    }
  })
})
