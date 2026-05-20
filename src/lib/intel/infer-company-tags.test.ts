/**
 * Phase 7.M Tier2 #1 — tests for deterministic company-tag inference.
 */
import { describe, it, expect } from "vitest"
import {
  inferCompanyTags,
  buildEntityPatternsFromCompanies,
  mergeCompanyTags,
} from "./infer-company-tags"

const FIXTURES = [
  {
    code: "AZSEKER-AZSF",
    name: "Azərşəkər Sugar",
    nameAz: "Azərşəkər",
    nameRu: "АзерШекер Сахарный",
    nameEn: null,
  },
  {
    code: "AAC",
    name: "AAC",
    nameAz: null,
    nameRu: null,
    nameEn: "Azerbaijan Aluminum Company",
  },
  {
    code: "ATL-DBZ",
    name: "Polad Boru Zavodu",
    nameAz: "Polad Boru Zavodu",
    nameRu: null,
    nameEn: "Steel Pipe Factory",
  },
]

describe("buildEntityPatternsFromCompanies", () => {
  it("collects every non-empty name variant + the code itself", () => {
    const out = buildEntityPatternsFromCompanies(FIXTURES)
    const azsf = out.find((e) => e.code === "AZSEKER-AZSF")!
    expect(azsf.patterns).toContain("AZSEKER-AZSF")
    expect(azsf.patterns).toContain("Azərşəkər Sugar")
    expect(azsf.patterns).toContain("Azərşəkər")
    expect(azsf.patterns).toContain("АзерШекер Сахарный")
  })

  it("drops 1-char patterns and dedupes", () => {
    const out = buildEntityPatternsFromCompanies([
      { code: "X", name: "X", nameAz: "Foo", nameRu: "Foo", nameEn: "Foo" },
    ])
    expect(out[0].patterns).toEqual(["Foo"])
  })
})

describe("inferCompanyTags", () => {
  const entities = buildEntityPatternsFromCompanies(FIXTURES)

  it("matches Latin transliteration", () => {
    const tags = inferCompanyTags(
      "AzerSheker Sugar plant boosts production after Brent crash",
      entities,
    )
    expect(tags).toContain("AZSEKER-AZSF")
  })

  it("matches Azerbaijani diacritic form (Azərşəkər)", () => {
    const tags = inferCompanyTags(
      "Azərşəkər kompaniyası şəkər istehsalını 40% artırdı",
      entities,
    )
    expect(tags).toContain("AZSEKER-AZSF")
  })

  it("matches Cyrillic Russian form", () => {
    const tags = inferCompanyTags(
      "АзерШекер увеличил продажи на 30% в первом квартале",
      entities,
    )
    expect(tags).toContain("AZSEKER-AZSF")
  })

  it("matches short acronyms when length ≥ 3 (AAC / SPARK / ZTP class)", () => {
    const tags = inferCompanyTags(
      "AAC announces new aluminum smelter expansion",
      entities,
    )
    expect(tags).toContain("AAC")
  })

  it("matches an English full-name pattern", () => {
    const tags = inferCompanyTags(
      "Steel Pipe Factory wins major Azerbaijani infrastructure tender",
      entities,
    )
    expect(tags).toContain("ATL-DBZ")
  })

  it("returns empty array when no entity is mentioned", () => {
    expect(
      inferCompanyTags(
        "Generic agro_crops news about wheat prices in Turkey",
        entities,
      ),
    ).toEqual([])
  })

  it("returns multiple codes when several companies match", () => {
    const tags = inferCompanyTags(
      "AAC and Azərşəkər both reported H1 results yesterday",
      entities,
    )
    expect(tags).toContain("AAC")
    expect(tags).toContain("AZSEKER-AZSF")
    expect(tags).toHaveLength(2)
  })

  it("doesn't duplicate when a company matches via multiple patterns", () => {
    // "Azərşəkər Sugar" matches BOTH the `name` "Azərşəkər Sugar" AND
    // the `nameAz` "Azərşəkər" — we only emit one code.
    const tags = inferCompanyTags("Azərşəkər Sugar profit up 15%", entities)
    expect(tags.filter((t) => t === "AZSEKER-AZSF")).toHaveLength(1)
  })

  it("empty input → empty output", () => {
    expect(inferCompanyTags("", entities)).toEqual([])
    expect(inferCompanyTags("hi", [])).toEqual([])
  })
})

describe("mergeCompanyTags", () => {
  it("unions two arrays without duplicates", () => {
    const out = mergeCompanyTags(
      ["AZSEKER-AZSF", "AAC"],
      ["AZSEKER-AZSF", "ATL-DBZ"],
    )
    expect(out).toEqual(["AZSEKER-AZSF", "AAC", "ATL-DBZ"])
  })

  it("preserves LLM-provided ordering then appends new inferred", () => {
    const out = mergeCompanyTags(["AAC"], ["AZSEKER-AZSF"])
    expect(out).toEqual(["AAC", "AZSEKER-AZSF"])
  })

  it("dedupes case-insensitively + strips whitespace", () => {
    const out = mergeCompanyTags(["azseker-azsf", "AAC"], ["AZSEKER-AZSF"])
    expect(out).toHaveLength(2)
  })

  it("drops empty strings", () => {
    expect(mergeCompanyTags(["", "  "], ["AAC"])).toEqual(["AAC"])
  })
})
