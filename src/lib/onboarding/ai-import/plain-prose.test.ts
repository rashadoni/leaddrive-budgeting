import { describe, it, expect } from "vitest"
import { stripMarkdown, stripMarkdownAll } from "./plain-prose"

describe("stripMarkdown — the panel must never show raw markup", () => {
  it("removes the bold that reached the owner's screen", () => {
    // Verbatim shape from the 2026-08-03 screenshot.
    expect(
      stripMarkdown("**Maliyyə vərəqləri (PLF, BS)** — artıq şirkətlərə bölünüb"),
    ).toBe("Maliyyə vərəqləri (PLF, BS) — artıq şirkətlərə bölünüb")
  })

  it("removes a leading bullet the UI already draws", () => {
    expect(stripMarkdown("• İcmal vərəqləri idxal edilmir")).toBe(
      "İcmal vərəqləri idxal edilmir",
    )
    expect(stripMarkdown("- Check the routing tab")).toBe("Check the routing tab")
    expect(stripMarkdown("## Heading")).toBe("Heading")
  })

  it("handles italics in both spellings", () => {
    expect(stripMarkdown("this is *important* and _also this_")).toBe(
      "this is important and also this",
    )
  })
})

describe("what it deliberately leaves alone", () => {
  it("keeps snake_case identifiers intact", () => {
    // This product is full of them — `pl_ebitda`, `planKind`, `source_cell`.
    // A cleaner that eats the underscores would rename a metric on screen.
    expect(stripMarkdown("the metric pl_ebitda and allCommittedGroupsVerified")).toBe(
      "the metric pl_ebitda and allCommittedGroupsVerified",
    )
    expect(stripMarkdown("check import_staging_apply first")).toBe(
      "check import_staging_apply first",
    )
  })

  it("keeps arithmetic and a lone asterisk", () => {
    expect(stripMarkdown("rows = 2 * 3")).toBe("rows = 2 * 3")
    expect(stripMarkdown('group "*" was not committed')).toBe('group "*" was not committed')
  })

  it("keeps account codes and amounts exactly", () => {
    const s = "PLF.05.12.06 — 1,677,014.63 ₼ (−12,014.63 ₼, 0.7%)"
    expect(stripMarkdown(s)).toBe(s)
  })

  it("returns a non-markdown sentence identical, so drift is detectable", () => {
    const s = "The import is safe to continue."
    expect(stripMarkdown(s)).toBe(s)
  })

  it("survives empty and non-string input", () => {
    expect(stripMarkdown("")).toBe("")
    expect(stripMarkdown(undefined as unknown as string)).toBe(undefined)
  })
})

describe("stripMarkdownAll", () => {
  it("cleans a list and drops entries that were only markup", () => {
    expect(stripMarkdownAll(["**one**", "- two", "*", "   "])).toEqual([
      "one",
      "two",
      "*",
    ])
  })
})
