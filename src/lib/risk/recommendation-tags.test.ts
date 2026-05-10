// @vitest-environment node
import { describe, it, expect } from "vitest"
import {
  tagRecommendation,
  tagRecommendations,
  RECOMMENDATION_TAG_LABEL,
  type RecommendationTag,
} from "./recommendation-tags"

describe("tagRecommendation", () => {
  const cases: Array<[string, RecommendationTag]> = [
    ["Hedge USD exposure with 6-month forward contract", "hedge"],
    ["Renegotiate supplier contracts for cocoa procurement", "renegotiate"],
    ["Monitor weekly occupancy rates via dashboard", "monitor"],
    ["Cut marketing spend by 20% across all channels", "cut-cost"],
    ["Freeze hiring in admin functions", "cut-cost"],
    ["Raise ADR by 8% for Q3 high-season nights", "raise-price"],
    ["Shift Q3 marketing spend from print to digital channels", "shift-mix"],
    ["Audit revenue classifications for code 601 entries", "audit"],
    ["Verify data classification — this is likely a misclassified line", "audit"],
    ["Hire 2 senior baristas for service consistency", "hire"],
    ["Pause CapEx project Hilton renovation Q3", "pause-capex"],
    ["Exit underperforming East regional contract by Q4", "exit"],
    ["Investigate further", "other"], // forbidden phrase per system prompt
    ["Consider all available options", "other"],
  ]

  for (const [text, expected] of cases) {
    it(`tags "${text.slice(0, 40)}..." → ${expected}`, () => {
      expect(tagRecommendation(text)).toBe(expected)
    })
  }

  it("handles RU recommendations", () => {
    expect(tagRecommendation("Хеджировать валютный риск")).toBe("hedge")
    expect(tagRecommendation("Сократить операционные расходы")).toBe("cut-cost")
    expect(tagRecommendation("Поднять цены на 5%")).toBe("raise-price")
  })

  it("handles AZ recommendations", () => {
    expect(tagRecommendation("Müqaviləni yenidən razılaşdır")).toBe("renegotiate")
    expect(tagRecommendation("Layihəni dayandır")).toBe("pause-capex")
  })

  it("first-match-wins on multi-pattern overlap", () => {
    // "audit + reclassify" — both audit and audit patterns. Just confirms deterministic.
    expect(tagRecommendation("Audit data and reclassify")).toBe("audit")
  })

  it("handles empty string → other", () => {
    expect(tagRecommendation("")).toBe("other")
  })
})

describe("tagRecommendations (array)", () => {
  it("returns parallel tag array", () => {
    const recs = [
      "Hedge USD",
      "Cut cost in marketing",
      "Investigate further",
    ]
    expect(tagRecommendations(recs)).toEqual(["hedge", "cut-cost", "other"])
  })

  it("empty array returns empty", () => {
    expect(tagRecommendations([])).toEqual([])
  })
})

describe("RECOMMENDATION_TAG_LABEL", () => {
  it("has en/ru/az labels for every tag", () => {
    const tags: RecommendationTag[] = [
      "hedge", "renegotiate", "monitor", "cut-cost", "raise-price",
      "shift-mix", "audit", "hire", "pause-capex", "exit", "other",
    ]
    for (const tag of tags) {
      expect(RECOMMENDATION_TAG_LABEL[tag]).toBeDefined()
      expect(RECOMMENDATION_TAG_LABEL[tag].en).toBeTruthy()
      expect(RECOMMENDATION_TAG_LABEL[tag].ru).toBeTruthy()
      expect(RECOMMENDATION_TAG_LABEL[tag].az).toBeTruthy()
    }
  })
})
