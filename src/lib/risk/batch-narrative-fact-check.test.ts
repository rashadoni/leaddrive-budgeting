/**
 * Phase 8 C5 — batch-narrative fact-checker tests.
 */
import { describe, it, expect } from "vitest"
import {
  verifyBatchNarrative,
  verifyMorningBriefNarrative,
} from "./batch-narrative-fact-check"
import type {
  BatchNarrativeSnapshot,
  MorningBriefSnapshot,
} from "./batch-narrative-fact-check"

const SNAPSHOT: BatchNarrativeSnapshot = {
  period: "2026",
  totals: {
    operational: 8,
    indicators: 33,
    cells: 264,
    green: 142,
    amber: 67,
    red: 38,
  },
  compositeByCompany: new Map([
    [
      "co_azsf",
      {
        score: 30,
        band: "red",
        contributingCount: 19,
        totalCount: 28,
        coverage: "full" as const,
      },
    ],
    [
      "co_eden",
      {
        score: 52,
        band: "amber",
        contributingCount: 21,
        totalCount: 33,
        coverage: "full" as const,
      },
    ],
  ]),
  countsByCompany: new Map([
    ["co_azsf", { green: 8, amber: 9, red: 11, unknown: 0 }],
    ["co_eden", { green: 14, amber: 4, red: 3, unknown: 12 }],
  ]),
  matchesBySeverity: {
    critical: [{} as never, {} as never, {} as never], // 3 critical alerts
    warning: [{} as never, {} as never], // 2 warnings
    info: [],
  },
}

describe("verifyBatchNarrative", () => {
  it("passes when narrative cites only known snapshot numbers", () => {
    const narrative =
      "Across 8 operational entities, 38 cells landed red and 67 amber. AZSF scored 30/100 with 11 red indicators; EDEN sits at 52 with 4 amber."
    const out = verifyBatchNarrative(narrative, SNAPSHOT)
    expect(out.flags).toEqual([])
    expect(out.matched).toBeGreaterThan(0)
  })

  it("flags fabricated composite score outside the 0-100 expansion gap", () => {
    // 92 has no neighbour in the known set after ×100/÷100/×1000
    // expansion variants either — safer fabrication catch than mid-
    // range counts (which can collide with `someSmallCount × 1000`
    // expansion noise — documented module limitation).
    const narrative = "AZSF composite plummeted to 92/100 this period."
    const out = verifyBatchNarrative(narrative, SNAPSHOT)
    expect(out.flags.some((f) => f.claim.includes("92"))).toBe(true)
  })

  it("matches alert-severity counts (3 critical)", () => {
    const narrative = "3 critical alerts triggered this morning."
    const out = verifyBatchNarrative(narrative, SNAPSHOT)
    expect(out.flags).toEqual([])
  })

  it("matches contributing-count phrasing (19 of 28 indicators)", () => {
    const narrative = "AZSF scored 19 of 28 indicators."
    const out = verifyBatchNarrative(narrative, SNAPSHOT)
    expect(out.flags).toEqual([])
  })

  it("flags future-year drift (period=2026, narrative cites 2030)", () => {
    const narrative = "By 2030 the holding will stabilise — total cells: 264."
    const out = verifyBatchNarrative(narrative, SNAPSHOT)
    expect(out.flags.some((f) => f.claim === "2030" && f.severity === "warn")).toBe(
      true,
    )
  })

  it("uses extras when provided (total revenue passed by caller)", () => {
    const narrative = "Holding revenue 2,300,000 AZN for 2026."
    const out = verifyBatchNarrative(narrative, {
      ...SNAPSHOT,
      extras: { totalRevenueAzn: 2_300_000 },
    })
    // 2,300,000 matches extras.totalRevenueAzn directly
    expect(out.flags.every((f) => !f.claim.includes("2,300,000") || f.severity !== "warn")).toBe(
      true,
    )
  })

  it("returns empty result for empty narrative", () => {
    const out = verifyBatchNarrative("", SNAPSHOT)
    expect(out.flags).toEqual([])
    expect(out.totalChecked).toBe(0)
  })
})

// ── Phase 8 C5 close (2026-05-29) — Morning Brief adapter ──────────────
describe("verifyMorningBriefNarrative", () => {
  const BRIEF: MorningBriefSnapshot = {
    period: "2026",
    worstCells: [
      { companyCode: "AZSEKER-CPC", indicatorCode: "FP_GROSS_MARGIN", value: 8.2 },
      { companyCode: "AZSEKER-EDEN", indicatorCode: "CUSTOMER_HHI", value: 4200 },
    ],
    topMovers: [
      { companyCode: "AZSEKER-CPC", indicatorCode: "SUGAR_PRICE", deltaPct: 21 },
    ],
    alertCounts: { critical: 3, warning: 5, info: 2 },
    newsBulletCount: 4,
  }

  it("passes a narrative citing the brief's own numbers", () => {
    const narrative =
      "AZSEKER-CPC gross margin at 8.2% with sugar +21%; 3 critical alerts this morning."
    const out = verifyMorningBriefNarrative(narrative, BRIEF)
    expect(out.flags).toEqual([])
    expect(out.totalChecked).toBeGreaterThan(0)
  })

  it("flags a fabricated worst-cell value", () => {
    // Narrative claims 88.8% margin — far outside any known value or its
    // ×100/×1000 paraphrase, so it must be flagged.
    const narrative = "AZSEKER-CPC gross margin collapsed to 88.8% overnight."
    const out = verifyMorningBriefNarrative(narrative, BRIEF)
    expect(out.flags.some((f) => f.claim.includes("88.8") && f.severity === "warn")).toBe(
      true,
    )
  })

  it("flags future-year drift (period=2026, narrative cites 2031)", () => {
    const narrative = "By 2031 the holding stabilises; margin 8.2%."
    const out = verifyMorningBriefNarrative(narrative, BRIEF)
    expect(out.flags.some((f) => f.claim === "2031" && f.severity === "warn")).toBe(
      true,
    )
  })

  it("does not false-flag alert counts (3 critical / 5 warning)", () => {
    const narrative = "3 critical and 5 warning alerts fired across the holding."
    const out = verifyMorningBriefNarrative(narrative, BRIEF)
    expect(out.flags).toEqual([])
  })

  it("returns empty result for empty narrative", () => {
    const out = verifyMorningBriefNarrative("", BRIEF)
    expect(out.flags).toEqual([])
    expect(out.totalChecked).toBe(0)
  })
})
