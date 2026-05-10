// @vitest-environment node
/**
 * Phase 7.G Turn CIII (Phase 7.E #3 v2 E.2e LLM-half) — breach-digest tests.
 */

import { describe, it, expect } from "vitest"
import {
  selectTopBreaches,
  buildDigestPrompt,
  validateDigestResponse,
  topCompaniesFrom,
  DIGEST_PROMPT_VERSION,
  DEFAULT_DIGEST_TOP_N,
} from "./breach-digest"
import type { ForecastedBreach } from "./breach-forecaster"

const sampleBreach = (overrides: Partial<ForecastedBreach> = {}): ForecastedBreach => ({
  indicatorCode: "REV_GROWTH",
  companyId: "co_aac",
  period: "2026-Q1",
  horizonStep: 1,
  currentStatus: "green",
  predictedStatus: "amber",
  forecastConfidence: 0.85,
  confidenceBand: "high",
  predictedValue: 75,
  ...overrides,
})

describe("selectTopBreaches — ranking + cap", () => {
  it("ranks predictedStatus=red ABOVE predictedStatus=amber", () => {
    const ranked = selectTopBreaches([
      sampleBreach({ companyId: "co_a", predictedStatus: "amber" }),
      sampleBreach({ companyId: "co_b", predictedStatus: "red" }),
    ])
    expect(ranked[0].companyId).toBe("co_b")
    expect(ranked[1].companyId).toBe("co_a")
  })

  it("when severity ties, ranks confidenceBand high above medium above low", () => {
    const ranked = selectTopBreaches([
      sampleBreach({ companyId: "co_a", predictedStatus: "red", confidenceBand: "low" }),
      sampleBreach({ companyId: "co_b", predictedStatus: "red", confidenceBand: "high" }),
      sampleBreach({ companyId: "co_c", predictedStatus: "red", confidenceBand: "medium" }),
    ])
    expect(ranked.map((b) => b.companyId)).toEqual(["co_b", "co_c", "co_a"])
  })

  it("when severity + confidence tie, horizon step asc (sooner first)", () => {
    const ranked = selectTopBreaches([
      sampleBreach({ companyId: "co_a", horizonStep: 3 }),
      sampleBreach({ companyId: "co_b", horizonStep: 1 }),
      sampleBreach({ companyId: "co_c", horizonStep: 2 }),
    ])
    expect(ranked.map((b) => b.horizonStep)).toEqual([1, 2, 3])
  })

  it("final tiebreak by companyId asc", () => {
    const ranked = selectTopBreaches([
      sampleBreach({ companyId: "co_z" }),
      sampleBreach({ companyId: "co_a" }),
    ])
    expect(ranked[0].companyId).toBe("co_a")
  })

  it("caps at DEFAULT_DIGEST_TOP_N (12) by default", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      sampleBreach({ companyId: `co_${i}` }),
    )
    expect(selectTopBreaches(many).length).toBe(DEFAULT_DIGEST_TOP_N)
  })

  it("respects custom topN", () => {
    const many = Array.from({ length: 5 }, (_, i) =>
      sampleBreach({ companyId: `co_${i}` }),
    )
    expect(selectTopBreaches(many, { topN: 2 }).length).toBe(2)
  })

  it("filters by minConfidenceBand=medium → drops low rows", () => {
    const ranked = selectTopBreaches(
      [
        sampleBreach({ companyId: "co_a", confidenceBand: "high" }),
        sampleBreach({ companyId: "co_b", confidenceBand: "medium" }),
        sampleBreach({ companyId: "co_c", confidenceBand: "low" }),
      ],
      { minConfidenceBand: "medium" },
    )
    expect(ranked.length).toBe(2)
    expect(ranked.find((b) => b.companyId === "co_c")).toBeUndefined()
  })

  it("zero input → empty output", () => {
    expect(selectTopBreaches([])).toEqual([])
  })
})

