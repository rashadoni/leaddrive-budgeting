/**
 * 11.69 — «тут ничего не поймёшь, всё так записано».
 *
 * The fixture below is the ACTUAL twelve-warning list from the production
 * preview the owner was looking at on 2026-07-31, copied verbatim. Testing the
 * grouping against invented strings would prove only that the regexes match
 * themselves.
 */
import { describe, it, expect } from "vitest"
import { groupImportWarnings, ACTIONABLE_GROUPS } from "./warning-groups"

/** Verbatim from the live run. Six of the twelve say the same thing. */
const LIVE_WARNINGS = [
  'actual-budget-v1.xlsx: sheet "Satış İcmalı" — row 1: Missing required column(s): companyCode, metric, date, value, unit. Expected headers: companyCode, metric, date, value, unit (optional: sourceNote).',
  'actual-budget-v1.xlsx: sheet "Müştəri İcmalı" — No counterparty blocks detected on "Müştəri İcmalı"',
  'actual-budget-v1.xlsx: sheet "Satış Əkinçilik Fakt" — Sales transactions "AZSEKER-AZSF": 140 row(s) outside 2026 skipped (import that year separately). · Sheet "Satış Əkinçilik Fakt": 7 product label(s) outside the approved dictionary — imported under their own code, review the mapping: Arpa Püfə, Pambıq Çiyidi',
  'actual-budget-v1.xlsx: sheet "Satış CPC Fakt" — Sales transactions "AZSEKER-CPC": 1516 row(s) outside 2026 skipped (import that year separately). · column "Net Miqdar Ton" claims tonnes but the median implied price is 0.72 ₼ — the values are kilograms; divided by 1000 so price/volume read per tonne',
  'actual-budget-v1.xlsx: sheet "Tech" — Could not locate year-header row in İcmal sheet',
  'actual-budget-v1.xlsx: sheet "Sales Budget CPC 2026" — 1 product label(s) outside the approved dictionary — imported under their own code, review the mapping: Byproduct',
  'actual-budget-v1.xlsx: sheet "PLF Actual 2025 [AZSEKER-CPC]" — carries 2025 data, but this run imports 2026 — skipped without calling the AI detector.',
  'actual-budget-v1.xlsx: sheet "PLF Actual 2025 [AZSEKER-AZSF]" — carries 2025, 2029 data, but this run imports 2026 — skipped without calling the AI detector.',
  'actual-budget-v1.xlsx: sheet "PLF Actual 2025 [AZSEKER-EDEN]" — carries 2025 data, but this run imports 2026 — skipped without calling the AI detector.',
  'actual-budget-v1.xlsx: sheet "BS Actual 2025 [AZSEKER-CPC]" — carries 2024, 2025 data, but this run imports 2026 — skipped without calling the AI detector.',
  'actual-budget-v1.xlsx: sheet "BS Actual 2025 [AZSEKER-AZSF]" — carries 2024, 2025 data, but this run imports 2026 — skipped without calling the AI detector.',
  'actual-budget-v1.xlsx: sheet "BS Actual 2025 [AZSEKER-EDEN]" — carries 2024, 2025 data, but this run imports 2026 — skipped without calling the AI detector.',
]

const byKey = (ws: readonly string[]) =>
  new Map(groupImportWarnings(ws).map((g) => [g.key, g]))

describe("groupImportWarnings — the real production list", () => {
  it("collapses twelve lines into a handful of kinds", () => {
    const groups = groupImportWarnings(LIVE_WARNINGS)
    // Twelve unreadable lines become five headings.
    expect(groups.length).toBeLessThanOrEqual(5)
    expect(groups.reduce((n, g) => n + g.messages.length, 0)).toBe(12)
  })

  it("puts the SIX off-year skips under one heading", () => {
    // The whole complaint: the same expected event, restated six times, next
    // to a genuine failure and indistinguishable from it.
    expect(byKey(LIVE_WARNINGS).get("off-year")?.messages).toHaveLength(6)
  })

  it("names the years an off-year skip is about, so the remedy can be offered", () => {
    // These sheets load if the operator ticks the multi-year box — the UI can
    // only say so if it knows which years are sitting there.
    const years = byKey(LIVE_WARNINGS).get("off-year")!.years
    expect(years).toContain(2025)
    expect(years).toContain(2024)
  })

  it("separates a real structural failure from routine skips", () => {
    const groups = byKey(LIVE_WARNINGS)
    // "Missing required column(s)" and "Could not locate year-header row" are
    // sheets that did NOT parse — a different thing entirely from a sheet
    // skipped on purpose.
    expect(groups.get("structure")?.messages).toHaveLength(3)
    expect(ACTIONABLE_GROUPS.has("structure")).toBe(true)
    expect(ACTIONABLE_GROUPS.has("off-year")).toBe(false)
  })

  it("puts what needs action FIRST", () => {
    // A six-line block of expected skips at the top is exactly what made the
    // live list unreadable.
    const order = groupImportWarnings(LIVE_WARNINGS).map((g) => g.key)
    const firstInformational = order.findIndex((k) => !ACTIONABLE_GROUPS.has(k))
    const lastActionable = order.reduce(
      (last, k, i) => (ACTIONABLE_GROUPS.has(k) ? i : last),
      -1,
    )
    expect(lastActionable).toBeLessThan(firstInformational)
  })

  it("keeps the unit auto-correction visible — it changed the numbers", () => {
    // Dividing a column by 1000 is the single most consequential thing in this
    // list. It must not be filed away with the dictionary notes.
    expect(byKey(LIVE_WARNINGS).get("unit-fix")?.messages).toHaveLength(1)
  })

  it("never paraphrases — every original line survives verbatim", () => {
    const all = groupImportWarnings(LIVE_WARNINGS).flatMap((g) => g.messages)
    for (const w of LIVE_WARNINGS) expect(all).toContain(w)
  })
})

describe("groupImportWarnings — edges", () => {
  it("files an unrecognised message under `other`, which is actionable", () => {
    // Tidying must never swallow something it does not understand: an
    // unmatched warning is MORE likely to matter, not less.
    const groups = byKey(["something nobody has seen before"])
    expect(groups.get("other")?.messages).toHaveLength(1)
    expect(ACTIONABLE_GROUPS.has("other")).toBe(true)
  })

  it("returns nothing for an empty or blank-only list", () => {
    expect(groupImportWarnings([])).toEqual([])
    expect(groupImportWarnings(["", "   "])).toEqual([])
  })

  it("classifies a multi-part line by its MOST CONSEQUENTIAL concern", () => {
    // Real lines staple several notes together with " · ". Ordering the rules
    // by convenience instead put this line under "expected skips" because it
    // also mentions rows outside 2026 — burying the dictionary note. The rule
    // that matters most has to win, or the tidying hides the very thing it
    // was meant to surface.
    const g = groupImportWarnings([LIVE_WARNINGS[2]])
    expect(g).toHaveLength(1)
    expect(g[0].messages[0]).toContain("approved dictionary")
  })
})
