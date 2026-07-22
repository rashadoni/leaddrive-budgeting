import { describe, it, expect } from "vitest"
import {
  ALL_INDICATOR_SEEDS,
  RETIRED_CODES,
  hospitalityIndicators,
  agroIndicators,
  crossSectorIndicators,
  industrialIndicators,
  servicesIndicators,
  pharmaIndicators,
  realEstateIndicators,
  entertainmentIndicators,
  educationIndicators,
  poultryIndicators,
  foodProcessingIndicators,
  beverageIndicators,
  retailIndicators,
  logisticsIndicators,
  constructionIndicators,
} from "./indicator-seeds"
import { esgIndicators } from "./esg-seeds"
import { newsIndicators } from "./news-seeds"
import { classifyValue } from "./formula-engine"
import { getOperationalRule } from "./metric-validation-rules"

/**
 * Integrity tests for the indicator-seeds catalog. These are
 * regression-prevention checks for a holding running 14 sector packs
 * × 60 companies:
 *
 * 1. No duplicate codes within ALL_INDICATOR_SEEDS — a duplicate
 *    silently overwrites IndicatorDefinition rows on re-seed.
 * 2. No active code shadows a RETIRED_CODES entry — reviving a code
 *    would conflict with historical IndicatorValue rows.
 * 3. ALL_INDICATOR_SEEDS includes every pack — adding a new pack
 *    without registering it would silently drop those indicators.
 * 4. Required fields are non-empty per IndicatorSeed contract.
 *
 * Catches: typo-renames, copy-paste duplicate codes, forgetting to
 * register a new sector pack, missing translations on a new seed.
 */

describe("ALL_INDICATOR_SEEDS — catalog integrity", () => {
  it("includes seeds from every pack (no pack accidentally dropped)", () => {
    const allCodes = new Set(ALL_INDICATOR_SEEDS.map((s) => s.code))
    const packs = [
      ["hospitality", hospitalityIndicators],
      ["agro", agroIndicators],
      ["industrial", industrialIndicators],
      ["services", servicesIndicators],
      ["pharma", pharmaIndicators],
      ["real_estate", realEstateIndicators],
      ["entertainment", entertainmentIndicators],
      ["education", educationIndicators],
      ["poultry", poultryIndicators],
      ["food_processing", foodProcessingIndicators],
      ["beverage", beverageIndicators],
      ["retail", retailIndicators],
      ["logistics", logisticsIndicators],
      ["construction", constructionIndicators],
      ["cross_sector", crossSectorIndicators],
      ["esg", esgIndicators],
      ["news", newsIndicators],
    ] as const
    for (const [packName, pack] of packs) {
      for (const seed of pack) {
        expect(
          allCodes.has(seed.code),
          `Seed ${seed.code} (pack=${packName}) is missing from ALL_INDICATOR_SEEDS`,
        ).toBe(true)
      }
    }
  })

  it("has no duplicate codes across packs", () => {
    const seen = new Map<string, number>()
    for (const s of ALL_INDICATOR_SEEDS) {
      seen.set(s.code, (seen.get(s.code) ?? 0) + 1)
    }
    const dups = [...seen.entries()].filter(([, count]) => count > 1)
    expect(
      dups,
      `Duplicate indicator codes detected: ${dups.map(([c, n]) => `${c} (×${n})`).join(", ")}`,
    ).toEqual([])
  })

  it("does not revive any RETIRED_CODES", () => {
    const activeCodes = new Set(ALL_INDICATOR_SEEDS.map((s) => s.code))
    const revived = RETIRED_CODES.filter((rc) => activeCodes.has(rc))
    expect(
      revived,
      `Active seeds shadow retired codes: ${revived.join(", ")} — historical IndicatorValue rows would conflict`,
    ).toEqual([])
  })

  it("contains ≥ 50 active indicators (catalog growth floor)", () => {
    // Loose lower bound — catches a regression that empties out a pack.
    expect(ALL_INDICATOR_SEEDS.length).toBeGreaterThanOrEqual(50)
  })
})