describe("buildDigestPrompt — pure formatter", () => {
  it("emits empty-list path when no breaches", () => {
    const prompt = buildDigestPrompt({
      organizationId: "org_demo",
      breaches: [],
      period: "2026-Q1",
    })
    expect(prompt).toContain("(empty")
    expect(prompt).toContain("Period: 2026-Q1")
    expect(prompt).toContain("Output language: English")
  })

  it("includes ranked breach lines with all critical fields", () => {
    const prompt = buildDigestPrompt({
      organizationId: "org_demo",
      breaches: [
        sampleBreach({
          companyId: "co_aac",
          indicatorCode: "REV_GROWTH",
          predictedStatus: "red",
          confidenceBand: "high",
          forecastConfidence: 0.92,
          predictedValue: 55.5,
          predictedLower: 50.1,
          predictedUpper: 60.9,
        }),
      ],
      period: "2026-Q1",
    })
    expect(prompt).toContain("co_aac")
    expect(prompt).toContain("REV_GROWTH")
    expect(prompt).toContain("green → red")
    expect(prompt).toContain("predicted 55.50")
    expect(prompt).toContain("[50.10, 60.90]")
    expect(prompt).toContain("confidence high 92%")
  })

  it("renders Russian language label when lang=ru", () => {
    const prompt = buildDigestPrompt({
      organizationId: "org_demo",
      breaches: [sampleBreach()],
      period: "2026-Q1",
      language: "ru",
    })
    expect(prompt).toContain("Russian")
  })

  it("renders Azerbaijani language label when lang=az", () => {
    const prompt = buildDigestPrompt({
      organizationId: "org_demo",
      breaches: [sampleBreach()],
      period: "2026-Q1",
      language: "az",
    })
    expect(prompt).toContain("Azerbaijani")
  })
})

describe("validateDigestResponse — schema enforcement", () => {
  it("accepts valid {narrative} JSON", () => {
    const out = validateDigestResponse(
      { narrative: "Three companies show declining margins next quarter." },
      ["co_a"],
      5,
      "claude-sonnet-4-5",
      { inputTokens: 800, outputTokens: 60 },
    )
    expect(out.narrative).toBe("Three companies show declining margins next quarter.")
    expect(out.breachCount).toBe(5)
    expect(out.topCompanies).toEqual(["co_a"])
    expect(out.modelName).toBe("claude-sonnet-4-5")
    expect(out.promptVersion).toBe(DIGEST_PROMPT_VERSION)
    expect(out.usage).toEqual({ inputTokens: 800, outputTokens: 60 })
  })

  it("trims narrative whitespace", () => {
    const out = validateDigestResponse(
      { narrative: "  hello  " },
      [],
      0,
      "m",
    )
    expect(out.narrative).toBe("hello")
  })

  it("throws on null parsed", () => {
    expect(() => validateDigestResponse(null, [], 0, "m")).toThrow(/not a JSON object/)
  })

  it("throws on missing narrative field", () => {
    expect(() => validateDigestResponse({}, [], 0, "m")).toThrow(/'narrative'/)
  })

  it("throws on empty narrative", () => {
    expect(() => validateDigestResponse({ narrative: "" }, [], 0, "m")).toThrow(/'narrative'/)
    expect(() => validateDigestResponse({ narrative: "   " }, [], 0, "m")).toThrow(/'narrative'/)
  })

  it("throws on non-string narrative", () => {
    expect(() => validateDigestResponse({ narrative: 42 }, [], 0, "m")).toThrow(/'narrative'/)
  })
})

describe("topCompaniesFrom — top-3 distinct extraction", () => {
  it("returns first 3 distinct companyIds in order", () => {
    expect(
      topCompaniesFrom([
        sampleBreach({ companyId: "co_a" }),
        sampleBreach({ companyId: "co_b" }),
        sampleBreach({ companyId: "co_a" }),
        sampleBreach({ companyId: "co_c" }),
        sampleBreach({ companyId: "co_d" }),
      ]),
    ).toEqual(["co_a", "co_b", "co_c"])
  })

  it("returns fewer than 3 when distinct count < 3", () => {
    expect(
      topCompaniesFrom([sampleBreach({ companyId: "co_a" }), sampleBreach({ companyId: "co_a" })]),
    ).toEqual(["co_a"])
  })

  it("handles empty input", () => {
    expect(topCompaniesFrom([])).toEqual([])
  })
})