describe("IndicatorSeed contract — required fields", () => {
  it("every seed has non-empty code, nameEn, category, formula, unit, direction", () => {
    for (const seed of ALL_INDICATOR_SEEDS) {
      expect(seed.code, `Seed missing code`).toBeTruthy()
      expect(seed.nameEn, `Seed ${seed.code} missing nameEn`).toBeTruthy()
      expect(seed.category, `Seed ${seed.code} missing category`).toBeTruthy()
      expect(seed.formula, `Seed ${seed.code} missing formula`).toBeTruthy()
      expect(seed.unit, `Seed ${seed.code} missing unit`).toBeTruthy()
      expect(seed.direction, `Seed ${seed.code} missing direction`).toBeTruthy()
      expect(
        Array.isArray(seed.industries),
        `Seed ${seed.code} industries must be array`,
      ).toBe(true)
      expect(
        Array.isArray(seed.requiredInputs),
        `Seed ${seed.code} requiredInputs must be array`,
      ).toBe(true)
      expect(
        typeof seed.sortOrder,
        `Seed ${seed.code} sortOrder must be number`,
      ).toBe("number")
    }
  })

  it("every seed has thresholds with green / amber / red bands", () => {
    for (const seed of ALL_INDICATOR_SEEDS) {
      expect(seed.thresholds, `Seed ${seed.code} missing thresholds`).toBeTruthy()
      // Thresholds shape: each band is { op, value } where op is a comparison.
      // Spot-check that the catalog defines all 3 bands.
      expect(
        seed.thresholds.green,
        `Seed ${seed.code} missing green threshold`,
      ).toBeTruthy()
      expect(
        seed.thresholds.amber,
        `Seed ${seed.code} missing amber threshold`,
      ).toBeTruthy()
      expect(
        seed.thresholds.red,
        `Seed ${seed.code} missing red threshold`,
      ).toBeTruthy()
    }
  })

  it("direction is one of higher_better / lower_better / band", () => {
    // `band` covers indicators with a target range (e.g., student-
    // teacher ratio where both too-high and too-low are bad).
    for (const seed of ALL_INDICATOR_SEEDS) {
      expect(
        ["higher_better", "lower_better", "band"],
        `Seed ${seed.code} direction "${seed.direction}" not in allow-list`,
      ).toContain(seed.direction)
    }
  })

  it("defaultValueSource (when present) is a valid SeedValueSource", () => {
    const valid = ["disclosed", "modeled_industry", "modeled_generic", "macro", "computed"]
    for (const seed of ALL_INDICATOR_SEEDS) {
      if (seed.defaultValueSource !== undefined) {
        expect(
          valid,
          `Seed ${seed.code} defaultValueSource "${seed.defaultValueSource}" invalid`,
        ).toContain(seed.defaultValueSource)
      }
    }
  })
})

describe("News seeds (Phase 7.H Feature B)", () => {
  it("newsIndicators pack contains IND_NEWS_SENTIMENT_30D", () => {
    const codes = newsIndicators.map((s) => s.code)
    expect(codes).toContain("IND_NEWS_SENTIMENT_30D")
  })

  it("IND_NEWS_SENTIMENT_30D has news.sentiment30d as required input", () => {
    const news = newsIndicators.find((s) => s.code === "IND_NEWS_SENTIMENT_30D")
    expect(news?.requiredInputs).toContain("news.sentiment30d")
  })
})

describe("Agro seed input-scale contracts", () => {
  it("classifies drought_index on the same 0–10 scale accepted by imports", () => {
    const seed = agroIndicators.find((s) => s.code === "AGRO_DROUGHT_RISK")
    const input = getOperationalRule("drought_index")

    expect(input?.min).toBe(0)
    expect(input?.max).toBe(10)
    expect(seed).toBeDefined()
    expect(classifyValue(3, seed!.thresholds)).toBe("green")
    expect(classifyValue(4, seed!.thresholds)).toBe("amber")
    expect(classifyValue(6, seed!.thresholds)).toBe("amber")
    expect(classifyValue(7, seed!.thresholds)).toBe("red")
    expect(classifyValue(10, seed!.thresholds)).toBe("red")
  })
})
